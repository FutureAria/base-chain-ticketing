/**
 * mockFabricService.js
 *
 * Phase 1: Fabric 네트워크 없이 전체 흐름 테스트용 Mock
 * Phase 2: 실제 Fabric 연동 시 fabricService.js로 교체
 *
 * 모든 함수는 실제 Fabric SDK와 동일한 인터페이스를 가짐
 */

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const DID_PEPPER = process.env.DID_PEPPER || 'ticket-blockchain-pepper';

// 인메모리 상태 저장 (서버 재시작 시 초기화)
const _store = {
  tickets:      {},   // ticketId → TicketRecord
  points:       {},   // userDidHash → PointRecord
  memberships:  {},   // userDidHash → MembershipRecord
  entries:      {},   // entryId → EntryRecord
  exchanges:    {},   // exchangeId → ExchangeRecord
  refunds:      {},   // refundId → RefundRecord
  settlements:  {},   // settlementId → SettlementRecord
  raffleNfts:   {},   // raffleNftId → RaffleNFTRecord
  draws:        {},   // drawId → DrawRecord
  reservations: {},   // reservationId → ReservationRecord
  events:       [],   // 이벤트 로그
};

function now() {
  return new Date().toISOString();
}

/**
 * 암호학적 난수를 쓰는 Fisher-Yates 셔플.
 * crypto.randomInt 는 모듈로 편향 없이 [0, max) 정수를 준다.
 */
function cryptoShuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function hashDid(walletAddress) {
  return crypto.createHash('sha256').update(DID_PEPPER + walletAddress.toLowerCase()).digest('hex');
}

// ─── 멤버십 등급 계산 ──────────────────────────────────────
function calcGrade(entryCount) {
  if (entryCount >= 10) return 'GOLD';
  if (entryCount >= 6)  return 'SILVER';
  if (entryCount >= 3)  return 'BRONZE';
  return 'BASIC';
}

// ─── 등급별 포인트 적립률 ──────────────────────────────────
function getEarnRate(grade) {
  const rates = { BASIC: 0.005, BRONZE: 0.007, SILVER: 0.010, GOLD: 0.015 };
  return rates[grade] || 0.005;
}

// ─── 월 교환 한도 ──────────────────────────────────────────
const EXCHANGE_LIMITS = {
  BASIC:  { RAFFLE_NFT: 1, CARD_NFT: 1 },
  BRONZE: { RAFFLE_NFT: 1, CARD_NFT: 1 },
  SILVER: { RAFFLE_NFT: 2, CARD_NFT: 1 },
  GOLD:   { RAFFLE_NFT: 2, CARD_NFT: 2 },
};

const EXCHANGE_COSTS = { RAFFLE_NFT: 1500, CARD_NFT: 5000 };

// ─── 1. RegisterTicket ─────────────────────────────────────
async function registerTicket({ ticketId, tokenId, gameId, seatId, walletAddress, price, purchaseType, gameDate }) {
  if (_store.tickets[ticketId]) {
    throw new Error(`TICKET_ALREADY_EXISTS: ${ticketId}`);
  }

  const userDidHash = hashDid(walletAddress);
  const record = {
    ticketId,
    tokenId:      String(tokenId),
    gameId,
    seatId,
    userDidHash,
    status:       'ACTIVE',
    purchaseType: purchaseType || 'PRIMARY',
    gameDateStr:  gameDate     || '',
    price:        Number(price),
    pointUsed:    0,
    createdAt:    now(),
    updatedAt:    now(),
  };

  _store.tickets[ticketId] = record;
  _emitEvent('TICKET_REGISTERED', { ticketId, tokenId, gameId });

  console.log(`[MockFabric] RegisterTicket: ${ticketId}`);
  return { success: true, txId: `mock-tx-${uuidv4().slice(0, 8)}`, record };
}

