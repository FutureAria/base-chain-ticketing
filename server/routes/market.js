const express = require('express');
const crypto  = require('crypto');
const { getAddress, verifyMessage } = require('ethers');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const fabricService = require('../services/fabricBridge');
const { confirmPayment, cancelPayment } = require('../services/tossPayService');
const membershipService = require('../services/membershipService');
const notificationService = require('../services/notificationService');
const {
  verifyNativePayment,
  PaymentVerificationError,
} = require('../services/onchainPaymentService');

const router = express.Router();
let _pool;

function setPool(pool) {
  _pool = pool;
}

// ─── 헬퍼 ────────────────────────────────────────────────

function normalizeAddress(address) {
  try { return getAddress(String(address)).toLowerCase(); } catch { return String(address).toLowerCase(); }
}

// ─── 설정 ────────────────────────────────────────────────

const PLATFORM_FEE_RATE         = 0.09;
const MARKET_NATIVE_SYMBOL      = process.env.MARKET_NATIVE_SYMBOL      ?? 'HOODI';
const MARKET_NATIVE_PRICE_KRW   = Number(process.env.MARKET_NATIVE_PRICE_KRW ?? 3700000);
const MARKET_RESERVATION_SECONDS = Number(process.env.MARKET_RESERVATION_SECONDS ?? 120);
const MARKET_SALE_REWARD_RATE = 0.001;
const MARKET_SALE_DAILY_REWARD_LIMIT = 2;

async function ensureMarketPaymentColumns(conn) {
  const [columns] = await conn.query(`SHOW COLUMNS FROM purchase_history`);
  const existing = new Set(columns.map((c) => c.Field));
  if (!existing.has('toss_payment_key')) {
    await conn.query(`ALTER TABLE purchase_history ADD COLUMN toss_payment_key VARCHAR(200) DEFAULT NULL AFTER tx_hash`);
  }
}

// ─── 유틸 ────────────────────────────────────────────────

function createTokenId(prefix) {
  return `${prefix}-${crypto.randomBytes(9).toString('hex').toUpperCase()}`;
}

function createTxHash() {
  return `0x${crypto.randomBytes(32).toString('hex')}`;
}

function formatNativeAmount(priceKrw) {
  if (!Number.isFinite(priceKrw) || priceKrw <= 0) return { wei: '0', hex: '0x0', display: '0' };
  const weiPerNative = BigInt('1000000000000000000');
  const rate = Number.isFinite(MARKET_NATIVE_PRICE_KRW) && MARKET_NATIVE_PRICE_KRW > 0
    ? MARKET_NATIVE_PRICE_KRW : 3700000;
  const weiAmount = (BigInt(Math.round(priceKrw)) * weiPerNative) / BigInt(Math.round(rate));
  const safeWei = weiAmount > 0n ? weiAmount : 1n;
  return {
    wei: safeWei.toString(),
    hex: `0x${safeWei.toString(16)}`,
    display: (Number(safeWei) / 1e18).toFixed(6).replace(/0+$/, '').replace(/\.$/, ''),
  };
}

function formatRelativePostedAt(dateValue) {
  const diffMinutes = Math.max(0, Math.floor((Date.now() - new Date(dateValue).getTime()) / 60000));
  if (diffMinutes < 1)  return '방금 전';
  if (diffMinutes < 60) return `${diffMinutes}분 전`;
  return `${Math.floor(diffMinutes / 60)}시간 전`;
}

function formatTradeTime(dateValue) {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
  }).format(new Date(dateValue));
}

function formatChartDate(dateValue) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul',
  }).format(new Date(dateValue)).replace('. ', '/').replace('.', '');
}

function shortBuyerLabel(identifier) {
  if (!identifier) return '알 수 없음';
  if (identifier.startsWith('0x')) return `${identifier.slice(0, 6)}...${identifier.slice(-4)}`;
  return `0x${identifier.slice(0, 2)}...${identifier.slice(-4)}`;
}

async function getWalletAddress(userId) {
  const [[wallet]] = await _pool.query(
    'SELECT wallet_address FROM user_wallets WHERE user_id = ?',
    [userId]
  );
  return wallet?.wallet_address ?? `0x${'0'.repeat(40)}`;
}

// nft_tokens와 user_fragments 카운트를 동기화해 판매 가능 토큰 확보
async function ensureFragmentTokenPool(userId, fragmentTypeId, walletAddress, conn) {
  const db = conn || _pool;
  const [[aggRow]] = await db.query(
    'SELECT COALESCE(count, 0) AS count FROM user_fragments WHERE user_id = ? AND fragment_type_id = ?',
    [userId, fragmentTypeId]
  );
  const aggregateCount = Number(aggRow?.count ?? 0);

  const [[tokenRow]] = await db.query(
    `SELECT COUNT(*) AS tokenCount FROM nft_tokens
     WHERE owner_user_id = ? AND fragment_type_id = ? AND status = 'owned'`,
    [userId, fragmentTypeId]
  );
  const currentTokenCount = Number(tokenRow?.tokenCount ?? 0);

  for (let i = currentTokenCount; i < aggregateCount; i++) {
    const tokenId = createTokenId('FRAG');
    const txHash  = createTxHash();
    await db.query(
      `INSERT INTO nft_tokens
         (token_id, token_type, owner_user_id, owner_wallet, fragment_type_id, status, source_action, mint_tx_hash, last_tx_hash)
       VALUES (?, 'fragment', ?, ?, ?, 'owned', 'sync_seed', ?, ?)`,
      [tokenId, userId, walletAddress, fragmentTypeId, txHash, txHash]
    );
  }
}

