'use strict';

const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const fabricService = require('../services/fabricBridge');
const membershipService = require('../services/membershipService');
const notificationService = require('../services/notificationService');
const { mintCardOnChain, isOnChainMintingEnabled } = require('../services/nftService');
const { ensureUserCardsRuntimeColumns, ensurePhysicalRedemptionTable } = require('../services/schemaGuardService');

const router = express.Router();
let _pool;

function setPool(pool) {
  _pool = pool;
}

const TIER_LIMITS = {
  '베이직': { raffle: 1, nft: 1 },
  '브론즈': { raffle: 1, nft: 1 },
  '실버': { raffle: 2, nft: 1 },
  '골드': { raffle: 2, nft: 2 },
};

const CARD_NFT_COST = 5000;
function createCardNftId() {
  return `card-${crypto.randomBytes(8).toString('hex')}`;
}

function createTxHash() {
  return `0x${crypto.randomBytes(32).toString('hex')}`;
}

async function getMonthlyCount(userId, actionType) {
  if (actionType !== 'RAFFLE_PURCHASE') {
    const [[row]] = await _pool.query(
      `SELECT COUNT(*) AS cnt
         FROM onchain_tx_logs
        WHERE user_id = ? AND action_type = ?
          AND YEAR(created_at) = YEAR(NOW()) AND MONTH(created_at) = MONTH(NOW())`,
      [userId, actionType],
    );
    return Number(row?.cnt ?? 0);
  }

  const [[row]] = await _pool.query(
    `SELECT COALESCE(SUM(CAST(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.count')) AS UNSIGNED)), 0) AS cnt
       FROM onchain_tx_logs
      WHERE user_id = ? AND action_type = ?
        AND YEAR(created_at) = YEAR(NOW()) AND MONTH(created_at) = MONTH(NOW())`,
    [userId, actionType],
  );
  return Number(row?.cnt ?? 0);
}

async function getTier(userId) {
  const membership = await membershipService.getUserMembership(_pool, userId);
  return membership.joined ? membership.tier : null;
}

async function syncFabricDemoState({ userId, walletAddress }) {
  if (typeof fabricService.seedUser === 'function') {
    await membershipService.syncFabricUserFromDb({
      pool: _pool,
      fabricService,
      userId,
      walletAddress,
    });
    return;
  }

  const userDidHash = fabricService.hashDid(walletAddress);
  const membership = await membershipService.getUserMembership(_pool, userId);
  const grade = membershipService.toFabricTier(membership.tier || '베이직');
  await fabricService.joinMembership({ userDidHash });
  if (grade !== 'BASIC') {
    await fabricService.tierUpMembership({ userDidHash, targetGrade: grade });
  }
}

async function exchangePointItemWithRecoveredMembership({ userId, walletAddress, tier, itemType }) {
  const userDidHash = fabricService.hashDid(walletAddress);
  try {
    return await fabricService.exchangePointItem({ userDidHash, itemType });
  } catch (err) {
    const message = String(err.message || '');
    if (!message.includes('MEMBERSHIP_REQUIRED') && !message.includes('INSUFFICIENT_POINT')) throw err;
    await syncFabricDemoState({ userId, walletAddress, tier });
    return fabricService.exchangePointItem({ userDidHash, itemType });
  }
}

async function getCardPool() {
  const [cards] = await _pool.query(
    `SELECT id, team, name, image_url AS image, note
       FROM card_types
      ORDER BY id`,
  );
  return cards;
}

function pickRandomCard(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  return cards[crypto.randomInt(cards.length)];
}

async function assertVerifiedWallet(userId, walletAddress) {
  const [[wallet]] = await _pool.query(
    `SELECT wallet_address
       FROM user_wallets
      WHERE user_id = ? AND LOWER(wallet_address) = LOWER(?)`,
    [userId, walletAddress],
  );
  if (!wallet) throw new Error('현재 계정에 연결된 지갑으로만 이용할 수 있습니다.');
  return wallet.wallet_address;
}

