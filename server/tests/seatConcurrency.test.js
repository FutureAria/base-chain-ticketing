'use strict';
/**
 * 좌석 동시 예매 통합 테스트 (실제 DB 필요).
 *
 * 단위 테스트로는 "두 요청이 같은 순간에 들어오는" 상황을 재현할 수 없어서,
 * 진짜 DB에 병렬로 밀어넣어 한 장만 발권되는지 확인한다.
 *
 * DB에 붙지 못하면 실패가 아니라 건너뛴다 (CI나 남의 PC에서도 테스트가 돌아가야 하므로).
 * 실행 후 만든 데이터는 전부 지운다.
 */
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2/promise');

const {
  purchaseTickets,
  SeatAlreadyTakenError,
  RELEASED_TICKET_STATUSES,
} = require('../services/ticketService');
const { DB_NAME, DB_CONFIG } = require('../db/init');

const TEST_GAME_ID = 'TEST_CONCURRENCY_GAME';
const TEST_BLOCK = 'TESTBLK';
const TEST_ROW = 77;
const TEST_SEAT = 77;

let pool = null;
let dbAvailable = false;

test.before(async () => {
  try {
    pool = mysql.createPool({ ...DB_CONFIG, database: DB_NAME, connectionLimit: 10 });
    await pool.query('SELECT 1');

    // 외래키(games) 때문에 테스트용 경기를 먼저 만들어 둔다.
    const [[stadium]] = await pool.query('SELECT id FROM stadiums LIMIT 1');
    if (!stadium) throw new Error('stadiums 데이터가 없어 테스트를 진행할 수 없습니다');

    await pool.query(
      `INSERT INTO games (id, home_team, away_team, game_date, game_time, stadium_id, status)
       VALUES (?, 'TEST', 'TEST', CURDATE(), '18:30:00', ?, 'OPEN')
       ON DUPLICATE KEY UPDATE home_team = VALUES(home_team)`,
      [TEST_GAME_ID, stadium.id],
    );
    dbAvailable = true;
  } catch (err) {
    console.warn(`[skip] DB에 연결할 수 없어 동시성 테스트를 건너뜁니다: ${err.message}`);
    dbAvailable = false;
  }
});