// ─── 2. VerifyEntry ────────────────────────────────────────
async function verifyEntry({ ticketId, tokenId, walletAddress, gateId }) {
  const ticket = _store.tickets[ticketId];

  if (!ticket) {
    return { allowed: false, reason: 'TICKET_NOT_FOUND' };
  }
  if (ticket.status === 'USED') {
    return { allowed: false, reason: 'ALREADY_USED' };
  }
  if (ticket.status === 'REFUNDED' || ticket.status === 'REFUND_PROCESSING') {
    return { allowed: false, reason: 'REFUNDED' };
  }
  if (ticket.status !== 'ACTIVE') {
    return { allowed: false, reason: 'INVALID_STATUS' };
  }

  // 상태 변경
  ticket.status    = 'USED';
  ticket.updatedAt = now();

  // EntryRecord 생성
  const entryId = uuidv4();
  _store.entries[entryId] = {
    entryId,
    ticketId,
    tokenId: String(tokenId),
    gateId:  gateId || 'GATE_DEFAULT',
    entryTime: now(),
    result: 'ALLOWED',
  };

  const membership = _getOrCreateMembership(ticket.userDidHash);
  let earnedPoint = 0;
  let grade = membership.grade;
  if (membership.joined) {
    ({ earnedPoint } = await _earnPointByEntry(ticket.userDidHash, ticket.price));
    membership.entryCount += 1;
    membership.updatedAt = now();
    _store.memberships[ticket.userDidHash] = membership;
    grade = membership.grade;
  }

  // 이벤트 발생
  _emitEvent('NFT_BURN_REQUESTED', {
    ticketId,
    tokenId: String(tokenId),
    userDidHash: ticket.userDidHash,
  });

  console.log(`[MockFabric] VerifyEntry: ${ticketId} → ALLOWED (+${earnedPoint}P, ${grade})`);
  return {
    allowed:      true,
    entryId,
    earnedPoint,
    membershipGrade: grade,
    txId: `mock-tx-${uuidv4().slice(0, 8)}`,
  };
}

async function completePointCardExchange({ exchangeId, userDidHash, cardTypeId, nftId, mintTxHash }) {
  const record = _store.exchanges[exchangeId];
  if (!record) throw new Error(`EXCHANGE_NOT_FOUND: ${exchangeId}`);
  if (record.userDidHash !== userDidHash) throw new Error('EXCHANGE_OWNER_MISMATCH');
  if (record.itemType !== 'CARD_NFT') throw new Error(`INVALID_EXCHANGE_ITEM: ${record.itemType}`);
  if (record.status !== 'MINT_REQUESTED' && record.status !== 'MINT_COMPLETED') {
    throw new Error(`INVALID_EXCHANGE_STATUS: ${record.status}`);
  }

  record.status = 'MINT_COMPLETED';
  record.cardTypeId = String(cardTypeId);
  record.nftId = nftId;
  record.mintTxHash = mintTxHash;
  record.completedAt = now();
  _store.exchanges[exchangeId] = record;

  _emitEvent('CARD_NFT_MINT_COMPLETED', {
    exchangeId,
    userDidHash,
    cardTypeId: record.cardTypeId,
    nftId,
    mintTxHash,
  });

  console.log(`[MockFabric] CompletePointCardExchange: ${exchangeId} -> ${nftId}`);
  return { ...record, txId: `mock-tx-${uuidv4().slice(0, 8)}` };
}

async function getExchangeRecord({ exchangeId }) {
  const record = _store.exchanges[exchangeId];
  if (!record) throw new Error(`EXCHANGE_NOT_FOUND: ${exchangeId}`);
  return record;
}

// ─── 3. EarnPointByEntry (내부 호출용) ────────────────────
async function _earnPointByEntry(userDidHash, price) {
  const membership = _getOrCreateMembership(userDidHash);
  if (!membership.joined) return { earnedPoint: 0, balance: _getOrCreatePoint(userDidHash).balance };
  const rate       = getEarnRate(membership.grade);
  const earnedPoint = Math.floor(price * rate);

  const point = _getOrCreatePoint(userDidHash);
  point.balance      += earnedPoint;
  point.totalEarned  += earnedPoint;
  point.lastUpdatedAt = now();

  _store.points[userDidHash] = point;
  console.log(`[MockFabric] EarnPoint: ${userDidHash.slice(0, 8)}... +${earnedPoint}P (잔액: ${point.balance}P)`);
  return { earnedPoint, balance: point.balance };
}

// 외부에서도 호출 가능
async function earnPointByEntry({ userDidHash, price }) {
  return _earnPointByEntry(userDidHash, price);
}

// ─── 4. UpdateMembershipGrade (내부 호출용) ───────────────
async function _updateMembershipGrade(userDidHash) {
  const membership = _getOrCreateMembership(userDidHash);
  membership.entryCount   += 1;
  membership.grade         = calcGrade(membership.entryCount);
  membership.updatedAt     = now();

  _store.memberships[userDidHash] = membership;
  console.log(`[MockFabric] Membership: ${userDidHash.slice(0, 8)}... 입장${membership.entryCount}회 → ${membership.grade}`);
  return { grade: membership.grade, entryCount: membership.entryCount };
}

