'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
let _pool;

function setPool(pool) { _pool = pool; }

const FILTERS = {
  all: null,
  trade: 'TRADE',
  raffle: 'RAFFLE',
  membership: 'MEMBERSHIP',
  point: 'POINT',
  box: 'BOX',
};

router.get('/', requireAuth, async (req, res) => {
  try {
    const type = String(req.query.type || 'all').toLowerCase();
    const category = Object.prototype.hasOwnProperty.call(FILTERS, type) ? FILTERS[type] : null;
    const params = [req.user.user_id];
    let where = 'WHERE user_id = ? AND read_at IS NULL';
    if (category) {
      where += ' AND category = ?';
      params.push(category);
    }

    const [rows] = await _pool.query(
      `SELECT id, category, title, message, amount, metadata_json, read_at,
              DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s+09:00') AS created_at
         FROM notification_events
        ${where}
        ORDER BY created_at DESC
        LIMIT 20`,
      params,
    );
    const [[unread]] = await _pool.query(
      `SELECT COUNT(*) AS cnt
         FROM notification_events
        WHERE user_id = ? AND read_at IS NULL`,
      [req.user.user_id],
    );
    res.json({ success: true, data: rows, unreadCount: Number(unread?.cnt ?? 0) });
  } catch (err) {
    console.error('[notifications] GET /:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/read', requireAuth, async (req, res) => {
  try {
    const notificationId = String(req.body?.id || req.query.id || '').trim();
    if (notificationId) {
      const [result] = await _pool.query(
        `UPDATE notification_events
            SET read_at = NOW()
          WHERE id = ? AND user_id = ? AND read_at IS NULL`,
        [notificationId, req.user.user_id],
      );
      return res.json({ success: true, updated: result.affectedRows || 0 });
    }

    const type = String(req.body?.type || req.query.type || 'all').toLowerCase();
    const category = Object.prototype.hasOwnProperty.call(FILTERS, type) ? FILTERS[type] : null;
    const params = [req.user.user_id];
    let where = 'WHERE user_id = ? AND read_at IS NULL';
    if (category) {
      where += ' AND category = ?';
      params.push(category);
    }

    await _pool.query(
      `UPDATE notification_events SET read_at = NOW() ${where}`,
      params,
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[notifications] POST /read:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setPool };
