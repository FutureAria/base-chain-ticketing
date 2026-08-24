'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const fabricService = require('../services/fabricBridge');

const router = express.Router();
let _pool;
function setPool(pool) { _pool = pool; }

// 정산 생성은 매출·수수료·구단 배분을 확정하는 절차라 운영자만 할 수 있어야 한다.
// 주석에는 "관리자용"이라고 적혀 있었지만 실제 검사가 없었다.
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: '관리자만 정산을 처리할 수 있습니다.' });
  }
  next();
}

// POST /api/settlements  (관리자용: 경기 정산 생성)
// Body: { gameId }
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { gameId } = req.body;
    if (!gameId) return res.status(400).json({ error: 'gameId 필요' });

    // DB에서 경기 티켓 통계
    const [[stats]] = await _pool.query(
      `SELECT
         COUNT(*)                                                 AS total_count,
         IFNULL(SUM(price), 0)                                   AS total_sales,
         IFNULL(SUM(CASE WHEN status = 'refunded' THEN price ELSE 0 END), 0) AS refund_amount
       FROM tickets WHERE game_id = ?`,
      [gameId]
    );

    // Fabric 정산 생성 (mock)
    const result = await fabricService.createSettlement({
      gameId,
      pool: Number(stats.total_sales),
    });

    // 이벤트 로그
    await _pool.query(
      `INSERT INTO fabric_events (id, event_name, game_id, payload_json)
       VALUES (?, 'SETTLEMENT_CREATED', ?, ?)`,
      [
        uuidv4(),
        gameId,
        JSON.stringify({
          settlementId: result.settlementId,
          totalSales:   result.totalSales,
          refundAmount: result.refundAmount,
          platformFee:  result.platformFee,
          clubRevenue:  result.clubRevenue,
        }),
      ]
    );

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[settlementRoutes] POST /:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settlements/:gameId  — fabric_events 로그에서 마지막 정산 조회
// 정산 결과에는 총매출·플랫폼 수수료·구단 수익이 들어 있어 공개하지 않는다.
router.get('/:gameId', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { gameId } = req.params;

    const [rows] = await _pool.query(
      `SELECT payload_json, created_at
       FROM fabric_events
       WHERE event_name = 'SETTLEMENT_CREATED' AND game_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [gameId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: '정산 내역 없음' });
    }

    const data = JSON.parse(rows[0].payload_json);
    res.json({
      success: true,
      data: { ...data, createdAt: rows[0].created_at },
    });
  } catch (err) {
    console.error('[settlementRoutes] GET /:gameId:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setPool };
