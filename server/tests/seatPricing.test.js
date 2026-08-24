'use strict';
/**
 * 결제 금액 검증 테스트.
 *
 * 이 프로젝트에서 가장 아팠던 결함이 "클라이언트가 보낸 가격을 그대로 믿은 것"이라,
 * 그 경로가 다시 열리지 않는지를 여기서 못 박는다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  SEAT_GRADE_PRICES,
  TICKET_TYPE_MULTIPLIERS,
  PriceValidationError,
  validateSeatPrices,
  computeOrderAmount,
  assertAmountMatches,
} = require('../config/seatPricing');

const BLUE = '1루 응원 블루석'; // 24,000원
const bluePrice = SEAT_GRADE_PRICES[BLUE];

test('정가 좌석은 통과한다', () => {
  const total = validateSeatPrices(BLUE, [{ price: bluePrice }, { price: bluePrice }]);
  assert.equal(total, bluePrice * 2);
});

test('권종 할인가(청소년·멤버십·키즈)도 통과한다', () => {
  for (const multiplier of Object.values(TICKET_TYPE_MULTIPLIERS)) {
    const discounted = Math.round(bluePrice * multiplier);
    assert.doesNotThrow(() => validateSeatPrices(BLUE, [{ price: discounted }]));
  }
});

test('임의로 깎은 가격은 거부한다 — 가격 조작 방어', () => {
  assert.throws(
    () => validateSeatPrices(BLUE, [{ price: 100 }]),
    PriceValidationError,
  );
  assert.throws(
    () => validateSeatPrices(BLUE, [{ price: 0 }]),
    PriceValidationError,
  );
  assert.throws(
    () => validateSeatPrices(BLUE, [{ price: -5000 }]),
    PriceValidationError,
  );
});

test('여러 좌석 중 하나만 조작해도 거부한다', () => {
  assert.throws(
    () => validateSeatPrices(BLUE, [{ price: bluePrice }, { price: 10 }]),
    PriceValidationError,
  );
});

test('등록되지 않은 등급명은 거부한다', () => {
  assert.throws(
    () => validateSeatPrices('내가 만든 좌석', [{ price: 1 }]),
    PriceValidationError,
  );
});

test('결제 금액은 서버가 계산한 값과 정확히 일치해야 한다', () => {
  const seats = [{ price: bluePrice }];
  const expected = computeOrderAmount({ gradeName: BLUE, seats, pointDiscount: 0 });

  assert.equal(expected.seatTotal, 24000);
  assert.equal(expected.serviceFee, 720); // 3%
  assert.equal(expected.payable, 24720);

  assert.doesNotThrow(() => assertAmountMatches(24720, expected));
  assert.throws(() => assertAmountMatches(100, expected), PriceValidationError);
  assert.throws(() => assertAmountMatches(24719, expected), PriceValidationError);
});

test('포인트 할인은 pointDiscount 가 0일 때도 금액 검증을 건너뛰지 않는다', () => {
  // 예전 버그: pd > 0 인 경우에만 금액을 확인해서, pd=0 이면 아무 금액이나 통과했다.
  const seats = [{ price: bluePrice }];
  const expected = computeOrderAmount({ gradeName: BLUE, seats, pointDiscount: 0 });
  assert.throws(() => assertAmountMatches(1, expected), PriceValidationError);
});

test('포인트 할인이 결제 금액을 넘으면 거부한다', () => {
  assert.throws(
    () => computeOrderAmount({ gradeName: BLUE, seats: [{ price: bluePrice }], pointDiscount: 999999 }),
    PriceValidationError,
  );
});

test('포인트 할인이 적용된 금액을 정확히 계산한다', () => {
  const result = computeOrderAmount({
    gradeName: BLUE,
    seats: [{ price: bluePrice }],
    pointDiscount: 5000,
  });
  assert.equal(result.payable, 24000 + 720 - 5000);
});

/**
 * 프론트(Proje/app/data/ticketing.ts)와 서버 가격표가 어긋나면 실패한다.
 * 한쪽만 고치고 다른 쪽을 잊는 사고를 막기 위한 장치다.
 */
test('프론트 가격표와 서버 가격표가 일치한다', () => {
  const ticketingPath = path.join(__dirname, '..', '..', 'Proje', 'app', 'data', 'ticketing.ts');
  if (!fs.existsSync(ticketingPath)) {
    console.warn('[skip] 프론트 ticketing.ts 를 찾을 수 없어 대조를 건너뜁니다.');
    return;
  }

  const source = fs.readFileSync(ticketingPath, 'utf-8');
  const gradePattern = /\n        id: "[^"]+",\n        name: "([^"]+)",\n(?:.*\n)*?        price: (\d+),/g;

  const frontendPrices = {};
  for (const match of source.matchAll(gradePattern)) {
    frontendPrices[match[1]] = Number(match[2]);
  }

  assert.ok(
    Object.keys(frontendPrices).length > 0,
    'ticketing.ts 에서 좌석 등급을 하나도 읽지 못했습니다 (파싱 규칙 확인 필요)',
  );

  for (const [gradeName, price] of Object.entries(frontendPrices)) {
    assert.equal(
      SEAT_GRADE_PRICES[gradeName],
      price,
      `등급 "${gradeName}" 가격이 프론트(${price})와 서버(${SEAT_GRADE_PRICES[gradeName]})에서 다릅니다`,
    );
  }

  const multiplierPattern = /multiplier: ([\d.]+)/g;
  const frontendMultipliers = [...source.matchAll(multiplierPattern)].map((m) => Number(m[1]));
  for (const multiplier of frontendMultipliers) {
    assert.ok(
      Object.values(TICKET_TYPE_MULTIPLIERS).includes(multiplier),
      `프론트 권종 배수 ${multiplier} 가 서버 목록에 없습니다`,
    );
  }
});
