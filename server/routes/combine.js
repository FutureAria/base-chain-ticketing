const express = require('express');
const crypto  = require('crypto');
const { requireAuth } = require('../middleware/auth');
const {
  mintFragmentOnChain,
  burnFragmentOnChain,
  getFragmentBalanceOnChain,
  mintCardOnChain,
  burnBoxOnChain,
  isOnChainMintingEnabled,
} = require('../services/nftService');

const router = express.Router();
let _pool;

function setPool(pool) {
  _pool = pool;
}

// ─── 유틸 ────────────────────────────────────────────────

function createNftId() {
  return `#GAME-${crypto.randomBytes(8).toString('hex')}`;
}

function createTokenId(prefix) {
  return `${prefix}-${crypto.randomBytes(9).toString('hex').toUpperCase()}`;
}

function createTxHash() {
  return `0x${crypto.randomBytes(32).toString('hex')}`;
}

async function getWalletAddress(userId) {
  const [[wallet]] = await _pool.query(
    'SELECT wallet_address FROM user_wallets WHERE user_id = ?',
    [userId]
  );
  return wallet?.wallet_address ?? `0x${'0'.repeat(40)}`;
}

async function fetchInventory(userId) {
  const [fragments] = await _pool.query(
    `SELECT
       ft.id,
       ft.family,
       ft.team,
       ft.name,
       ft.result_name       AS resultName,
       ft.image_url         AS image,
       ft.note,
       ma.id                AS marketAssetId,
       ma.asset_name        AS marketAssetName,
       COALESCE(uf.count, 0) AS count
     FROM fragment_types ft
     LEFT JOIN market_assets ma ON ma.fragment_type_id = ft.id
     LEFT JOIN user_fragments uf ON uf.fragment_type_id = ft.id AND uf.user_id = ?
     ORDER BY ft.id`,
    [userId]
  );

  const [cards] = await _pool.query(
    `SELECT
       uc.id,
       COALESCE(uc.display_team,      ct.team)      AS team,
       COALESCE(uc.display_name,      ct.name)      AS name,
       COALESCE(uc.display_image_url, ct.image_url) AS image,
       COALESCE(uc.display_note,      ct.note)      AS note,
       uc.nft_id      AS nftId,
       uc.obtained_at AS obtainedAt
     FROM user_cards uc
     JOIN card_types      ct ON ct.id = uc.card_type_id
     JOIN combine_recipes cr ON cr.result_card_type_id = uc.card_type_id
     WHERE uc.user_id = ?
     ORDER BY uc.obtained_at DESC`,
    [userId]
  );

  return { fragments, cards };
}

// ─── GET /api/inventory ──────────────────────────────────

