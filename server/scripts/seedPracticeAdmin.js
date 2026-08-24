'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const { DB_CONFIG, DB_NAME } = require('../db/init');
const fabricService = require('../services/fabricBridge');

// 이 스크립트는 관리자 권한 계정을 만든다.
// 비밀번호를 소스에 박아두면 공개 저장소에 운영 서버 관리자 자격증명을 함께 공개하는 것과 같다.
// PRACTICE_ADMIN_PASSWORD 환경변수로만 받고, 없으면 실행을 거부한다.
const PRACTICE_ADMIN_PASSWORD = process.env.PRACTICE_ADMIN_PASSWORD || '';
if (!PRACTICE_ADMIN_PASSWORD) {
  console.error(
    '[seed:practice-admin] PRACTICE_ADMIN_PASSWORD 가 설정되지 않아 중단합니다.\n' +
    '  이 스크립트는 관리자 권한 계정을 생성하므로 비밀번호를 직접 지정해야 합니다.\n' +
    '  예: PRACTICE_ADMIN_PASSWORD="$(node -e \"console.log(require(\'crypto\').randomBytes(16).toString(\'hex\'))\")" npm run seed:practice-admin',
  );
  process.exit(1);
}
if (PRACTICE_ADMIN_PASSWORD.length < 12) {
  console.error('[seed:practice-admin] PRACTICE_ADMIN_PASSWORD 는 12자 이상이어야 합니다.');
  process.exit(1);
}

const PRACTICE = {
  userId: 'practice_admin',
  email: process.env.PRACTICE_ADMIN_EMAIL || 'practice@basechain.dev',
  password: PRACTICE_ADMIN_PASSWORD,
  nickname: '시연 관리자',
  walletAddress: '0x9999999999999999999999999999999999999999',
  didValue: 'did:basechain:practice-admin',
  pointBalance: 990000,
  boxes: 99,
  fragmentsPerType: 99,
  raffles: 99,
  gameId: 'PRACTICE_ALL_DAY_GAME',
  drawId: '00000000-0000-4000-8000-000000000099',
  ticketId: 'practice-ticket-qr-000000000001',
};

