const axios = require('axios');

const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY;
const TOSS_MODE = (process.env.TOSS_MODE || '').trim().toLowerCase();
const TOSS_API_BASE = 'https://api.tosspayments.com/v1';

/**
 * 이 결제를 mock 으로 처리할지 판단한다.
 *
 * 주의: paymentKey 는 클라이언트가 보내는 값이다.
 * 예전에는 TOSS_MODE 와 무관하게 'tgen_' 으로 시작하기만 하면 mock 으로 처리했다.
 * 실결제 모드로 전환하는 순간, paymentKey 를 "tgen_..." 으로 보내는 것만으로
 * 결제 없이 주문이 승인된다. 그래서 실결제 모드에서는 어떤 경우에도 우회하지 않는다.
 */
function shouldUseMockPayment(paymentKey) {
  if (TOSS_MODE === 'real') return false;
  if (TOSS_MODE === 'mock') return true;
  // 모드가 명시되지 않은 경우: 시크릿 키가 없으면 실제 호출이 불가능하므로 mock,
  // 키가 있으면 Toss 테스트 위젯의 tgen_ 키만 mock 으로 취급한다.
  return !TOSS_SECRET_KEY || String(paymentKey || '').startsWith('tgen_');
}

function buildMockPayment({ paymentKey, orderId, amount, status = 'DONE' }) {
  return {
    paymentKey,
    orderId,
    totalAmount: Number(amount || 0),
    status,
    method: 'LOCAL_MOCK',
    approvedAt: new Date().toISOString(),
    isMock: true,
  };
}

// Basic Auth 헤더 생성 (시크릿 키 + ":" + Base64)
function getAuthHeader() {
  const encoded = Buffer.from(`${TOSS_SECRET_KEY}:`).toString('base64');
  return `Basic ${encoded}`;
}

// 결제 승인
async function confirmPayment({ paymentKey, orderId, amount }) {
  if (shouldUseMockPayment(paymentKey)) {
    console.log(`[TossMock] 결제 승인 mock 처리: orderId=${orderId}, amount=${amount}`);
    return {
      success: true,
      data: buildMockPayment({ paymentKey, orderId, amount }),
      mock: true,
    };
  }

  try {
    const response = await axios.post(
      `${TOSS_API_BASE}/payments/confirm`,
      { paymentKey, orderId, amount },
      {
        headers: {
          Authorization: getAuthHeader(),
          'Content-Type': 'application/json',
        },
      }
    );
    return { success: true, data: response.data };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    const code = err.response?.data?.code || 'UNKNOWN';
    return { success: false, code, message: msg };
  }
}

// 결제 취소 (환불)
async function cancelPayment({ paymentKey, cancelReason, cancelAmount }) {
  if (shouldUseMockPayment(paymentKey)) {
    console.log(`[TossMock] 결제 취소 mock 처리: paymentKey=${paymentKey}, amount=${cancelAmount ?? 'ALL'}, reason=${cancelReason}`);
    return {
      success: true,
      data: buildMockPayment({
        paymentKey,
        orderId: `mock-cancel-${Date.now()}`,
        amount: cancelAmount ?? 0,
        status: 'CANCELED',
      }),
      mock: true,
    };
  }

  try {
    const body = { cancelReason };
    // cancelAmount가 있으면 부분 취소, 없으면 전체 취소
    if (cancelAmount !== undefined && cancelAmount !== null) {
      body.cancelAmount = cancelAmount;
    }
    const response = await axios.post(
      `${TOSS_API_BASE}/payments/${paymentKey}/cancel`,
      body,
      {
        headers: {
          Authorization: getAuthHeader(),
          'Content-Type': 'application/json',
        },
      }
    );
    return { success: true, data: response.data };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    const code = err.response?.data?.code || 'UNKNOWN';
    return { success: false, code, message: msg };
  }
}

// 결제 조회
async function getPayment({ paymentKey }) {
  if (shouldUseMockPayment(paymentKey)) {
    return {
      success: true,
      data: buildMockPayment({
        paymentKey,
        orderId: `mock-query-${Date.now()}`,
        amount: 0,
      }),
      mock: true,
    };
  }

  try {
    const response = await axios.get(
      `${TOSS_API_BASE}/payments/${paymentKey}`,
      {
        headers: { Authorization: getAuthHeader() },
      }
    );
    return { success: true, data: response.data };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    return { success: false, message: msg };
  }
}

module.exports = { confirmPayment, cancelPayment, getPayment };
