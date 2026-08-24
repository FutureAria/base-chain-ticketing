'use strict';
/**
 * 온체인 네이티브 코인 결제 검증.
 *
 * 조각 마켓의 /api/market/buy 는 "구매자가 판매자 지갑으로 직접 코인을 보냈다"는 전제로
 * 동작하는데, 예전에는 클라이언트가 보낸 txHash 를 그대로 믿고 조각을 넘겨줬다.
 * 즉 아무 문자열이나 보내면 결제 없이 물건을 가져갈 수 있었다.
 *
 * 여기서는 실제 체인에서 트랜잭션을 조회해
 *   (1) 성공한 트랜잭션인지
 *   (2) 수신자가 판매자 지갑인지
 *   (3) 보낸 금액이 요구 금액 이상인지
 *   (4) 충분히 확정됐는지
 * 를 확인한다. 확인할 수 없으면 통과시키지 않고 거부한다(fail-closed).
 */

const { ethers } = require('ethers');

// services/nftService.js 가 쓰는 것과 같은 기본 네트워크(Hoodi 테스트넷)를 쓴다.
// 두 파일이 서로 다른 체인을 보면 결제는 A 체인에서 확인하고 민팅은 B 체인에서 하게 된다.
const DEFAULT_RPC_URL = 'https://ethereum-hoodi-rpc.publicnode.com';
const RPC_URL = process.env.MARKET_RPC_URL || process.env.RPC_URL || DEFAULT_RPC_URL;
const MIN_CONFIRMATIONS = Number(process.env.MARKET_MIN_CONFIRMATIONS ?? 1);

let _provider = null;

function isVerificationAvailable() {
  return Boolean(RPC_URL);
}

function getProvider() {
  if (!RPC_URL) return null;
  if (!_provider) _provider = new ethers.JsonRpcProvider(RPC_URL);
  return _provider;
}

class PaymentVerificationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'PaymentVerificationError';
    this.statusCode = statusCode;
  }
}

/** 트랜잭션 해시 형식 검사 — 0x + 64자리 16진수. */
function isValidTxHash(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * 조회해 온 트랜잭션이 요구 조건을 만족하는지 판단한다.
 * 네트워크 접근과 분리해 둔 순수 함수라 테스트로 고정할 수 있다.
 *
 * @param {{to: string|null, value: bigint|string}} tx
 * @param {{status: number, confirmations: number}} receipt
 * @param {{expectedTo: string, expectedWei: string|bigint}} expected
 */
function checkPaymentMatches(tx, receipt, expected) {
  if (!tx) {
    throw new PaymentVerificationError('체인에서 해당 트랜잭션을 찾을 수 없습니다.');
  }
  if (!receipt) {
    throw new PaymentVerificationError('아직 처리되지 않은 트랜잭션입니다. 잠시 후 다시 시도해주세요.');
  }
  if (Number(receipt.status) !== 1) {
    throw new PaymentVerificationError('실패한 트랜잭션입니다.');
  }
  if (Number(receipt.confirmations) < MIN_CONFIRMATIONS) {
    throw new PaymentVerificationError('아직 확정되지 않은 트랜잭션입니다. 잠시 후 다시 시도해주세요.');
  }

  const actualTo = String(tx.to || '').toLowerCase();
  const wantedTo = String(expected.expectedTo || '').toLowerCase();
  if (!wantedTo || actualTo !== wantedTo) {
    throw new PaymentVerificationError('판매자 지갑으로 보낸 결제가 아닙니다.');
  }

  const actualValue = BigInt(tx.value ?? 0);
  const wantedValue = BigInt(expected.expectedWei ?? 0);
  if (wantedValue <= 0n) {
    throw new PaymentVerificationError('결제 요구 금액을 계산할 수 없습니다.');
  }
  if (actualValue < wantedValue) {
    throw new PaymentVerificationError('결제 금액이 매물 가격보다 적습니다.');
  }

  return true;
}

/**
 * 실제 체인을 조회해 결제를 검증한다.
 * RPC 가 설정돼 있지 않으면 "검증 성공"으로 넘기지 않고 거부한다.
 */
async function verifyNativePayment({ txHash, expectedTo, expectedWei }) {
  if (!isValidTxHash(txHash)) {
    throw new PaymentVerificationError('올바른 트랜잭션 해시가 아닙니다.');
  }
  if (!isVerificationAvailable()) {
    throw new PaymentVerificationError(
      '온체인 결제 확인을 사용할 수 없습니다. 관리자에게 문의해주세요.',
      503,
    );
  }

  const provider = getProvider();
  let tx;
  let receipt;
  try {
    [tx, receipt] = await Promise.all([
      provider.getTransaction(txHash),
      provider.getTransactionReceipt(txHash),
    ]);
  } catch (err) {
    throw new PaymentVerificationError(`결제 확인 중 오류가 발생했습니다: ${err.message}`, 502);
  }

  const confirmations = receipt ? await receipt.confirmations().catch(() => 0) : 0;
  return checkPaymentMatches(
    tx,
    receipt ? { status: receipt.status, confirmations } : null,
    { expectedTo, expectedWei },
  );
}

module.exports = {
  PaymentVerificationError,
  isValidTxHash,
  isVerificationAvailable,
  checkPaymentMatches,
  verifyNativePayment,
  MIN_CONFIRMATIONS,
};
