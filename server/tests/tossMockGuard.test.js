'use strict';
/**
 * 결제 mock 우회 조건 테스트.
 *
 * paymentKey 는 클라이언트가 보내는 값이다.
 * 예전 구현은 TOSS_MODE 와 무관하게 'tgen_' 으로 시작하기만 하면 mock 으로 처리했다.
 * 실결제 모드로 전환하는 순간, paymentKey 를 "tgen_..." 으로 보내는 것만으로
 * 결제 없이 주문이 승인된다. 그 경로가 다시 열리지 않도록 못 박는다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

/** tossPayService 는 모듈 로드 시점에 env 를 읽으므로, 매번 새로 로드한다. */
function loadService({ mode, secretKey }) {
  const prevMode = process.env.TOSS_MODE;
  const prevKey = process.env.TOSS_SECRET_KEY;

  if (mode === undefined) delete process.env.TOSS_MODE;
  else process.env.TOSS_MODE = mode;
  if (secretKey === undefined) delete process.env.TOSS_SECRET_KEY;
  else process.env.TOSS_SECRET_KEY = secretKey;

  delete require.cache[require.resolve('../services/tossPayService')];
  // shouldUseMockPayment 는 내보내지 않으므로, 동작으로 판별한다.
  const service = require('../services/tossPayService');

  const restore = () => {
    if (prevMode === undefined) delete process.env.TOSS_MODE;
    else process.env.TOSS_MODE = prevMode;
    if (prevKey === undefined) delete process.env.TOSS_SECRET_KEY;
    else process.env.TOSS_SECRET_KEY = prevKey;
    delete require.cache[require.resolve('../services/tossPayService')];
  };
  return { service, restore };
}

/**
 * mock 처리 여부를 결과로 판별한다.
 * mock 이면 네트워크 호출 없이 즉시 성공하고 data.isMock 이 true 다.
 */
async function isHandledAsMock(service, paymentKey) {
  const result = await service.confirmPayment({ paymentKey, orderId: 'o1', amount: 1000 });
  return result.success === true && result.data?.isMock === true;
}

test('mock 모드에서는 어떤 키든 mock 으로 처리한다', async () => {
  const { service, restore } = loadService({ mode: 'mock', secretKey: 'test_sk' });
  try {
    assert.equal(await isHandledAsMock(service, 'tgen_abc'), true);
    assert.equal(await isHandledAsMock(service, 'live_key_abc'), true);
  } finally {
    restore();
  }
});

test('실결제 모드에서는 tgen_ 접두사로 우회할 수 없다 — 핵심 회귀 방지', async () => {
  const { service, restore } = loadService({ mode: 'real', secretKey: 'live_sk_dummy' });
  try {
    // mock 으로 빠지면 안 된다. 실제 호출을 시도하고, 더미 키라 실패해야 정상이다.
    const result = await service.confirmPayment({
      paymentKey: 'tgen_공격자가_보낸_값',
      orderId: 'o1',
      amount: 1000,
    });
    assert.notEqual(result.data?.isMock, true, 'tgen_ 키가 mock 으로 처리되면 안 됩니다');
    assert.equal(result.success, false, '더미 시크릿 키로는 승인에 성공할 수 없습니다');
  } finally {
    restore();
  }
});

test('실결제 모드에서는 시크릿 키가 없어도 mock 으로 빠지지 않는다', async () => {
  const { service, restore } = loadService({ mode: 'real', secretKey: undefined });
  try {
    const result = await service.confirmPayment({ paymentKey: 'tgen_x', orderId: 'o1', amount: 1000 });
    assert.notEqual(result.data?.isMock, true, '키가 없다고 mock 으로 승인하면 안 됩니다');
    assert.equal(result.success, false);
  } finally {
    restore();
  }
});

test('모드 미지정 + 시크릿 키 없음이면 mock 으로 처리한다 (로컬 개발 편의)', async () => {
  const { service, restore } = loadService({ mode: undefined, secretKey: undefined });
  try {
    assert.equal(await isHandledAsMock(service, 'anything'), true);
  } finally {
    restore();
  }
});

test('결제 취소도 같은 기준을 따른다', async () => {
  const { service, restore } = loadService({ mode: 'real', secretKey: 'live_sk_dummy' });
  try {
    const result = await service.cancelPayment({
      paymentKey: 'tgen_x',
      cancelReason: '테스트',
      cancelAmount: 1000,
    });
    assert.notEqual(result.data?.isMock, true, '취소도 tgen_ 로 우회되면 안 됩니다');
  } finally {
    restore();
  }
});
