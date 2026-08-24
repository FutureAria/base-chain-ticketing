'use strict';
const express  = require('express');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const fabricService    = require('../services/fabricBridge');
const nftBridge        = require('../services/nftBridgeAdapter');
const { mintBoxOnChain, isOnChainMintingEnabled } = require('../services/nftService');
const membershipService = require('../services/membershipService');
const notificationService = require('../services/notificationService');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
let _pool;
function setPool(pool) { _pool = pool; }

const QR_SECRET = process.env.QR_SECRET;
const DEFAULT_QR_SLOT_SECONDS = 10;
const DEFAULT_ENTRY_EARN_RATE = membershipService.TIER_EARN_RATES['베이직'];

function calculateEntryRewardPoint(price, tier) {
  const normalizedTier = membershipService.normalizeTier(tier);
  const rate = membershipService.TIER_EARN_RATES[normalizedTier] ?? DEFAULT_ENTRY_EARN_RATE;
  return Math.max(0, Math.floor(Number(price || 0) * rate));
}

function getQrSlotSeconds() {
  const value = Number.parseInt(process.env.QR_SLOT_SECONDS || '', 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_QR_SLOT_SECONDS;
}

function getCurrentSlot() {
  const offset = Number.parseFloat(process.env.DEBUG_TIME_OFFSET_HOURS || '0');
  const nowMs = Date.now() + (Number.isFinite(offset) ? offset : 0) * 60 * 60 * 1000;
  return Math.floor(nowMs / 1000 / getQrSlotSeconds());
}

function generateQRToken(ticketId, slot) {
  return crypto
    .createHmac('sha256', QR_SECRET)
    .update(`${ticketId}:${slot}`)
    .digest('hex')
    .slice(0, 32);
}

// 현재 슬롯 + 이전 슬롯 둘 다 허용 (슬롯 경계 타이밍 대응)
function isValidQRToken(ticketId, token) {
  const slot = getCurrentSlot();
  return token === generateQRToken(ticketId, slot) ||
         token === generateQRToken(ticketId, slot - 1);
}

// 검표는 현장 스태프(관리자)만 수행한다.
// QR 토큰 자체는 HMAC 이라 위조가 어렵지만, 이 엔드포인트는 티켓을 '사용됨'으로 바꾸는
// 상태 변경 지점이라 아무나 호출하게 두지 않는다.
function requireEntryStaff(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ allowed: false, reason: 'NOT_ENTRY_STAFF' });
  }
  next();
}