async function completeCardExchangeOnFabric({
  exchangeId,
  userDidHash,
  cardTypeId,
  nftId,
  mintTxHash,
}) {
  if (!exchangeId || typeof fabricService.completePointCardExchange !== 'function') return null;
  try {
    const completed = await fabricService.completePointCardExchange({
      exchangeId,
      userDidHash,
      cardTypeId,
      nftId,
      mintTxHash,
    });
    await _pool.query(
      `INSERT INTO fabric_events
         (id, event_name, user_did_hash, payload_json, fabric_tx_id)
       VALUES (?, 'CARD_NFT_MINT_COMPLETED', ?, ?, ?)`,
      [
        uuidv4(),
        userDidHash,
        JSON.stringify({ exchangeId, cardTypeId, nftId, mintTxHash, status: completed?.status || 'MINT_COMPLETED' }),
        null,
      ],
    );
    return completed;
  } catch (err) {
    console.error('[exchange/card-nft] Fabric 발급 완료 기록 실패:', err.message);
    return null;
  }
}

router.get('/status', requireAuth, async (req, res) => {
  try {
    const tier = await getTier(req.user.user_id);
    const limits = tier ? (TIER_LIMITS[tier] || TIER_LIMITS['베이직']) : { raffle: 0, nft: 0 };
    const [raffleUsed, nftUsed, cardPool] = await Promise.all([
      getMonthlyCount(req.user.user_id, 'RAFFLE_PURCHASE'),
      getMonthlyCount(req.user.user_id, 'NFT_EXCHANGE_REQUESTED'),
      getCardPool(),
    ]);

    res.json({
      success: true,
      tier,
      limits,
      cardNftCost: CARD_NFT_COST,
      cardPool,
      used: { raffle: raffleUsed, nft: nftUsed },
      remaining: {
        raffle: Math.max(0, limits.raffle - raffleUsed),
        nft: Math.max(0, limits.nft - nftUsed),
      },
    });
  } catch (err) {
    console.error('[exchange/status]', err);
    res.status(500).json({ error: '교환소 상태 조회에 실패했습니다.' });
  }
});

