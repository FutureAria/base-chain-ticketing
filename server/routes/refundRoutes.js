'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const fabricService = require('../services/fabricBridge');
const nftBridge     = require('../services/nftBridgeAdapter');
const { cancelPayment } = require('../services/tossPayService');

const router = express.Router();
let _pool;
function setPool(pool) { _pool = pool; }

// 경기 취소·일괄 환불은 운영자만 할 수 있어야 한다.
// 주석에는 "관리자용"이라고 적혀 있었지만 실제 검사가 없어서,
// 로그인한 아무나 경기 하나를 통째로 취소하고 전 좌석을 환불시킬 수 있었다.
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: '관리자만 경기 취소를 처리할 수 있습니다.' });
  }
  next();
}

/**
 * 요청자가 실제로 그 지갑의 주인인지 확인하고, 확인된 주소를 돌려준다.
 *
 * 이전에는 요청 본문의 walletAddress 를 그대로 조회 조건에 썼다.
 * 그러면 남의 티켓 id 와 지갑 주소만 알면 그 사람의 티켓을 환불시킬 수 있다
 * (환불 대금은 원결제자에게 가지만, 피해자는 좌석을 잃는다).
 */
async function resolveOwnedWallet(userId, requestedWallet) {
  const [[wallet]] = await _pool.query(
    `SELECT wallet_address
       FROM user_wallets
      WHERE user_id = ? AND LOWER(wallet_address) = LOWER(?)`,
    [userId, String(requestedWallet || '').trim()],
  );
  return wallet?.wallet_address || null;
}

// ─── 환불율 계산 (서버 측) ────────────────────────────────
// TRANSFERRED: 항상 0%
// PRIMARY: 7일 이상=100%, 3일 이상=90%, 1일 이상=80%, 당일/이후=0%
function calcRefundRate(gameDateStr, purchaseType) {
  if (purchaseType === 'TRANSFERRED') return 0;
  if (!gameDateStr) return 100;
  const today    = new Date();
  today.setHours(0, 0, 0, 0);
  const gameDate = new Date(gameDateStr);
  if (isNaN(gameDate.getTime())) return 100;
  gameDate.setHours(0, 0, 0, 0);
  const daysUntil = Math.floor((gameDate - today) / (1000 * 60 * 60 * 24));

  if (daysUntil >= 7) return 100;
  if (daysUntil >= 3) return 90;
  if (daysUntil >= 1) return 80;
  return 0;
}

