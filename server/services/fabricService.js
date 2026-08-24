'use strict';
/**
 * fabricService.js  —  Phase 2: 실제 Hyperledger Fabric SDK 연동
 *
 * Phase 1 (mock):   FABRIC_MODE=mock  → fabricBridge.js가 mockFabricService 반환
 * Phase 2 (real):   FABRIC_MODE=real  → fabricBridge.js가 이 파일 반환
 */

const { Wallets, Gateway } = require('fabric-network');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const channelName   = 'channel1';
const chaincodeName = 'ticket';

const ccpPath    = process.env.FABRIC_CCP_PATH    || path.resolve(__dirname, '../../fabric/application/connection-org1.json');
const walletPath = process.env.FABRIC_WALLET_PATH || path.join(__dirname,    '../../fabric/wallet');

const DID_PEPPER = process.env.DID_PEPPER || 'ticket-blockchain-pepper';

function hashDid(walletAddress) {
  return crypto.createHash('sha256').update(DID_PEPPER + walletAddress.toLowerCase()).digest('hex');
}

let _gateway = null;

async function getGateway() {
  if (_gateway) return _gateway;
  const ccp    = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));
  const wallet = await Wallets.newFileSystemWallet(walletPath);
  const gateway = new Gateway();
  await gateway.connect(ccp, {
    wallet,
    identity:  'appUser',
    discovery: { enabled: false, asLocalhost: true },
  });
  _gateway = gateway;
  return gateway;
}

function isChaincodeBizError(e) {
  // 체인코드가 status=500으로 반환한 비즈니스 에러 → 재시도 불필요
  return e && typeof e.message === 'string' && e.message.includes('status=500');
}

async function submitTx(func, ...args) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const gateway  = await getGateway();
      const network  = await gateway.getNetwork(channelName);
      const contract = network.getContract(chaincodeName);
      const result   = await contract.submitTransaction(func, ...args.map(String));
      return result ? result.toString() : '';
    } catch (e) {
      lastErr = e;
      if (isChaincodeBizError(e)) throw e;
      _gateway = null;
      if (i < 2) await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}

async function evaluateTx(func, ...args) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const gateway  = await getGateway();
      const network  = await gateway.getNetwork(channelName);
      const contract = network.getContract(chaincodeName);
      const result   = await contract.evaluateTransaction(func, ...args.map(String));
      return result ? result.toString() : '';
    } catch (e) {
      lastErr = e;
      if (isChaincodeBizError(e)) throw e;
      _gateway = null;
      if (i < 2) await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}

// ─── 1. RegisterTicket ────────────────────────────────────
async function registerTicket({ ticketId, tokenId, gameId, seatId, walletAddress, price, purchaseType, gameDate }) {
  await submitTx(
    'RegisterTicket',
    ticketId,
    String(tokenId || '0'),
    gameId,
    seatId,
    walletAddress,
    purchaseType || 'PRIMARY',
    gameDate     || '',
    String(price),
  );
  return { success: true, txId: 'fabric-tx' };
}

// ─── 2. VerifyEntry ──────────────────────────────────────
async function verifyEntry({ ticketId, gateId }) {
  const raw = await submitTx('VerifyEntry', ticketId, gateId || 'GATE_DEFAULT');
  return JSON.parse(raw);
}

async function joinMembership({ userDidHash }) {
  const raw = await submitTx('JoinMembership', userDidHash);
  return raw ? JSON.parse(raw) : { success: true };
}

async function tierUpMembership({ userDidHash, targetGrade }) {
  const raw = await submitTx('TierUpMembership', userDidHash, targetGrade);
  return raw ? JSON.parse(raw) : { success: true };
}

// ─── 3. UsePointForTicket ────────────────────────────────
async function usePointForTicket({ userDidHash, ticketId, pointAmount }) {
  await submitTx('UsePointForTicket', userDidHash, ticketId || '', String(pointAmount));
  return { success: true };
}

// ─── 4. ExchangePointItem ────────────────────────────────
async function exchangePointItem({ userDidHash, itemType }) {
  const raw = await submitTx('ExchangePointItem', userDidHash, itemType);
  return JSON.parse(raw);
}

async function completePointCardExchange({ exchangeId, userDidHash, cardTypeId, nftId, mintTxHash }) {
  const raw = await submitTx(
    'CompletePointCardExchange',
    exchangeId,
    userDidHash,
    String(cardTypeId),
    nftId,
    mintTxHash,
  );
  return raw ? JSON.parse(raw) : { success: true, exchangeId };
}

async function getExchangeRecord({ exchangeId }) {
  const raw = await evaluateTx('GetExchangeRecord', exchangeId);
  return raw ? JSON.parse(raw) : null;
}

// ─── 7. RequestRefund ────────────────────────────────────
async function requestRefund({ ticketId, refundReason }) {
  const raw = await submitTx('RequestRefund', ticketId, refundReason || '사용자 요청');
  return JSON.parse(raw);
}

// ─── 8. CompleteRefund ───────────────────────────────────
async function completeRefund({ refundId, ticketId }) {
  await submitTx('CompleteRefund', refundId, ticketId);
  return { success: true, refundId };
}

// ─── 9. CancelGameRefundAll ──────────────────────────────
// 경기 취소 시 전체 티켓 환불: Fabric에서 범위 조회 후 루프
async function cancelGameRefundAll({ gameId }) {
  // Phase 2: 서버 측에서 DB 티켓 목록 받아 개별 RequestRefund 호출
  // raffleRoutes/settlementRoutes에서 티켓 목록을 조회해 개별 호출하는 방식으로 처리
  throw new Error('cancelGameRefundAll: 호출자에서 티켓별 requestRefund를 개별 호출하세요');
}