async function updateMembershipGrade({ userDidHash }) {
  return _updateMembershipGrade(userDidHash);
}

// ─── 5. UsePointForTicket ──────────────────────────────────
async function usePointForTicket({ userDidHash, ticketId, pointAmount }) {
  const membership = _getOrCreateMembership(userDidHash);
  if (!membership.joined) throw new Error('MEMBERSHIP_REQUIRED');
  const point = _getOrCreatePoint(userDidHash);

  // 숫자가 아닌 값이 들어오면 비교가 전부 false 가 되어 검사를 그냥 통과한다.
  // (NaN < 1000 도 false, balance < NaN 도 false → balance -= NaN 으로 잔액이 NaN 이 된다)
  // 그래서 크기 비교보다 "정수인가"를 먼저 확인한다.
  if (!Number.isInteger(pointAmount) || pointAmount <= 0) {
    throw new Error('INVALID_POINT_AMOUNT: 사용 포인트는 양의 정수여야 합니다');
  }
  if (pointAmount < 1000) {
    throw new Error('MIN_POINT_1000: 최소 1,000P 이상 사용 가능');
  }
  if (point.balance < pointAmount) {
    throw new Error(`INSUFFICIENT_POINT: 잔액 ${point.balance}P, 요청 ${pointAmount}P`);
  }

  point.balance    -= pointAmount;
  point.totalUsed  += pointAmount;
  point.lastUpdatedAt = now();

  if (ticketId && _store.tickets[ticketId]) {
    _store.tickets[ticketId].pointUsed = pointAmount;
  }

  _store.points[userDidHash] = point;
  console.log(`[MockFabric] UsePoint: ${userDidHash.slice(0, 8)}... -${pointAmount}P (잔액: ${point.balance}P)`);
  return { success: true, remainingBalance: point.balance };
}

// ─── 5-b. RestorePointForRefund ────────────────────────────
async function restorePointForRefund({ userDidHash, ticketId, pointAmount }) {
  if (!pointAmount || pointAmount <= 0) return { success: true, remainingBalance: 0 };
  const point = _getOrCreatePoint(userDidHash);
  point.balance    += pointAmount;
  point.totalUsed  -= pointAmount;
  point.lastUpdatedAt = now();
  if (ticketId && _store.tickets[ticketId]) {
    _store.tickets[ticketId].pointUsed = 0;
  }
  _store.points[userDidHash] = point;
  console.log(`[MockFabric] RestorePoint: ${userDidHash.slice(0, 8)}... +${pointAmount}P (잔액: ${point.balance}P)`);
  return { success: true, remainingBalance: point.balance };
}

// ─── 6. ExchangePointItem ──────────────────────────────────
async function exchangePointItem({ userDidHash, itemType }) {
  const cost = EXCHANGE_COSTS[itemType];
  if (!cost) throw new Error(`INVALID_ITEM_TYPE: ${itemType}`);

  const point      = _getOrCreatePoint(userDidHash);
  const membership = _getOrCreateMembership(userDidHash);
  if (!membership.joined) throw new Error('MEMBERSHIP_REQUIRED');
  const currentMonth = new Date().toISOString().slice(0, 7);

  // 월 초기화
  if (membership.lastResetMonth !== currentMonth) {
    membership.monthlyRaffleExchangeCount = 0;
    membership.monthlyCardExchangeCount   = 0;
    membership.lastResetMonth = currentMonth;
  }

  // 잔액 확인
  if (point.balance < cost) {
    throw new Error(`INSUFFICIENT_POINT: 잔액 ${point.balance}P, 필요 ${cost}P`);
  }

  // 월 교환 횟수 확인
  const limit = EXCHANGE_LIMITS[membership.grade];
  if (itemType === 'RAFFLE_NFT' && membership.monthlyRaffleExchangeCount >= limit.RAFFLE_NFT) {
    throw new Error(`EXCHANGE_LIMIT_EXCEEDED: 이번 달 응모권 NFT 교환 횟수 초과`);
  }
  if (itemType === 'CARD_NFT' && membership.monthlyCardExchangeCount >= limit.CARD_NFT) {
    throw new Error(`EXCHANGE_LIMIT_EXCEEDED: 이번 달 실물 NFT 카드 교환 횟수 초과`);
  }

  // 포인트 차감
  point.balance   -= cost;
  point.totalUsed += cost;
  point.lastUpdatedAt = now();

  // 교환 횟수 증가
  if (itemType === 'RAFFLE_NFT') membership.monthlyRaffleExchangeCount += 1;
  if (itemType === 'CARD_NFT')   membership.monthlyCardExchangeCount   += 1;

  _store.points[userDidHash]      = point;
  _store.memberships[userDidHash] = membership;

  // ExchangeRecord 저장
  const exchangeId = uuidv4();
  const record = {
    exchangeId,
    userDidHash,
    itemType,
    pointUsed:   cost,
    status:      'MINT_REQUESTED',
    requestedAt: now(),
  };
  _store.exchanges[exchangeId] = record;

  // 이벤트 발생
  const eventName = itemType === 'RAFFLE_NFT'
    ? 'RAFFLE_NFT_MINT_REQUESTED'
    : 'CARD_NFT_MINT_REQUESTED';

  _emitEvent(eventName, {
    exchangeId,
    userDidHash,
    itemType,
    requestedAt: record.requestedAt,
  });

  console.log(`[MockFabric] Exchange: ${itemType} -${cost}P → MINT_REQUESTED`);
  return {
    success:    true,
    exchangeId,
    status:     'MINT_REQUESTED',
    itemType,
    pointUsed:  cost,
    remainingBalance: point.balance,
    txId: `mock-tx-${uuidv4().slice(0, 8)}`,
  };
}