router.post('/buy-card-nft', requireAuth, async (req, res) => {
  const userId = req.user.user_id;
  const walletAddress = String(req.body.walletAddress || '').trim();

  if (!walletAddress) return res.status(400).json({ error: '지갑 주소가 필요합니다.' });

  try {
    await ensureUserCardsRuntimeColumns(_pool);
    const verifiedWallet = await assertVerifiedWallet(userId, walletAddress);
    const tier = await getTier(userId);
    if (!tier) return res.status(400).json({ error: '멤버십 가입 후 실물 NFT를 발급할 수 있습니다.' });

    const limits = TIER_LIMITS[tier] || TIER_LIMITS['베이직'];
    const used = await getMonthlyCount(userId, 'NFT_EXCHANGE_REQUESTED');
    if (used >= limits.nft) {
      return res.status(400).json({
        error: `이번 달 실물 NFT 발급 한도를 초과했습니다. (${tier} 등급: 월 ${limits.nft}회)`,
      });
    }

    const cardPool = await getCardPool();
    const selectedCard = pickRandomCard(cardPool);
    if (!selectedCard) return res.status(400).json({ error: '발급 가능한 실물 NFT가 없습니다.' });

    const userDidHash = fabricService.hashDid(verifiedWallet);
    const result = await exchangePointItemWithRecoveredMembership({
      userId,
      walletAddress: verifiedWallet,
      tier,
      itemType: 'CARD_NFT',
    });
    const nftId = createCardNftId();
    const tempTxHash = createTxHash();
    const logId = uuidv4();

    await _pool.query(
      `INSERT INTO user_cards
         (user_id, card_type_id, nft_id, display_team, display_name, display_image_url, display_note, source_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'point_random')`,
      [userId, selectedCard.id, nftId, selectedCard.team, selectedCard.name, selectedCard.image, selectedCard.note],
    );

    await _pool.query(
      `INSERT INTO onchain_tx_logs
         (id, user_id, wallet_address, action_type, tx_hash, token_id, payload_json)
       VALUES (?, ?, ?, 'NFT_EXCHANGE_REQUESTED', ?, ?, ?)`,
      [
        logId,
        userId,
        verifiedWallet,
        tempTxHash,
        nftId,
        JSON.stringify({
          itemType: 'CARD_NFT',
          exchangeId: result.exchangeId,
          pointUsed: result.pointUsed,
          remainingBalance: result.remainingBalance,
          tier,
          cardTypeId: selectedCard.id,
          cardName: selectedCard.name,
        }),
      ],
    );

    await _pool.query(
      `INSERT INTO fabric_events
         (id, event_name, user_did_hash, payload_json, fabric_tx_id)
       VALUES (?, 'CARD_NFT_MINT_REQUESTED', ?, ?, ?)`,
      [
        uuidv4(),
        userDidHash,
        JSON.stringify({
          exchangeId: result.exchangeId,
          itemType: 'CARD_NFT',
          pointUsed: result.pointUsed,
          remainingBalance: result.remainingBalance,
          cardTypeId: selectedCard.id,
          nftId,
        }),
        null,
      ],
    );

    await membershipService.recordPointEvent(_pool, {
      userId,
      walletAddress: verifiedWallet,
      eventType: 'POINT_EXCHANGE_CARD',
      reason: '랜덤 실물 NFT 발급',
      amount: -Math.abs(Number(result.pointUsed || CARD_NFT_COST)),
      metadata: { exchangeId: result.exchangeId, nftId, cardTypeId: selectedCard.id, cardName: selectedCard.name },
    });

    await notificationService.recordNotification(_pool, {
      userId,
      category: 'SYSTEM',
      title: '실물 NFT 발급 완료',
      message: `${selectedCard.name}이 지급되었습니다.`,
      amount: 1,
      metadata: { source: 'POINT_RANDOM_CARD', exchangeId: result.exchangeId, nftId, cardTypeId: selectedCard.id },
    });

    if (isOnChainMintingEnabled(['MINTER_PRIVATE_KEY', 'FRAGMENT_NFT_ADDRESS'])) {
      Promise.resolve()
        .then(async () => {
          const realTxHash = await mintCardOnChain(verifiedWallet, selectedCard.id);
          await _pool.query('UPDATE onchain_tx_logs SET tx_hash = ? WHERE id = ?', [realTxHash, logId]);
          await completeCardExchangeOnFabric({
            exchangeId: result.exchangeId,
            userDidHash,
            cardTypeId: selectedCard.id,
            nftId,
            mintTxHash: realTxHash,
          });
          console.log(`[exchange/card-nft] 온체인 발급 완료 → tx: ${realTxHash}`);
        })
        .catch(err => console.error('[exchange/card-nft] 온체인 배경 처리 실패:', err.message));
    } else {
      await completeCardExchangeOnFabric({
        exchangeId: result.exchangeId,
        userDidHash,
        cardTypeId: selectedCard.id,
        nftId,
        mintTxHash: tempTxHash,
      });
    }

    res.json({
      success: true,
      card: {
        id: selectedCard.id,
        nftId,
        team: selectedCard.team,
        name: selectedCard.name,
        image: selectedCard.image,
        note: selectedCard.note,
      },
      pointUsed: Number(result.pointUsed || CARD_NFT_COST),
      remainingBalance: Number(result.remainingBalance ?? 0),
      remaining: Math.max(0, limits.nft - used - 1),
    });
  } catch (err) {
    console.error('[exchange/buy-card-nft]', err);
    res.status(400).json({ error: err.message || '실물 NFT 발급에 실패했습니다.' });
  }
});

