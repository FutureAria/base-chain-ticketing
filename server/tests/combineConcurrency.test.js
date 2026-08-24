'use strict';
/**
 * 조각 합성 동시성 테스트 (실제 DB 필요).
 *
 * 합성은 "파편 2개 → 카드 1장"이다. 재료 확인과 차감 사이에 잠금이 없으면
 * 파편 2개로 동시에 여러 번 요청해 카드를 여러 장 만들 수 있다
 * (실제로 재현했을 때 카드 3장이 나오고 파편 잔량이 -4가 됐다).
 *
 * DB에 붙지 못하면 실패가 아니라 건너뛴다. 만든 데이터는 전부 원복한다.
 */
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');

const { DB_NAME, DB_CONFIG } = require('../db/init');

let pool = null;
let dbAvailable = false;
let userId = null;
let fragmentId = null;
let originalCount = null;

test.before(async () => {
  try {
    pool = mysql.createPool({ ...DB_CONFIG, database: DB_NAME, connectionLimit: 20 });
    const [[user]] = await pool.query('SELECT user_id FROM users LIMIT 1');
    const [[fragment]] = await pool.query('SELECT id FROM fragment_types LIMIT 1');
    if (!user || !fragment) throw new Error('시드 데이터(users/fragment_types)가 없습니다');

    userId = user.user_id;
    fragmentId = fragment.id;

    const [[owned]] = await pool.query(
      'SELECT count FROM user_fragments WHERE user_id = ? AND fragment_type_id = ?',
      [userId, fragmentId],
    );
    originalCount = owned ? owned.count : null;
    dbAvailable = true;
  } catch (err) {
    console.warn(`[skip] DB에 연결할 수 없어 합성 동시성 테스트를 건너뜁니다: ${err.message}`);
    dbAvailable = false;
  }
});

test.after(async () => {
  if (pool && dbAvailable) {
    if (originalCount === null) {
      await pool.query(
        'DELETE FROM user_fragments WHERE user_id = ? AND fragment_type_id = ?',
        [userId, fragmentId],
      ).catch(() => {});
    } else {
      await pool.query(
        'UPDATE user_fragments SET count = ? WHERE user_id = ? AND fragment_type_id = ?',
        [originalCount, userId, fragmentId],
      ).catch(() => {});
    }
  }
  if (pool) await pool.end().catch(() => {});
});

/** routes/combine.js 의 재료 차감 부분과 같은 순서로 동작한다. */
async function craftOnce() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[owned]] = await conn.query(
      'SELECT count FROM user_fragments WHERE user_id = ? AND fragment_type_id = ? FOR UPDATE',
      [userId, fragmentId],
    );
    if (!owned || Number(owned.count) < 2) {
      await conn.rollback();
      return 'REJECT';
    }

    const [decremented] = await conn.query(
      'UPDATE user_fragments SET count = count - 2 WHERE user_id = ? AND fragment_type_id = ? AND count >= 2',
      [userId, fragmentId],
    );
    if (decremented.affectedRows === 0) {
      await conn.rollback();
      return 'REJECT';
    }

    await conn.commit();
    return 'CRAFTED';
  } catch (err) {
    await conn.rollback().catch(() => {});
    return `ERROR:${err.code || err.message}`;
  } finally {
    conn.release();
  }
}

async function setFragmentCount(count) {
  await pool.query(
    `INSERT INTO user_fragments (user_id, fragment_type_id, count)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE count = VALUES(count)`,
    [userId, fragmentId, count],
  );
}

test('파편 2개로 동시에 8번 합성해도 카드는 1장만 나온다', async (t) => {
  if (!dbAvailable) return t.skip('DB 없음');
  await setFragmentCount(2);

  const results = await Promise.all(Array.from({ length: 8 }, () => craftOnce()));
  const crafted = results.filter((r) => r === 'CRAFTED').length;
  const errors = results.filter((r) => String(r).startsWith('ERROR'));

  assert.equal(crafted, 1, `합성은 1회만 성공해야 하는데 ${crafted}회 성공했습니다 (카드 복제)`);
  assert.equal(errors.length, 0, `예상 밖 오류: ${errors.join(', ')}`);

  const [[after]] = await pool.query(
    'SELECT count FROM user_fragments WHERE user_id = ? AND fragment_type_id = ?',
    [userId, fragmentId],
  );
  assert.equal(Number(after.count), 0, '남은 파편은 0이어야 합니다');
});

test('파편 잔량이 음수로 내려가지 않는다', async (t) => {
  if (!dbAvailable) return t.skip('DB 없음');
  await setFragmentCount(3);

  await Promise.all(Array.from({ length: 6 }, () => craftOnce()));

  const [[after]] = await pool.query(
    'SELECT count FROM user_fragments WHERE user_id = ? AND fragment_type_id = ?',
    [userId, fragmentId],
  );
  assert.ok(Number(after.count) >= 0, `파편 잔량이 음수입니다: ${after.count}`);
  assert.equal(Number(after.count), 1, '3개로 1회 합성 후 1개가 남아야 합니다');
});

test('파편이 1개뿐이면 합성되지 않는다', async (t) => {
  if (!dbAvailable) return t.skip('DB 없음');
  await setFragmentCount(1);

  assert.equal(await craftOnce(), 'REJECT');

  const [[after]] = await pool.query(
    'SELECT count FROM user_fragments WHERE user_id = ? AND fragment_type_id = ?',
    [userId, fragmentId],
  );
  assert.equal(Number(after.count), 1, '실패한 합성이 파편을 축내면 안 됩니다');
});