// POST /api/entry/verify
// Body: { ticketId, qrToken, gateId? }
router.post('/verify', requireAuth, requireEntryStaff, async (req, res) => {
  try {
    const { ticketId, qrToken, gateId } = req.body;

    if (!ticketId || !qrToken) {
      return res.status(400).json({ allowed: false, reason: 'MISSING_PARAMS' });
    }

    // 1. DB에서 티켓 + 경기 정보 조회
    const [[ticket]] = await _pool.query(
      `SELECT t.*, g.game_date, g.game_time, g.status AS game_status,
              g.home_team, g.away_team, g.stadium_id
       FROM tickets t
       LEFT JOIN games g ON t.game_id = g.id
       WHERE t.id = ?`,
      [ticketId]
    );

    if (!ticket) {
      return res.json({ allowed: false, reason: 'TICKET_NOT_FOUND' });
    }

    // 2. QR 토큰 유효성 검증
    if (!isValidQRToken(ticketId, qrToken)) {
      return res.json({ allowed: false, reason: 'INVALID_QR_TOKEN' });
    }
    if (ticket.status === 'used') {
      return res.json({ allowed: false, reason: 'ALREADY_USED' });
    }
    if (ticket.status !== 'confirmed') {
      return res.json({ allowed: false, reason: `INVALID_STATUS:${ticket.status}` });
    }

    // 3. NFT 소유권 확인
    // TRANSFERRED 티켓은 장터 2차 거래 시 온체인 이전 없이 DB로만 소유권 관리하므로 체크 생략
    if (ticket.purchase_type !== 'TRANSFERRED') {
      const isOwner = await nftBridge.checkNftOwner(ticket.token_id, ticket.wallet_address);
      if (!isOwner) {
        return res.json({ allowed: false, reason: 'NOT_NFT_OWNER' });
      }
    }

    // 4. Fabric 입장 처리 (mock in-memory)
    // 서버 재시작으로 mock 스토어가 비어있을 경우 DB 기반으로 자동 재등록
    let fabricResult = await fabricService.verifyEntry({
      ticketId,
      tokenId:       ticket.token_id || '0',
      walletAddress: ticket.wallet_address,
      gateId:        gateId || 'GATE_DEFAULT',
    });

    if (!fabricResult.allowed && fabricResult.reason === 'TICKET_NOT_FOUND') {
      try {
        const gameDateStr = ticket.game_date instanceof Date
          ? ticket.game_date.toISOString().split('T')[0]
          : String(ticket.game_date || '').split('T')[0];
        await fabricService.registerTicket({
          ticketId,
          tokenId:      ticket.token_id || '0',
          gameId:       String(ticket.game_id),
          seatId:       `${ticket.block}-${ticket.row_num}-${ticket.seat_number}`,
          walletAddress: ticket.wallet_address,
          price:        Number(ticket.price),
          purchaseType: ticket.purchase_type || 'PRIMARY',
          gameDate:     gameDateStr,
        });
        fabricResult = await fabricService.verifyEntry({
          ticketId,
          tokenId:       ticket.token_id || '0',
          walletAddress: ticket.wallet_address,
          gateId:        gateId || 'GATE_DEFAULT',
        });
      } catch (reRegErr) {
        console.error('[entryRoutes] Fabric 재등록 실패:', reRegErr);
        fabricResult = { allowed: false, reason: 'FABRIC_REGISTRATION_FAILED' };
      }
    }

    if (!fabricResult.allowed) {
      return res.json({ allowed: false, reason: fabricResult.reason });
    }

    // 5. MySQL 상태 업데이트
    await _pool.query(
      "UPDATE tickets SET status = 'used' WHERE id = ?",
      [ticketId]
    );

    // 6. fabric_events 로그 기록
    await _pool.query(
      `INSERT INTO fabric_events
         (id, event_name, ticket_id, game_id, user_did_hash, payload_json, fabric_tx_id)
       VALUES (?, 'ENTRY_VERIFIED', ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        ticketId,
        ticket.game_id,
        fabricService.hashDid(ticket.wallet_address),
        JSON.stringify({
          gateId:  gateId || 'GATE_DEFAULT',
          entryId: fabricResult.entryId,
        }),
        fabricResult.txId,
      ]
    );

    // 7. QR 입장 보상 반영
    // - 박스는 멤버십 가입 여부와 무관하게 실제 입장 완료 시 지급
    // - 포인트는 멤버십 가입자에게만 적립
    let boxTxHash = null;
    let memberJoined = false;
    let ownerUserId = null;
    let earnedPoint = 0;
    try {
      const [[walletRow]] = await _pool.query(
        'SELECT user_id FROM user_wallets WHERE wallet_address = ?',
        [ticket.wallet_address]
      );
      if (walletRow) {
        ownerUserId = walletRow.user_id;
        memberJoined = await membershipService.isMembershipActive(_pool, walletRow.user_id);
        await _pool.query(
          `INSERT INTO user_boxes (user_id, season_count) VALUES (?, 1)
           ON DUPLICATE KEY UPDATE season_count = season_count + 1`,
          [walletRow.user_id]
        );
        if (isOnChainMintingEnabled(['MINTER_PRIVATE_KEY', 'BOX_NFT_ADDRESS'])) {
          boxTxHash = await mintBoxOnChain(ticket.wallet_address);
        }
        await notificationService.recordNotification(_pool, {
          userId: walletRow.user_id,
          category: 'BOX',
          title: '랜덤 박스 NFT 획득',
          message: '랜덤 박스 NFT가 지급되었습니다.',
          amount: 1,
          metadata: { ticketId, gameId: ticket.game_id, gateId: gateId || 'GATE_DEFAULT', boxTxHash },
        });
        console.log(`[entry] 입장 박스 지급 완료: user=${walletRow.user_id}, ticket=${ticketId}, member=${memberJoined}`);

        if (memberJoined) {
          const membershipSummary = await membershipService.getMembershipSummary(_pool, walletRow.user_id);
          earnedPoint = calculateEntryRewardPoint(ticket.price, membershipSummary.currentTier);
          if (membershipSummary.canTierUp && membershipSummary.nextTier) {
            const [[existingTierNotice]] = await _pool.query(
              `SELECT id FROM notification_events
                WHERE user_id = ? AND category = 'MEMBERSHIP' AND title = ?
                LIMIT 1`,
              [walletRow.user_id, `${membershipSummary.nextTier} 티어업 조건 달성`],
            );
            if (!existingTierNotice) {
              await notificationService.recordNotification(_pool, {
                userId: walletRow.user_id,
                category: 'MEMBERSHIP',
                title: `${membershipSummary.nextTier} 티어업 조건 달성`,
                message: '멤버십 페이지에서 티어업을 완료하고 최초 혜택을 받으세요.',
                metadata: { nextTier: membershipSummary.nextTier, seasonCount: membershipSummary.season_count },
              });
            }
          }
          if (earnedPoint > 0) {
            await membershipService.recordPointEvent(_pool, {
              userId: walletRow.user_id,
              walletAddress: ticket.wallet_address,
              eventType: 'ENTRY_REWARD',
              reason: 'QR 입장 완료',
              amount: earnedPoint,
              metadata: {
                ticketId,
                gameId: ticket.game_id,
                gateId: gateId || 'GATE_DEFAULT',
                tier: membershipSummary.currentTier,
                source: 'db_membership',
                fabricEarnedPoint: Number(fabricResult.earnedPoint ?? 0),
              },
            });
          }
          console.log(`[entry] 멤버십 입장 포인트 적립 완료: user=${walletRow.user_id}, point=${earnedPoint}`);
        }
      }
    } catch (boxErr) {
      console.error('[entry] 입장 보상 처리 실패 (입장은 유효):', boxErr.message);
    }

    console.log(`[entry] 입장 완료 - 티켓: ${ticketId} | 포인트 적립: ${earnedPoint}P | 등급: ${fabricResult.membershipGrade ?? '-'}`);

    return res.json({
      allowed:         true,
      ticketId,
      earnedPoint,
      membershipGrade: fabricResult.membershipGrade,
      membershipJoined: memberJoined,
      userId:          ownerUserId,
      entryId:         fabricResult.entryId,
      walletAddress:   ticket.wallet_address,
      boxTxHash,
    });

  } catch (err) {
    console.error('[entryRoutes] verify error:', err);
    res.status(500).json({ allowed: false, reason: 'SERVER_ERROR', message: err.message });
  }
});

module.exports = { router, setPool };
