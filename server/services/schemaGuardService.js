'use strict';

let runtimeSchemaReady = false;

async function columnSet(pool, tableName) {
  const [columns] = await pool.query(`SHOW COLUMNS FROM ${tableName}`);
  return new Set(columns.map((column) => column.Field));
}

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
