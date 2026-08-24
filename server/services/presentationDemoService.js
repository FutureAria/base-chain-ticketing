'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// 시연용 자산을 자동 지급받을 이메일은 소스에 두지 않고 환경변수로만 받는다.
// 이 저장소는 공개되므로 팀원의 학교/개인 메일을 코드에 남기지 않는다.
// 값을 설정하지 않으면 아무도 대상이 되지 않는다.
const TARGET_POINTS = 100000;
const TARGET_FRAGMENT_COUNT = 99;
const TARGET_BOXES = 99;
const TARGET_RAFFLES = 99;
const DEMO_GAME_ID = 'PRESENTATION_RAFFLE_ALWAYS_ON';
const DEMO_STADIUM_ID = 'presentation-demo-stadium';

function isAutoGrantEnabled() {
  return String(process.env.DEMO_PRESENTATION_AUTO_GRANT || '').toLowerCase() === 'true';
}

function getDemoEmails() {
  return new Set(
    String(process.env.DEMO_PRESENTATION_EMAILS || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isPresentationDemoEmail(email) {
  if (!email) return false;
  return getDemoEmails().has(String(email).trim().toLowerCase());
}

function createNftId(prefix = 'REAL') {
  return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

async function ensureDemoRaffleGame(conn) {
  await conn.query(
    `INSERT INTO stadiums (id, name, location, capacity)
     VALUES (?, 'BASE CHAIN 시연구장', '서울특별시 송파구', 50000)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       location = VALUES(location),
       capacity = VALUES(capacity)`,
    [DEMO_STADIUM_ID],
  );

  await conn.query(
    `INSERT INTO games
       (id, home_team, away_team, game_date, game_time, stadium_id, status, base_price, booking_open_at, raffle_open_at, raffle_winners_count)
     VALUES (?, 'BASE', 'CHAIN', '2099-12-31', '23:59:00', ?, 'OPEN', 1000, NOW(), NOW(), 99)
     ON DUPLICATE KEY UPDATE
       home_team = VALUES(home_team),
       away_team = VALUES(away_team),
       game_date = VALUES(game_date),
       game_time = VALUES(game_time),
       stadium_id = VALUES(stadium_id),
       status = 'OPEN',
       base_price = VALUES(base_price),
       booking_open_at = NOW(),
       raffle_open_at = NOW(),
       raffle_winners_count = VALUES(raffle_winners_count)`,
    [DEMO_GAME_ID, DEMO_STADIUM_ID],
  );

  const [[draw]] = await conn.query(
    `SELECT id FROM draws WHERE game_id = ? ORDER BY created_at DESC LIMIT 1`,
    [DEMO_GAME_ID],
  );
  if (!draw) {
    await conn.query(
      `INSERT INTO draws (id, game_id, status, winner_count, total_entries)
       VALUES (?, ?, 'PENDING', 99, 0)`,
      [uuidv4(), DEMO_GAME_ID],
    );
  }
}

async function getUserWithWallet(conn, userId) {
  const [[user]] = await conn.query(
    `SELECT u.user_id, u.email, u.nickname, u.membership_tier, u.membership_joined_at, uw.wallet_address
       FROM users u
       LEFT JOIN user_wallets uw ON uw.user_id = u.user_id
      WHERE u.user_id = ?`,
    [userId],
  );
  return user || null;
}

async function pointBalance(conn, userId) {
  const [[row]] = await conn.query(
    `SELECT COALESCE(SUM(amount), 0) AS balance FROM point_events WHERE user_id = ?`,
    [userId],
  );
  return Number(row?.balance || 0);
}

async function raffleCount(conn, userId) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS count
       FROM raffle_nfts
      WHERE user_id = ?
        AND status = 'ISSUED'
        AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId],
  );
  return Number(row?.count || 0);
}

async function grantMembership(conn, userId) {
  await conn.query(
    `UPDATE users
        SET membership_tier = '골드',
            membership_joined_at = COALESCE(membership_joined_at, NOW())
      WHERE user_id = ?`,
    [userId],
  );
}

async function grantPoints(conn, user) {
  const before = await pointBalance(conn, user.user_id);
  const adjustment = Math.max(0, TARGET_POINTS - before);
  if (adjustment > 0) {
    await conn.query(
      `INSERT INTO point_events
         (id, user_id, wallet_address, event_type, reason, amount, metadata_json)
       VALUES (?, ?, ?, 'PRESENTATION_DEMO_POINT_GRANT', '시연용 포인트 지급', ?, ?)`,
      [
        uuidv4(),
        user.user_id,
        user.wallet_address || null,
        adjustment,
        JSON.stringify({ targetBalance: TARGET_POINTS, source: 'presentationDemoService' }),
      ],
    );
  }
  return { before, added: adjustment, after: before + adjustment };
}

async function grantFragments(conn, userId) {
  await conn.query(
    `INSERT INTO user_fragments (user_id, fragment_type_id, count)
     SELECT ?, id, ?
       FROM fragment_types
     ON DUPLICATE KEY UPDATE count = GREATEST(count, VALUES(count))`,
    [userId, TARGET_FRAGMENT_COUNT],
  );
}

async function grantBoxes(conn, userId) {
  await conn.query(
    `INSERT INTO user_boxes (user_id, season_count)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE season_count = GREATEST(season_count, VALUES(season_count))`,
    [userId, TARGET_BOXES],
  );
}

async function grantRaffles(conn, user, fabricService) {
  if (!user.wallet_address) return { skipped: true, reason: 'NO_WALLET' };
  const before = await raffleCount(conn, user.user_id);
  const missing = Math.max(0, TARGET_RAFFLES - before);
  const userDidHash = fabricService.hashDid(user.wallet_address);
  for (let i = 0; i < missing; i += 1) {
    await conn.query(
      `INSERT INTO raffle_nfts
         (id, user_id, wallet_address, user_did_hash, game_id, status, source, expires_at)
       VALUES (?, ?, ?, ?, ?, 'ISSUED', 'ADMIN', NULL)`,
      [uuidv4(), user.user_id, user.wallet_address, userDidHash, DEMO_GAME_ID],
    );
  }
  return { before, added: missing, after: before + missing };
}

async function grantDemoCards(conn, userId) {
  const [cardTypes] = await conn.query(`SELECT id, team, name, image_url, note FROM card_types ORDER BY id`);
  let added = 0;
  for (const cardType of cardTypes.slice(0, 8)) {
    const [[existing]] = await conn.query(
      `SELECT id FROM user_cards WHERE user_id = ? AND card_type_id = ? LIMIT 1`,
      [userId, cardType.id],
    );
    if (existing) continue;
    await conn.query(
      `INSERT INTO user_cards
         (user_id, card_type_id, nft_id, display_team, display_name, display_image_url, display_note, source_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'presentation-demo')`,
      [userId, cardType.id, createNftId(), cardType.team, cardType.name, cardType.image_url, cardType.note],
    );
    added += 1;
  }
  return { added, target: Math.min(8, cardTypes.length) };
}

async function grantPresentationDemoAssetsIfEligible(pool, userId, fabricService, options = {}) {
  if (!isAutoGrantEnabled() && !options.force) return { skipped: true, reason: 'DISABLED' };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const user = await getUserWithWallet(conn, userId);
    if (!user) {
      await conn.rollback();
      return { skipped: true, reason: 'USER_NOT_FOUND' };
    }
    if (!isPresentationDemoEmail(user.email)) {
      await conn.rollback();
      return { skipped: true, reason: 'EMAIL_NOT_ALLOWED' };
    }

    await ensureDemoRaffleGame(conn);
    await grantMembership(conn, user.user_id);
    const points = await grantPoints(conn, user);
    await grantFragments(conn, user.user_id);
    await grantBoxes(conn, user.user_id);
    const raffles = await grantRaffles(conn, user, fabricService);
    const cards = await grantDemoCards(conn, user.user_id);
    await conn.commit();
    return {
      skipped: false,
      userId: user.user_id,
      email: user.email,
      hasWallet: Boolean(user.wallet_address),
      points,
      fragmentsEach: TARGET_FRAGMENT_COUNT,
      boxes: TARGET_BOXES,
      raffles,
      cards,
      demoGameId: DEMO_GAME_ID,
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  DEMO_GAME_ID,
  TARGET_POINTS,
  TARGET_FRAGMENT_COUNT,
  TARGET_BOXES,
  TARGET_RAFFLES,
  ensureDemoRaffleGame,
  getDemoEmails,
  isPresentationDemoEmail,
  grantPresentationDemoAssetsIfEligible,
};