// POST /api/refunds
// Body: { ticketId, walletAddress, reason? }
router.post('/', requireAuth, async (req, res) => {
  const conn = await _pool.getConnection();
  try {
    const { ticketId, walletAddress: requestedWallet, reason } = req.body;
    if (!ticketId || !requestedWallet) {
      return res.status(400).json({ error: '필수 항목 누락 (ticketId, walletAddress)' });
    }

    // 요청한 지갑이 로그인한 사용자의 것인지 먼저 확인한다.
    const walletAddress = await resolveOwnedWallet(req.user.user_id, requestedWallet);
    if (!walletAddress) {
      return res.status(403).json({ error: '본인 계정에 연결된 지갑의 티켓만 환불할 수 있습니다.' });
    }

    // 티켓 조회 (본인 소유 + game_date 포함)
    const [[ticket]] = await _pool.query(
      `SELECT t.*, t.payment_key, g.game_date
       FROM tickets t
       JOIN games g ON t.game_id = g.id
       WHERE t.id = ? AND t.wallet_address = ?`,
      [ticketId, walletAddress]
    );
    if (!ticket) return res.status(404).json({ error: '티켓을 찾을 수 없습니다' });
    if (ticket.status !== 'confirmed') {
      return res.status(400).json({ error: `환불 불가 상태: ${ticket.status}` });
    }

    const gameDateStr    = ticket.game_date instanceof Date
      ? ticket.game_date.toISOString().split('T')[0]
      : String(ticket.game_date).split('T')[0];
    const purchaseType   = ticket.purchase_type || 'PRIMARY';
    const refundRate     = calcRefundRate(gameDateStr, purchaseType);

    if (refundRate === 0) {
      return res.status(400).json({ error: '환불 불가 기간입니다 (경기 당일 또는 이후)' });
    }

    const refundAmount = Math.floor(Number(ticket.price) * refundRate / 100);
    const refundId     = uuidv4();

    await conn.beginTransaction();

    // DB: tickets 상태 업데이트
    await conn.query(
      "UPDATE tickets SET status = 'refund_processing' WHERE id = ?",
      [ticketId]
    );

    // DB: refunds 레코드 삽입
    await conn.query(
      `INSERT INTO refunds
         (refund_id, ticket_id, user_id, purchase_type, refund_rate, original_price, refund_amount, reason, status, fabric_refund_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', NULL)`,
      [refundId, ticketId, req.user.user_id, purchaseType, refundRate, ticket.price, refundAmount, reason || null]
    );

    // Fabric 환불 요청 (mock)
    const fabricResult = await fabricService.requestRefund({
      ticketId,
      walletAddress,
      refundReason:  reason || '사용자 요청',
      gameDateStr,
      purchaseType,
    });

    // NFT 무효화
    await nftBridge.requestNftBurn(ticket.token_id, walletAddress);

    // 토스페이 환불 (결제 키가 있는 경우만)
    if (ticket.payment_key) {
      const tossResult = await cancelPayment({
        paymentKey:   ticket.payment_key,
        cancelReason: reason || '사용자 환불 요청',
        cancelAmount: refundAmount,
      });
      if (!tossResult.success) {
        console.error('[refundRoutes] 토스페이 환불 실패:', tossResult);
      }
    }

    // DB: 자동 완료 처리
    await conn.query(
      "UPDATE tickets SET status = 'refunded' WHERE id = ?",
      [ticketId]
    );
    await conn.query(
      `UPDATE refunds SET status = 'completed', fabric_refund_id = ?, completed_at = NOW()
       WHERE refund_id = ?`,
      [fabricResult.refundId, refundId]
    );

    // 이벤트 로그
    await conn.query(
      `INSERT INTO fabric_events
         (id, event_name, ticket_id, game_id, user_did_hash, payload_json)
       VALUES (?, 'REFUND_COMPLETED', ?, ?, ?, ?)`,
      [
        uuidv4(),
        ticketId,
        ticket.game_id,
        fabricService.hashDid(walletAddress),
        JSON.stringify({
          refundId,
          fabricRefundId: fabricResult.refundId,
          refundRate,
          refundAmount,
          purchaseType,
          reason: reason || '사용자 요청',
        }),
      ]
    );

    await conn.commit();
    res.json({
      success:      true,
      refundId,
      refundRate,
      refundAmount,
      purchaseType,
      status:       'completed',
    });
  } catch (err) {
    await conn.rollback();
    console.error('[refundRoutes] POST /:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// GET /api/refunds/preview?ticketId=...&walletAddress=...
// 환불 전 예상 금액 조회
router.get('/preview', requireAuth, async (req, res) => {
  try {
    const { ticketId, walletAddress: requestedWallet } = req.query;
    if (!ticketId || !requestedWallet) {
      return res.status(400).json({ error: '필수 파라미터 누락' });
    }

    // 조회 역시 본인 지갑으로 제한한다 — 남의 티켓 가격·환불액이 새어나가지 않도록.
    const walletAddress = await resolveOwnedWallet(req.user.user_id, requestedWallet);
    if (!walletAddress) {
      return res.status(403).json({ error: '본인 계정에 연결된 지갑의 티켓만 조회할 수 있습니다.' });
    }

    const [[ticket]] = await _pool.query(
      `SELECT t.*, g.game_date
       FROM tickets t
       JOIN games g ON t.game_id = g.id
       WHERE t.id = ? AND t.wallet_address = ?`,
      [ticketId, walletAddress]
    );
    if (!ticket) return res.status(404).json({ error: '티켓을 찾을 수 없습니다' });

    const gameDateStr  = ticket.game_date instanceof Date
      ? ticket.game_date.toISOString().split('T')[0]
      : String(ticket.game_date).split('T')[0];
    const purchaseType = ticket.purchase_type || 'PRIMARY';
    const refundRate   = calcRefundRate(gameDateStr, purchaseType);
    const refundAmount = Math.floor(Number(ticket.price) * refundRate / 100);

    res.json({
      ticketId,
      purchaseType,
      originalPrice: ticket.price,
      refundRate,
      refundAmount,
      refundable:    refundRate > 0 && ticket.status === 'confirmed',
      gameDate:      gameDateStr,
    });
  } catch (err) {
    console.error('[refundRoutes] GET /preview:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/refunds/cancel-game  (관리자용: 경기 취소 → 전체 100% 환불)
// Body: { gameId }
router.post('/cancel-game', requireAuth, requireAdmin, async (req, res) => {
  const conn = await _pool.getConnection();
  try {
    const { gameId } = req.body;
    if (!gameId) return res.status(400).json({ error: 'gameId 필요' });

    // 경기 상태 CANCELLED 로 변경
    await conn.beginTransaction();
    await conn.query(
      "UPDATE games SET status = 'CANCELLED' WHERE id = ?",
      [gameId]
    );

    // confirmed 상태 티켓 전부 조회 (PRIMARY + TRANSFERRED 모두)
    const [tickets] = await conn.query(
      `SELECT t.*, t.payment_key, g.game_date
       FROM tickets t
       JOIN games g ON t.game_id = g.id
       WHERE t.game_id = ? AND t.status = 'confirmed'`,
      [gameId]
    );

    // Fabric 일괄 환불
    // 반환값은 쓰지 않는다. 실패하면 예외가 올라와 아래 응답까지 가지 않는다.
    await fabricService.cancelGameRefundAll({ gameId });

    let completedCount = 0;
    for (const ticket of tickets) {
      const refundId = uuidv4();
      // wallet_address → user_id 변환 (tickets 테이블에 user_id 없음)
      const [[walletRow]] = await conn.query(
        'SELECT user_id FROM user_wallets WHERE wallet_address = ?',
        [ticket.wallet_address]
      );
      if (!walletRow) continue; // 지갑 미등록 티켓은 건너뜀
      await conn.query(
        `INSERT INTO refunds
           (refund_id, ticket_id, user_id, purchase_type, refund_rate, original_price, refund_amount, reason, status, completed_at)
         VALUES (?, ?, ?, ?, 100, ?, ?, '경기 취소', 'completed', NOW())`,
        [refundId, ticket.id, walletRow.user_id, ticket.purchase_type || 'PRIMARY', ticket.price, ticket.price]
      );
      await conn.query(
        "UPDATE tickets SET status = 'refunded' WHERE id = ?",
        [ticket.id]
      );

      // 토스페이 전액 환불
      if (ticket.payment_key) {
        const tossResult = await cancelPayment({
          paymentKey:   ticket.payment_key,
          cancelReason: '경기 취소로 인한 전액 환불',
        });
        if (!tossResult.success) {
          console.error(`[refundRoutes] 토스페이 환불 실패 (ticket: ${ticket.id}):`, tossResult);
        }
      }

      completedCount++;
    }

    await conn.query(
      `INSERT INTO fabric_events (id, event_name, game_id, payload_json)
       VALUES (?, 'GAME_CANCEL_REFUND_ALL', ?, ?)`,
      [uuidv4(), gameId, JSON.stringify({ refundCount: completedCount })]
    );

    await conn.commit();
    res.json({ success: true, gameId, refundCount: completedCount });
  } catch (err) {
    await conn.rollback();
    console.error('[refundRoutes] POST /cancel-game:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = { router, setPool };