router.get('/physical-options', requireAuth, async (req, res) => {
  try {
    await ensureUserCardsRuntimeColumns(_pool);
    await ensurePhysicalRedemptionTable(_pool);
    const [cards] = await _pool.query(
      `SELECT
         uc.id,
         uc.nft_id AS nftId,
         uc.source_mode AS sourceMode,
         uc.obtained_at AS obtainedAt,
         COALESCE(uc.display_team, ct.team) AS team,
         COALESCE(uc.display_name, ct.name) AS name,
         COALESCE(uc.display_image_url, ct.image_url) AS image,
         COALESCE(uc.display_note, ct.note) AS note,
         pr.id AS redemptionId,
         pr.status AS redemptionStatus,
         pr.requested_at AS requestedAt
       FROM user_cards uc
       JOIN card_types ct ON ct.id = uc.card_type_id
       LEFT JOIN physical_redemption_requests pr ON pr.user_card_id = uc.id
       WHERE uc.user_id = ?
       ORDER BY uc.obtained_at DESC`,
      [req.user.user_id],
    );

    res.json({ success: true, data: cards });
  } catch (err) {
    console.error('[exchange/physical-options]', err);
    res.status(500).json({ error: '실물 교환 목록 조회에 실패했습니다.' });
  }
});

router.post('/physical-redeem', requireAuth, async (req, res) => {
  const userId = req.user.user_id;
  const walletAddress = String(req.body.walletAddress || '').trim();
  const cardId = Number(req.body.cardId);
  const delivery = req.body.delivery && typeof req.body.delivery === 'object' ? req.body.delivery : {};

  if (!walletAddress) return res.status(400).json({ error: '지갑 주소가 필요합니다.' });
  if (!Number.isInteger(cardId) || cardId <= 0) return res.status(400).json({ error: '교환할 실물 NFT를 선택해주세요.' });

  try {
    await ensureUserCardsRuntimeColumns(_pool);
    await ensurePhysicalRedemptionTable(_pool);
    const verifiedWallet = await assertVerifiedWallet(userId, walletAddress);
    const [[card]] = await _pool.query(
      `SELECT
         uc.id,
         uc.nft_id AS nftId,
         COALESCE(uc.display_team, ct.team) AS team,
         COALESCE(uc.display_name, ct.name) AS name,
         COALESCE(uc.display_image_url, ct.image_url) AS image
       FROM user_cards uc
       JOIN card_types ct ON ct.id = uc.card_type_id
       WHERE uc.id = ? AND uc.user_id = ?`,
      [cardId, userId],
    );
    if (!card) return res.status(404).json({ error: '보유한 실물 NFT를 찾을 수 없습니다.' });

    const [[existing]] = await _pool.query(
      `SELECT id, status FROM physical_redemption_requests WHERE user_card_id = ?`,
      [cardId],
    );
    if (existing) {
      return res.status(409).json({ error: `이미 실물 교환 요청된 NFT입니다. (상태: ${existing.status})` });
    }

    const requestId = uuidv4();
    await _pool.query(
      `INSERT INTO physical_redemption_requests
         (id, user_id, user_card_id, wallet_address, recipient_name, phone, address_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        requestId,
        userId,
        cardId,
        verifiedWallet,
        String(delivery.recipient || '').trim() || null,
        String(delivery.phone || '').trim() || null,
        JSON.stringify({
          zipcode: String(delivery.zipcode || '').trim(),
          address: String(delivery.address || '').trim(),
          addressDetail: String(delivery.addressDetail || '').trim(),
        }),
      ],
    );

    await notificationService.recordNotification(_pool, {
      userId,
      category: 'SYSTEM',
      title: '실물 교환 요청 완료',
      message: `${card.name} 실물 교환 요청이 접수되었습니다.`,
      amount: 1,
      metadata: { requestId, cardId, nftId: card.nftId },
    });

    res.json({
      success: true,
      request: {
        id: requestId,
        status: 'requested',
        cardId,
        nftId: card.nftId,
        team: card.team,
        name: card.name,
        image: card.image,
      },
    });
  } catch (err) {
    console.error('[exchange/physical-redeem]', err);
    res.status(400).json({ error: err.message || '실물 교환 요청에 실패했습니다.' });
  }
});

router.post('/buy-raffle', requireAuth, async (req, res) => {
  const userId = req.user.user_id;
  const count = Math.max(1, Number(req.body.count || 1));
  const walletAddress = String(req.body.walletAddress || '').trim();

  if (!walletAddress) return res.status(400).json({ error: '지갑 주소가 필요합니다.' });
  if (![1, 2, 3].includes(count)) return res.status(400).json({ error: '올바른 수량이 아닙니다.' });

  try {
    const verifiedWallet = await assertVerifiedWallet(userId, walletAddress);

    const tier = await getTier(userId);
    if (!tier) return res.status(400).json({ error: '멤버십 가입 후 응모권을 교환할 수 있습니다.' });
    const limits = TIER_LIMITS[tier] || TIER_LIMITS['베이직'];
    const used = await getMonthlyCount(userId, 'RAFFLE_PURCHASE');
    if (used + count > limits.raffle) {
      return res.status(400).json({
        error: `이번 달 응모권 교환 한도를 초과합니다. (${tier} 등급: 월 ${limits.raffle}장)`,
      });
    }

    const userDidHash = fabricService.hashDid(verifiedWallet);
    let lastResult = null;
    const issued = [];
    for (let i = 0; i < count; i += 1) {
      lastResult = await exchangePointItemWithRecoveredMembership({
        userId,
        walletAddress: verifiedWallet,
        tier,
        itemType: 'RAFFLE_NFT',
      });
      const raffleNftId = uuidv4();
      await fabricService.registerRaffleNFT({ raffleNftId, userDidHash, gameId: '' });
      await _pool.query(
        `INSERT INTO raffle_nfts
           (id, user_id, wallet_address, user_did_hash, status, source, expires_at)
         VALUES (?, ?, ?, ?, 'ISSUED', 'POINT_EXCHANGE', ?)`,
        [raffleNftId, userId, verifiedWallet, userDidHash, membershipService.addDays(new Date(), 60)],
      );
      issued.push(raffleNftId);
    }

    await _pool.query(
      `INSERT INTO onchain_tx_logs (id, user_id, wallet_address, action_type, tx_hash, payload_json)
       VALUES (?, ?, ?, 'RAFFLE_PURCHASE', ?, ?)`,
      [uuidv4(), userId, verifiedWallet, createTxHash(), JSON.stringify({ count, tier, raffleNftIds: issued })],
    );
    await _pool.query(
      `INSERT INTO fabric_events (id, event_name, user_did_hash, payload_json, fabric_tx_id)
       VALUES (?, 'RAFFLE_NFT_MINT_REQUESTED', ?, ?, ?)`,
      [uuidv4(), userDidHash, JSON.stringify({ count, raffleNftIds: issued, pointUsed: count * 1500 }), null],
    );

    await membershipService.recordPointEvent(_pool, {
      userId,
      walletAddress: verifiedWallet,
      eventType: 'POINT_EXCHANGE_RAFFLE',
      reason: '응모권 교환',
      amount: -Math.abs(Number(lastResult?.pointUsed || 1500) * count),
      metadata: { count, raffleNftIds: issued },
    });
    await notificationService.recordNotification(_pool, {
      userId,
      category: 'RAFFLE',
      title: '응모권 획득',
      message: `포인트 교환으로 응모권 NFT ${count}장이 지급되었습니다.`,
      amount: count,
      metadata: { raffleNftIds: issued },
    });

    const [[row]] = await _pool.query(
      `SELECT COUNT(*) AS cnt
         FROM raffle_nfts
        WHERE user_id = ? AND status = 'ISSUED'
          AND (expires_at IS NULL OR expires_at > NOW())`,
      [userId],
    );

    res.json({
      success: true,
      newCount: Number(row?.cnt ?? issued.length),
      raffleNftIds: issued,
      remainingBalance: lastResult?.remainingBalance,
      remaining: Math.max(0, limits.raffle - used - count),
    });
  } catch (err) {
    console.error('[exchange/buy-raffle]', err);
    res.status(400).json({ error: err.message || '응모권 교환에 실패했습니다.' });
  }
});

module.exports = { router, setPool };