// ─── 환불율 계산 (날짜 기준) ───────────────────────────────
// TRANSFERRED: 항상 0%
// PRIMARY: 7일 이상=100%, 3일 이상=90%, 1일 이상=80%, 당일/이후=0%
function calcRefundRate(gameDateStr, purchaseType) {
  if (purchaseType === 'TRANSFERRED') return 0;
  if (!gameDateStr) return 100;
  const today    = new Date();
  today.setHours(0, 0, 0, 0);
  const gameDate = new Date(gameDateStr);
  if (isNaN(gameDate.getTime())) return 100;
  gameDate.setHours(0, 0, 0, 0);
  const daysUntil = Math.floor((gameDate - today) / (1000 * 60 * 60 * 24));

  if (daysUntil >= 7) return 100;
  if (daysUntil >= 3) return 90;
  if (daysUntil >= 1) return 80;
  return 0;
}

// ─── 7. RequestRefund ──────────────────────────────────────
async function requestRefund({ ticketId, walletAddress, refundReason, gameDateStr, purchaseType }) {
  const ticket = _store.tickets[ticketId];

  if (!ticket) throw new Error('TICKET_NOT_FOUND');
  if (ticket.status === 'USED')     throw new Error('REFUND_DENIED: 입장 완료된 티켓은 환불 불가');
  if (ticket.status === 'REFUNDED') throw new Error('ALREADY_REFUNDED');
  if (ticket.status === 'REFUND_PROCESSING') throw new Error('REFUND_ALREADY_PROCESSING');

  const pType    = purchaseType || ticket.purchaseType || 'PRIMARY';
  const gameDate = gameDateStr  || ticket.gameDateStr  || '';
  const rate     = calcRefundRate(gameDate, pType);

  if (rate === 0) {
    throw new Error('REFUND_DENIED: 환불 불가 기간입니다');
  }

  const baseAmount   = ticket.price - (ticket.pointUsed || 0);
  const refundAmount = Math.floor(baseAmount * rate / 100);

  // 포인트 복구 (실제 체인코드 RequestRefund와 동일한 동작)
  const pointRestored = ticket.pointUsed || 0;
  if (pointRestored > 0) {
    const point = _getOrCreatePoint(ticket.userDidHash);
    point.balance    += pointRestored;
    point.totalUsed  -= pointRestored;
    if (point.totalUsed < 0) point.totalUsed = 0;
    point.lastUpdatedAt = now();
    _store.points[ticket.userDidHash] = point;
  }

  ticket.status       = 'REFUND_PROCESSING';
  ticket.updatedAt    = now();
  ticket.purchaseType = pType;

  const refundId = uuidv4();
  const record = {
    refundId,
    ticketId,
    purchaseType:  pType,
    refundRate:    rate,
    refundReason:  refundReason || '사용자 요청',
    originalPrice: ticket.price,
    refundAmount,
    refundStatus:  'PROCESSING',
    requestedAt:   now(),
    completedAt:   null,
  };
  _store.refunds[refundId] = record;

  // 자동 완료 처리
  ticket.status    = 'REFUNDED';
  ticket.updatedAt = now();
  record.refundStatus = 'COMPLETED';
  record.completedAt  = now();

  _emitEvent('PAYMENT_REFUND_REQUESTED', { refundId, ticketId, refundAmount, refundRate: rate });
  _emitEvent('NFT_INVALIDATE_REQUESTED', { ticketId, tokenId: ticket.tokenId, userDidHash: ticket.userDidHash });
  _emitEvent('REFUND_COMPLETED',         { refundId, ticketId, refundAmount });

  console.log(`[MockFabric] RequestRefund: ${ticketId} → REFUNDED (${rate}%, ${refundAmount}원)`);
  return { success: true, refundId, status: 'COMPLETED', refundRate: rate, refundAmount };
}

