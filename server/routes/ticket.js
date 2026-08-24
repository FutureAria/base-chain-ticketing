const express = require("express");
const crypto  = require("crypto");
const {
  purchaseTicket,
  purchaseTickets,
  SeatAlreadyTakenError,
  RELEASED_TICKET_STATUSES,
} = require("../services/ticketService");
const {
  computeOrderAmount,
  assertAmountMatches,
  validateSeatPrices,
  PriceValidationError,
} = require("../config/seatPricing");
const { mintTicketOnChain, isOnChainMintingEnabled } = require("../services/nftService");
const fabricService = require("../services/fabricBridge");
const { confirmPayment, cancelPayment } = require("../services/tossPayService");
const { requireAuth } = require("../middleware/auth");
const { isWithinGamePlus1h } = require("../utils/gameTime");
const membershipService = require("../services/membershipService");
const notificationService = require("../services/notificationService");

const router = express.Router();
let _pool;

function setPool(pool) {
  _pool = pool;
}

const PRIORITY_BLOCKS = new Set(['T1', 'T2']);
const PRIORITY_ROW = 5;
const PRIORITY_SEATS = new Set([2, 3, 4, 5, 6]);

function isPrioritySeat(block, seat) {
  return PRIORITY_BLOCKS.has(String(block || '').toUpperCase())
    && Number(seat.row) === PRIORITY_ROW
    && PRIORITY_SEATS.has(Number(seat.seatNumber));
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// NFT 민팅을 mock 으로 할지 판단한다.
// paymentKey 는 클라이언트가 보내는 값이므로, 실결제 모드에서는 그 값으로 우회되지 않게 한다.
// (tossPayService.shouldUseMockPayment 와 같은 기준을 쓴다)
function isMockTossPayment(paymentKey) {
  const mode = (process.env.TOSS_MODE || '').trim().toLowerCase();
  if (mode === 'real') return false;
  if (mode === 'mock') return true;
  return String(paymentKey || '').startsWith('tgen_');
}

function createMockTicketMintResult(ticketId) {
  return {
    tokenId: Math.floor(100000000 + Math.random() * 900000000),
    txHash: `0x${crypto.createHash('sha256').update(`${ticketId}:${Date.now()}:${Math.random()}`).digest('hex')}`,
  };
}

function demoAdminWalletAddress(user) {
  if (user?.user_id === 'practice_admin' && user?.email === 'practice@basechain.dev') {
    return '0x9999999999999999999999999999999999999999';
  }
  const seed = `${user?.user_id || 'admin'}:${user?.email || 'basechain'}`;
  return `0x${crypto.createHash('sha256').update(`basechain-demo-admin:${seed}`).digest('hex').slice(0, 40)}`;
}

async function ensureAdminWalletDid(user) {
  const [[existingWallet]] = await _pool.query(
    'SELECT wallet_address FROM user_wallets WHERE user_id = ?',
    [user.user_id],
  );
  const walletAddress = existingWallet?.wallet_address || demoAdminWalletAddress(user);
  const didValue = user.user_id === 'practice_admin' && user.email === 'practice@basechain.dev'
    ? 'did:basechain:practice-admin'
    : `did:basechain:${walletAddress.toLowerCase().slice(2)}`;

  await _pool.query(
    `INSERT INTO user_wallets
       (user_id, wallet_address, nonce, is_verified, connected_at, verified_at)
     VALUES (?, ?, NULL, 1, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       wallet_address = VALUES(wallet_address),
       nonce = NULL,
       is_verified = 1,
       verified_at = NOW()`,
    [user.user_id, walletAddress],
  );

  await _pool.query(
    `INSERT INTO did_verifications
       (user_id, did_value, wallet_address, last_signature, status, verified_at)
     VALUES (?, ?, ?, 'admin-demo-signature', 'verified', NOW())
     ON DUPLICATE KEY UPDATE
       did_value = VALUES(did_value),
       wallet_address = VALUES(wallet_address),
       last_signature = VALUES(last_signature),
       status = 'verified',
       verified_at = NOW()`,
    [user.user_id, didValue, walletAddress],
  );

  return walletAddress.toLowerCase();
}

async function requireVerifiedDidForWallet(req, res, next) {
  try {
    if (req.user?.role === 'admin') {
      req.verifiedWalletAddress = await ensureAdminWalletDid(req.user);
      return next();
    }

    const walletAddress = String(req.body.walletAddress || "").trim().toLowerCase();

    if (!walletAddress) {
      return res.status(400).json({ success: false, message: "지갑 주소가 필요합니다" });
    }

    const [[wallet]] = await _pool.query(
      `SELECT uw.wallet_address, uw.is_verified,
              dv.wallet_address AS did_wallet_address,
              dv.status AS did_status
       FROM user_wallets uw
       LEFT JOIN did_verifications dv ON dv.user_id = uw.user_id
       WHERE uw.user_id = ?`,
      [req.user.user_id],
    );

    if (!wallet) {
      return res.status(403).json({ success: false, message: "먼저 지갑을 연결해주세요" });
    }

    const registeredWallet = String(wallet.wallet_address || "").toLowerCase();
    const didWallet = String(wallet.did_wallet_address || "").toLowerCase();

    if (registeredWallet !== walletAddress) {
      return res.status(403).json({ success: false, message: "DID 인증된 본인 지갑으로만 예매할 수 있습니다" });
    }

    if (!wallet.is_verified || wallet.did_status !== "verified" || didWallet !== registeredWallet) {
      return res.status(403).json({ success: false, message: "DID 인증 완료 후 예매할 수 있습니다" });
    }

    req.verifiedWalletAddress = registeredWallet;
    next();
  } catch (err) {
    console.error("[ticket did gate]", err);
    res.status(500).json({ success: false, message: "DID 인증 상태 확인 실패" });
  }
}

// ─── QR 유틸 ──────────────────────────────────────────────

const QR_SECRET = process.env.QR_SECRET;
const DEFAULT_QR_SLOT_SECONDS = 10;
const DEFAULT_DEMO_QR_GAME_IDS = ['PRACTICE_ALL_DAY_GAME'];

function getQrSlotSeconds() {
  const value = Number.parseInt(process.env.QR_SLOT_SECONDS || "", 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_QR_SLOT_SECONDS;
}

function getDemoAlwaysOnGameIds() {
  const raw = process.env.QR_DEMO_ALWAYS_ON_GAME_IDS ?? process.env.QR_PERMANENT_DEMO_GAME_IDS;
  if (raw == null) return DEFAULT_DEMO_QR_GAME_IDS;
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function isDemoAlwaysOnQrTicket(ticket) {
  const gameId = String(ticket?.game_id || '');
  if (getDemoAlwaysOnGameIds().includes(gameId)) return true;
  if (process.env.QR_DEMO_ALWAYS_ON_GAME_IDS != null || process.env.QR_PERMANENT_DEMO_GAME_IDS != null) return false;
  return String(ticket?.home_team || '').toUpperCase() === 'BASE'
    && String(ticket?.away_team || '').toUpperCase() === 'CHAIN'
    && String(ticket?.stadium_id || '') === 'practice-stadium';
}

// 테스트용: DEBUG_TIME_OFFSET_HOURS 만큼 현재 시간을 앞당김
function getNowMs() {
  const offset = parseFloat(process.env.DEBUG_TIME_OFFSET_HOURS || "0");
  return Date.now() + offset * 60 * 60 * 1000;
}

function getCurrentSlot(nowMs) {
  return Math.floor(nowMs / 1000 / getQrSlotSeconds());
}

function generateQRToken(ticketId, slot) {
  return crypto
    .createHmac("sha256", QR_SECRET)
    .update(`${ticketId}:${slot}`)
    .digest("hex")
    .slice(0, 32);
}

// 경기 목록 조회
const GAMES_CACHE_TTL_MS = Number.parseInt(process.env.GAMES_CACHE_TTL_MS || "30000", 10);
let gamesCache = { expiresAt: 0, payload: null };

router.get("/games", async (req, res) => {
  try {
    const now = Date.now();
    if (gamesCache.payload && gamesCache.expiresAt > now) {
      res.set("Cache-Control", "public, max-age=5, stale-while-revalidate=60");
      return res.json(gamesCache.payload);
    }

    const [games] = await _pool.query(`
      SELECT g.id, g.home_team, g.away_team,
        DATE_FORMAT(g.game_date, '%Y-%m-%d') AS game_date,
        TIME_FORMAT(g.game_time, '%H:%i:%s') AS game_time,
        g.stadium_id, g.base_price,
        DATE_FORMAT(g.booking_open_at, '%Y-%m-%dT%H:%i:%s+09:00') AS booking_open_at,
        DATE_FORMAT(g.raffle_open_at, '%Y-%m-%dT%H:%i:%s+09:00') AS raffle_open_at,
        g.raffle_winners_count,
        s.name AS stadium_name, s.location,
        ELT(WEEKDAY(g.game_date)+1, '월','화','수','목','금','토','일') AS day_of_week,
        CASE
          WHEN TIMESTAMP(g.game_date, g.game_time) < NOW() THEN 'ENDED'
          WHEN g.booking_open_at IS NOT NULL AND g.booking_open_at > NOW() THEN 'UPCOMING'
          ELSE g.status
        END AS status
      FROM games g
      JOIN stadiums s ON g.stadium_id = s.id
      ORDER BY g.game_date ASC, g.game_time ASC
    `);
    const payload = { success: true, data: games };
    gamesCache = { expiresAt: now + Math.max(1000, GAMES_CACHE_TTL_MS), payload };
    res.set("Cache-Control", "public, max-age=5, stale-while-revalidate=60");
    res.json(payload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "경기 목록 조회 실패" });
  }
});

// 경기 상세 조회
router.get("/games/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await _pool.query(
      `SELECT g.id, g.home_team, g.away_team,
         DATE_FORMAT(g.game_date, '%Y-%m-%d') AS game_date,
         TIME_FORMAT(g.game_time, '%H:%i:%s') AS game_time,
         g.stadium_id, g.base_price,
         DATE_FORMAT(g.booking_open_at, '%Y-%m-%dT%H:%i:%s+09:00') AS booking_open_at,
         DATE_FORMAT(g.raffle_open_at, '%Y-%m-%dT%H:%i:%s+09:00') AS raffle_open_at,
         g.raffle_winners_count,
         s.name AS stadium_name, s.location, s.capacity,
         CASE
           WHEN TIMESTAMP(g.game_date, g.game_time) < NOW() THEN 'ENDED'
           WHEN g.booking_open_at IS NOT NULL AND g.booking_open_at > NOW() THEN 'UPCOMING'
           ELSE g.status
         END AS status
       FROM games g
       JOIN stadiums s ON g.stadium_id = s.id
       WHERE g.id = ?`,
      [id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "경기를 찾을 수 없습니다" });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "경기 상세 조회 실패" });
  }
});

