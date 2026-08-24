'use strict';

require('dotenv').config();
const mysql = require('mysql2/promise');
const membershipService = require('../services/membershipService');
const { DB_CONFIG, DB_NAME } = require('../db/init');

const TICKET_RESALE_REWARD_RATE = 0.003;
const isApplyMode = process.argv.includes('--apply');

function calculateReward(price) {
  return Math.floor((Number(price) || 0) * TICKET_RESALE_REWARD_RATE);
}

function eventTypeFor(role) {
  return role === 'buyer' ? 'TICKET_RESALE_BUYER_REWARD' : 'TICKET_RESALE_REWARD';
}

function reasonFor(role) {
  return role === 'buyer' ? '티켓 양도 구매 포인트 적립' : '티켓 양도 판매 포인트 적립';
}

async function hasRewardEvent(pool, { userId, eventType, tradeId, listingId }) {
  const [[row]] = await pool.query(
    `SELECT id
       FROM point_events
      WHERE user_id = ?
        AND event_type = ?
        AND (
          JSON_UNQUOTE(JSON_EXTRACT(metadata_json, "$.tradeId")) = ?
          OR JSON_UNQUOTE(JSON_EXTRACT(metadata_json, "$.listingId")) = ?
        )
      LIMIT 1`,
    [userId, eventType, tradeId, listingId],
  );
  return Boolean(row?.id);
}

async function buildRoleResult(pool, trade, role) {
  const userId = role === 'buyer' ? trade.buyer_id : trade.seller_id;
  const walletAddress = role === 'buyer' ? trade.buyer_wallet : trade.seller_wallet;
  const counterpartyId = role === 'buyer' ? trade.seller_id : trade.buyer_id;
  const eventType = eventTypeFor(role);
  const amount = calculateReward(trade.price);

  if (!userId || !walletAddress || amount <= 0) {
    return { role, status: 'skipped', userId, amount: 0 };
  }

  const joined = await membershipService.isMembershipActive(pool, userId);
  if (!joined) {
    return { role, status: 'not_member', userId, amount: 0 };
  }

  const exists = await hasRewardEvent(pool, {
    userId,
    eventType,
    tradeId: trade.trade_id,
    listingId: trade.listing_id,
  });
  if (exists) {
    return { role, status: 'exists', userId, amount: 0 };
  }

  return {
    role,
    status: isApplyMode ? 'inserted' : 'would_insert',
    userId,
    walletAddress,
    eventType,
    reason: reasonFor(role),
    amount,
    metadata: {
      tradeId: trade.trade_id,
      listingId: trade.listing_id,
      ticketId: trade.ticket_id,
      counterpartyId,
      price: Number(trade.price),
      rate: TICKET_RESALE_REWARD_RATE,
      role,
      source: 'ticket_resale_backfill',
    },
  };
}

async function maybeInsert(pool, result) {
  if (!isApplyMode || result.status !== 'inserted') return;
  await membershipService.recordPointEvent(pool, {
    userId: result.userId,
    walletAddress: result.walletAddress,
    eventType: result.eventType,
    reason: result.reason,
    amount: result.amount,
    metadata: result.metadata,
  });
}

async function main() {
  const pool = await mysql.createPool({ ...DB_CONFIG, database: DB_NAME, connectionLimit: 3 });
  try {
    const [trades] = await pool.query(
      `SELECT tt.id AS trade_id, tt.listing_id, tt.buyer_id, tt.seller_id, tt.price, tt.traded_at,
              tl.ticket_id,
              buyer.email AS buyer_email,
              seller.email AS seller_email,
              bw.wallet_address AS buyer_wallet,
              sw.wallet_address AS seller_wallet
         FROM ticket_trades tt
         JOIN ticket_listings tl ON tl.id = tt.listing_id
         JOIN users buyer ON buyer.user_id = tt.buyer_id
         JOIN users seller ON seller.user_id = tt.seller_id
         LEFT JOIN user_wallets bw ON bw.user_id = tt.buyer_id
         LEFT JOIN user_wallets sw ON sw.user_id = tt.seller_id
        ORDER BY tt.traded_at DESC`,
    );

    const changed = [];
    for (const trade of trades) {
      const seller = await buildRoleResult(pool, trade, 'seller');
      const buyer = await buildRoleResult(pool, trade, 'buyer');
      await maybeInsert(pool, seller);
      await maybeInsert(pool, buyer);
      if (seller.status === 'inserted' || seller.status === 'would_insert' || buyer.status === 'inserted' || buyer.status === 'would_insert') {
        changed.push({
          tradeId: trade.trade_id,
          listingId: trade.listing_id,
          price: Number(trade.price),
          sellerEmail: trade.seller_email,
          buyerEmail: trade.buyer_email,
          seller,
          buyer,
        });
      }
    }

    console.log(JSON.stringify({
      mode: isApplyMode ? 'apply' : 'dry-run',
      changedCount: changed.length,
      changed,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
