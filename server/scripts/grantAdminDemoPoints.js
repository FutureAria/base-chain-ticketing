'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');
const { DB_CONFIG, DB_NAME } = require('../db/init');

const TARGET_POINTS = 10000;
const DEFAULT_ADMIN_WALLET = '0x9999999999999999999999999999999999999999';

async function main() {
  const pool = await mysql.createPool({ ...DB_CONFIG, database: DB_NAME, connectionLimit: 3 });
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [admins] = await conn.query(
      `SELECT u.user_id, u.email, COALESCE(uw.wallet_address, ?) AS wallet_address
         FROM users u
         LEFT JOIN user_wallets uw ON uw.user_id = u.user_id
        WHERE u.role = 'admin'
          AND u.is_active = 1`,
      [DEFAULT_ADMIN_WALLET],
    );

    const results = [];
    for (const admin of admins) {
      const [[balanceRow]] = await conn.query(
        `SELECT COALESCE(SUM(amount), 0) AS balance
           FROM point_events
          WHERE user_id = ?`,
        [admin.user_id],
      );
      const current = Number(balanceRow?.balance || 0);
      const adjustment = Math.max(0, TARGET_POINTS - current);

      if (adjustment > 0) {
        await conn.query(
          `INSERT INTO point_events
             (id, user_id, wallet_address, event_type, reason, amount, metadata_json)
           VALUES (UUID(), ?, ?, 'ADMIN_DEMO_POINT', '시연 관리자 포인트 지급', ?, JSON_OBJECT('targetBalance', ?, 'source', 'grantAdminDemoPoints'))`,
          [admin.user_id, admin.wallet_address, adjustment, TARGET_POINTS],
        );
      }

      results.push({
        user_id: admin.user_id,
        email: admin.email,
        before: current,
        added: adjustment,
        after: current + adjustment,
      });
    }

    await conn.commit();
    console.log(JSON.stringify({ success: true, targetPoints: TARGET_POINTS, results }, null, 2));
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