// ─── 8. CompleteRefund ─────────────────────────────────────
async function completeRefund({ refundId, ticketId }) {
  const refund = _store.refunds[refundId];
  if (!refund) throw new Error('REFUND_NOT_FOUND');

  refund.refundStatus = 'COMPLETED';
  refund.completedAt  = now();

  if (_store.tickets[ticketId]) {
    _store.tickets[ticketId].status    = 'REFUNDED';
    _store.tickets[ticketId].updatedAt = now();
  }

  console.log(`[MockFabric] CompleteRefund: ${refundId} → COMPLETED`);
  return { success: true, refundId, status: 'COMPLETED' };
}

// ─── 9. CancelGameRefundAll ────────────────────────────────
async function cancelGameRefundAll({ gameId }) {
  const targets = Object.values(_store.tickets).filter(
    t => t.gameId === gameId && (t.status === 'ACTIVE')
  );

  // 경기 취소는 구매 유형·날짜 무관 100% 환불을 보장하기 위해 미래 날짜 전달
  const futureDateStr = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const refundIds = [];
  for (const ticket of targets) {
    try {
      const result = await requestRefund({
        ticketId:     ticket.ticketId,
        refundReason: '경기 취소',
        gameDateStr:   futureDateStr,
        purchaseType:  ticket.purchaseType || 'PRIMARY',
      });
      refundIds.push(result.refundId);
    } catch (e) {
      console.error(`[MockFabric] CancelGame skip ${ticket.ticketId}:`, e.message);
    }
  }

  console.log(`[MockFabric] CancelGameRefundAll: gameId=${gameId}, ${targets.length}개 환불 처리`);
  return { success: true, gameId, refundCount: targets.length, refundIds };
}

// ─── 10. CreateSettlement ──────────────────────────────────
async function createSettlement({ gameId, pool }) {
  const tickets = Object.values(_store.tickets).filter(t => t.gameId === gameId);

  const totalSales      = tickets.filter(t => t.status !== 'REFUNDED').reduce((s, t) => s + t.price, 0);
  const refundAmount    = tickets.filter(t => t.status === 'REFUNDED').reduce((s, t) => s + t.price, 0);
  const pointUsedAmount = tickets.reduce((s, t) => s + (t.pointUsed || 0), 0);
  const platformFee     = Math.floor(totalSales * 0.03);
  const clubRevenue     = totalSales - refundAmount - pointUsedAmount - platformFee;

  const settlementId = uuidv4();
  const record = {
    settlementId,
    gameId,
    totalSales,
    resaleSales:      0,
    refundAmount,
    pointUsedAmount,
    platformFee,
    clubRevenue,
    settlementStatus: 'DRAFT',
    createdAt:        now(),
  };
  _store.settlements[settlementId] = record;

  console.log(`[MockFabric] CreateSettlement: gameId=${gameId}, 구단수익=${clubRevenue}원`);
  return { success: true, settlementId, ...record };
}

// ─── 11. TransferTicket (2차 거래 소유권 이전) ────────────────
async function transferTicket({ ticketId, fromWalletAddress, toWalletAddress, transferPrice }) {
  const ticket = _store.tickets[ticketId];
  if (!ticket) throw new Error('TICKET_NOT_FOUND');

  if (ticket.userDidHash !== hashDid(fromWalletAddress)) {
    throw new Error('NOT_OWNER');
  }

  ticket.purchaseType = 'TRANSFERRED';
  ticket.userDidHash  = hashDid(toWalletAddress);
  ticket.updatedAt    = now();

  // 판매자 포인트는 일일 적립 한도 적용을 위해 백엔드 라우터에서 EarnPointFromTrade로 처리한다.
  const fromDidHash = hashDid(fromWalletAddress);
  const earnedPoint = 0;

  _emitEvent('TICKET_TRANSFERRED', { ticketId, fromWalletAddress, toWalletAddress, transferPrice, earnedPoint });
  console.log(`[MockFabric] TransferTicket: ${ticketId} ${fromWalletAddress.slice(0, 8)} → ${toWalletAddress.slice(0, 8)}`);
  return {
    success: true,
    txId: `mock-tx-${uuidv4().slice(0, 8)}`,
    ticketId,
    fromDidHash: hashDid(fromWalletAddress),
    toDidHash: hashDid(toWalletAddress),
    transferPrice,
    sellerEarnedPoint: earnedPoint,
    status: 'TRANSFERRED',
  };
}

