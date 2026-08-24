'use strict';
/**
 * 온체인 결제 검증 테스트.
 *
 * /api/market/buy 는 예전에 클라이언트가 보낸 txHash 를 그대로 믿었다.
 * 즉 아무 문자열이나 보내면 결제 없이 조각을 받아갈 수 있었다.
 * 여기서는 "무엇을 통과시키고 무엇을 막아야 하는가"를 못 박는다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isValidTxHash,
  checkPaymentMatches,
  PaymentVerificationError,
} = require('../services/onchainPaymentService');

const SELLER = '0xAbC1230000000000000000000000000000000001';
const PRICE_WEI = '1000000000000000'; // 0.001

const okReceipt = { status: 1, confirmations: 3 };
const okTx = { to: SELLER, value: BigInt(PRICE_WEI) };
const expected = { expectedTo: SELLER, expectedWei: PRICE_WEI };

test('트랜잭션 해시 형식을 검사한다', () => {
  assert.equal(isValidTxHash('0x' + 'a'.repeat(64)), true);
  assert.equal(isValidTxHash('0x' + 'A'.repeat(64)), true);

  // 예전에는 이런 값들이 그대로 통과해 조각을 가져갈 수 있었다.
  assert.equal(isValidTxHash('0xdeadbeef'), false);
  assert.equal(isValidTxHash('아무거나'), false);
  assert.equal(isValidTxHash(''), false);
  assert.equal(isValidTxHash(null), false);
  assert.equal(isValidTxHash(undefined), false);
  assert.equal(isValidTxHash('a'.repeat(66)), false); // 0x 없음
});

test('정상 결제는 통과한다', () => {
  assert.equal(checkPaymentMatches(okTx, okReceipt, expected), true);
});

test('요구 금액보다 더 보낸 경우도 통과한다', () => {
  const tx = { to: SELLER, value: BigInt(PRICE_WEI) * 2n };
  assert.equal(checkPaymentMatches(tx, okReceipt, expected), true);
});

test('체인에 없는 트랜잭션은 거부한다', () => {
  assert.throws(() => checkPaymentMatches(null, okReceipt, expected), PaymentVerificationError);
});

test('아직 처리되지 않은 트랜잭션은 거부한다', () => {
  assert.throws(() => checkPaymentMatches(okTx, null, expected), PaymentVerificationError);
});

test('실패한 트랜잭션은 거부한다', () => {
  assert.throws(
    () => checkPaymentMatches(okTx, { status: 0, confirmations: 5 }, expected),
    PaymentVerificationError,
  );
});

test('확정되지 않은 트랜잭션은 거부한다', () => {
  assert.throws(
    () => checkPaymentMatches(okTx, { status: 1, confirmations: 0 }, expected),
    PaymentVerificationError,
  );
});

test('다른 사람에게 보낸 결제는 거부한다', () => {
  const tx = { to: '0x9999999999999999999999999999999999999999', value: BigInt(PRICE_WEI) };
  assert.throws(() => checkPaymentMatches(tx, okReceipt, expected), PaymentVerificationError);
});

test('수신자가 없는(컨트랙트 생성) 트랜잭션은 거부한다', () => {
  const tx = { to: null, value: BigInt(PRICE_WEI) };
  assert.throws(() => checkPaymentMatches(tx, okReceipt, expected), PaymentVerificationError);
});

test('금액이 모자라면 거부한다 — 1 wei 부족해도 막는다', () => {
  const tx = { to: SELLER, value: BigInt(PRICE_WEI) - 1n };
  assert.throws(() => checkPaymentMatches(tx, okReceipt, expected), PaymentVerificationError);
});

test('금액 0 결제는 거부한다', () => {
  const tx = { to: SELLER, value: 0n };
  assert.throws(() => checkPaymentMatches(tx, okReceipt, expected), PaymentVerificationError);
});

test('요구 금액을 계산하지 못하면 거부한다', () => {
  assert.throws(
    () => checkPaymentMatches(okTx, okReceipt, { expectedTo: SELLER, expectedWei: '0' }),
    PaymentVerificationError,
  );
});

test('지갑 주소 대소문자가 달라도 같은 주소로 본다', () => {
  const tx = { to: SELLER.toLowerCase(), value: BigInt(PRICE_WEI) };
  assert.equal(
    checkPaymentMatches(tx, okReceipt, { expectedTo: SELLER.toUpperCase().replace('0X', '0x'), expectedWei: PRICE_WEI }),
    true,
  );
});
