const { v4: uuidv4 } = require("uuid");

const PLATFORM_FEE_RATE = 0.03; // 3% 서비스 이용료

// 이 상태가 되면 좌석은 다시 팔 수 있다.
// DB의 seat_lock 생성컬럼, 좌석 지도 조회, 중복 검사가 모두 이 목록 하나를 기준으로 움직여야
// "지도에는 빈자리인데 예매하면 이미 팔렸다고 나오는" 어긋남이 생기지 않는다.
const RELEASED_TICKET_STATUSES = Object.freeze(['refunded', 'cancelled']);

// 좌석이 이미 팔린 경우 라우터가 409로 내려보낼 수 있도록 전용 에러를 쓴다.
class SeatAlreadyTakenError extends Error {
  constructor(seatLabel) {
    super(seatLabel ? `이미 예매된 좌석입니다 (${seatLabel})` : "이미 예매된 좌석입니다");
    this.name = "SeatAlreadyTakenError";
    this.statusCode = 409;
  }
}

function seatLabelOf({ block, row, seatNumber }) {
  return `${block}블록 ${row}열 ${seatNumber}번`;
}

function feeBreakdown(price) {
  const ticketPrice = Number(price);
  const platformFee = Math.round(ticketPrice * PLATFORM_FEE_RATE);
  return { ticketPrice, platformFee, totalCharged: ticketPrice + platformFee };
}

/**
 * 좌석 한 장을 예매한다. 호출자가 연 트랜잭션(conn) 안에서 동작한다.
 *
 * 동시 예매 방어는 2중이다.
 *   1) SELECT ... FOR UPDATE 로 같은 좌석을 노리는 트랜잭션을 직렬화한다.
 *   2) 그래도 뚫리면 DB의 uq_ticket_active_seat UNIQUE 제약이 INSERT를 거부한다.
 * 애플리케이션 검사만 믿지 않는 이유는, 검사와 INSERT 사이의 틈을 코드로는 완전히 없앨 수 없기 때문이다.
 */
async function insertTicketWithSeatLock(conn, {
  walletAddress,
  gameId,
  stadium,
  grade,
  block,
  row,
  seatNumber,
  price,
  purchaseType = "PRIMARY",
}) {
  const [taken] = await conn.query(
    `SELECT id
       FROM tickets
      WHERE game_id = ? AND block = ? AND row_num = ? AND seat_number = ?
        AND status NOT IN ('refunded','cancelled')
      FOR UPDATE`,
    [gameId, block, row, seatNumber],
  );
  if (taken.length > 0) {
    throw new SeatAlreadyTakenError(seatLabelOf({ block, row, seatNumber }));
  }

  const { ticketPrice, platformFee, totalCharged } = feeBreakdown(price);
  const id = uuidv4();

  try {
    await conn.query(
      `INSERT INTO tickets
         (id, wallet_address, game_id, stadium, grade, block, row_num, seat_number, price, purchase_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, walletAddress, gameId, stadium, grade, block, row, seatNumber, ticketPrice, purchaseType],
    );
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY") {
      throw new SeatAlreadyTakenError(seatLabelOf({ block, row, seatNumber }));
    }
    throw err;
  }

  return {
    id,
    walletAddress,
    gameId,
    stadium,
    grade,
    block,
    row,
    seatNumber,
    price: ticketPrice,
    platformFee,
    totalCharged,
    status: "confirmed",
  };
}

// 같은 좌석을 여러 트랜잭션이 동시에 노리면 InnoDB 가 갭 잠금 때문에 데드락을 잡아낸다.
// 이건 오류가 아니라 DB 가 정상적으로 충돌을 정리한 것이므로, 진 쪽은 다시 시도하면 된다.
// 재시도하면 좌석은 이미 팔린 뒤라 사용자에게는 "이미 예매된 좌석" 안내가 나간다.
// 재시도가 없으면 예매 오픈 직후 몰리는 요청이 그대로 500 으로 떨어진다.
const RETRYABLE_DB_ERRORS = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
const MAX_PURCHASE_ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 좌석 여러 장을 한 트랜잭션 안에서 예매한다.
 * 한 좌석이라도 실패하면 앞서 넣은 좌석까지 전부 롤백된다 —
 * "3석 중 2석만 발권되고 결제는 취소되는" 상태를 원천적으로 막기 위함이다.
 */
async function purchaseTickets(pool, { seats, ...common }) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_PURCHASE_ATTEMPTS; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const results = [];
      for (const seat of seats) {
        results.push(await insertTicketWithSeatLock(conn, { ...common, ...seat }));
      }
      await conn.commit();
      return results;
    } catch (err) {
      await conn.rollback().catch(() => {});
      lastError = err;

      if (!RETRYABLE_DB_ERRORS.has(err?.code) || attempt === MAX_PURCHASE_ATTEMPTS) {
        throw err;
      }
      // 같은 순간에 다시 부딪히지 않도록 짧게 흩뜨린 뒤 재시도한다.
      await sleep(20 * attempt + Math.floor(Math.random() * 20));
    } finally {
      conn.release();
    }
  }

  throw lastError;
}

/** 좌석 한 장짜리 예매(레거시 호출부 호환용). */
async function purchaseTicket(pool, input) {
  const { block, row, seatNumber, price, ...common } = input;
  const [ticket] = await purchaseTickets(pool, {
    ...common,
    seats: [{ block, row, seatNumber, price }],
  });
  return ticket;
}

module.exports = {
  purchaseTicket,
  purchaseTickets,
  insertTicketWithSeatLock,
  SeatAlreadyTakenError,
  PLATFORM_FEE_RATE,
  RELEASED_TICKET_STATUSES,
};
