/**
 * 멤버십·포인트 서비스.
 *
 * 티어는 **입장 실적(시즌 관람 횟수)** 으로 결정된다. 결제 금액이 아니다 —
 * 돈을 많이 쓴 사람이 아니라 실제로 경기장에 온 사람에게 혜택을 주려는 의도다.
 *
 * 포인트 잔액은 컬럼으로 저장하지 않고 `point_events` 에서 매번 재계산한다.
 * 잔액 컬럼과 이벤트 로그가 어긋나면 어느 쪽이 맞는지 판단할 근거가 없기 때문이다.
 * mock Fabric 이 재시작으로 날아가도 포인트·티어가 복구되는 것은 이 설계의 부산물이다.
 *
 * @see docs/ARCHITECTURE.md 신뢰의 경계
 */
'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const notificationService = require('./notificationService');

/** 티어 순서(낮은 것부터). 승급 판정과 다음 티어 계산의 기준이다. */
const TIER_ORDER = ['베이직', '브론즈', '실버', '골드'];
/** 티어별 필요 입장 횟수. 결제액이 아니라 **실제 입장 실적**이 기준이다. */
const TIER_REQUIREMENTS = { 베이직: 0, 브론즈: 3, 실버: 6, 골드: 10 };
/** 티어별 포인트 적립률. 골드 1.5% ~ 베이직 0.5%. */
const TIER_EARN_RATES = { 베이직: 0.005, 브론즈: 0.007, 실버: 0.01, 골드: 0.015 };
/** 티어별 월 응모권 지급 수. 실버 이상만 받는다. */
const TIER_MONTHLY_RAFFLES = { 베이직: 0, 브론즈: 0, 실버: 1, 골드: 2 };
/** 티어 승급 시 1회 지급하는 보상(카드·응모권). */
const TIER_REWARDS = {
  베이직: { cards: 0, raffles: 0 },
  브론즈: { cards: 1, raffles: 0 },
  실버: { cards: 2, raffles: 1 },
  골드: { cards: 3, raffles: 2 },
};

/** 한글 티어명 ↔ Fabric 체인코드가 쓰는 영문 등급명 매핑. */
const FABRIC_TIER = {
  베이직: 'BASIC',
  브론즈: 'BRONZE',
  실버: 'SILVER',
  골드: 'GOLD',
};

/**
 * 알 수 없는 티어 값을 안전한 기본값으로 정규화한다.
 * @param {string} tier 원본 티어명
 * @returns {string} TIER_ORDER 안의 값, 모르면 '베이직'
 */
function normalizeTier(tier) {
  const value = String(tier || '').toUpperCase();
  if (tier === '일반' || value === 'BASIC') return '베이직';
  if (tier === '브론즈' || value === 'BRONZE') return '브론즈';
  if (tier === '실버' || value === 'SILVER') return '실버';
  if (tier === '골드' || value === 'GOLD') return '골드';
  return null;
}

/**
 * 한글 티어명을 체인코드용 영문 등급으로 바꾼다.
 * @param {string} tier 한글 티어명
 * @returns {string} BASIC·BRONZE·SILVER·GOLD
 */
function toFabricTier(tier) {
  return FABRIC_TIER[normalizeTier(tier) || '베이직'];
}

/**
 * 체인코드 영문 등급을 한글 티어명으로 되돌린다.
 * @param {string} grade 영문 등급
 * @returns {string} 한글 티어명
 */
function fromFabricTier(grade) {
  return normalizeTier(grade);
}

/**
 * 월별 한도 관리에 쓰는 `YYYY-MM` 문자열을 만든다.
 * @param {Date} [date] 기준 시각
 * @returns {string} 예: '2026-08'
 */
function formatMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * 날짜에 일수를 더한다.
 * @param {Date} date 기준 날짜
 * @param {number} days 더할 일수
 * @returns {Date} 새 Date
 */
function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * 다음 달 말일을 구한다. 월 지급 응모권의 만료 기준이다.
 * @param {Date} [date] 기준 시각
 * @returns {Date} 다음 달 마지막 날
 */
function nextMonthEnd(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 2, 0, 23, 59, 59, 999);
}

/**
 * 사용자의 티어와 가입 시각을 읽는다.
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} userId
 * @returns {Promise<object|null>} 멤버십 행, 없으면 null
 */
