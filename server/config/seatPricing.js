'use strict';
/**
 * 좌석 가격의 서버측 원본(authoritative source).
 *
 * 예전에는 클라이언트가 보낸 seats[].price 를 그대로 믿고 결제 금액을 계산했다.
 * 그러면 요청 본문의 price 를 100 으로 바꾸는 것만으로 5만원 좌석을 100원에 살 수 있다.
 * 그래서 등급별 정가를 서버가 직접 들고, 요청에 실려온 금액은 검증에만 쓴다.
 *
 * 값은 프론트의 단일 출처인 Proje/app/data/ticketing.ts 와 일치해야 한다.
 * 어긋나면 tests/seatPricing.test.js 가 실패하도록 해 두었다.
 */

const PLATFORM_FEE_RATE = 0.03; // 서비스 이용료 3%

// 등급명 → 일반가(성인 기준). 프론트 seatGrades[].name / price 와 1:1 대응.
const SEAT_GRADE_PRICES = Object.freeze({
  '1루 응원 블루석': 24000,
  '중앙 테이블석':   29000,
  '3루 레드석':      21000,
  '외야 그린석':     12000,
  '중앙 지정석':     24000,
  '외야 지정석':     14000,
  '랜더스 레드석':   22000,
  '내야 네이비석':   18000,
  // 시연/실습 전용 좌석 (scripts/seedPracticeAdmin.js 가 발급하는 QR 시연 티켓)
  '시연석':          1000,
});

// 권종 배수. 프론트 seatTicketTypes[].multiplier 와 일치해야 한다.
const TICKET_TYPE_MULTIPLIERS = Object.freeze({
  adult:      1,
  youth:      0.82,
  membership: 0.9,
  kids:       0.72,
});

class PriceValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PriceValidationError';
    this.statusCode = 400;
  }
}

function knownGrade(gradeName) {
  return Object.prototype.hasOwnProperty.call(SEAT_GRADE_PRICES, String(gradeName));
}

/** 해당 등급에서 나올 수 있는 좌석 단가 집합(권종 배수 적용 후 반올림). */
function allowedSeatPrices(gradeName) {
  const base = SEAT_GRADE_PRICES[String(gradeName)];
  if (base == null) return null;
  return new Set(
    Object.values(TICKET_TYPE_MULTIPLIERS).map((multiplier) => Math.round(base * multiplier)),
  );
}

/**
 * 좌석 목록의 단가를 서버 가격표로 검증하고, 정상이면 좌석 합계를 돌려준다.
 * 클라이언트가 보낸 price 는 "이 값이 맞는지" 확인하는 용도로만 쓰고 계산의 근거로 삼지 않는다.
 */
function validateSeatPrices(gradeName, seats) {
  if (!knownGrade(gradeName)) {
    throw new PriceValidationError(`알 수 없는 좌석 등급입니다: ${gradeName}`);
  }
  if (!Array.isArray(seats) || seats.length === 0) {
    throw new PriceValidationError('좌석 정보가 없습니다.');
  }

  const allowed = allowedSeatPrices(gradeName);
  let seatTotal = 0;

  for (const seat of seats) {
    const price = Number(seat?.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new PriceValidationError('좌석 가격이 올바르지 않습니다.');
    }
    if (!allowed.has(price)) {
      throw new PriceValidationError(
        `좌석 가격이 정가와 일치하지 않습니다 (${gradeName}: ${[...allowed].sort((a, b) => a - b).join('/')}원 중 하나여야 함)`,
      );
    }
    seatTotal += price;
  }

  return seatTotal;
}

/**
 * 최종 결제 금액을 서버가 직접 계산한다.
 * 반환값의 payable 이 곧 Toss 에 승인 요청해도 되는 유일한 금액이다.
 */
function computeOrderAmount({ gradeName, seats, pointDiscount = 0 }) {
  const seatTotal = validateSeatPrices(gradeName, seats);
  const discount = Number(pointDiscount || 0);

  if (!Number.isInteger(discount) || discount < 0) {
    throw new PriceValidationError('포인트 할인 금액이 올바르지 않습니다.');
  }

  const serviceFee = Math.round(seatTotal * PLATFORM_FEE_RATE);
  const payable = seatTotal + serviceFee - discount;

  if (discount > seatTotal + serviceFee) {
    throw new PriceValidationError('포인트 할인 금액이 결제 금액을 초과합니다.');
  }

  return { seatTotal, serviceFee, discount, payable };
}

/** 요청에 실려온 amount 가 서버 계산값과 정확히 같은지 확인한다. */
function assertAmountMatches(requestedAmount, expected) {
  const amount = Number(requestedAmount);
  if (!Number.isFinite(amount) || amount !== expected.payable) {
    throw new PriceValidationError(
      `결제 금액이 올바르지 않습니다 (요청: ${requestedAmount}원, 정상: ${expected.payable}원)`,
    );
  }
  return amount;
}

module.exports = {
  PLATFORM_FEE_RATE,
  SEAT_GRADE_PRICES,
  TICKET_TYPE_MULTIPLIERS,
  PriceValidationError,
  knownGrade,
  allowedSeatPrices,
  validateSeatPrices,
  computeOrderAmount,
  assertAmountMatches,
};
