'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const notificationService = require('./notificationService');

const TIER_ORDER = ['베이직', '브론즈', '실버', '골드'];
const TIER_REQUIREMENTS = { 베이직: 0, 브론즈: 3, 실버: 6, 골드: 10 };
const TIER_EARN_RATES = { 베이직: 0.005, 브론즈: 0.007, 실버: 0.01, 골드: 0.015 };
const TIER_MONTHLY_RAFFLES = { 베이직: 0, 브론즈: 0, 실버: 1, 골드: 2 };
const TIER_REWARDS = {
  베이직: { cards: 0, raffles: 0 },
  브론즈: { cards: 1, raffles: 0 },
  실버: { cards: 2, raffles: 1 },
  골드: { cards: 3, raffles: 2 },
};

const FABRIC_TIER = {
  베이직: 'BASIC',
  브론즈: 'BRONZE',
  실버: 'SILVER',
  골드: 'GOLD',
};

function normalizeTier(tier) {
  const value = String(tier || '').toUpperCase();
  if (tier === '일반' || value === 'BASIC') return '베이직';
  if (tier === '브론즈' || value === 'BRONZE') return '브론즈';
  if (tier === '실버' || value === 'SILVER') return '실버';
  if (tier === '골드' || value === 'GOLD') return '골드';
  return null;
}

function toFabricTier(tier) {
  return FABRIC_TIER[normalizeTier(tier) || '베이직'];
}

function fromFabricTier(grade) {
  return normalizeTier(grade);
}

function formatMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function nextMonthEnd(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 2, 0, 23, 59, 59, 999);
}

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

async function isMembershipActive(pool, userId) {
  const membership = await getUserMembership(pool, userId);
  return membership.joined;
}

async function getSeasonCount(pool, userId) {
  const [[row]] = await pool.query(
    'SELECT season_count FROM user_boxes WHERE user_id = ?',
    [userId],
  );
  return Number(row?.season_count ?? 0);
}

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

function nextTierOf(tier) {
  const idx = TIER_ORDER.indexOf(normalizeTier(tier) || '베이직');
  return idx >= 0 && idx < TIER_ORDER.length - 1 ? TIER_ORDER[idx + 1] : null;
}

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
