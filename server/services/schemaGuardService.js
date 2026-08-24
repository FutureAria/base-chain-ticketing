/**
 * 스키마 드리프트 보정.
 *
 * 운영 DB 는 이미 데이터가 들어 있어 통째로 다시 만들 수 없다. 그래서 코드가 기대하는
 * 컬럼·테이블이 실제 DB 에 있는지 **서버 기동 시 확인하고, 없으면 그때 붙인다.**
 *
 * 규칙 — 여기서는 **추가만 한다.** 컬럼을 지우거나 타입을 바꾸는 변경은 넣지 않는다.
 * 자동으로 도는 코드가 데이터를 잃게 만들면 안 되기 때문이다.
 * 되돌릴 수 없는 변경이 필요하면 사람이 직접 실행하는 마이그레이션으로 뺀다.
 */
'use strict';

/** 프로세스당 1회만 실행하기 위한 플래그. 요청마다 SHOW COLUMNS 를 돌리지 않는다. */
let runtimeSchemaReady = false;

/**
 * 테이블의 컬럼 이름 집합을 읽는다.
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} tableName 테이블 이름
 * @returns {Promise<Set<string>>} 컬럼 이름 집합
 */
async function columnSet(pool, tableName) {
  const [columns] = await pool.query(`SHOW COLUMNS FROM ${tableName}`);
  return new Set(columns.map((column) => column.Field));
}

/**
 * `users` 에 나중에 추가된 컬럼(role·마지막 로그인 정보)이 없으면 붙인다.
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<void>}
 */
async function ensureUsersRuntimeColumns(pool) {
  const columns = await columnSet(pool, 'users');
  const alters = [];
  if (!columns.has('role')) {
    alters.push(`ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user' AFTER profile_image`);
  }
  if (!columns.has('last_login_at')) {
    alters.push(`ADD COLUMN last_login_at DATETIME DEFAULT NULL AFTER updated_at`);
  }
  if (!columns.has('last_login_ip')) {
    alters.push(`ADD COLUMN last_login_ip VARCHAR(100) DEFAULT NULL AFTER last_login_at`);
  }
  if (!columns.has('last_login_user_agent')) {
    alters.push(`ADD COLUMN last_login_user_agent VARCHAR(255) DEFAULT NULL AFTER last_login_ip`);
  }
  if (alters.length > 0) {
    await pool.query(`ALTER TABLE users ${alters.join(', ')}`);
  }
}

/**
 * `user_cards` 의 표시용 스냅샷 컬럼이 없으면 붙인다.
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<void>}
 */
async function ensureUserCardsRuntimeColumns(pool) {
  const columns = await columnSet(pool, 'user_cards');
  const alters = [];
  if (!columns.has('display_team')) {
    alters.push(`ADD COLUMN display_team VARCHAR(40) NULL AFTER nft_id`);
  }
  if (!columns.has('display_name')) {
    alters.push(`ADD COLUMN display_name VARCHAR(140) NULL AFTER display_team`);
  }
  if (!columns.has('display_image_url')) {
    alters.push(`ADD COLUMN display_image_url TEXT NULL AFTER display_name`);
  }
  if (!columns.has('display_note')) {
    alters.push(`ADD COLUMN display_note TEXT NULL AFTER display_image_url`);
  }
  if (!columns.has('source_mode')) {
    alters.push(`ADD COLUMN source_mode VARCHAR(20) NULL AFTER display_note`);
  }
  if (alters.length > 0) {
    await pool.query(`ALTER TABLE user_cards ${alters.join(', ')}`);
  }
}

/**
 * `raffle_nfts.source` ENUM 에 나중에 늘어난 값이 빠져 있으면 확장한다.
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<void>}
 */
async function ensureRaffleNftSourceEnum(pool) {
  const [columns] = await pool.query(`SHOW COLUMNS FROM raffle_nfts LIKE 'source'`);
  const type = String(columns[0]?.Type || '');
  const required = ['TIER_REWARD', 'MONTHLY_GRANT', 'POINT_EXCHANGE', 'ADMIN'];
  if (!required.every((value) => type.includes(`'${value}'`))) {
    await pool.query(
      `ALTER TABLE raffle_nfts
       MODIFY source ENUM('TIER_REWARD','MONTHLY_GRANT','POINT_EXCHANGE','ADMIN') NOT NULL DEFAULT 'POINT_EXCHANGE'`,
    );
  }
}

/**
 * 실물 교환 신청 테이블이 없으면 만든다.
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<void>}
 */
async function ensurePhysicalRedemptionTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS physical_redemption_requests (
      id              CHAR(36)     PRIMARY KEY,
      user_id         VARCHAR(50)  NOT NULL,
      user_card_id    INT          NOT NULL,
      wallet_address  VARCHAR(100) NOT NULL,
      status          ENUM('requested','shipping','completed','cancelled') NOT NULL DEFAULT 'requested',
      recipient_name  VARCHAR(80)  DEFAULT NULL,
      phone           VARCHAR(40)  DEFAULT NULL,
      address_json    JSON         DEFAULT NULL,
      requested_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_physical_redemption_card (user_card_id),
      INDEX idx_physical_redemption_user (user_id, requested_at),
      FOREIGN KEY (user_id)      REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (user_card_id) REFERENCES user_cards(id) ON DELETE CASCADE
    )
  `);
}

/**
 * 위 보정들을 한 번에 실행한다. 프로세스당 1회만 동작한다.
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<void>}
 */
async function ensureRuntimeSchema(pool) {
  if (runtimeSchemaReady) return;
  await ensureUsersRuntimeColumns(pool);
  await ensureUserCardsRuntimeColumns(pool);
  await ensureRaffleNftSourceEnum(pool);
  await ensurePhysicalRedemptionTable(pool);
  runtimeSchemaReady = true;
}

module.exports = {
  ensureRuntimeSchema,
  ensureUsersRuntimeColumns,
  ensureUserCardsRuntimeColumns,
  ensureRaffleNftSourceEnum,
  ensurePhysicalRedemptionTable,
};