async function getUserMembership(pool, userId) {
  const [[row]] = await pool.query(
    `SELECT membership_tier, membership_joined_at
       FROM users
      WHERE user_id = ?`,
    [userId],
  );
  const joined = Boolean(row?.membership_joined_at);
  return {
    joined,
    tier: joined ? (normalizeTier(row.membership_tier) || '베이직') : null,
    joinedAt: row?.membership_joined_at || null,
  };
}

/**
 * 멤버십에 가입한 상태인지 확인한다.
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} userId
 * @returns {Promise<boolean>}
 */
async function isMembershipActive(pool, userId) {
  const membership = await getUserMembership(pool, userId);
  return membership.joined;
}

/**
 * 시즌 입장 횟수를 센다. 티어 판정의 유일한 입력값이다.
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} userId
 * @returns {Promise<number>} 입장 완료 티켓 수
 */
async function getSeasonCount(pool, userId) {
  const [[row]] = await pool.query(
    'SELECT season_count FROM user_boxes WHERE user_id = ?',
    [userId],
  );
  return Number(row?.season_count ?? 0);
}

/**
 * 포인트 잔액을 `point_events` 합계로 **매번 계산**한다.
 *
 * 잔액을 컬럼에 캐시하지 않는 이유는 파일 상단 주석 참고.
 * 이벤트가 많아지면 느려질 수 있으나 현재 규모에서는 문제가 없다.
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} userId
 * @returns {Promise<number>} 현재 잔액
 */
async function getPointBalanceFromEvents(pool, userId) {
  const [[row]] = await pool.query(
    `SELECT
       COALESCE(SUM(amount), 0) AS balance,
       COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS totalEarned,
       COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END), 0) AS totalUsed
     FROM point_events
     WHERE user_id = ?`,
    [userId],
  );
  return {
    balance: Number(row?.balance ?? 0),
    totalEarned: Number(row?.totalEarned ?? 0),
    totalUsed: Number(row?.totalUsed ?? 0),
  };
}

/**
 * 다음 티어를 구한다. 이미 최고 티어면 그대로 돌려준다.
 * @param {string} tier 현재 티어
 * @returns {string} 다음 티어
 */
function nextTierOf(tier) {
  const idx = TIER_ORDER.indexOf(normalizeTier(tier) || '베이직');
  return idx >= 0 && idx < TIER_ORDER.length - 1 ? TIER_ORDER[idx + 1] : null;
}

/**
 * 마이페이지에 필요한 멤버십 정보를 한 번에 모아 준다.
 * (현재 티어·입장 횟수·다음 티어까지 남은 횟수·적립률·포인트 잔액)
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} userId
 * @returns {Promise<object>} 요약 객체
 */
async function getMembershipSummary(pool, userId) {
  const membership = await getUserMembership(pool, userId);
  const seasonCount = await getSeasonCount(pool, userId);
  const currentTier = membership.tier;
  const nextTier = membership.joined ? nextTierOf(currentTier) : null;
  const nextTierCount = nextTier ? TIER_REQUIREMENTS[nextTier] : null;
  const canTierUp = Boolean(nextTier && seasonCount >= TIER_REQUIREMENTS[nextTier]);
  const currentMonth = formatMonth();
  const [[monthlyRow]] = await pool.query(
    `SELECT claimed_count
       FROM membership_monthly_raffle_claims
      WHERE user_id = ? AND claim_month = ?`,
    [userId, currentMonth],
  );
  const monthlyLimit = currentTier ? TIER_MONTHLY_RAFFLES[currentTier] || 0 : 0;
  const monthlyClaimed = Number(monthlyRow?.claimed_count ?? 0);

  return {
    success: true,
    joined: membership.joined,
    currentTier,
    season_count: seasonCount,
    nextTier,
    nextTierCount,
    canTierUp,
    earnRate: currentTier ? TIER_EARN_RATES[currentTier] || 0 : 0,
    monthlyRaffleLimit: monthlyLimit,
    monthlyRaffleClaimed: monthlyClaimed,
    monthlyRaffleRemaining: Math.max(0, monthlyLimit - monthlyClaimed),
    currentMonth,
    rewards: TIER_REWARDS,
    tierRequirements: TIER_REQUIREMENTS,
    tierMonthlyRaffles: TIER_MONTHLY_RAFFLES,
  };
}

/**
 * Fabric 원장의 멤버십 정보를 DB 기준 요약에 덮어씌운다.
 * @param {object} summary DB 기준 요약
 * @param {object} fabricMembership 원장에서 읽은 멤버십
 * @returns {object} 병합된 요약
 */