function tomorrowDateSql() {
  return `DATE_ADD(CURDATE(), INTERVAL 1 DAY)`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function ensurePracticeAccount(conn) {
  const passwordHash = await bcrypt.hash(PRACTICE.password, 10);
  await conn.query(
    `INSERT INTO users
       (user_id, nickname, email, password_hash, login_type, role, membership_tier, membership_joined_at, is_active)
     VALUES (?, ?, ?, ?, 'local', 'admin', '골드', NOW(), 1)
     ON DUPLICATE KEY UPDATE
       nickname = VALUES(nickname),
       password_hash = VALUES(password_hash),
       login_type = 'local',
       role = 'admin',
       membership_tier = '골드',
       membership_joined_at = COALESCE(membership_joined_at, NOW()),
       is_active = 1`,
    [PRACTICE.userId, PRACTICE.nickname, PRACTICE.email, passwordHash],
  );

  await conn.query(
    `INSERT INTO user_wallets
       (user_id, wallet_address, nonce, is_verified, connected_at, verified_at)
     VALUES (?, ?, NULL, 1, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       wallet_address = VALUES(wallet_address),
       is_verified = 1,
       verified_at = NOW()`,
    [PRACTICE.userId, PRACTICE.walletAddress],
  );

  await conn.query(
    `INSERT INTO did_verifications
       (user_id, did_value, wallet_address, last_signature, status, verified_at)
     VALUES (?, ?, ?, 'practice-demo-signature', 'verified', NOW())
     ON DUPLICATE KEY UPDATE
       did_value = VALUES(did_value),
       wallet_address = VALUES(wallet_address),
       status = 'verified',
       verified_at = NOW()`,
    [PRACTICE.userId, PRACTICE.didValue, PRACTICE.walletAddress],
  );
}

async function ensureOpenPracticeGame(conn) {
  await conn.query(
    `INSERT INTO stadiums (id, name, location, capacity)
     VALUES ('practice-stadium', 'BASE CHAIN 시연구장', '서울특별시 송파구', 25000)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       location = VALUES(location),
       capacity = VALUES(capacity)`,
  );

  await conn.query(
    `INSERT INTO games
       (id, home_team, away_team, game_date, game_time, stadium_id, status, base_price, booking_open_at, raffle_open_at, raffle_winners_count)
     VALUES (?, 'BASE', 'CHAIN', ${tomorrowDateSql()}, '23:59:00', 'practice-stadium', 'OPEN', 1000, DATE_SUB(NOW(), INTERVAL 1 HOUR), DATE_SUB(NOW(), INTERVAL 1 MINUTE), 99)
     ON DUPLICATE KEY UPDATE
       home_team = VALUES(home_team),
       away_team = VALUES(away_team),
       game_date = ${tomorrowDateSql()},
       game_time = '23:59:00',
       stadium_id = 'practice-stadium',
       status = 'OPEN',
       base_price = 1000,
       booking_open_at = DATE_SUB(NOW(), INTERVAL 1 HOUR),
       raffle_open_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE),
       raffle_winners_count = 99`,
    [PRACTICE.gameId],
  );

  await conn.query(
    `INSERT INTO draws (id, game_id, status, winner_count, total_entries)
     VALUES (?, ?, 'PENDING', 99, 0)
     ON DUPLICATE KEY UPDATE
       game_id = VALUES(game_id),
       status = 'PENDING',
       winner_count = 99`,
    [PRACTICE.drawId, PRACTICE.gameId],
  );
}

async function ensureQrTicket(conn) {
  await conn.query(
    `INSERT INTO tickets
       (id, wallet_address, game_id, stadium, grade, block, row_num, seat_number, price, token_id, ticket_tx_hash, payment_key, point_discount, purchase_type, status)
     VALUES (?, ?, ?, 'BASE CHAIN 시연구장', '시연석', 'QR', 1, 1, 1000, 999999, ?, 'practice-payment', 0, 'PRIMARY', 'confirmed')
     ON DUPLICATE KEY UPDATE
       wallet_address = VALUES(wallet_address),
       game_id = VALUES(game_id),
       stadium = VALUES(stadium),
       grade = VALUES(grade),
       block = VALUES(block),
       row_num = VALUES(row_num),
       seat_number = VALUES(seat_number),
       price = VALUES(price),
       token_id = VALUES(token_id),
       ticket_tx_hash = VALUES(ticket_tx_hash),
       payment_key = VALUES(payment_key),
       purchase_type = 'PRIMARY',
       status = 'confirmed'`,
    [PRACTICE.ticketId, PRACTICE.walletAddress, PRACTICE.gameId, `0x${sha256(PRACTICE.ticketId)}`],
  );
}

async function ensureInventory(conn) {
  await conn.query(
    `INSERT INTO user_boxes (user_id, season_count)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE season_count = VALUES(season_count)`,
    [PRACTICE.userId, PRACTICE.boxes],
  );

  const [fragmentTypes] = await conn.query(`SELECT id FROM fragment_types ORDER BY id`);
  for (const fragment of fragmentTypes) {
    await conn.query(
      `INSERT INTO user_fragments (user_id, fragment_type_id, count)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE count = VALUES(count)`,
      [PRACTICE.userId, fragment.id, PRACTICE.fragmentsPerType],
    );
  }

  await conn.query(`DELETE FROM raffle_nfts WHERE user_id = ?`, [PRACTICE.userId]);
  const userDidHash = fabricService.hashDid(PRACTICE.walletAddress);
  for (let i = 1; i <= PRACTICE.raffles; i += 1) {
    await conn.query(
      `INSERT INTO raffle_nfts
         (id, user_id, wallet_address, user_did_hash, game_id, status, source, expires_at)
       VALUES (?, ?, ?, ?, ?, 'ISSUED', 'ADMIN', DATE_ADD(NOW(), INTERVAL 30 DAY))`,
      [
        `practice-raffle-${String(i).padStart(3, '0')}-0000-0000-0000-000000000000`.slice(0, 36),
        PRACTICE.userId,
        PRACTICE.walletAddress,
        userDidHash,
        PRACTICE.gameId,
      ],
    );
  }
}

async function ensurePointBalance(conn) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(SUM(amount), 0) AS balance
       FROM point_events
      WHERE user_id = ?`,
    [PRACTICE.userId],
  );
  const current = Number(row?.balance || 0);
  const adjustment = PRACTICE.pointBalance - current;
  if (adjustment !== 0) {
    await conn.query(
      `INSERT INTO point_events
         (id, user_id, wallet_address, event_type, reason, amount, metadata_json)
       VALUES (UUID(), ?, ?, 'PRACTICE_SEED_POINT', '실습용 포인트 지급', ?, JSON_OBJECT('targetBalance', ?, 'source', 'seedPracticeAdmin'))`,
      [PRACTICE.userId, PRACTICE.walletAddress, adjustment, PRACTICE.pointBalance],
    );
  }
}

async function main() {
  const pool = await mysql.createPool({ ...DB_CONFIG, database: DB_NAME, connectionLimit: 3 });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await ensurePracticeAccount(conn);
    await ensureOpenPracticeGame(conn);
    await ensureQrTicket(conn);
    await ensureInventory(conn);
    await ensurePointBalance(conn);
    await conn.commit();

    console.log(JSON.stringify({
      success: true,
      account: {
        email: PRACTICE.email,
        password: PRACTICE.password,
        role: 'admin',
        tier: '골드',
        walletAddress: PRACTICE.walletAddress,
        did: PRACTICE.didValue,
      },
      demo: {
        gameId: PRACTICE.gameId,
        drawId: PRACTICE.drawId,
        ticketId: PRACTICE.ticketId,
        points: PRACTICE.pointBalance,
        boxes: PRACTICE.boxes,
        fragmentsPerType: PRACTICE.fragmentsPerType,
        raffles: PRACTICE.raffles,
      },
    }, null, 2));
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