// ─── EarnPointFromTrade (양도/장터 거래 포인트) ────────────────
async function earnPointFromTrade({ userDidHash, amount, rate }) {
  const membership = _getOrCreateMembership(userDidHash);
  if (!membership.joined) return { earnedPoint: 0, balance: _getOrCreatePoint(userDidHash).balance };
  const earnedPoint = Math.floor(amount * rate);
  if (earnedPoint <= 0) return { earnedPoint: 0, balance: _getOrCreatePoint(userDidHash).balance };

  const point = _getOrCreatePoint(userDidHash);
  point.balance     += earnedPoint;
  point.totalEarned += earnedPoint;
  point.lastUpdatedAt = now();
  _store.points[userDidHash] = point;

  console.log(`[MockFabric] TradePoint: ${userDidHash.slice(0, 8)}... +${earnedPoint}P (잔액: ${point.balance}P)`);
  return { earnedPoint, balance: point.balance };
}

// ─── 응모권 NFT / 추첨 / 예약 함수들 ─────────────────────

// 13. RegisterRaffleNFT
async function registerRaffleNFT({ raffleNftId, userDidHash, gameId }) {
  if (_store.raffleNfts[raffleNftId]) {
    throw new Error(`RAFFLE_NFT_ALREADY_EXISTS: ${raffleNftId}`);
  }
  const record = {
    raffleNftId,
    userDidHash,
    gameId:    gameId || '',
    status:    'ISSUED',
    drawId:    '',
    issuedAt:  now(),
    updatedAt: now(),
  };
  _store.raffleNfts[raffleNftId] = record;
  _emitEvent('RAFFLE_NFT_REGISTERED', { raffleNftId, userDidHash });
  console.log(`[MockFabric] RegisterRaffleNFT: ${raffleNftId}`);
  return { success: true, raffleNftId, txId: `mock-tx-${uuidv4().slice(0, 8)}` };
}

// 14. EnterDraw
async function enterDraw({ raffleNftId, userDidHash, drawId }) {
  const raffle = _store.raffleNfts[raffleNftId];
  if (!raffle)                         throw new Error('RAFFLE_NFT_NOT_FOUND');
  if (raffle.userDidHash !== userDidHash) throw new Error('NOT_OWNER');
  if (raffle.status !== 'ISSUED')      throw new Error(`RAFFLE_NFT_ALREADY_USED: ${raffle.status}`);

  raffle.status    = 'ENTERED';
  raffle.drawId    = drawId;
  raffle.updatedAt = now();

  const draw = _store.draws[drawId];
  if (draw) { draw.totalEntries = (draw.totalEntries || 0) + 1; }

  _emitEvent('RAFFLE_NFT_ENTERED', { raffleNftId, drawId });
  console.log(`[MockFabric] EnterDraw: ${raffleNftId} → drawId=${drawId}`);
  return { success: true, txId: `mock-tx-${uuidv4().slice(0, 8)}` };
}

// 15. CreateDraw
async function createDraw({ drawId, gameId, winnerCount }) {
  if (_store.draws[drawId]) throw new Error(`DRAW_ALREADY_EXISTS: ${drawId}`);
  const record = {
    drawId,
    gameId,
    status:       'PENDING',
    winnerCount:  winnerCount || 10,
    totalEntries: 0,
    executedAt:   null,
    createdAt:    now(),
  };
  _store.draws[drawId] = record;
  console.log(`[MockFabric] CreateDraw: ${drawId} for game ${gameId}`);
  return { success: true, drawId };
}