// 특정 경기의 예약된 좌석 조회
router.get("/seats/:gameId", async (req, res) => {
  try {
    const { gameId } = req.params;
    // 예매 시 중복 검사와 같은 기준을 쓴다 — 환불·취소된 좌석만 빈자리로 본다.
    const releasedPlaceholders = RELEASED_TICKET_STATUSES.map(() => '?').join(',');
    const [rows] = await _pool.query(
      `SELECT block, row_num, seat_number
         FROM tickets
        WHERE game_id = ? AND status NOT IN (${releasedPlaceholders})`,
      [gameId, ...RELEASED_TICKET_STATUSES],
    );
    const bookedSeats = rows.map((t) => `${t.block}:${t.row_num}-${t.seat_number}`);
    res.json({ success: true, data: bookedSeats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "좌석 조회 실패" });
  }
});

// 티켓 구매
router.post("/purchase", requireAuth, requireVerifiedDidForWallet, async (req, res) => {
  try {
    const { walletAddress, gameId, stadium, grade, block, row, seatNumber, price } = req.body;
    const verifiedWalletAddress = req.verifiedWalletAddress || String(walletAddress).toLowerCase();

    if (!walletAddress || !gameId || !grade || !block || !row || !seatNumber) {
      return res.status(400).json({ success: false, message: "필수 정보가 누락되었습니다" });
    }

    // 가격은 이 경로에서도 서버 가격표로 검증한다 (Toss 흐름만 막으면 우회로가 남는다).
    try {
      validateSeatPrices(grade, [{ price }]);
    } catch (priceErr) {
      if (priceErr instanceof PriceValidationError) {
        return res.status(400).json({ success: false, message: priceErr.message });
      }
      throw priceErr;
    }

    const result = await purchaseTicket(_pool, {
      walletAddress: verifiedWalletAddress,
      gameId,
      stadium,
      grade,
      block,
      row,
      seatNumber,
      price,
    });

    // 티켓 구매 성공 시 → 지갑 주소로 user_id 조회 후 시즌 박스 1개 지급
    let ticketTokenId = null;
    let ticketTxHash  = null;

    // Fabric 티켓 등록 + 예약 레코드 생성 (실패해도 구매 자체는 성공 처리)
    try {
      const [[gameRow]] = await _pool.query(
        "SELECT DATE_FORMAT(game_date, '%Y-%m-%d') AS game_date FROM games WHERE id = ?",
        [gameId]
      );
      const { v4: uuidv4 } = require('uuid');
      await fabricService.registerTicket({
        ticketId:     result.id,
        tokenId:      ticketTokenId || '0',
        gameId:       String(gameId),
        seatId:       `${block}-${row}-${seatNumber}`,
        walletAddress: verifiedWalletAddress,
        price:        Number(price),
        purchaseType: 'PRIMARY',
        gameDate:     gameRow?.game_date || '',
      });

      // Fabric 예약 레코드 (1차 구매 = 일반 예약)
      const userDidHash    = fabricService.hashDid(walletAddress);
      const reservationId  = uuidv4();
      await fabricService.createReservation({
        reservationId,
        userDidHash,
        gameId:      String(gameId),
        raffleNftId: '',
        isPriority:  false,
      });
      await fabricService.confirmReservation({ reservationId, ticketId: result.id });
    } catch (fabErr) {
      console.error('[ticket] Fabric registerTicket/reservation 실패 (무시):', fabErr.message);
    }

    res.json({
      success: true,
      data: { ...result, ticketTokenId, ticketTxHash },
    });
  } catch (err) {
    if (err instanceof SeatAlreadyTakenError) {
      return res.status(409).json({ success: false, message: err.message });
    }
    console.error(err);
    res.status(500).json({ success: false, message: err.message || "티켓 구매 실패" });
  }
});

