'use strict';

require('dotenv').config();

const mysql = require('mysql2/promise');
const { DB_CONFIG, DB_NAME } = require('../db/init');
const fabricService = require('../services/fabricBridge');
const {
  DEMO_GAME_ID,
  TARGET_POINTS,
  TARGET_FRAGMENT_COUNT,
  TARGET_BOXES,
  TARGET_RAFFLES,
  getDemoEmails,
  grantPresentationDemoAssetsIfEligible,
} = require('../services/presentationDemoService');

const applyChanges = process.argv.includes('--apply');
const targetEmails = Array.from(getDemoEmails());

async function currentUserSnapshot(conn, user) {
  const [[points]] = await conn.query(
    `SELECT COALESCE(SUM(amount), 0) AS balance FROM point_events WHERE user_id = ?`,
    [user.user_id],
  );
  const [[boxes]] = await conn.query(
    `SELECT COALESCE(season_count, 0) AS season_count FROM user_boxes WHERE user_id = ?`,
    [user.user_id],
  );
  const [[raffles]] = await conn.query(
    `SELECT COUNT(*) AS count
       FROM raffle_nfts
      WHERE user_id = ?
        AND status = 'ISSUED'
        AND (expires_at IS NULL OR expires_at > NOW())`,
    [user.user_id],
  );
  const [[fragmentTypes]] = await conn.query(`SELECT COUNT(*) AS count FROM fragment_types`);
  const [[fragmentsAtTarget]] = await conn.query(
    `SELECT COUNT(*) AS count
       FROM user_fragments uf
       JOIN fragment_types ft ON ft.id = uf.fragment_type_id
      WHERE uf.user_id = ? AND uf.count >= ?`,
    [user.user_id, TARGET_FRAGMENT_COUNT],
  );

  return {
    points: Number(points?.balance || 0),
    boxes: Number(boxes?.season_count || 0),
    raffles: Number(raffles?.count || 0),
    fragmentTypes: Number(fragmentTypes?.count || 0),
    fragmentTypesAtTarget: Number(fragmentsAtTarget?.count || 0),
  };
}

async function getTargetUsers(conn) {
  const placeholders = targetEmails.map(() => '?').join(', ');
  const orderPlaceholders = targetEmails.map(() => '?').join(', ');
  const [columns] = await conn.query(`SHOW COLUMNS FROM users`);
  const columnNames = new Set(columns.map((column) => column.Field));
  const lastLoginSelect = columnNames.has('last_login_at') ? 'u.last_login_at' : 'NULL AS last_login_at';
  const [rows] = await conn.query(
    `SELECT u.user_id,
            u.email,
            u.nickname,
            u.login_type,
            u.membership_tier,
            u.membership_joined_at,
            u.is_active,
            ${lastLoginSelect},
            uw.wallet_address
       FROM users u
       LEFT JOIN user_wallets uw ON uw.user_id = u.user_id
      WHERE u.email IN (${placeholders})
      ORDER BY FIELD(u.email, ${orderPlaceholders})`,
    [...targetEmails, ...targetEmails],
  );
  return rows;
}

async function main() {
  const pool = await mysql.createPool({ ...DB_CONFIG, database: DB_NAME, connectionLimit: 3 });
  const conn = await pool.getConnection();
  try {
    const users = await getTargetUsers(conn);
    const foundEmailSet = new Set(users.map((user) => String(user.email).toLowerCase()));
    const missingEmails = targetEmails.filter((email) => !foundEmailSet.has(email));

    if (!applyChanges) {
      const found = [];
      for (const user of users) {
        found.push({
          userId: user.user_id,
          email: user.email,
          nickname: user.nickname,
          loginType: user.login_type,
          isActive: Boolean(user.is_active),
          hasWallet: Boolean(user.wallet_address),
          membershipTier: user.membership_tier,
          hasMembership: Boolean(user.membership_joined_at),
          lastLoginAt: user.last_login_at || null,
          inventory: await currentUserSnapshot(conn, user),
        });
      }
      console.log(JSON.stringify({
        success: true,
        dryRun: true,
        message: '변경 없음. 실제 반영은 npm run seed:presentation-demo-users -- --apply 로 실행하세요.',
        checkedEmails: targetEmails,
        missingEmails,
        found,
        target: {
          points: TARGET_POINTS,
          fragmentsEach: TARGET_FRAGMENT_COUNT,
          boxes: TARGET_BOXES,
          raffles: TARGET_RAFFLES,
          demoGameId: DEMO_GAME_ID,
        },
      }, null, 2));
      return;
    }

    const results = [];
    for (const user of users) {
      results.push(await grantPresentationDemoAssetsIfEligible(pool, user.user_id, fabricService, { force: true }));
    }

    console.log(JSON.stringify({
      success: true,
      dryRun: false,
      checkedEmails: targetEmails,
      missingEmails,
      demoGameId: DEMO_GAME_ID,
      results,
    }, null, 2));
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