// ─── 10. CreateSettlement ────────────────────────────────
async function createSettlement({ gameId, totalSales, refundAmount, pointUsedAmount }) {
  const raw = await submitTx(
    'CreateSettlement',
    gameId,
    String(totalSales    || 0),
    String(refundAmount  || 0),
    String(pointUsedAmount || 0),
  );
  return JSON.parse(raw);
}

// ─── 11. EarnPointFromTrade ──────────────────────────────
async function earnPointFromTrade({ userDidHash, amount, rate }) {
  const raw = await submitTx('EarnPointFromTrade', userDidHash, String(amount), String(rate));
  return JSON.parse(raw);
}

// ─── 조회 함수 ────────────────────────────────────────────

async function getTicket({ ticketId }) {
  const raw = await evaluateTx('GetTicket', ticketId);
  return JSON.parse(raw);
}

async function getPointBalance({ userDidHash }) {
  const raw = await evaluateTx('GetPointBalance', userDidHash);
  return JSON.parse(raw);
}

async function getMembership({ userDidHash }) {
  const raw = await evaluateTx('GetMembership', userDidHash);
  return JSON.parse(raw);
}

async function getEvents() {
  return [];
}

// ─── Raffle / Draw / Reservation ─────────────────────────

async function registerRaffleNFT({ raffleNftId, userDidHash, gameId }) {
  await submitTx('RegisterRaffleNFT', raffleNftId, userDidHash, gameId || '');
  return { success: true, raffleNftId };
}

async function enterDraw({ raffleNftId, userDidHash, drawId }) {
  await submitTx('EnterDraw', raffleNftId, userDidHash, drawId);
  return { success: true };
}

async function createDraw({ drawId, gameId, winnerCount }) {
  await submitTx('CreateDraw', drawId, gameId, String(winnerCount || 10));
  return { success: true, drawId };
}

async function executeDraw({ drawId, entryIds }) {
  // Go 체인코드 ExecuteDraw(drawId, entryIdsJSON)
  const raw = await submitTx('ExecuteDraw', drawId, JSON.stringify(entryIds || []));
  return JSON.parse(raw);
}

async function useRaffleNFT({ raffleNftId, userDidHash, ticketId }) {
  await submitTx('UseRaffleNFT', raffleNftId, userDidHash, ticketId || '');
  return { success: true };
}

async function createReservation({ reservationId, userDidHash, gameId, raffleNftId, isPriority }) {
  await submitTx(
    'CreateReservation',
    reservationId,
    userDidHash,
    gameId,
    raffleNftId  || '',
    String(!!isPriority),
  );
  return { success: true, reservationId };
}

async function confirmReservation({ reservationId, ticketId }) {
  await submitTx('ConfirmReservation', reservationId, ticketId || '');
  return { success: true };
}

async function cancelReservation({ reservationId }) {
  await submitTx('CancelReservation', reservationId);
  return { success: true };
}

async function mapTicketNFT({ ticketId, tokenId }) {
  await submitTx('MapTicketNFT', ticketId, String(tokenId));
  return { success: true };
}

async function getRaffleNFT({ raffleNftId }) {
  const raw = await evaluateTx('GetRaffleNFT', raffleNftId);
  return JSON.parse(raw);
}

async function getUserRaffleNFTs({ userDidHash }) {
  const raw = await evaluateTx('GetUserRaffleNFTs', userDidHash);
  return JSON.parse(raw);
}

async function getDraw({ drawId }) {
  const raw = await evaluateTx('GetDraw', drawId);
  return JSON.parse(raw);
}

async function getAllDraws() {
  const raw = await evaluateTx('GetAllDraws');
  return JSON.parse(raw);
}

async function transferTicket({ ticketId, fromWalletAddress, toWalletAddress, transferPrice }) {
  const raw = await submitTx('TransferTicket', ticketId, fromWalletAddress, toWalletAddress, String(transferPrice));
  return raw ? JSON.parse(raw) : { success: true };
}

async function seedUser({
  walletAddress,
  pointBalance = 10000,
  totalEarned = pointBalance,
  totalUsed = 0,
  entryCount = 0,
  joined = true,
  grade = 'SILVER',
}) {
  const userDidHash = hashDid(walletAddress);
  const raw = await submitTx(
    'SeedUserForTest',
    userDidHash,
    String(pointBalance),
    String(totalEarned),
    String(totalUsed),
    String(entryCount),
    grade,
    joined ? 'true' : 'false',
  );
  return raw ? JSON.parse(raw) : { success: true, userDidHash };
}

module.exports = {
  hashDid,
  registerTicket,
  verifyEntry,
  joinMembership,
  tierUpMembership,
  usePointForTicket,
  exchangePointItem,
  completePointCardExchange,
  getExchangeRecord,
  requestRefund,
  completeRefund,
  cancelGameRefundAll,
  createSettlement,
  earnPointFromTrade,
  getTicket,
  getPointBalance,
  getMembership,
  getEvents,
  registerRaffleNFT,
  enterDraw,
  createDraw,
  executeDraw,
  useRaffleNFT,
  createReservation,
  confirmReservation,
  cancelReservation,
  mapTicketNFT,
  getRaffleNFT,
  getUserRaffleNFTs,
  getDraw,
  getAllDraws,
  transferTicket,
  seedUser,
};