router.get('/inventory', requireAuth, async (req, res) => {
  const userId = req.user.user_id;
  try {
    const inventory = await fetchInventory(userId);
    const [[boxRow]] = await _pool.query(
      'SELECT season_count AS seasonBoxCount FROM user_boxes WHERE user_id = ?',
      [userId]
    );
    const walletAddress = await getWalletAddress(userId);

    res.json({
      ...inventory,
      seasonBoxCount: boxRow?.seasonBoxCount ?? 0,
      walletAddress,
    });
  } catch (err) {
    console.error('[inventory]', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// ─── POST /api/combine ───────────────────────────────────

router.post('/combine', requireAuth, async (req, res) => {
  const userId = req.user.user_id;
  const { fragmentIds } = req.body;

  if (!Array.isArray(fragmentIds) || fragmentIds.length !== 2) {
    return res.status(400).json({ error: '파편 ID 2개가 필요합니다' });
  }

  const conn = await _pool.getConnection();
  try {
    await conn.beginTransaction();

    const [id1, id2] = fragmentIds;

    if (id1 !== id2) {
      await conn.rollback();
      return res.status(400).json({ error: '같은 파편 2개를 선택해야 조합할 수 있습니다' });
    }

    const [[frag]] = await conn.query(
      `SELECT ft.*, ft.onchain_id
       FROM fragment_types ft
       WHERE ft.id = ?`,
      [id1]
    );

    if (!frag) {
      await conn.rollback();
      return res.status(400).json({ error: '파편을 찾을 수 없습니다' });
    }

    // 보유 수량은 잠근 상태로 읽는다.
    // 잠금 없이 읽고 차감하면, 파편 2개로 동시에 두 번 요청을 보내 카드 2장을 만들 수 있다
    // (count 가 signed INT 라 -2 까지 내려간다).
    const [[owned]] = await conn.query(
      'SELECT count FROM user_fragments WHERE user_id = ? AND fragment_type_id = ? FOR UPDATE',
      [userId, id1]
    );

    if (!owned || Number(owned.count) < 2) {
      await conn.rollback();
      return res.status(400).json({ error: '파편 수량이 부족합니다 (2개 필요)' });
    }

    const [[recipe]] = await conn.query(
      `SELECT cr.result_card_type_id, ct.name, ct.image_url
       FROM combine_recipes cr
       JOIN card_types ct ON ct.id = cr.result_card_type_id
       WHERE cr.fragment_type_id = ?`,
      [id1]
    );

    if (!recipe) {
      await conn.rollback();
      return res.status(400).json({ error: '이 파편은 아직 완성 카드 조합이 지원되지 않습니다' });
    }

    // 조건부 차감으로 한 번 더 막는다. 잠금이 어떤 이유로 통하지 않아도
    // count 가 2 미만이면 0행이 갱신되어 아래에서 걸린다.
    const [decremented] = await conn.query(
      'UPDATE user_fragments SET count = count - 2 WHERE user_id = ? AND fragment_type_id = ? AND count >= 2',
      [userId, id1]
    );
    if (decremented.affectedRows === 0) {
      await conn.rollback();
      return res.status(409).json({ error: '파편 수량이 부족합니다 (2개 필요)' });
    }

    const nftId = createNftId();

    await conn.query(
      `INSERT INTO user_cards
         (user_id, card_type_id, nft_id, display_team, display_name, display_image_url, display_note, source_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'fragment-combine')`,
      [
        userId,
        recipe.result_card_type_id,
        nftId,
        frag.team,
        recipe.name,
        recipe.image_url,
        `${frag.name} 2개를 모아 ${recipe.name}를 완성했습니다.`,
      ]
    );

    await conn.query(
      `INSERT INTO combine_logs
         (id, user_id, fragment_type_id_1, fragment_type_id_2, result_card_type_id, result_name, result_nft_id)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?)`,
      [userId, id1, id2, recipe.result_card_type_id, recipe.name, nftId]
    );

    await conn.commit();

    // ─── 온체인 처리 백그라운드 (DB 커밋 후 즉시 응답, 블록체인은 비동기) ──
    const walletAddress = await getWalletAddress(userId);
    const hasWallet = walletAddress && walletAddress !== `0x${'0'.repeat(40)}`;
    const onChainEnabled = isOnChainMintingEnabled(['MINTER_PRIVATE_KEY', 'FRAGMENT_NFT_ADDRESS']);
    const onChainPending = hasWallet && onChainEnabled;

    // ─── 트랜잭션 이력 저장 (임시 해시로 먼저 저장) ─────────
    const combineLogId     = crypto.randomUUID();
    const combineLogTxHash = `0x${crypto.randomBytes(32).toString('hex')}`;
    const combineTokenId   = createTokenId('CARD');
    try {
      await _pool.query(
        `INSERT INTO onchain_tx_logs
           (id, user_id, wallet_address, action_type, tx_hash, token_id, payload_json)
         VALUES (?, ?, ?, 'COMBINE_CARD', ?, ?,
                 JSON_OBJECT('fragmentTypeId', ?, 'resultCard', ?, 'nftId', ?))`,
        [combineLogId, userId, walletAddress, combineLogTxHash, combineTokenId,
         id1, recipe.name, nftId],
      );
    } catch (logErr) {
      console.error('[combine] 이력 저장 실패:', logErr.message);
    }

    if (onChainPending) {
      Promise.resolve()
        .then(async () => {
          const requiredCount = 2;
          const onChainBalance = await getFragmentBalanceOnChain(walletAddress, frag.onchain_id);
          if (onChainBalance < requiredCount) {
            const missingCount = requiredCount - onChainBalance;
            console.warn(
              `[combine] 온체인 파편 잔액 보정: wallet=${walletAddress}, fragment=${frag.onchain_id}, balance=${onChainBalance}, mint=${missingCount}`,
            );
            for (let i = 0; i < missingCount; i += 1) {
              await mintFragmentOnChain(walletAddress, frag.onchain_id);
            }
          }

          await burnFragmentOnChain(walletAddress, frag.onchain_id);
          const realTxHash = await mintCardOnChain(walletAddress, recipe.result_card_type_id);
          await _pool.query(
            'UPDATE onchain_tx_logs SET tx_hash = ? WHERE id = ?',
            [realTxHash, combineLogId]
          );
          console.log(`[combine] 온체인 완료 → tx: ${realTxHash}`);
        })
        .catch(err => console.error('[combine] 온체인 배경 처리 실패:', err.message));
    }

    const inventory = await fetchInventory(userId);
    res.json({
      result: {
        type: 'card',
        name: recipe.name,
        image: recipe.image_url,
        description: `${frag.name} 2개를 모아 ${recipe.name}를 완성했습니다.`,
        nftId,
        burnTxHash: null,
        cardTxHash: null,
        onChain: onChainPending ? 'pending' : false,
      },
      updatedInventory: inventory,
    });
  } catch (err) {
    await conn.rollback();
    console.error('[combine]', err);
    res.status(500).json({ error: '조합 처리 중 오류가 발생했습니다' });
  } finally {
    conn.release();
  }
});

// ─── POST /api/box/open ──────────────────────────────────

router.post('/box/open', requireAuth, async (req, res) => {
  const userId = req.user.user_id;

  const conn = await _pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[boxRow]] = await conn.query(
      'SELECT season_count FROM user_boxes WHERE user_id = ? FOR UPDATE',
      [userId]
    );

    const currentCount = Number(boxRow?.season_count ?? 0);
    if (currentCount <= 0) {
      await conn.rollback();
      return res.status(400).json({ error: '박스가 없습니다' });
    }

    const remaining = currentCount - 1;
    await conn.query(
      'UPDATE user_boxes SET season_count = ? WHERE user_id = ?',
      [remaining, userId]
    );

    // 가중치 뽑기는 POW(RAND(), 1/weight) 가 가장 큰 항목을 고른다 (Efraimidis-Spirakis).
    // 이 식이라야 각 항목이 뽑힐 확률이 weight 에 정확히 비례한다.
    //
    // 이전에는 `RAND() * weight DESC` 를 썼는데, 이건 비례하지 않는다.
    // 가중치 14 대 7(의도한 비율 2:1)을 20만 회 시뮬레이션하면 실제로는 3:1(75%:25%)로 나온다.
    // 즉 설정한 확률표와 실제 뽑기 확률이 어긋나 희귀 보상이 의도보다 더 안 나왔다.
    const [[reward]] = await conn.query(
      `SELECT brp.*, ma.id AS fragmentMarketAssetId, ft.onchain_id
       FROM box_reward_pool brp
       LEFT JOIN market_assets ma ON ma.fragment_type_id = brp.fragment_type_id
       LEFT JOIN fragment_types ft ON ft.id = brp.fragment_type_id
       WHERE brp.weight > 0
       ORDER BY POW(RAND(), 1 / brp.weight) DESC
       LIMIT 1`
    );

    if (!reward) {
      await conn.rollback();
      return res.status(500).json({ error: '현재 개봉 가능한 보상이 없습니다' });
    }

    const walletAddress = await getWalletAddress(userId);
    const boxTokenId    = createTokenId('BOX');
    const isGoods       = reward.type === 'goods';

    if (isGoods) {
      // 원본 굿즈 NFT → user_cards에 저장
      const nftId = createNftId();
      const [[cardType]] = await conn.query(
        'SELECT name, image_url, team FROM card_types WHERE id = ?',
        [reward.card_type_id]
      );
      await conn.query(
        `INSERT INTO user_cards
           (user_id, card_type_id, nft_id, display_team, display_name, display_image_url, display_note, source_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'box_open')`,
        [userId, reward.card_type_id, nftId, cardType?.team ?? '', cardType?.name ?? reward.name, reward.image_url, reward.description]
      );
      reward._nftId = nftId;
    } else {
      // 파편 → user_fragments에 저장
      await conn.query(
        `INSERT INTO user_fragments (user_id, fragment_type_id, count)
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE count = count + 1`,
        [userId, reward.fragment_type_id]
      );
    }

    // DB 먼저 커밋 후 온체인 민팅 백그라운드 (DB는 동기, 블록체인은 비동기)
    await conn.commit();

    const tokenPrefix        = isGoods ? 'GOODS' : 'FRAG';
    const rewardTokenIdFinal = createTokenId(tokenPrefix);
    const tempTxHash         = `0x${crypto.randomBytes(32).toString('hex')}`;
    const logId              = crypto.randomUUID();

    // ─── 로그 기록 (임시 해시로 먼저 저장) ───────────────────
    try {
      await _pool.query(
        `INSERT INTO nft_tokens
           (token_id, token_type, owner_user_id, owner_wallet, fragment_type_id, status, source_action, mint_tx_hash, last_tx_hash)
         VALUES (?, ?, ?, ?, ?, 'owned', 'box_open', ?, ?)`,
        [rewardTokenIdFinal, isGoods ? 'goods' : 'fragment', userId, walletAddress,
         isGoods ? null : reward.fragment_type_id, tempTxHash, tempTxHash]
      );

      await _pool.query(
        `INSERT INTO onchain_tx_logs
           (id, user_id, wallet_address, action_type, tx_hash, token_id, payload_json)
         VALUES (?, ?, ?, 'BOX_OPEN', ?, ?, JSON_OBJECT('boxTokenId', ?, 'rewardType', ?, 'rewardId', ?))`,
        [logId, userId, walletAddress, tempTxHash, rewardTokenIdFinal,
         boxTokenId, reward.type, isGoods ? String(reward.card_type_id) : reward.fragment_type_id]
      );

      await _pool.query(
        `INSERT INTO box_open_logs
           (id, user_id, wallet_address, box_token_id, reward_type, reward_fragment_type_id, reward_card_type_id, reward_name, reward_token_id, reward_nft_id, tx_hash)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, walletAddress, boxTokenId, reward.type,
         isGoods ? null : reward.fragment_type_id,
         isGoods ? reward.card_type_id : null,
         reward.name, rewardTokenIdFinal, reward._nftId ?? null, tempTxHash]
      );
    } catch (logErr) {
      console.error('[box/open] 로그 기록 실패:', logErr.message);
    }

    // ─── 온체인 민팅 백그라운드 → 완료 후 진짜 해시로 업데이트 ──
    const hasWallet = walletAddress && walletAddress !== `0x${'0'.repeat(40)}`;
    const onChainEnabled = isOnChainMintingEnabled(['MINTER_PRIVATE_KEY', 'FRAGMENT_NFT_ADDRESS', 'BOX_NFT_ADDRESS']);
    const onChainPending = hasWallet && onChainEnabled;
    if (onChainPending) {
      Promise.resolve()
        .then(async () => {
          await burnBoxOnChain(walletAddress);
          const realTxHash = !isGoods
            ? await mintFragmentOnChain(walletAddress, reward.onchain_id)
            : await mintCardOnChain(walletAddress, reward.card_type_id);
          await _pool.query(
            'UPDATE onchain_tx_logs SET tx_hash = ? WHERE id = ?',
            [realTxHash, logId]
          );
          console.log(`[box/open] 온체인 완료 → tx: ${realTxHash}`);
        })
        .catch(err => console.error('[box/open] 온체인 배경 처리 실패:', err.message));
    }

    const inventory = await fetchInventory(userId);
    res.json({
      reward: {
        type: reward.type,
        name: reward.name,
        image: reward.image_url,
        description: reward.description,
        targetId: isGoods ? String(reward.card_type_id) : reward.fragment_type_id,
        marketAssetId: reward.fragmentMarketAssetId ?? null,
        boxTokenId,
        tokenId: rewardTokenIdFinal,
        nftId: reward._nftId ?? null,
        txHash: tempTxHash,
        onChain: onChainPending ? 'pending' : false,
      },
      remainingBoxCount: remaining,
      walletAddress,
      updatedInventory: inventory,
    });
  } catch (err) {
    await conn.rollback();
    console.error('[box/open]', err);
    res.status(500).json({ error: '박스 열기 중 오류가 발생했습니다' });
  } finally {
    conn.release();
  }
});

// ─── 박스 보상 목록 조회 ──────────────────────────────────
router.get('/box/rewards', async (req, res) => {
  try {
    const [rows] = await _pool.query(
      `SELECT brp.type, brp.name, brp.image_url AS image
       FROM box_reward_pool brp
       ORDER BY brp.type DESC, brp.id ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[box/rewards]', err);
    res.status(500).json({ error: '보상 목록 조회 실패' });
  }
});

module.exports = { router, setPool };