// 특정 마켓 자산의 상세 정보 빌드 (리스팅/거래/차트 포함)
async function buildFragmentMarket(assetId, userId) {
  const [[asset]] = await _pool.query(
    `SELECT ma.*, ft.image_url AS fragment_image, ft.result_name
     FROM market_assets ma
     LEFT JOIN fragment_types ft ON ft.id = ma.fragment_type_id
     WHERE ma.id = ?`,
    [assetId]
  );
  if (!asset || !asset.fragment_type_id) return null;
  const fragTypeId = asset.fragment_type_id;

  let owned = 0;
  if (userId) {
    const [[ownRow]] = await _pool.query(
      'SELECT COALESCE(count, 0) AS count FROM user_fragments WHERE user_id = ? AND fragment_type_id = ?',
      [userId, fragTypeId]
    );
    owned = Number(ownRow?.count ?? 0);
  }

  const [listings] = await _pool.query(
    `SELECT ml.id, u.nickname AS sellerName, u.nickname AS sellerHandle,
            ml.quantity, ml.price, ml.posted_at AS postedAtRaw
     FROM market_listings ml
     JOIN users u ON u.user_id = ml.seller_id
     WHERE ml.fragment_type_id = ? AND ml.is_active = TRUE
     ORDER BY ml.price ASC, ml.posted_at DESC`,
    [fragTypeId]
  );

  const [myListings] = userId
    ? await _pool.query(
        `SELECT ml.id, u.nickname AS sellerName, u.nickname AS sellerHandle,
                ml.quantity, ml.price, ml.posted_at AS postedAtRaw
         FROM market_listings ml
         JOIN users u ON u.user_id = ml.seller_id
         WHERE ml.fragment_type_id = ? AND ml.is_active = TRUE AND ml.seller_id = ?
         ORDER BY ml.price ASC`,
        [fragTypeId, userId]
      )
    : [[]];

  const [tradesRaw] = await _pool.query(
    `SELECT traded_at AS tradedAtRaw, price, quantity AS volume,
            buyer_id AS buyerId, buyer_wallet_address AS buyerWalletAddress,
            seller_wallet_address AS sellerWalletAddress, token_id AS tokenId,
            platform_fee AS platformFee, tx_hash AS txHash
     FROM trades WHERE fragment_type_id = ?
     ORDER BY traded_at DESC LIMIT 10`,
    [fragTypeId]
  );

  const [chartRaw] = await _pool.query(
    `SELECT recorded_date AS recordedDateRaw, price
     FROM price_history WHERE fragment_type_id = ?
     ORDER BY recorded_date ASC LIMIT 7`,
    [fragTypeId]
  );

  const [[volumeRow]] = await _pool.query(
    `SELECT COALESCE(SUM(quantity), 0) AS volume FROM trades
     WHERE fragment_type_id = ? AND traded_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)`,
    [fragTypeId]
  );

  const formattedListings = listings.map(l => ({ ...l, postedAt: formatRelativePostedAt(l.postedAtRaw) }));
  const formattedMyListings = myListings.map(l => ({ ...l, postedAt: formatRelativePostedAt(l.postedAtRaw) }));
  const chart = chartRaw.map(c => ({ time: formatChartDate(c.recordedDateRaw), price: c.price }));
  const floorPrice  = formattedListings[0]?.price ?? 0;
  const listedCount = formattedListings.reduce((s, l) => s + Number(l.quantity), 0);
  const lastPrice   = tradesRaw[0]?.price ?? floorPrice;
  const prevPrice   = chart.length >= 2 ? chart[chart.length - 2].price : lastPrice;
  const changeRate  = prevPrice > 0 ? Math.round(((lastPrice - prevPrice) / prevPrice) * 1000) / 10 : 0;

  const trades = tradesRaw.map((t, i, arr) => ({
    time: formatTradeTime(t.tradedAtRaw),
    type: i === arr.length - 1 ? '신규 등록'
        : t.price >= (arr[i + 1]?.price ?? t.price) ? '상승 체결' : '하락 체결',
    price: t.price,
    volume: t.volume,
    buyer: shortBuyerLabel(t.buyerWalletAddress ?? t.buyerId),
    buyerWalletAddress: t.buyerWalletAddress,
    sellerWalletAddress: t.sellerWalletAddress,
    tokenId: t.tokenId,
    platformFee: Number(t.platformFee ?? 0),
    txHash: t.txHash,
  }));

  return {
    id: asset.id,
    idol: asset.idol,
    fragmentName: asset.asset_name,
    resultName: asset.result_name ?? null,
    color: asset.color,
    accent: asset.accent,
    imageUrl: asset.fragment_image ?? null,
    owned,
    floorPrice,
    lastPrice,
    changeRate,
    volume24h: Number(volumeRow?.volume ?? 0),
    demandScore: asset.demand_score,
    listedCount,
    description: asset.description,
    chart,
    trades,
    listings: formattedListings,
    myListings: formattedMyListings,
  };
}

// ─── GET /api/market/fragments ───────────────────────────