// 16. ExecuteDraw
async function executeDraw({ drawId }) {
  const draw = _store.draws[drawId];
  if (!draw)                      throw new Error('DRAW_NOT_FOUND');
  if (draw.status === 'COMPLETED') throw new Error('DRAW_ALREADY_COMPLETED');

  // 응모된 raffleNfts 수집
  const entries = Object.values(_store.raffleNfts).filter(
    r => r.drawId === drawId && r.status === 'ENTERED'
  );

  const winnerCount = Math.min(draw.winnerCount, entries.length);
  // 추첨은 우선 예매권을 나눠주는 절차라 공정성이 결과의 신뢰를 좌우한다.
  // 이전 구현인 sort(() => Math.random() - 0.5) 는 두 가지 문제가 있었다.
  //   1) 비교 함수가 일관되지 않아 각 자리가 균등하게 섞이지 않는다(편향된 셔플).
  //   2) Math.random 은 예측 가능한 의사난수라 결과를 추측할 여지가 있다.
  // 그래서 암호학적 난수를 쓰는 Fisher-Yates 로 교체했다.
  const shuffled = cryptoShuffle(entries);
  const winners  = shuffled.slice(0, winnerCount).map(r => r.raffleNftId);

  for (const entry of entries) {
    const isWinner = winners.includes(entry.raffleNftId);
    entry.status    = isWinner ? 'WINNER' : 'LOST';
    entry.updatedAt = now();
  }

  draw.status     = 'COMPLETED';
  draw.executedAt = now();

  _emitEvent('DRAW_EXECUTED', { drawId, winnerCount, totalEntries: entries.length });
  console.log(`[MockFabric] ExecuteDraw: ${drawId} → ${winnerCount}명 당첨`);
  return { success: true, drawId, winners, totalEntries: entries.length };
}

// 17. UseRaffleNFT
async function useRaffleNFT({ raffleNftId, userDidHash, ticketId }) {
  const raffle = _store.raffleNfts[raffleNftId];
  if (!raffle)                            throw new Error('RAFFLE_NFT_NOT_FOUND');
  if (raffle.userDidHash !== userDidHash)  throw new Error('NOT_OWNER');
  if (raffle.status !== 'WINNER')          throw new Error(`NOT_WINNER: ${raffle.status}`);

  raffle.status    = 'USED';
  raffle.updatedAt = now();

  _emitEvent('RAFFLE_NFT_USED', { raffleNftId, ticketId });
  console.log(`[MockFabric] UseRaffleNFT: ${raffleNftId} → ticketId=${ticketId}`);
  return { success: true, txId: `mock-tx-${uuidv4().slice(0, 8)}` };
}

// 18. CreateReservation
async function createReservation({ reservationId, userDidHash, gameId, raffleNftId, isPriority }) {
  const record = {
    reservationId,
    userDidHash,
    gameId,
    raffleNftId: raffleNftId || '',
    isPriority:  !!isPriority,
    ticketId:    '',
    status:      'PENDING',
    createdAt:   now(),
    updatedAt:   now(),
  };
  _store.reservations[reservationId] = record;
  _emitEvent('RESERVATION_CREATED', { reservationId, gameId, isPriority });
  console.log(`[MockFabric] CreateReservation: ${reservationId} (priority=${isPriority})`);
  return { success: true, reservationId, txId: `mock-tx-${uuidv4().slice(0, 8)}` };
}

// 19. ConfirmReservation
async function confirmReservation({ reservationId, ticketId }) {
  const res = _store.reservations[reservationId];
  if (!res) throw new Error('RESERVATION_NOT_FOUND');
  res.ticketId   = ticketId;
  res.status     = 'CONFIRMED';
  res.updatedAt  = now();
  console.log(`[MockFabric] ConfirmReservation: ${reservationId} → ticket=${ticketId}`);
  return { success: true, txId: `mock-tx-${uuidv4().slice(0, 8)}` };
}

// 20. CancelReservation
async function cancelReservation({ reservationId }) {
  const res = _store.reservations[reservationId];
  if (!res) throw new Error('RESERVATION_NOT_FOUND');
  res.status    = 'CANCELLED';
  res.updatedAt = now();
  console.log(`[MockFabric] CancelReservation: ${reservationId}`);
  return { success: true };
}

// 21. MapTicketNFT
async function mapTicketNFT({ ticketId, tokenId }) {
  const ticket = _store.tickets[ticketId];
  if (!ticket) throw new Error('TICKET_NOT_FOUND');
  ticket.tokenId   = String(tokenId);
  ticket.updatedAt = now();
  console.log(`[MockFabric] MapTicketNFT: ${ticketId} → tokenId=${tokenId}`);
  return { success: true, txId: `mock-tx-${uuidv4().slice(0, 8)}` };
}