// ─── QR 발급 ──────────────────────────────────────────────
router.get("/:ticketId/qr", requireAuth, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { walletAddress } = req.query;

    if (!walletAddress) {
      return res.status(400).json({ available: false, message: "지갑 주소가 필요합니다" });
    }

    const normalizedWallet = String(walletAddress).trim().toLowerCase();
    const [[walletRow]] = await _pool.query(
      "SELECT wallet_address FROM user_wallets WHERE user_id = ?",
      [req.user.user_id],
    );
    if (!walletRow?.wallet_address || String(walletRow.wallet_address).toLowerCase() !== normalizedWallet) {
      return res.status(403).json({ available: false, message: "내 입장권의 QR만 조회할 수 있습니다" });
    }

    // 티켓 + 경기 정보 조회
    const [rows] = await _pool.query(
      `SELECT t.*, g.game_date, g.game_time, g.home_team, g.away_team, g.stadium_id
       FROM tickets t
       LEFT JOIN games g ON t.game_id = g.id
       WHERE t.id = ? AND t.wallet_address = ?`,
      [ticketId, normalizedWallet],
    );

    if (rows.length === 0) {
      return res.status(404).json({ available: false, message: "티켓을 찾을 수 없습니다" });
    }

    const ticket = rows[0];

    // 티켓 상태 확인
    if (ticket.status === "used") {
      return res.json({ available: false, message: "이미 사용된 티켓입니다" });
    }

    // 경기 정보 없음 → QR 불가
    if (!ticket.game_date || !ticket.game_time) {
      return res.json({ available: false, message: "경기 정보를 찾을 수 없습니다" });
    }

    // 경기 시작 시간 계산
    const gameDate    = ticket.game_date instanceof Date
      ? [
          ticket.game_date.getFullYear(),
          String(ticket.game_date.getMonth() + 1).padStart(2, "0"),
          String(ticket.game_date.getDate()).padStart(2, "0"),
        ].join("-")
      : String(ticket.game_date).slice(0, 10);
    const gameTime    = String(ticket.game_time).slice(0, 8);
    const gameDateTime = new Date(`${gameDate}T${gameTime}+09:00`);

    // 날짜 파싱 실패 → QR 불가
    if (isNaN(gameDateTime.getTime())) {
      return res.json({ available: false, message: "경기 시간 정보가 올바르지 않습니다" });
    }

    const nowMs          = getNowMs();
    const msUntilGame    = gameDateTime.getTime() - nowMs;
    const hoursUntilGame = msUntilGame / (1000 * 60 * 60);
    const demoAlwaysOn   = isDemoAlwaysOnQrTicket(ticket);

    // 경기 시작 N시간 전부터 QR 활성화 (QR_HOURS_BEFORE 환경변수로 제어, 기본 2시간)
    const qrHoursBefore = Number(process.env.QR_HOURS_BEFORE ?? 2);
    if (!demoAlwaysOn && hoursUntilGame > qrHoursBefore) {
      return res.json({
        available: false,
        message:   `경기 시작 ${qrHoursBefore}시간 전부터 QR 조회 가능`,
      });
    }

    // 경기 종료 후 2시간 이상 지난 경우
    if (!demoAlwaysOn && hoursUntilGame < -2) {
      return res.json({ available: false, message: "경기가 종료되었습니다" });
    }

    // QR 토큰 생성 (기본 10초 슬롯 기반, QR_SLOT_SECONDS로 조절 가능)
    const slot             = getCurrentSlot(nowMs);
    const qrToken          = generateQRToken(ticketId, slot);
    const slotEndMs        = (slot + 1) * getQrSlotSeconds() * 1000;
    const remainingSeconds = Math.max(1, Math.ceil((slotEndMs - nowMs) / 1000));

    res.json({
      available:        true,
      qrToken,
      expiresAt:        new Date(slotEndMs).toISOString(),
      remainingSeconds,
      demo:             demoAlwaysOn,
      message:          demoAlwaysOn ? "QR 시연용 조회 가능" : "QR 조회 가능",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ available: false, message: "QR 조회 실패" });
  }
});