router.get('/fragments', optionalAuth, async (req, res) => {
  const userId = req.user?.user_id ?? null;
  try {
    const [assets] = await _pool.query('SELECT id FROM market_assets ORDER BY demand_score DESC');
    const results = await Promise.all(assets.map(a => buildFragmentMarket(a.id, userId)));
    res.json(results.filter(Boolean));
  } catch (err) {
    console.error('[market/fragments]', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ─── GET /api/market/fragments/:id ──────────────────────

router.get('/fragments/:id', optionalAuth, async (req, res) => {
  const userId = req.user?.user_id ?? null;
  try {
    const fragment = await buildFragmentMarket(req.params.id, userId);
    if (!fragment) return res.status(404).json({ error: '자산을 찾을 수 없습니다' });
    res.json(fragment);
  } catch (err) {
    console.error('[market/fragments/:id]', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ─── POST /api/market/buy/prepare ───────────────────────

router.post('/buy/prepare', requireAuth, async (req, res) => {
  const userId = req.user.user_id;
  const { listingId, fragmentId } = req.body;
  if (!listingId) return res.status(400).json({ error: 'listingId 필요' });

  const buyerWalletAddress = await getWalletAddress(userId);
  const conn = await _pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[listing]] = await conn.query(
      `SELECT ml.*, u.nickname AS seller_name
       FROM market_listings ml
       JOIN users u ON u.user_id = ml.seller_id
       WHERE ml.id = ? AND ml.is_active = TRUE
         AND (ml.reserved_by IS NULL OR ml.reserved_by = ?
              OR ml.reserved_until IS NULL OR ml.reserved_until < NOW())
       FOR UPDATE`,
      [listingId, userId]
    );

    if (!listing) {
      await conn.rollback();
      return res.status(409).json({ error: '이미 판매 완료되었거나 다른 사용자가 결제 중인 매물입니다' });
    }
    if (listing.seller_id === userId) {
      await conn.rollback();
      return res.status(400).json({ error: '본인 매물은 구매할 수 없습니다' });
    }

    const [[sellerWalletRow]] = await conn.query(
      'SELECT wallet_address FROM user_wallets WHERE user_id = ?',
      [listing.seller_id]
    );
    const sellerWalletAddress = sellerWalletRow?.wallet_address ?? listing.seller_wallet_address ?? `0x${'0'.repeat(40)}`;
    const nativeAmount = formatNativeAmount(listing.price);

    await conn.query(
      `UPDATE market_listings
       SET reserved_by = ?, reserved_until = DATE_ADD(NOW(), INTERVAL ? SECOND)
       WHERE id = ?`,
      [userId, MARKET_RESERVATION_SECONDS, listingId]
    );

    await conn.commit();

    res.json({
      listingId,
      fragmentId: fragmentId ?? listing.fragment_type_id,
      price: listing.price,
      quantity: 1,
      sellerName: listing.seller_name,
      sellerHandle: listing.seller_name,
      sellerWalletAddress,
      buyerWalletAddress,
      nativeSymbol: MARKET_NATIVE_SYMBOL,
      nativePriceKrw: MARKET_NATIVE_PRICE_KRW,
      paymentAmountWei: nativeAmount.wei,
      paymentAmountHex: nativeAmount.hex,
      paymentAmountDisplay: nativeAmount.display,
      reservationExpiresIn: MARKET_RESERVATION_SECONDS,
    });
  } catch (err) {
    await conn.rollback();
    console.error('[market/buy/prepare]', err);
    res.status(500).json({ error: '구매 준비 중 오류가 발생했습니다' });
  } finally {
    conn.release();
  }
});

// ─── POST /api/market/buy ────────────────────────────────

router.post('/buy', requireAuth, async (req, res) => {
  const userId = req.user.user_id;
  const { listingId, fragmentId, txHash } = req.body;
  if (!listingId || !txHash) return res.status(400).json({ error: 'listingId와 txHash가 필요합니다' });

  const buyerWalletAddress = await getWalletAddress(userId);
  const conn = await _pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[listing]] = await conn.query(
      `SELECT ml.*, u.nickname AS seller_name
       FROM market_listings ml
       JOIN users u ON u.user_id = ml.seller_id
       WHERE ml.id = ? AND ml.is_active = TRUE
         AND ml.reserved_by = ? AND ml.reserved_until IS NOT NULL AND ml.reserved_until > NOW()
       FOR UPDATE`,
      [listingId, userId]
    );

    if (!listing) {
      await conn.rollback();
      return res.status(409).json({ error: '구매 준비가 만료되었거나 이미 판매 완료된 매물입니다' });
    }
    if (listing.seller_id === userId) {
      await conn.rollback();
      return res.status(400).json({ error: '본인 매물은 구매할 수 없습니다' });
    }

    const [[sellerWalletRow]] = await conn.query(
      'SELECT wallet_address FROM user_wallets WHERE user_id = ?',
      [listing.seller_id]
    );
    const sellerWalletAddress = sellerWalletRow?.wallet_address ?? listing.seller_wallet_address ?? `0x${'0'.repeat(40)}`;

    // 같은 트랜잭션 해시를 두 번 쓰는 것을 막는다 (한 번의 결제로 여러 매물 획득 방지).
    const [[usedTx]] = await conn.query(
      'SELECT token_id FROM nft_tokens WHERE last_tx_hash = ? LIMIT 1',
      [txHash],
    );
    if (usedTx) {
      await conn.rollback();
      return res.status(409).json({ error: '이미 사용된 결제 트랜잭션입니다.' });
    }

    // 클라이언트가 보낸 txHash 를 그대로 믿으면 결제 없이 조각을 가져갈 수 있다.
    // 체인에서 직접 조회해 수신자·금액·성공 여부를 확인하고, 확인할 수 없으면 거부한다.
    try {
      await verifyNativePayment({
        txHash,
        expectedTo: sellerWalletAddress,
        expectedWei: formatNativeAmount(listing.price).wei,
      });
    } catch (payErr) {
      await conn.rollback();
      if (payErr instanceof PaymentVerificationError) {
        console.warn(`[market/buy] 결제 검증 실패: user=${userId} listing=${listingId} — ${payErr.message}`);
        return res.status(payErr.statusCode).json({ error: payErr.message });
      }
      throw payErr;
    }

    const platformFee      = Math.floor(listing.price * PLATFORM_FEE_RATE);
    const settlementAmount = listing.price - platformFee;

    // nft_tokens 이전
    let tradedTokenId = null;
    const [[tokenRow]] = await conn.query(
      `SELECT token_id FROM nft_tokens
       WHERE listed_listing_id = ? AND status = 'listed'
       ORDER BY minted_at ASC LIMIT 1 FOR UPDATE`,
      [listingId]
    );

    if (tokenRow) {
      tradedTokenId = tokenRow.token_id;
      await conn.query(
        `UPDATE nft_tokens
         SET owner_user_id = ?, owner_wallet = ?, listed_listing_id = NULL,
             status = 'owned', last_tx_hash = ?, updated_at = CURRENT_TIMESTAMP
         WHERE token_id = ?`,
        [userId, buyerWalletAddress, txHash, tradedTokenId]
      );
    } else {
      tradedTokenId = createTokenId('FRAG');
      await conn.query(
        `INSERT INTO nft_tokens
           (token_id, token_type, owner_user_id, owner_wallet, fragment_type_id, status, source_action, mint_tx_hash, last_tx_hash)
         VALUES (?, 'fragment', ?, ?, ?, 'owned', 'market_seed_transfer', ?, ?)`,
        [tradedTokenId, userId, buyerWalletAddress, listing.fragment_type_id, txHash, txHash]
      );
    }

    // 매물 처리 (수량 1이면 비활성, 아니면 감소)
    if (listing.quantity === 1) {
      await conn.query(
        'UPDATE market_listings SET is_active = FALSE, reserved_by = NULL, reserved_until = NULL WHERE id = ?',
        [listingId]
      );
    } else {
      await conn.query(
        'UPDATE market_listings SET quantity = quantity - 1, reserved_by = NULL, reserved_until = NULL WHERE id = ?',
        [listingId]
      );
    }

    // 구매자 인벤토리 증가
    await conn.query(
      `INSERT INTO user_fragments (user_id, fragment_type_id, count)
       VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE count = count + 1`,
      [userId, listing.fragment_type_id]
    );

    // 거래 기록
    await conn.query(
      `INSERT INTO trades
         (fragment_type_id, listing_id, buyer_id, seller_id,
          buyer_wallet_address, seller_wallet_address, token_id,
          price, quantity, platform_fee, settlement_amount, tx_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [listing.fragment_type_id, listingId, userId, listing.seller_id,
       buyerWalletAddress, sellerWalletAddress, tradedTokenId,
       listing.price, platformFee, settlementAmount, txHash]
    );

    // 가격 히스토리 갱신
    await conn.query(
      `INSERT INTO price_history (fragment_type_id, price, recorded_date)
       VALUES (?, ?, CURDATE()) ON DUPLICATE KEY UPDATE price = VALUES(price)`,
      [listing.fragment_type_id, listing.price]
    );

    const purchaseHistoryId = crypto.randomUUID();
    await conn.query(
      `INSERT INTO purchase_history
         (id, buyer_id, fragment_type_id, listing_id, seller_id,
          buyer_wallet_address, seller_wallet_address, token_id,
          price, quantity, platform_fee, settlement_amount, tx_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [purchaseHistoryId, userId, listing.fragment_type_id, listingId, listing.seller_id,
       buyerWalletAddress, sellerWalletAddress, tradedTokenId,
       listing.price, platformFee, settlementAmount, txHash]
    );

    await conn.query(
      `INSERT INTO onchain_tx_logs
         (id, user_id, wallet_address, action_type, tx_hash, token_id, payload_json)
       VALUES (UUID(), ?, ?, 'FRAGMENT_TRANSFER', ?, ?,
               JSON_OBJECT('listingId', ?, 'sellerWallet', ?, 'buyerWallet', ?, 'price', ?, 'platformFee', ?, 'settlementAmount', ?))`,
      [userId, buyerWalletAddress, txHash, tradedTokenId,
       listingId, sellerWalletAddress, buyerWalletAddress,
       listing.price, platformFee, settlementAmount]
    );

    await conn.commit();

    // 판매자 포인트 적립 (거래금액 0.1%, 하루 2건 한도)
    let earnedPoint = 0;
    try {
      const [[{ cnt }]] = await _pool.query(
        `SELECT COUNT(*) AS cnt
           FROM point_events
          WHERE user_id = ?
            AND event_type = 'MARKET_SALE_REWARD'
            AND DATE(created_at) = CURDATE()`,
        [listing.seller_id],
      );
      const memberJoined = await membershipService.isMembershipActive(_pool, listing.seller_id);
      if (memberJoined && Number(cnt) < MARKET_SALE_DAILY_REWARD_LIMIT) {
        const result = await fabricService.earnPointFromTrade({
          userDidHash: fabricService.hashDid(sellerWalletAddress),
          amount: listing.price,
          rate:   MARKET_SALE_REWARD_RATE,
        });
        earnedPoint = result.earnedPoint;
        await membershipService.recordPointEvent(_pool, {
          userId: listing.seller_id,
          walletAddress: sellerWalletAddress,
          eventType: 'MARKET_SALE_REWARD',
          reason: '팬 자산 판매 완료',
          amount: earnedPoint,
          metadata: {
            listingId,
            fragmentTypeId: listing.fragment_type_id,
            price: listing.price,
            rate: MARKET_SALE_REWARD_RATE,
            dailyLimit: MARKET_SALE_DAILY_REWARD_LIMIT,
          },
        });
        console.log(`[market] 판매자 포인트 적립: ${earnedPoint}P (거래금액 ${listing.price}원 × 0.1%)`);
      }
    } catch (pointErr) {
      console.error('[market] 포인트 적립 실패:', pointErr.message);
    }

    const [[assetRow]] = await _pool.query(
      'SELECT id, idol, asset_name FROM market_assets WHERE fragment_type_id = ? LIMIT 1',
      [listing.fragment_type_id]
    );
    const assetId = assetRow?.id ?? fragmentId ?? listing.fragment_type_id;
    await notificationService.recordNotification(_pool, {
      userId,
      category: 'TRADE',
      title: '팬 자산 구매 완료',
      message: `${assetRow?.asset_name ?? '굿즈 파편'} 구매가 완료되었습니다.`,
      amount: Number(listing.price),
      metadata: { listingId, fragmentTypeId: listing.fragment_type_id, sellerId: listing.seller_id, purchaseHistoryId },
    });
    await notificationService.recordNotification(_pool, {
      userId: listing.seller_id,
      category: 'TRADE',
      title: '팬 자산 판매 완료',
      message: `${assetRow?.asset_name ?? '굿즈 파편'} 판매가 완료되었습니다.`,
      amount: Number(listing.price),
      metadata: { listingId, fragmentTypeId: listing.fragment_type_id, buyerId: userId, purchaseHistoryId },
    });
    const updatedFragment = await buildFragmentMarket(assetId, userId);

    console.log(`[market] 파편 거래 완료: ${assetRow?.asset_name ?? listing.fragment_type_id} | ${listing.price}원 | 구매자: ${userId} | 판매자: ${listing.seller_id}`);

    res.json({
      receipt: { fragmentId: assetId, sellerName: listing.seller_name, price: listing.price, earnedPoint },
      purchaseRecord: {
        id: purchaseHistoryId,
        fragmentId: assetId,
        idol: assetRow?.idol ?? '',
        fragmentName: assetRow?.asset_name ?? '',
        sellerName: listing.seller_name,
        sellerHandle: listing.seller_name,
        price: listing.price,
        quantity: 1,
        platformFee,
        settlementAmount,
        tokenId: tradedTokenId,
        txHash,
        purchasedAt: new Intl.DateTimeFormat('ko-KR', {
          month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
          hour12: false, timeZone: 'Asia/Seoul',
        }).format(new Date()),
      },
      soldOut: listing.quantity === 1,
      updatedFragment,
    });
  } catch (err) {
    await conn.rollback();
    console.error('[market/buy]', err);
    res.status(500).json({ error: '구매 처리 중 오류가 발생했습니다' });
  } finally {
    conn.release();
  }
});

// ─── POST /api/market/listings ───────────────────────────

router.post('/listings', requireAuth, async (req, res) => {
  const userId = req.user.user_id;
  const { fragmentId, price, quantity, listingMessage, listingSignature } = req.body;

  if (!fragmentId || !price || !quantity)
    return res.status(400).json({ error: 'fragmentId, price, quantity 필요' });
  if (!Number.isFinite(price) || price < 1000)
    return res.status(400).json({ error: '판매 가격은 1,000원 이상이어야 합니다' });
  if (!Number.isInteger(quantity) || quantity <= 0)
    return res.status(400).json({ error: '판매 수량은 1개 이상의 정수여야 합니다' });
  if (!listingMessage || !listingSignature)
    return res.status(400).json({ error: 'MetaMask 서명이 필요합니다' });

  const sellerWalletAddress = await getWalletAddress(userId);
  if (!sellerWalletAddress)
    return res.status(400).json({ error: '등록된 지갑 주소가 없습니다' });

  // MetaMask 서명 검증
  let recoveredAddress = '';
  try {
    recoveredAddress = verifyMessage(String(listingMessage), String(listingSignature));
  } catch {
    return res.status(400).json({ error: 'MetaMask 서명을 검증할 수 없습니다' });
  }
  if (normalizeAddress(recoveredAddress) !== normalizeAddress(sellerWalletAddress))
    return res.status(400).json({ error: 'MetaMask 서명자와 판매자 지갑이 일치하지 않습니다' });
  if (!String(listingMessage).includes(String(fragmentId)))
    return res.status(400).json({ error: '서명 메시지와 파편 정보가 일치하지 않습니다' });
  const conn = await _pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[assetRow]] = await conn.query(
      'SELECT fragment_type_id FROM market_assets WHERE id = ?',
      [fragmentId]
    );
    const fragmentTypeId = assetRow?.fragment_type_id;
    if (!fragmentTypeId) {
      await conn.rollback();
      return res.status(400).json({ error: '현재 판매 등록이 지원되지 않는 자산입니다' });
    }

    const [[ownedRow]] = await conn.query(
      'SELECT count FROM user_fragments WHERE user_id = ? AND fragment_type_id = ? FOR UPDATE',
      [userId, fragmentTypeId]
    );
    if (Number(ownedRow?.count ?? 0) < quantity) {
      await conn.rollback();
      return res.status(400).json({ error: '보유 수량이 부족합니다' });
    }

    await ensureFragmentTokenPool(userId, fragmentTypeId, sellerWalletAddress, conn);

    const listingId   = crypto.randomUUID();
    const listingTxHash = createTxHash();

    const [tokenRows] = await conn.query(
      `SELECT token_id FROM nft_tokens
       WHERE owner_user_id = ? AND fragment_type_id = ? AND status = 'owned'
       ORDER BY minted_at ASC LIMIT ? FOR UPDATE`,
      [userId, fragmentTypeId, quantity]
    );

    if (tokenRows.length < quantity) {
      await conn.rollback();
      return res.status(400).json({ error: '판매 가능한 파편 토큰이 부족합니다' });
    }

    await conn.query(
      'UPDATE user_fragments SET count = count - ? WHERE user_id = ? AND fragment_type_id = ?',
      [quantity, userId, fragmentTypeId]
    );

    await conn.query(
      `INSERT INTO market_listings (id, seller_id, seller_wallet_address, fragment_type_id, price, quantity, listing_message, listing_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [listingId, userId, sellerWalletAddress, fragmentTypeId, price, quantity, listingMessage, listingSignature]
    );

    for (const token of tokenRows) {
      await conn.query(
        `UPDATE nft_tokens
         SET status = 'listed', listed_listing_id = ?, last_tx_hash = ?, updated_at = CURRENT_TIMESTAMP
         WHERE token_id = ?`,
        [listingId, listingTxHash, token.token_id]
      );
    }

    await conn.query(
      `INSERT INTO onchain_tx_logs
         (id, user_id, wallet_address, action_type, tx_hash, payload_json)
       VALUES (UUID(), ?, ?, 'FRAGMENT_LIST', ?,
               JSON_OBJECT('listingId', ?, 'fragmentTypeId', ?, 'quantity', ?, 'price', ?))`,
      [userId, sellerWalletAddress, listingTxHash, listingId, fragmentTypeId, quantity, price]
    );

    await conn.commit();

    console.log(`[market] 파편 매물 등록: fragmentId ${fragmentId} | ${price}원 × ${quantity}개 | 판매자: ${userId} | 지갑: ${sellerWalletAddress?.slice(0, 10)}...`);

    const updatedFragment = await buildFragmentMarket(fragmentId, userId);
    res.json({ listingId, sellerHandle: userId, sellerWalletAddress, txHash: listingTxHash, updatedFragment });
  } catch (err) {
    await conn.rollback();
    console.error('[market/listings POST]', err);
    res.status(500).json({ error: '판매 등록 중 오류가 발생했습니다' });
  } finally {
    conn.release();
  }
});

// ─── DELETE /api/market/listings/:id ────────────────────

router.delete('/listings/:id', requireAuth, async (req, res) => {
  const userId = req.user.user_id;
  const conn = await _pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[listing]] = await conn.query(
      'SELECT * FROM market_listings WHERE id = ? AND is_active = TRUE FOR UPDATE',
      [req.params.id]
    );
    if (!listing) {
      await conn.rollback();
      return res.status(404).json({ error: '매물을 찾을 수 없습니다' });
    }
    if (listing.seller_id !== userId) {
      await conn.rollback();
      return res.status(403).json({ error: '본인 매물만 취소할 수 있습니다' });
    }

    const walletAddress = await getWalletAddress(userId);
    const cancelTxHash  = createTxHash();

    await conn.query('UPDATE market_listings SET is_active = FALSE WHERE id = ?', [req.params.id]);
    await conn.query(
      `UPDATE nft_tokens
       SET status = 'owned', listed_listing_id = NULL, last_tx_hash = ?, updated_at = CURRENT_TIMESTAMP
       WHERE listed_listing_id = ? AND status = 'listed'`,
      [cancelTxHash, req.params.id]
    );
    await conn.query(
      `INSERT INTO user_fragments (user_id, fragment_type_id, count)
       VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE count = count + VALUES(count)`,
      [userId, listing.fragment_type_id, listing.quantity]
    );
    await conn.query(
      `INSERT INTO onchain_tx_logs
         (id, user_id, wallet_address, action_type, tx_hash, payload_json)
       VALUES (UUID(), ?, ?, 'FRAGMENT_UNLIST', ?,
               JSON_OBJECT('listingId', ?, 'fragmentTypeId', ?, 'restoredQuantity', ?))`,
      [userId, walletAddress, cancelTxHash, req.params.id, listing.fragment_type_id, listing.quantity]
    );

    await conn.commit();

    const [[assetRow]] = await _pool.query(
      'SELECT id FROM market_assets WHERE fragment_type_id = ?',
      [listing.fragment_type_id]
    );
    const assetId = assetRow?.id ?? listing.fragment_type_id;
    const updatedFragment = await buildFragmentMarket(assetId, userId);
    res.json({ success: true, updatedFragment });
  } catch (err) {
    await conn.rollback();
    console.error('[market/listings DELETE]', err);
    res.status(500).json({ error: '매물 취소 중 오류가 발생했습니다' });
  } finally {
    conn.release();
  }
});

// ─── PATCH /api/market/listings/:id ─────────────────────

router.patch('/listings/:id', requireAuth, async (req, res) => {
  const userId = req.user.user_id;
  const { price } = req.body;
  if (!Number.isFinite(price) || price < 1000)
    return res.status(400).json({ error: '가격은 1,000원 이상이어야 합니다' });

  const conn = await _pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[listing]] = await conn.query(
      'SELECT * FROM market_listings WHERE id = ? AND is_active = TRUE FOR UPDATE',
      [req.params.id]
    );
    if (!listing) {
      await conn.rollback();
      return res.status(404).json({ error: '매물을 찾을 수 없습니다' });
    }
    if (listing.seller_id !== userId) {
      await conn.rollback();
      return res.status(403).json({ error: '본인 매물만 수정할 수 있습니다' });
    }

    await conn.query(
      'UPDATE market_listings SET price = ?, posted_at = NOW() WHERE id = ?',
      [price, req.params.id]
    );
    await conn.commit();

    const [[assetRow]] = await _pool.query(
      'SELECT id FROM market_assets WHERE fragment_type_id = ?',
      [listing.fragment_type_id]
    );
    const assetId = assetRow?.id ?? listing.fragment_type_id;
    const updatedFragment = await buildFragmentMarket(assetId, userId);
    res.json({ success: true, updatedFragment });
  } catch (err) {
    await conn.rollback();
    console.error('[market/listings PATCH]', err);
    res.status(500).json({ error: '가격 수정 중 오류가 발생했습니다' });
  } finally {
    conn.release();
  }
});

// ─── GET /api/market/purchases ───────────────────────────

router.get('/purchases', requireAuth, async (req, res) => {
  const userId = req.user.user_id;
  try {
    const [rows] = await _pool.query(
      `SELECT ph.id,
              COALESCE(ma.id, ph.fragment_type_id) AS fragmentId,
              ma.idol,
              ma.asset_name    AS fragmentName,
              u.nickname       AS sellerName,
              u.nickname       AS sellerHandle,
              ph.price, ph.quantity,
              ph.platform_fee  AS platformFee,
              ph.settlement_amount AS settlementAmount,
              ph.token_id      AS tokenId,
              ph.tx_hash       AS txHash,
              ph.buyer_wallet_address  AS buyerWalletAddress,
              ph.seller_wallet_address AS sellerWalletAddress,
              ph.purchased_at  AS purchasedAtRaw
       FROM purchase_history ph
       JOIN market_assets ma ON ma.fragment_type_id = ph.fragment_type_id
       JOIN users u ON u.user_id = ph.seller_id
       WHERE ph.buyer_id = ?
       ORDER BY ph.purchased_at DESC LIMIT 50`,
      [userId]
    );
    res.json(rows.map(r => ({
      ...r,
      purchasedAt: new Intl.DateTimeFormat('ko-KR', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        hour12: false, timeZone: 'Asia/Seoul',
      }).format(new Date(r.purchasedAtRaw)),
    })));
  } catch (err) {
    console.error('[market/purchases]', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ─── GET /api/market/sales ───────────────────────────────

router.get('/sales', requireAuth, async (req, res) => {
  const userId = req.user.user_id;
  try {
    const [rows] = await _pool.query(
      `SELECT t.id,
              COALESCE(ma.id, t.fragment_type_id) AS fragmentId,
              ma.idol,
              ma.asset_name    AS fragmentName,
              t.buyer_wallet_address  AS buyerWalletAddress,
              t.seller_wallet_address AS sellerWalletAddress,
              t.token_id       AS tokenId,
              t.tx_hash        AS txHash,
              t.price, t.quantity,
              t.platform_fee   AS platformFee,
              t.settlement_amount AS settlementAmount,
              t.traded_at      AS tradedAtRaw
       FROM trades t
       JOIN market_assets ma ON ma.fragment_type_id = t.fragment_type_id
       WHERE t.seller_id = ?
       ORDER BY t.traded_at DESC LIMIT 50`,
      [userId]
    );
    res.json(rows.map(r => ({
      ...r,
      tradedAt: new Intl.DateTimeFormat('ko-KR', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        hour12: false, timeZone: 'Asia/Seoul',
      }).format(new Date(r.tradedAtRaw)),
    })));
  } catch (err) {
    console.error('[market/sales]', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ─── POST /api/market/toss-confirm ──────────────────────

router.post('/toss-confirm', requireAuth, async (req, res) => {
  const userId = req.user.user_id;
  const { paymentKey, orderId, amount, listingId } = req.body;

  if (!paymentKey || !orderId || !amount || !listingId)
    return res.status(400).json({ error: '필수 항목 누락 (paymentKey, orderId, amount, listingId)' });

  const buyerWalletAddress = await getWalletAddress(userId);
  const conn = await _pool.getConnection();
  try {
    await ensureMarketPaymentColumns(conn);
    await conn.beginTransaction();

    const [[existingPurchase]] = await conn.query(
      `SELECT ph.*, u.nickname AS seller_name, ma.id AS asset_id, ma.idol, ma.asset_name
       FROM purchase_history ph
       LEFT JOIN users u ON u.user_id = ph.seller_id
       LEFT JOIN market_assets ma ON ma.fragment_type_id = ph.fragment_type_id
       WHERE ph.toss_payment_key = ? AND ph.buyer_id = ?
       LIMIT 1`,
      [paymentKey, userId]
    );
    if (existingPurchase) {
      await conn.commit();
      return res.json({
        success: true,
        alreadyProcessed: true,
        receipt: {
          fragmentId:       existingPurchase.asset_id ?? existingPurchase.fragment_type_id,
          idol:             existingPurchase.idol ?? '',
          fragmentName:     existingPurchase.asset_name ?? '',
          sellerName:       existingPurchase.seller_name ?? '',
          price:            existingPurchase.price,
          platformFee:      existingPurchase.platform_fee,
          settlementAmount: existingPurchase.settlement_amount,
          earnedPoint:      0,
          tokenId:          existingPurchase.token_id,
          txHash:           existingPurchase.tx_hash,
        },
      });
    }

    const [[listing]] = await conn.query(
      `SELECT ml.*, u.nickname AS seller_name
       FROM market_listings ml
       JOIN users u ON u.user_id = ml.seller_id
       WHERE ml.id = ? AND ml.is_active = TRUE
       FOR UPDATE`,
      [listingId]
    );

    if (!listing) {
      await conn.rollback();
      return res.status(404).json({ error: '이미 판매 완료되었거나 존재하지 않는 매물입니다' });
    }
    if (listing.seller_id === userId) {
      await conn.rollback();
      return res.status(400).json({ error: '본인 매물은 구매할 수 없습니다' });
    }
    if (Number(amount) !== Number(listing.price)) {
      await conn.rollback();
      return res.status(400).json({ error: '결제 금액이 매물 가격과 일치하지 않습니다' });
    }

    const tossResult = await confirmPayment({ paymentKey, orderId, amount: Number(amount) });
    if (!tossResult.success) {
      await conn.rollback();
      return res.status(400).json({ error: `결제 승인 실패: ${tossResult.message}` });
    }

    try {
      const txHash = createTxHash();
      const [[sellerWalletRow]] = await conn.query(
        'SELECT wallet_address FROM user_wallets WHERE user_id = ?',
        [listing.seller_id]
      );
      const sellerWalletAddress = sellerWalletRow?.wallet_address ?? listing.seller_wallet_address ?? `0x${'0'.repeat(40)}`;
      const platformFee      = Math.floor(listing.price * PLATFORM_FEE_RATE);
      const settlementAmount = listing.price - platformFee;

      let tradedTokenId = null;
      const [[tokenRow]] = await conn.query(
        `SELECT token_id FROM nft_tokens
         WHERE listed_listing_id = ? AND status = 'listed'
         ORDER BY minted_at ASC LIMIT 1 FOR UPDATE`,
        [listingId]
      );

      if (tokenRow) {
        tradedTokenId = tokenRow.token_id;
        await conn.query(
          `UPDATE nft_tokens
           SET owner_user_id = ?, owner_wallet = ?, listed_listing_id = NULL,
               status = 'owned', last_tx_hash = ?, updated_at = CURRENT_TIMESTAMP
           WHERE token_id = ?`,
          [userId, buyerWalletAddress, txHash, tradedTokenId]
        );
      } else {
        tradedTokenId = createTokenId('FRAG');
        await conn.query(
          `INSERT INTO nft_tokens
             (token_id, token_type, owner_user_id, owner_wallet, fragment_type_id, status, source_action, mint_tx_hash, last_tx_hash)
           VALUES (?, 'fragment', ?, ?, ?, 'owned', 'market_toss_transfer', ?, ?)`,
          [tradedTokenId, userId, buyerWalletAddress, listing.fragment_type_id, txHash, txHash]
        );
      }

      if (listing.quantity === 1) {
        await conn.query(
          'UPDATE market_listings SET is_active = FALSE, reserved_by = NULL, reserved_until = NULL WHERE id = ?',
          [listingId]
        );
      } else {
        await conn.query(
          'UPDATE market_listings SET quantity = quantity - 1, reserved_by = NULL, reserved_until = NULL WHERE id = ?',
          [listingId]
        );
      }

      await conn.query(
        `INSERT INTO user_fragments (user_id, fragment_type_id, count)
         VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE count = count + 1`,
        [userId, listing.fragment_type_id]
      );

      await conn.query(
        `INSERT INTO trades
           (fragment_type_id, listing_id, buyer_id, seller_id,
            buyer_wallet_address, seller_wallet_address, token_id,
            price, quantity, platform_fee, settlement_amount, tx_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        [listing.fragment_type_id, listingId, userId, listing.seller_id,
         buyerWalletAddress, sellerWalletAddress, tradedTokenId,
         listing.price, platformFee, settlementAmount, txHash]
      );

      await conn.query(
        `INSERT INTO price_history (fragment_type_id, price, recorded_date)
         VALUES (?, ?, CURDATE()) ON DUPLICATE KEY UPDATE price = VALUES(price)`,
        [listing.fragment_type_id, listing.price]
      );

      const purchaseHistoryId = crypto.randomUUID();
      await conn.query(
        `INSERT INTO purchase_history
           (id, buyer_id, fragment_type_id, listing_id, seller_id,
            buyer_wallet_address, seller_wallet_address, token_id,
            price, quantity, platform_fee, settlement_amount, tx_hash, toss_payment_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [purchaseHistoryId, userId, listing.fragment_type_id, listingId, listing.seller_id,
         buyerWalletAddress, sellerWalletAddress, tradedTokenId,
         listing.price, platformFee, settlementAmount, txHash, paymentKey]
      );

      await conn.query(
        `INSERT INTO onchain_tx_logs
           (id, user_id, wallet_address, action_type, tx_hash, token_id, payload_json)
         VALUES (UUID(), ?, ?, 'FRAGMENT_TRANSFER', ?, ?,
                 JSON_OBJECT('listingId', ?, 'sellerWallet', ?, 'buyerWallet', ?, 'price', ?, 'platformFee', ?, 'settlementAmount', ?, 'paymentKey', ?))`,
        [userId, buyerWalletAddress, txHash, tradedTokenId,
         listingId, sellerWalletAddress, buyerWalletAddress,
         listing.price, platformFee, settlementAmount, paymentKey]
      );

      await conn.commit();

      let earnedPoint = 0;
      try {
        const [[{ cnt }]] = await _pool.query(
          `SELECT COUNT(*) AS cnt
             FROM point_events
            WHERE user_id = ?
              AND event_type = 'MARKET_SALE_REWARD'
              AND DATE(created_at) = CURDATE()`,
          [listing.seller_id],
        );
        const memberJoined = await membershipService.isMembershipActive(_pool, listing.seller_id);
        if (memberJoined && Number(cnt) < MARKET_SALE_DAILY_REWARD_LIMIT) {
          const result = await fabricService.earnPointFromTrade({
            userDidHash: fabricService.hashDid(sellerWalletAddress),
            amount: listing.price,
            rate:   MARKET_SALE_REWARD_RATE,
          });
          earnedPoint = result.earnedPoint;
          await membershipService.recordPointEvent(_pool, {
            userId: listing.seller_id,
            walletAddress: sellerWalletAddress,
            eventType: 'MARKET_SALE_REWARD',
            reason: '팬 자산 판매 완료',
            amount: earnedPoint,
            metadata: {
              listingId,
              fragmentTypeId: listing.fragment_type_id,
              price: listing.price,
              paymentKey,
              rate: MARKET_SALE_REWARD_RATE,
              dailyLimit: MARKET_SALE_DAILY_REWARD_LIMIT,
            },
          });
          console.log(`[market/toss-confirm] 판매자 포인트 적립: ${earnedPoint}P (거래금액 ${listing.price}원 × 0.1%)`);
        }
      } catch (pointErr) {
        console.error('[market/toss-confirm] 포인트 적립 실패:', pointErr.message);
      }

      const [[assetRow]] = await _pool.query(
        'SELECT id, idol, asset_name FROM market_assets WHERE fragment_type_id = ? LIMIT 1',
        [listing.fragment_type_id]
      );

      await notificationService.recordNotification(_pool, {
        userId,
        category: 'TRADE',
        title: '팬 자산 구매 완료',
        message: `${assetRow?.asset_name ?? '굿즈 파편'} 구매가 완료되었습니다.`,
        amount: Number(listing.price),
        metadata: { listingId, fragmentTypeId: listing.fragment_type_id, sellerId: listing.seller_id, purchaseHistoryId, paymentKey },
      });
      await notificationService.recordNotification(_pool, {
        userId: listing.seller_id,
        category: 'TRADE',
        title: '팬 자산 판매 완료',
        message: `${assetRow?.asset_name ?? '굿즈 파편'} 판매가 완료되었습니다.`,
        amount: Number(listing.price),
        metadata: { listingId, fragmentTypeId: listing.fragment_type_id, buyerId: userId, purchaseHistoryId, paymentKey },
      });

      console.log(`[market/toss-confirm] 파편 거래 완료 (토스): ${assetRow?.asset_name ?? listing.fragment_type_id} | ${listing.price}원 | 구매자: ${userId}`);

      res.json({
        success: true,
        receipt: {
          fragmentId:       assetRow?.id ?? listingId,
          idol:             assetRow?.idol ?? '',
          fragmentName:     assetRow?.asset_name ?? '',
          sellerName:       listing.seller_name,
          price:            listing.price,
          platformFee,
          settlementAmount,
          earnedPoint,
          tokenId:          tradedTokenId,
          txHash,
        },
      });
    } catch (dbErr) {
      await conn.rollback();
      try {
        await cancelPayment({ paymentKey, cancelReason: '구매 처리 중 오류', cancelAmount: Number(amount) });
      } catch (cancelErr) {
        console.error('[market/toss-confirm] 보상 환불 실패:', cancelErr.message);
      }
      throw dbErr;
    }
  } catch (err) {
    if (!res.headersSent) {
      res.status(err.statusCode || 500).json({ error: err.message || '구매 처리 중 오류가 발생했습니다' });
    }
  } finally {
    conn.release();
  }
});

module.exports = { router, setPool };
