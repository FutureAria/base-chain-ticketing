'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const fabricService  = require('../services/fabricBridge');
const membershipService = require('../services/membershipService');
const notificationService = require('../services/notificationService');

const router = express.Router();
let _pool;
function setPool(pool) { _pool = pool; }

function normalizeMonth(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

async function getWalletForHistory(userId, walletAddress = '') {
  const [[user]] = await _pool.query('SELECT role FROM users WHERE user_id = ?', [userId]);
  if (user?.role === 'admin') {
    const [[wallet]] = await _pool.query(
      `SELECT wallet_address
         FROM user_wallets
        WHERE user_id = ?
        ORDER BY is_verified DESC, connected_at DESC
        LIMIT 1`,
      [userId],
    );
    return wallet?.wallet_address || String(walletAddress || '').trim() || null;
  }

  if (walletAddress) {
    return membershipService.getVerifiedWallet(_pool, userId, walletAddress);
  }
  const [[wallet]] = await _pool.query(
    `SELECT wallet_address
       FROM user_wallets
      WHERE user_id = ?
      ORDER BY is_verified DESC, connected_at DESC
      LIMIT 1`,
    [userId],
  );
  return wallet?.wallet_address || null;
}

function noPointBalance() {
  return { balance: 0, totalEarned: 0, totalUsed: 0 };
}

async function getFabricPointBalanceForUser(userId, walletAddress) {
  const synced = await membershipService.syncFabricUserFromDb({
    pool: _pool,
    fabricService,
    userId,
    walletAddress,
  });
  const userDidHash = synced?.userDidHash || fabricService.hashDid(walletAddress);
  try {
    return await fabricService.getPointBalance({ userDidHash });
  } catch (err) {
    console.error('[pointRoutes] Fabric point read failed, using DB mirror:', err.message);
    return synced?.point || membershipService.getPointBalanceFromEvents(_pool, userId);
  }
}

function createWalletOwnerError() {
  const err = new Error('현재 로그인한 계정에 등록된 지갑으로만 이용할 수 있습니다.');
  err.statusCode = 403;
  return err;
}

async function getWalletForCurrentUser(req, walletAddress = '') {
  const requestedWallet = String(walletAddress || '').trim();

  // 로그인하지 않은 요청에는 어떤 지갑 정보도 돌려주지 않는다.
  // 예전에는 요청에 실린 지갑 주소를 그대로 조회해서, 주소만 알면 누구나
  // 그 사람의 포인트 잔액·등급·입장 횟수를 볼 수 있었다.
  // 지갑 주소는 장터·재판매 목록에 노출되므로 사실상 공개 정보다.
  if (!req.user?.user_id) return null;

  if (req.user.role === 'admin') {
    const [[wallet]] = await _pool.query(
      `SELECT wallet_address
         FROM user_wallets
        WHERE user_id = ?
        ORDER BY is_verified DESC, connected_at DESC
        LIMIT 1`,
      [req.user.user_id],
    );
    return wallet?.wallet_address || requestedWallet || null;
  }

  const verifiedWallet = await membershipService.getVerifiedWallet(_pool, req.user.user_id, requestedWallet);
  if (requestedWallet && !verifiedWallet) throw createWalletOwnerError();
  return verifiedWallet;
}

// GET /api/points/history?month=YYYY-MM&walletAddress=0x...
router.get('/history', requireAuth, async (req, res) => {
  try {
    const month = normalizeMonth(req.query.month);
    const walletAddress = await getWalletForHistory(req.user.user_id, String(req.query.walletAddress || '').trim());
    const point = walletAddress
      ? await getFabricPointBalanceForUser(req.user.user_id, walletAddress)
      : noPointBalance();

    const [rows] = await _pool.query(
      `SELECT id, event_type, reason, amount, metadata_json,
              DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s+09:00') AS created_at
         FROM point_events
        WHERE user_id = ? AND DATE_FORMAT(created_at, '%Y-%m') = ?
        ORDER BY created_at DESC`,
      [req.user.user_id, month],
    );

    const earnedThisMonth = rows
      .filter((row) => Number(row.amount) > 0)
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const usedThisMonth = rows
      .filter((row) => Number(row.amount) < 0)
      .reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);

    res.json({
      success: true,
      data: {
        month,
        walletAddress,
        balance: Number(point.balance ?? 0),
        totalEarned: Number(point.totalEarned ?? 0),
        totalUsed: Number(point.totalUsed ?? 0),
        earnedThisMonth,
        usedThisMonth,
        events: rows.map((row) => ({ ...row, amount: Number(row.amount), metadata: parseMetadata(row.metadata_json) })),
      },
    });
  } catch (err) {
    console.error('[pointRoutes] GET /history:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/points?walletAddress=0x...
router.get('/', optionalAuth, async (req, res) => {
  try {
    const walletAddress = await getWalletForCurrentUser(req, req.query.walletAddress);
    if (!walletAddress) {
      return res.json({
        success: true,
        data: noPointBalance(),
        membershipJoined: false,
        walletAddress: null,
      });
    }

    if (req.user?.user_id) {
      await membershipService.syncFabricUserFromDb({
        pool: _pool,
        fabricService,
        userId: req.user.user_id,
        walletAddress,
      });
    }

    // 여기까지 왔다면 로그인 사용자의 지갑임이 확인된 상태다.
    const userDidHash = fabricService.hashDid(walletAddress);
    const membership = req.user.role === 'admin'
      ? { joined: true }
      : await fabricService.getMembership({ userDidHash });
    const point = await fabricService.getPointBalance({ userDidHash });
    res.json({
      success: true,
      data: membership.joined ? point : noPointBalance(),
      membershipJoined: membership.joined,
      walletAddress,
    });
  } catch (err) {
    console.error('[pointRoutes] GET /:', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// GET /api/points/membership?walletAddress=0x...
router.get('/membership', optionalAuth, async (req, res) => {
  try {
    const walletAddress = await getWalletForCurrentUser(req, req.query.walletAddress);
    if (!walletAddress) {
      return res.json({
        success: true,
        data: { tier: 'NONE', joined: false, verified: false },
        walletAddress: null,
      });
    }

    if (req.user?.user_id) {
      await membershipService.syncFabricUserFromDb({
        pool: _pool,
        fabricService,
        userId: req.user.user_id,
        walletAddress,
      });
    }

    const userDidHash = fabricService.hashDid(walletAddress);
    const membership = req.user?.role === 'admin'
      ? { tier: 'GOLD', joined: true, verified: true }
      : await fabricService.getMembership({ userDidHash });
    res.json({ success: true, data: membership, walletAddress });
  } catch (err) {
    console.error('[pointRoutes] GET /membership:', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// POST /api/points/use
// Body: { walletAddress, ticketId?, pointAmount }
router.post('/use', requireAuth, async (req, res) => {
  try {
    const { walletAddress, ticketId, pointAmount } = req.body;
    if (!walletAddress || !pointAmount) {
      return res.status(400).json({ error: '필수 항목 누락 (walletAddress, pointAmount)' });
    }

    // "abc" 같은 값을 그대로 Number() 하면 NaN 이 되고, NaN 은 어떤 크기 비교도 통과해버려
    // 잔액이 NaN 으로 망가진다. 라우터에서 먼저 걸러낸다.
    const amount = Number(pointAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: '사용할 포인트는 양의 정수여야 합니다.' });
    }

    const verifiedWallet = await membershipService.getVerifiedWallet(_pool, req.user.user_id, walletAddress);
    if (!verifiedWallet) throw createWalletOwnerError();

    const userDidHash = fabricService.hashDid(verifiedWallet);
    const result = await fabricService.usePointForTicket({
      userDidHash,
      ticketId: ticketId || null,
      pointAmount: amount,
    });

    await membershipService.recordPointEvent(_pool, {
      userId: req.user.user_id,
      walletAddress: verifiedWallet,
      eventType: 'POINT_USE_TICKET',
      reason: '티켓 예매 포인트 사용',
      amount: -amount,
      metadata: { ticketId: ticketId || null },
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[pointRoutes] POST /use:', err);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/points/exchange
// Body: { walletAddress, itemType: 'RAFFLE_NFT' | 'CARD_NFT' }
router.post('/exchange', requireAuth, async (req, res) => {
  try {
    const { walletAddress, itemType } = req.body;
    if (!walletAddress || !itemType) {
      return res.status(400).json({ error: '필수 항목 누락 (walletAddress, itemType)' });
    }

    const verifiedWallet = await membershipService.getVerifiedWallet(_pool, req.user.user_id, walletAddress);
    if (!verifiedWallet) throw createWalletOwnerError();

    const userDidHash = fabricService.hashDid(verifiedWallet);
    const result = await fabricService.exchangePointItem({ userDidHash, itemType });

    // fabric_events 로그
    await _pool.query(
      `INSERT INTO fabric_events
         (id, event_name, user_did_hash, payload_json, fabric_tx_id)
       VALUES (?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        itemType === 'RAFFLE_NFT' ? 'RAFFLE_NFT_MINT_REQUESTED' : 'CARD_NFT_MINT_REQUESTED',
        userDidHash,
        JSON.stringify({
          exchangeId: result.exchangeId,
          itemType,
          pointUsed: result.pointUsed,
          remainingBalance: result.remainingBalance,
        }),
        result.txId,
      ]
    );

    // RAFFLE_NFT 교환 시 → Fabric 등록 + DB raffle_nfts 저장
    if (itemType === 'RAFFLE_NFT') {
      try {
        const [[wallet]] = await _pool.query(
          'SELECT user_id FROM user_wallets WHERE wallet_address = ?',
          [verifiedWallet]
        );
        if (wallet) {
          const raffleNftId = uuidv4();
          await fabricService.registerRaffleNFT({ raffleNftId, userDidHash, gameId: '' });
          await _pool.query(
            `INSERT INTO raffle_nfts
               (id, user_id, wallet_address, user_did_hash, status, source, expires_at)
             VALUES (?, ?, ?, ?, 'ISSUED', 'POINT_EXCHANGE', ?)`,
            [raffleNftId, wallet.user_id, verifiedWallet, userDidHash, membershipService.addDays(new Date(), 60)]
          );
          result.raffleNftId = raffleNftId;
          await notificationService.recordNotification(_pool, {
            userId: wallet.user_id,
            category: 'RAFFLE',
            title: '응모권 획득',
            message: '포인트 교환으로 응모권 NFT 1장이 지급되었습니다.',
            amount: 1,
            metadata: { raffleNftId, itemType },
          });
        }
      } catch (raffleErr) {
        console.error('[pointRoutes] RAFFLE_NFT 등록 실패 (무시):', raffleErr.message);
      }
    }

    await membershipService.recordPointEvent(_pool, {
      userId: req.user.user_id,
      walletAddress: verifiedWallet,
      eventType: itemType === 'RAFFLE_NFT' ? 'POINT_EXCHANGE_RAFFLE' : 'POINT_EXCHANGE_CARD',
      reason: itemType === 'RAFFLE_NFT' ? '응모권 교환' : '실물 NFT 카드 교환',
      amount: -Math.abs(Number(result.pointUsed || (itemType === 'RAFFLE_NFT' ? 1500 : 5000))),
      metadata: { itemType, exchangeId: result.exchangeId, raffleNftId: result.raffleNftId || null },
    });

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[pointRoutes] POST /exchange:', err);
    res.status(400).json({ error: err.message });
  }
});

// GET /api/points/events — legacy point event feed
router.get('/events', requireAuth, async (req, res) => {
  try {
    const [rows] = await _pool.query(
      `SELECT id, event_type, reason, amount, metadata_json, read_at,
              DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s+09:00') AS created_at
         FROM point_events
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 10`,
      [req.user.user_id],
    );
    const [[unread]] = await _pool.query(
      `SELECT COUNT(*) AS cnt FROM point_events WHERE user_id = ? AND read_at IS NULL`,
      [req.user.user_id],
    );
    res.json({ success: true, data: rows, unreadCount: Number(unread?.cnt ?? 0) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/events/read', requireAuth, async (req, res) => {
  try {
    await _pool.query(
      `UPDATE point_events SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL`,
      [req.user.user_id],
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setPool };