// ─── 토스페이 결제 확인 + 티켓 발급 ──────────────────────────
router.post("/toss/confirm", requireAuth, requireVerifiedDidForWallet, async (req, res) => {
  const {
    paymentKey, orderId, amount,
    walletAddress, gameId, stadium, grade, block, seats,
    pointDiscount,
    bookingMode, priorityEntryId,
  } = req.body;

  if (!paymentKey || !orderId || !amount) {
    return res.status(400).json({ success: false, message: "paymentKey, orderId, amount는 필수입니다" });
  }
  if (!walletAddress || !gameId || !grade || !block || !Array.isArray(seats) || seats.length === 0) {
    return res.status(400).json({ success: false, message: "티켓 정보가 누락되었습니다" });
  }

  const verifiedWalletAddress = req.verifiedWalletAddress || String(walletAddress).toLowerCase();
  const isPriorityMode = bookingMode === 'priority';
  let priorityEntry = null;
  let priorityRaffleNftId = '';

  // 1-a. 예매 마감 체크 (경기 시작 후 1시간까지)
  const [[gameDeadlineRow]] = await _pool.query(
    `SELECT DATE_FORMAT(game_date, '%Y-%m-%d') AS game_date,
            TIME_FORMAT(game_time, '%H:%i:%s') AS game_time,
            booking_open_at
       FROM games
      WHERE id = ?`,
    [gameId]
  );
  if (!gameDeadlineRow) {
    return res.status(404).json({ success: false, message: '경기 정보를 찾을 수 없습니다' });
  }
  if (!isWithinGamePlus1h(gameDeadlineRow.game_date, gameDeadlineRow.game_time)) {
    return res.status(400).json({ success: false, message: '예매 마감 시간이 지났습니다 (경기 시작 1시간 이후 예매 불가)' });
  }

  if (!isPriorityMode && gameDeadlineRow.booking_open_at && new Date(gameDeadlineRow.booking_open_at).getTime() > Date.now()) {
    return res.status(400).json({ success: false, message: '아직 일반 예매 오픈 전입니다' });
  }

  if (isPriorityMode) {
    if (seats.length !== 1) {
      return res.status(400).json({ success: false, message: '우선 예매는 1인 1좌석만 선택할 수 있습니다' });
    }
    if (!priorityEntryId) {
      return res.status(400).json({ success: false, message: '우선 예매 응모 당첨 정보가 필요합니다' });
    }
    if (!seats.every((seat) => isPrioritySeat(block, seat))) {
      return res.status(400).json({ success: false, message: '우선 예매는 T1/T2 5열 2~6번 좌석만 선택할 수 있습니다' });
    }

    const [[entry]] = await _pool.query(
      `SELECT *
         FROM game_raffle_entries
        WHERE id = ? AND user_id = ? AND game_id = ? AND status = 'won'
        LIMIT 1`,
      [priorityEntryId, req.user.user_id, gameId],
    );
    if (!entry) {
      return res.status(403).json({ success: false, message: '우선 예매 당첨 내역을 찾을 수 없습니다' });
    }
    priorityEntry = entry;

    const raffleNftIds = parseJsonArray(entry.raffle_nft_ids);
    if (raffleNftIds.length > 0) {
      const placeholders = raffleNftIds.map(() => '?').join(',');
      const [[winnerNft]] = await _pool.query(
        `SELECT id FROM raffle_nfts
          WHERE id IN (${placeholders}) AND user_id = ? AND game_id = ? AND status = 'WINNER'
          LIMIT 1`,
        [...raffleNftIds, req.user.user_id, gameId],
      );
      priorityRaffleNftId = winnerNft?.id || raffleNftIds[0];
    }
  }

  // 1-b. pointDiscount 서버 검증 (결제 호출 전)
  const pd = Number(pointDiscount || 0);
  if (pd < 0) {
    return res.status(400).json({ success: false, message: '포인트 할인 금액은 0 이상이어야 합니다' });
  }

  // 결제 금액은 항상 서버 가격표로 다시 계산한다.
  // 예전에는 pd > 0 일 때만 검사했고 기준값마저 클라이언트가 보낸 price 였다 —
  // 즉 요청 본문만 고쳐도 좌석을 원하는 가격에 살 수 있었다.
  let expectedAmount;
  try {
    expectedAmount = computeOrderAmount({ gradeName: grade, seats, pointDiscount: pd });
    assertAmountMatches(amount, expectedAmount);
  } catch (priceErr) {
    if (priceErr instanceof PriceValidationError) {
      console.warn(`[toss] 금액 검증 실패: user=${req.user.user_id} ${priceErr.message}`);
      return res.status(400).json({ success: false, message: priceErr.message });
    }
    throw priceErr;
  }

  if (pd > 0) {
    const memberJoined = await membershipService.isMembershipActive(_pool, req.user.user_id);
    if (!memberJoined) {
      return res.status(400).json({ success: false, message: '멤버십 가입 후 포인트를 사용할 수 있습니다' });
    }
    // Fabric에서 실제 보유 포인트 잔액 조회
    const userDidHash = fabricService.hashDid(verifiedWalletAddress);
    let pointBalance = 0;
    try {
      const result = await fabricService.getPointBalance({ userDidHash });
      pointBalance = result.balance ?? 0;
    } catch (_) {}
    if (pointBalance < pd) {
      return res.status(400).json({
        success: false,
        message: `포인트 잔액 부족 (보유: ${pointBalance}P, 요청: ${pd}P)`,
      });
    }
  }

  const [[gameRow]] = await _pool.query(
    `SELECT DATE_FORMAT(game_date, '%Y-%m-%d') AS game_date, home_team, away_team FROM games WHERE id = ?`,
    [gameId]
  );

  // 같은 결제로 이미 발권이 끝났으면 그 결과를 그대로 돌려준다.
  // 결제 성공 페이지에서 새로고침하면 이 요청이 한 번 더 오는데,
  // 멱등 처리가 없으면 좌석 확보 단계에서 "이미 예매된 좌석"으로 막혀
  // 정상 결제한 사용자에게 실패 화면이 보인다.
  // (market/toss-confirm, ticketResale/toss-confirm 과 같은 방식)
  const [alreadyIssued] = await _pool.query(
    `SELECT id, token_id, ticket_tx_hash
       FROM tickets
      WHERE payment_key = ? AND wallet_address = ?
        AND status NOT IN ('refunded','cancelled')`,
    [paymentKey, verifiedWalletAddress],
  );
  if (alreadyIssued.length > 0) {
    console.log(`[toss] 이미 처리된 결제 재요청: paymentKey=${paymentKey}, 티켓 ${alreadyIssued.length}장`);
    return res.json({
      success: true,
      alreadyProcessed: true,
      data: {
        tickets: alreadyIssued.map((ticket) => ({
          ticketId: ticket.id,
          tokenId:  ticket.token_id,
          txHash:   ticket.ticket_tx_hash,
        })),
        paymentKey,
      },
    });
  }

  // 1-c. 좌석을 먼저 확보한 뒤에 결제를 승인한다.
  // 순서를 뒤집은 이유: 결제부터 하면 "돈은 빠져나갔는데 좌석은 남이 가져간" 상태가 만들어진다.
  // 좌석 확보는 한 트랜잭션이라 일부만 잡히는 경우도 없다.
  let ticketRows;
  try {
    const reserved = await purchaseTickets(_pool, {
      walletAddress: verifiedWalletAddress,
      gameId, stadium, grade, block,
      seats: seats.map((seat) => ({
        row: seat.row, seatNumber: seat.seatNumber, price: seat.price,
      })),
    });
    ticketRows = reserved.map((ticket, index) => ({
      ticketId:   ticket.id,
      row:        ticket.row,
      seatNumber: ticket.seatNumber,
      price:      ticket.price,
      isFirst:    index === 0,
    }));
  } catch (seatErr) {
    if (seatErr instanceof SeatAlreadyTakenError) {
      return res.status(409).json({ success: false, message: seatErr.message });
    }
    console.error('[toss/confirm] 좌석 확보 실패:', seatErr);
    return res.status(500).json({ success: false, message: '좌석 확보에 실패했습니다' });
  }

  // 좌석을 잡은 뒤 실패하는 모든 경로에서 좌석을 반드시 되돌려 놓는다.
  const releaseSeats = async (reason) => {
    const ids = ticketRows.map((t) => t.ticketId);
    if (ids.length === 0) return;
    try {
      await _pool.query(
        `UPDATE tickets SET status = 'cancelled' WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids,
      );
      console.log(`[toss] 좌석 반환 완료 (${reason}): ${ids.join(', ')}`);
    } catch (releaseErr) {
      // 여기서 조용히 삼키면 "결제는 취소됐는데 좌석은 잠긴 채" 남는다. 반드시 남긴다.
      console.error(`[toss] ⚠️ 좌석 반환 실패 (${reason}) — 수동 확인 필요: ${ids.join(', ')}`, releaseErr);
    }
  };

  // 1-d. 토스페이 결제 승인 (좌석 확보 성공 이후)
  let tossResult;
  try {
    tossResult = await confirmPayment({ paymentKey, orderId, amount: expectedAmount.payable });
  } catch (payErr) {
    await releaseSeats('결제 승인 오류');
    console.error('[toss/confirm] 결제 승인 중 오류:', payErr);
    return res.status(502).json({ success: false, message: '결제 승인 중 오류가 발생했습니다' });
  }
  if (!tossResult.success) {
    await releaseSeats('결제 승인 실패');
    return res.status(400).json({ success: false, message: `결제 승인 실패: ${tossResult.message}` });
  }

  const ticketResults = [];

  try {
    // Phase 1: 확보한 좌석에 결제 정보 기록
    for (const ticket of ticketRows) {
      await _pool.query(
        "UPDATE tickets SET payment_key = ?, point_discount = ? WHERE id = ?",
        [paymentKey, ticket.isFirst ? pd : 0, ticket.ticketId]
      );
    }

    // Phase 2: NFT 발급 처리
    // Toss 예매 완료 흐름에서는 사용자의 MetaMask 트랜잭션 승인을 요청하지 않는다.
    // Toss 테스트 결제(tgen_)나 TOSS_MODE=mock에서는 실제 온체인 tx.wait()를 기다리지 않고
    // 로컬 mock token/txHash를 발급해 성공 화면 전환을 빠르게 한다.
    let mintedResults;
    try {
      mintedResults = [];
      const useMockMint = req.user?.role === 'admin' ||
        isMockTossPayment(paymentKey) ||
        !isOnChainMintingEnabled(['MINTER_PRIVATE_KEY', 'TICKET_NFT_ADDRESS']);
      for (const { ticketId, row, seatNumber, price } of ticketRows) {
        const mintResult = useMockMint
          ? createMockTicketMintResult(ticketId)
          : await mintTicketOnChain(verifiedWalletAddress, {
              gameId:        String(gameId),
              gameDate:      gameRow?.game_date || '',
              homeTeam:      gameRow?.home_team || '',
              awayTeam:      gameRow?.away_team || '',
              seatSection:   `${block}-${row}-${seatNumber}`,
              originalPrice: Number(price),
            });
        await _pool.query(
          "UPDATE tickets SET token_id = ?, ticket_tx_hash = ? WHERE id = ?",
          [mintResult.tokenId, mintResult.txHash, ticketId]
        );
        mintedResults.push({ ticketId, tokenId: mintResult.tokenId, txHash: mintResult.txHash });
      }
    } catch (mintErr) {
      console.error('[toss] NFT 민팅 실패:', mintErr.message);
      await cancelPayment({
        paymentKey,
        cancelReason: 'NFT 발급 실패로 인한 자동 환불',
        cancelAmount: expectedAmount.payable,
      }).catch((cancelErr) => {
        console.error('[toss] ⚠️ 자동 환불 실패 — 수동 환불 필요:', paymentKey, cancelErr?.message);
      });
      await releaseSeats('NFT 발급 실패');
      return res.status(500).json({ success: false, message: 'NFT 발급 실패로 자동 환불되었습니다' });
    }

    ticketResults.push(...mintedResults);

    // Phase 3: Fabric 등록 병렬 처리 (nonce 없음 — 동시 실행 안전, 실패해도 무시)
    const { v4: uuidv4 } = require('uuid');
    await Promise.allSettled(
      mintedResults.map(({ ticketId, tokenId }, i) => {
        const { row, seatNumber, price } = ticketRows[i];
        return fabricService.registerTicket({
          ticketId,
          tokenId:       String(tokenId || '0'),
          gameId:        String(gameId),
          seatId:        `${block}-${row}-${seatNumber}`,
          walletAddress: verifiedWalletAddress,
          price:         Number(price),
          purchaseType:  'PRIMARY',
          gameDate:      gameRow?.game_date || '',
        }).then(async () => {
          const userDidHash = fabricService.hashDid ? fabricService.hashDid(verifiedWalletAddress) : '';
          if (userDidHash) {
            const reservationId = uuidv4();
            await fabricService.createReservation({
              reservationId,
              userDidHash,
              gameId: String(gameId),
              raffleNftId: priorityRaffleNftId || '',
              isPriority: isPriorityMode,
            });
            await fabricService.confirmReservation({ reservationId, ticketId });
          }
        }).catch(fabErr => {
          console.error('[toss] Fabric 등록 실패 (무시):', fabErr.message);
        });
      })
    );

    const seatList = ticketRows.map(t => `${block}블록 ${t.row}열 ${t.seatNumber}번`).join(', ');
    console.log(`[toss] 예매 완료: ${gameRow?.home_team} vs ${gameRow?.away_team} | ${seats.length}석 (${seatList}) | ${amount}원 | 지갑: ${verifiedWalletAddress.slice(0, 10)}...`);

    // 포인트 차감
    if (pointDiscount > 0 && ticketResults.length > 0) {
      try {
        const userDidHash = fabricService.hashDid(verifiedWalletAddress);
        await fabricService.usePointForTicket({
          userDidHash,
          ticketId: ticketResults[0].ticketId,
          pointAmount: Number(pointDiscount),
        });
        await membershipService.recordPointEvent(_pool, {
          userId: req.user.user_id,
          walletAddress: verifiedWalletAddress,
          eventType: 'POINT_USE_TICKET',
          reason: '티켓 예매 포인트 할인',
          amount: -Math.abs(Number(pointDiscount)),
          metadata: { ticketId: ticketResults[0].ticketId, gameId, seats: seats.length },
        });
        console.log(`[toss] 포인트 차감 완료: ${pointDiscount}P (티켓 ${ticketResults[0].ticketId})`);
      } catch (pointErr) {
        console.error('[toss] 포인트 차감 실패 (무시):', pointErr.message);
      }
    }

    if (isPriorityMode && priorityEntry && ticketResults.length > 0) {
      try {
        if (priorityRaffleNftId) {
          await fabricService.useRaffleNFT({
            raffleNftId: priorityRaffleNftId,
            userDidHash: fabricService.hashDid(verifiedWalletAddress),
            ticketId: ticketResults[0].ticketId,
          });
        }
        await _pool.query(
          `UPDATE game_raffle_entries SET status = 'used', used_at = NOW() WHERE id = ?`,
          [priorityEntry.id],
        );
        const raffleNftIds = parseJsonArray(priorityEntry.raffle_nft_ids);
        if (raffleNftIds.length > 0) {
          const placeholders = raffleNftIds.map(() => '?').join(',');
          await _pool.query(
            `UPDATE raffle_nfts SET status = 'USED', updated_at = NOW()
              WHERE id IN (${placeholders}) AND user_id = ?`,
            [...raffleNftIds, req.user.user_id],
          );
        }
        console.log(`[toss] 우선 예매 응모권 사용 완료: entry=${priorityEntry.id}, ticket=${ticketResults[0].ticketId}`);
        await notificationService.recordNotification(_pool, {
          userId: req.user.user_id,
          category: 'RAFFLE',
          title: '우선 예매권 사용 완료',
          message: `${gameRow?.home_team} vs ${gameRow?.away_team} 우선 예매가 완료되었습니다.`,
          metadata: { entryId: priorityEntry.id, ticketId: ticketResults[0].ticketId, gameId, raffleNftId: priorityRaffleNftId },
        });
      } catch (priorityErr) {
        console.error('[toss] 우선 예매 응모권 사용 처리 실패 (무시):', priorityErr.message);
      }
    }

    await notificationService.recordNotification(_pool, {
      userId: req.user.user_id,
      category: 'TRADE',
      title: isPriorityMode ? '우선 예매 완료' : '티켓 예매 완료',
      message: `${gameRow?.home_team} vs ${gameRow?.away_team} ${seats.length}석 예매가 완료되었습니다.`,
      amount: Number(amount),
      metadata: { gameId, paymentKey, ticketIds: ticketResults.map((ticket) => ticket.ticketId), seats: ticketRows },
    });

    res.json({ success: true, data: { tickets: ticketResults, paymentKey } });

  } catch (err) {
    console.error('[toss/confirm]', err);
    // 티켓 발급이 끝나지 않은 채 떨어졌으면 결제와 좌석을 모두 되돌린다.
    if (ticketResults.length === 0) {
      await cancelPayment({
        paymentKey,
        cancelReason: '티켓 저장 실패로 인한 자동 환불',
        cancelAmount: expectedAmount.payable,
      }).catch((cancelErr) => {
        console.error('[toss] ⚠️ 자동 환불 실패 — 수동 환불 필요:', paymentKey, cancelErr?.message);
      });
      await releaseSeats('티켓 저장 실패');
    }
    res.status(500).json({ success: false, message: err.message || '티켓 발급 실패' });
  }
});

module.exports = { router, setPool };