// 22. GetRaffleNFT
async function getRaffleNFT({ raffleNftId }) {
  const r = _store.raffleNfts[raffleNftId];
  if (!r) throw new Error('RAFFLE_NFT_NOT_FOUND');
  return r;
}

// 23. GetUserRaffleNFTs
async function getUserRaffleNFTs({ userDidHash }) {
  return Object.values(_store.raffleNfts).filter(r => r.userDidHash === userDidHash);
}

// 24. GetDraw
async function getDraw({ drawId }) {
  const d = _store.draws[drawId];
  if (!d) throw new Error('DRAW_NOT_FOUND');
  return d;
}

// 25. GetAllDraws
async function getAllDraws() {
  return Object.values(_store.draws);
}

// ─── 12. 조회 함수들 ───────────────────────────────────────
async function getTicket({ ticketId }) {
  const ticket = _store.tickets[ticketId];
  if (!ticket) throw new Error('TICKET_NOT_FOUND');
  return ticket;
}

async function getPointBalance({ userDidHash }) {
  return _getOrCreatePoint(userDidHash);
}

async function getMembership({ userDidHash }) {
  return _getOrCreateMembership(userDidHash);
}

async function getEvents() {
  return _store.events;
}

// ─── 내부 헬퍼 ─────────────────────────────────────────────
function _getOrCreatePoint(userDidHash) {
  if (!_store.points[userDidHash]) {
    _store.points[userDidHash] = {
      userDidHash,
      balance:       0,
      totalEarned:   0,
      totalUsed:     0,
      lastUpdatedAt: now(),
    };
  }
  return _store.points[userDidHash];
}

function _getOrCreateMembership(userDidHash) {
  if (!_store.memberships[userDidHash]) {
    _store.memberships[userDidHash] = {
      userDidHash,
      grade:                        'BASIC',
      joined:                       false,
      entryCount:                   0,
      monthlyRaffleExchangeCount:   0,
      monthlyCardExchangeCount:     0,
      lastResetMonth:               new Date().toISOString().slice(0, 7),
      updatedAt:                    now(),
    };
  }
  return _store.memberships[userDidHash];
}

function _emitEvent(name, payload) {
  _store.events.push({ name, payload, timestamp: now() });
  console.log(`[MockFabric] Event: ${name}`, JSON.stringify(payload));
}

// ─── 서버 시작 시 테스트 계정 포인트/멤버십 사전 세팅 ────────
function seedUser({ walletAddress, pointBalance, totalEarned, totalUsed, entryCount, joined = false, grade }) {
  const userDidHash = hashDid(walletAddress);

  _store.points[userDidHash] = {
    userDidHash,
    balance:       pointBalance,
    totalEarned:   totalEarned,
    totalUsed:     totalUsed,
    lastUpdatedAt: now(),
  };

  _store.memberships[userDidHash] = {
    userDidHash,
    grade:                        grade || calcGrade(entryCount),
      joined,
    entryCount,
    monthlyRaffleExchangeCount:   0,
    monthlyCardExchangeCount:     0,
    lastResetMonth:               new Date().toISOString().slice(0, 7),
    updatedAt:                    now(),
  };

  console.log(`[MockFabric] SeedUser: ${walletAddress.slice(0, 10)}... ${pointBalance}P ${calcGrade(entryCount)}`);
}

async function joinMembership({ userDidHash }) {
  const membership = _getOrCreateMembership(userDidHash);
  membership.joined = true;
  membership.grade = membership.grade || 'BASIC';
  membership.updatedAt = now();
  _store.memberships[userDidHash] = membership;
  return { success: true, grade: membership.grade };
}

async function tierUpMembership({ userDidHash, targetGrade }) {
  const membership = _getOrCreateMembership(userDidHash);
  if (!membership.joined) throw new Error('MEMBERSHIP_REQUIRED');
  membership.grade = targetGrade;
  membership.updatedAt = now();
  _store.memberships[userDidHash] = membership;
  return { success: true, grade: targetGrade };
}

module.exports = {
  registerTicket,
  verifyEntry,
  joinMembership,
  tierUpMembership,
  transferTicket,
  earnPointFromTrade,
  usePointForTicket,
  exchangePointItem,
  completePointCardExchange,
  getExchangeRecord,
  requestRefund,
  completeRefund,
  cancelGameRefundAll,
  createSettlement,
  getTicket,
  getPointBalance,
  getMembership,
  getEvents,
  hashDid,
  // Raffle / Draw / Reservation
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
  seedUser,
};
