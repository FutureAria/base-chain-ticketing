'use strict';

const { v4: uuidv4 } = require('uuid');

const ALLOWED_CATEGORIES = new Set(['TRADE', 'RAFFLE', 'MEMBERSHIP', 'POINT', 'BOX', 'SYSTEM']);

function normalizeCategory(category) {
  const value = String(category || '').toUpperCase();
  return ALLOWED_CATEGORIES.has(value) ? value : 'SYSTEM';
}

async function recordNotification(pool, {
  userId,
  category,
  title,
  message = '',
  amount = null,
  metadata = {},
}) {
  if (!pool || !userId || !title) return null;
  const id = uuidv4();
  try {
    await pool.query(
      `INSERT INTO notification_events
         (id, user_id, category, title, message, amount, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        normalizeCategory(category),
        title,
        message || '',
        amount === null || amount === undefined ? null : Number(amount),
        JSON.stringify(metadata || {}),
      ],
    );
    return id;
  } catch (err) {
    console.error('[notificationService] record failed:', err.message);
    return null;
  }
}

module.exports = {
  recordNotification,
};