function applyFabricMembershipToSummary(summary, fabricMembership) {
  if (!summary || !fabricMembership?.joined) return summary;
  const currentTier = fromFabricTier(fabricMembership.grade || fabricMembership.tier) || summary.currentTier || '베이직';
  const seasonCount = Number(fabricMembership.entryCount ?? summary.season_count ?? 0);
  const nextTier = nextTierOf(currentTier);
  const nextTierCount = nextTier ? TIER_REQUIREMENTS[nextTier] : null;
  const monthlyClaimed = Number(summary.monthlyRaffleClaimed ?? 0);
  const monthlyLimit = TIER_MONTHLY_RAFFLES[currentTier] || 0;

  return {
    ...summary,
    joined: true,
    currentTier,
    season_count: seasonCount,
    nextTier,
    nextTierCount,
    canTierUp: Boolean(nextTier && seasonCount >= TIER_REQUIREMENTS[nextTier]),
    earnRate: TIER_EARN_RATES[currentTier] || 0,
    monthlyRaffleLimit: monthlyLimit,
    monthlyRaffleClaimed: monthlyClaimed,
    monthlyRaffleRemaining: Math.max(0, monthlyLimit - monthlyClaimed),
  };
}

/**
 * DB 기준 실적을 Fabric 원장에 맞춰 넣는다(원장이 비어 있거나 뒤처졌을 때).
 * @param {object} params
 * @param {import('mysql2/promise').Pool} params.pool
 * @param {object} params.fabricService Fabric 어댑터
 * @param {number} params.userId
 * @param {string} params.walletAddress 검증된 지갑 주소
 * @returns {Promise<void>}
 */
async function syncFabricUserFromDb({ pool, fabricService, userId, walletAddress }) {
  if (!pool || !fabricService || !userId || !walletAddress || typeof fabricService.seedUser !== 'function') {
    return null;
  }
  const point = await getPointBalanceFromEvents(pool, userId);
  const membership = await getUserMembership(pool, userId);
  const seasonCount = await getSeasonCount(pool, userId);
  const grade = toFabricTier(membership.tier || '베이직');
  const seedResult = await fabricService.seedUser({
    walletAddress,
    pointBalance: point.balance,
    totalEarned: point.totalEarned,
    totalUsed: point.totalUsed,
    entryCount: seasonCount,
    joined: membership.joined,
    grade,
  });
  return {
    seedResult,
    userDidHash: fabricService.hashDid(walletAddress),
    point,
    membership: {
      joined: membership.joined,
      grade,
      tier: membership.tier,
      entryCount: seasonCount,
    },
  };
}

/**
 * 서명으로 소유가 검증된 지갑 주소를 가져온다.
 *
 * 클라이언트가 보낸 주소를 그대로 쓰지 않는다 — 남의 주소를 보내면
 * 그 사람의 포인트·응모권에 접근할 수 있기 때문이다.
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} userId
 * @param {string} [walletAddress] 요청에 실려 온 주소(검증 대조용)
 * @returns {Promise<string>} 검증된 주소, 없으면 빈 문자열
 */
async function getVerifiedWallet(pool, userId, walletAddress = '') {
  const params = [userId];
  let sql = `SELECT wallet_address FROM user_wallets WHERE user_id = ?`;
  if (walletAddress) {
    sql += ` AND LOWER(wallet_address) = LOWER(?)`;
    params.push(walletAddress);
  }
  sql += ` LIMIT 1`;
  const [[wallet]] = await pool.query(sql, params);
  return wallet?.wallet_address || null;
}

/**
 * 응모권 NFT 를 발급한다(티어 보상·월 지급·포인트 교환·관리자 지급).
 * @param {object} params
 * @param {import('mysql2/promise').Pool} params.pool
 * @param {object} params.fabricService Fabric 어댑터
 * @param {number} params.userId
 * @param {string} params.walletAddress 검증된 지갑 주소
 * @param {number} params.count 발급 수량
 * @param {string} params.source TIER_REWARD·MONTHLY_GRANT·POINT_EXCHANGE·ADMIN
 * @param {Date} [params.expiresAt] 만료 시각
 * @returns {Promise<string[]>} 발급된 응모권 id 목록
 */