test.after(async () => {
  if (!pool) return;
  if (dbAvailable) {
    await pool.query('DELETE FROM tickets WHERE game_id = ?', [TEST_GAME_ID]).catch(() => {});
    await pool.query('DELETE FROM games WHERE id = ?', [TEST_GAME_ID]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

async function clearSeat() {
  await pool.query('DELETE FROM tickets WHERE game_id = ?', [TEST_GAME_ID]);
}

function bookSeat(wallet, seatNumber = TEST_SEAT) {
  return purchaseTickets(pool, {
    walletAddress: wallet,
    gameId: TEST_GAME_ID,
    stadium: '테스트구장',
    grade: '외야 그린석',
    block: TEST_BLOCK,
    seats: [{ row: TEST_ROW, seatNumber, price: 12000 }],
  });
}

test('같은 좌석에 동시에 10명이 몰려도 딱 한 장만 발권된다', async (t) => {
  if (!dbAvailable) return t.skip('DB 없음');
  await clearSeat();

  const attempts = Array.from({ length: 10 }, (_, i) =>
    bookSeat(`0xconcurrent${String(i).padStart(30, '0')}`),
  );
  const results = await Promise.allSettled(attempts);

  const succeeded = results.filter((r) => r.status === 'fulfilled');
  const seatTaken = results.filter(
    (r) => r.status === 'rejected' && r.reason instanceof SeatAlreadyTakenError,
  );
  const unexpected = results.filter(
    (r) => r.status === 'rejected' && !(r.reason instanceof SeatAlreadyTakenError),
  );

  if (unexpected.length > 0) {
    console.error('예상 밖 오류:', unexpected.map((r) => r.reason?.message));
  }

  assert.equal(succeeded.length, 1, `성공은 1건이어야 하는데 ${succeeded.length}건이었습니다`);
  assert.equal(seatTaken.length, 9, '나머지 9건은 좌석 중복으로 거부돼야 합니다');
  assert.equal(unexpected.length, 0, '좌석 중복 외의 오류가 발생하면 안 됩니다');

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM tickets
      WHERE game_id = ? AND block = ? AND row_num = ? AND seat_number = ?
        AND status NOT IN (?, ?)`,
    [TEST_GAME_ID, TEST_BLOCK, TEST_ROW, TEST_SEAT, ...RELEASED_TICKET_STATUSES],
  );
  assert.equal(rows[0].cnt, 1, 'DB에 남은 유효 티켓도 1장이어야 합니다');
});

test('예매 오픈 직후처럼 30명이 몰려도 DB 오류가 새어나가지 않는다', async (t) => {
  if (!dbAvailable) return t.skip('DB 없음');
  await clearSeat();

  // 같은 좌석을 여러 트랜잭션이 동시에 잠그면 InnoDB 가 갭 잠금 때문에 데드락을 잡는다.
  // 재시도가 없으면 그 데드락이 그대로 500 응답이 되어 사용자에게 나간다.
  const attempts = Array.from({ length: 30 }, (_, i) =>
    bookSeat(`0xrush${String(i).padStart(35, '0')}`),
  );
  const results = await Promise.allSettled(attempts);

  const succeeded = results.filter((r) => r.status === 'fulfilled');
  const unexpected = results.filter(
    (r) => r.status === 'rejected' && !(r.reason instanceof SeatAlreadyTakenError),
  );

  if (unexpected.length > 0) {
    console.error('예상 밖 오류:', unexpected.map((r) => r.reason?.code || r.reason?.message));
  }

  assert.equal(succeeded.length, 1, '성공은 1건이어야 합니다');
  assert.equal(
    unexpected.length,
    0,
    '데드락 등 DB 오류가 그대로 노출되면 안 됩니다 (재시도로 흡수돼야 함)',
  );
});

test('순차로 같은 좌석을 사면 두 번째는 409로 막힌다', async (t) => {
  if (!dbAvailable) return t.skip('DB 없음');
  await clearSeat();

  await bookSeat('0xfirstbuyer');
  await assert.rejects(
    () => bookSeat('0xsecondbuyer'),
    (err) => err instanceof SeatAlreadyTakenError && err.statusCode === 409,
  );
});

test('환불된 좌석은 다시 예매할 수 있다', async (t) => {
  if (!dbAvailable) return t.skip('DB 없음');
  await clearSeat();

  const [first] = await bookSeat('0xrefundbuyer');
  await pool.query("UPDATE tickets SET status = 'refunded' WHERE id = ?", [first.id]);

  // 환불로 좌석이 풀렸으니 다른 사람이 같은 자리를 살 수 있어야 한다.
  const [second] = await bookSeat('0xnextbuyer');
  assert.notEqual(second.id, first.id);

  const [rows] = await pool.query(
    `SELECT COUNT(*) AS cnt FROM tickets
      WHERE game_id = ? AND block = ? AND row_num = ? AND seat_number = ?
        AND status NOT IN (?, ?)`,
    [TEST_GAME_ID, TEST_BLOCK, TEST_ROW, TEST_SEAT, ...RELEASED_TICKET_STATUSES],
  );
  assert.equal(rows[0].cnt, 1, '환불건을 뺀 유효 티켓은 1장이어야 합니다');
});

test('여러 좌석 중 하나가 실패하면 전부 롤백된다', async (t) => {
  if (!dbAvailable) return t.skip('DB 없음');
  await clearSeat();

  // 먼저 88번 좌석을 선점해 둔다.
  await bookSeat('0xblocker', 88);

  // 87, 88, 89를 한 번에 사려고 하면 88 때문에 전체가 실패해야 한다.
  await assert.rejects(
    () =>
      purchaseTickets(pool, {
        walletAddress: '0xbulkbuyer',
        gameId: TEST_GAME_ID,
        stadium: '테스트구장',
        grade: '외야 그린석',
        block: TEST_BLOCK,
        seats: [
          { row: TEST_ROW, seatNumber: 87, price: 12000 },
          { row: TEST_ROW, seatNumber: 88, price: 12000 },
          { row: TEST_ROW, seatNumber: 89, price: 12000 },
        ],
      }),
    SeatAlreadyTakenError,
  );

  // 87번이 남아 있으면 "일부만 발권" 버그가 살아있는 것이다.
  const [rows] = await pool.query(
    `SELECT seat_number FROM tickets
      WHERE game_id = ? AND wallet_address = '0xbulkbuyer'`,
    [TEST_GAME_ID],
  );
  assert.equal(rows.length, 0, `롤백 실패 — ${rows.map((r) => r.seat_number).join(',')}번 좌석이 남았습니다`);
});
