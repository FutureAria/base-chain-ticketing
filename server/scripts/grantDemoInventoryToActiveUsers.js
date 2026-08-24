'use strict';

require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const mysql = require('mysql2/promise');
const { DB_CONFIG, DB_NAME } = require('../db/init');
const fabricService = require('../services/fabricBridge');

const TARGET_POINTS = 10000;
const TARGET_BOXES = 4;
const TARGET_RAFFLES = 4;
const DEMO_GAME_ID = 'PRACTICE_ALL_DAY_GAME';

async function grantPoints(conn, user) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(SUM(amount), 0) AS balance
       FROM point_events
      WHERE user_id = ?`,
    [user.user_id],
  );
  const current = Number(row?.balance || 0);
  const adjustment = Math.max(0, TARGET_POINTS - current);
  if (adjustment > 0) {
    await conn.query(
      `INSERT INTO point_events
         (id, user_id, wallet_address, event_type, reason, amount, metadata_json)
       VALUES (UUID(), ?, ?, 'DEMO_POINT_GRANT', '시연용 포인트 지급', ?, JSON_OBJECT('targetBalance', ?, 'source', 'grantDemoInventoryToActiveUsers'))`,
      [user.user_id, user.wallet_address, adjustment, TARGET_POINTS],
    );
  }
  return { before: current, added: adjustment, after: current + adjustment };
}

async function grantBoxes(conn, user) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(season_count, 0) AS season_count
       FROM user_boxes
      WHERE user_id = ?`,
    [user.user_id],
  );
  const current = Number(row?.season_count || 0);
  const next = Math.max(current, TARGET_BOXES);
  await conn.query(
    `INSERT INTO user_boxes (user_id, season_count)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE season_count = GREATEST(season_count, VALUES(season_count))`,
    [user.user_id, TARGET_BOXES],
  );
  return { before: current, after: next };
}

async function grantRaffles(conn, user) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS count
       FROM raffle_nfts
      WHERE user_id = ?
        AND status = 'ISSUED'
        AND (expires_at IS NULL OR expires_at > NOW())`,
    [user.user_id],
  );
  const current = Number(row?.count || 0);
  const missing = Math.max(0, TARGET_RAFFLES - current);
  const userDidHash = fabricService.hashDid(user.wallet_address);
  for (let i = 0; i < missing; i += 1) {
    const raffleNftId = uuidv4();
    await conn.query(
      `INSERT INTO raffle_nfts
         (id, user_id, wallet_address, user_did_hash, game_id, status, source, expires_at)
       VALUES (?, ?, ?, ?, ?, 'ISSUED', 'ADMIN', DATE_ADD(NOW(), INTERVAL 30 DAY))`,
      [raffleNftId, user.user_id, user.wallet_address, userDidHash, DEMO_GAME_ID],
    );
  }
  return { before: current, added: missing, after: current + missing };
}

async function main() {
  const pool = await mysql.createPool({ ...DB_CONFIG, database: DB_NAME, connectionLimit: 3 });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [users] = await conn.query(
      `SELECT u.user_id, u.email, u.nickname, u.role, uw.wallet_address
         FROM users u
         JOIN user_wallets uw ON uw.user_id = u.user_id
        WHERE u.is_active = 1
          AND (u.email IS NOT NULL OR u.role = 'admin')`,
    );

    const results = [];
    for (const user of users) {
      const points = await grantPoints(conn, user);
      const boxes = await grantBoxes(conn, user);
      const raffles = await grantRaffles(conn, user);
      results.push({
        user_id: user.user_id,
        email: user.email,
        role: user.role,
        points,
        boxes,
        raffles,
      });
    }

    await conn.commit();
    console.log(JSON.stringify({ success: true, targets: { points: TARGET_POINTS, boxes: TARGET_BOXES, raffles: TARGET_RAFFLES }, results }, null, 2));
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