async function issueRaffleNfts({
  pool,
  fabricService,
  userId,
  walletAddress,
  count,
  source,
  expiresAt,
  claimedMonth = null,
  gameId = '',
}) {
  if (!walletAddress || count <= 0) return [];
  const userDidHash = fabricService.hashDid(walletAddress);
  const issued = [];
  for (let i = 0; i < count; i += 1) {
    const raffleNftId = uuidv4();
    await fabricService.registerRaffleNFT({ raffleNftId, userDidHash, gameId });
    await pool.query(
      `INSERT INTO raffle_nfts
         (id, user_id, wallet_address, user_did_hash, game_id, status, source, expires_at, claimed_month)
       VALUES (?, ?, ?, ?, ?, 'ISSUED', ?, ?, ?)`,
      [raffleNftId, userId, walletAddress, userDidHash, gameId || null, source, expiresAt, claimedMonth],
    );
    issued.push(raffleNftId);
  }
  return issued;
}

/**
 * 티어 승급 보상 카드를 지급한다.
 * @param {import('mysql2/promise').Pool} pool
 * @param {number} userId
 * @param {number} count 지급 장수
 * @param {string} sourceTier 지급 사유가 된 티어
 * @returns {Promise<object[]>} 지급된 카드 목록
 */
async function issueRewardCards(pool, userId, count, sourceTier) {
  if (count <= 0) return [];
  const [cards] = await pool.query(
    `SELECT id, team, name, image_url, note
       FROM card_types
      ORDER BY RAND()
      LIMIT ${Number(count)}`,
  );
  const issued = [];
  for (const card of cards) {
    const nftId = `card-${crypto.randomBytes(8).toString('hex')}`;
    await pool.query(
      `INSERT INTO user_cards
         (user_id, card_type_id, nft_id, display_team, display_name, display_image_url, display_note, source_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, card.id, nftId, card.team, card.name, card.image_url, card.note, `tier_${sourceTier}`],
    );
    issued.push({ nftId, name: card.name, team: card.team });
  }
  return issued;
}

/**
 * 포인트 적립·차감을 이벤트로 기록한다. **포인트를 바꾸는 유일한 경로다.**
 *
 * 잔액 컬럼을 직접 고치는 코드를 만들지 말 것 — 이벤트와 잔액이 갈라지는 순간
 * 어느 쪽이 맞는지 판단할 수 없게 된다.
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {object} params
 * @param {number} params.userId
 * @param {string} params.walletAddress 검증된 지갑 주소
 * @param {string} params.eventType 이벤트 종류
 * @param {string} params.reason 사용자에게 보일 사유
 * @param {number} params.amount 양수=적립, 음수=차감
 * @param {object} [params.metadata] 부가 정보
 * @returns {Promise<number>} 기록 후 잔액
 */
async function recordPointEvent(pool, {
  userId,
  walletAddress,
  eventType,
  reason,
  amount,
  metadata = {},
}) {
  const pointAmount = Number(amount || 0);
  if (!userId || pointAmount === 0) return null;
  const id = uuidv4();
  await pool.query(
    `INSERT INTO point_events
       (id, user_id, wallet_address, event_type, reason, amount, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, walletAddress || null, eventType, reason, pointAmount, JSON.stringify(metadata)],
  );
  try {
    const isEarn = pointAmount > 0;
    const absAmount = Math.abs(pointAmount);
    await notificationService.recordNotification(pool, {
      userId,
      category: 'POINT',
      title: reason,
      message: `${absAmount.toLocaleString('ko-KR')}P가 ${isEarn ? '적립' : '사용'}되었습니다.`,
      amount: pointAmount,
      metadata: { eventType, walletAddress, ...metadata },
    });
  } catch (notificationErr) {
    console.error('[membershipService] point notification failed:', notificationErr.message);
  }
  return id;
}

module.exports = {
  TIER_ORDER,
  TIER_REQUIREMENTS,
  TIER_EARN_RATES,
  TIER_MONTHLY_RAFFLES,
  TIER_REWARDS,
  normalizeTier,
  toFabricTier,
  fromFabricTier,
  formatMonth,
  addDays,
  nextMonthEnd,
  getUserMembership,
  isMembershipActive,
  getSeasonCount,
  getPointBalanceFromEvents,
  getMembershipSummary,
  applyFabricMembershipToSummary,
  syncFabricUserFromDb,
  getVerifiedWallet,
  issueRaffleNfts,
  issueRewardCards,
  recordPointEvent,
};
