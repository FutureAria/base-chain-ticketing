const express = require("express");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
let _pool;

function setPool(pool) {
  _pool = pool;
}

// DB 티켓 → 공통 포맷 변환
function normalizeTicket(t) {
  const gameDate = t.game_date ? String(t.game_date).slice(0, 10) : "";
  const gameTime = t.game_time ? String(t.game_time).slice(0, 8) : "00:00:00";
  const displayStatus = t.display_status || t.status; // 'confirmed' | 'used' | 'expired'

  return {
    ticketId:   t.id,
    matchName:  t.game_name ?? t.game_id,
    stadium:    [t.stadium_name, t.location].filter(Boolean).join(", "),
    matchTime:  gameDate ? `${gameDate}T${gameTime}` : null,
    seatInfo:   `${t.grade ?? ""} ${t.block ?? ""}블록 ${t.row_num ?? ""}열 ${t.seat_number ?? ""}번`.trim(),
    gate:       t.grade ?? "",
    status:     displayStatus === "confirmed" ? "ACTIVE" : "USED",
    rawStatus:  String(displayStatus || "").toUpperCase(),
    ticketCode: `GAME-${String(t.id).slice(0, 8).toUpperCase()}`,
    price:      t.price,
  };
}

// ─── 가장 임박한 티켓 1장 ─────────────────────────────────
router.get("/nearest", requireAuth, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const [[walletRow]] = await _pool.query(
      "SELECT wallet_address FROM user_wallets WHERE user_id = ?",
      [userId],
    );
    if (!walletRow?.wallet_address) {
      return res.json({ success: true, data: null });
    }

    const [rows] = await _pool.query(
      `SELECT t.*,
         CONCAT(g.home_team, ' vs ', g.away_team) AS game_name,
         DATE_FORMAT(g.game_date, '%Y-%m-%d') AS game_date,
         g.game_time,
         s.name AS stadium_name, s.location,
         CASE
           WHEN t.status = 'confirmed'
             AND TIMESTAMP(g.game_date, g.game_time) + INTERVAL 2 HOUR < NOW()
             THEN 'expired'
           ELSE t.status
         END AS display_status
       FROM tickets t
       LEFT JOIN games g    ON t.game_id    = g.id
       LEFT JOIN stadiums s ON g.stadium_id = s.id
       WHERE t.wallet_address = ?
         AND t.status = 'confirmed'
         AND TIMESTAMP(g.game_date, g.game_time) >= NOW()
       ORDER BY g.game_date ASC, g.game_time ASC
       LIMIT 1`,
      [walletRow.wallet_address],
    );

    res.json({ success: true, data: rows.length ? normalizeTicket(rows[0]) : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "티켓 조회 실패" });
  }
});

// ─── 내 입장권 목록 (auth 기반) ──────────────────────────
router.get("/", requireAuth, async (req, res) => {
  try {
    const userId = req.user.user_id;
    const [[walletRow]] = await _pool.query(
      "SELECT wallet_address FROM user_wallets WHERE user_id = ?",
      [userId],
    );
    if (!walletRow?.wallet_address) {
      return res.json({ success: true, data: [] });
    }

    const [rows] = await _pool.query(
      `SELECT t.*,
         CONCAT(g.home_team, ' vs ', g.away_team) AS game_name,
         DATE_FORMAT(g.game_date, '%Y-%m-%d') AS game_date,
         g.game_time,
         s.name AS stadium_name, s.location,
         CASE
           WHEN t.status = 'confirmed'
             AND TIMESTAMP(g.game_date, g.game_time) + INTERVAL 2 HOUR < NOW()
             THEN 'expired'
           ELSE t.status
         END AS display_status
       FROM tickets t
       LEFT JOIN games g    ON t.game_id    = g.id
       LEFT JOIN stadiums s ON g.stadium_id = s.id
       WHERE t.wallet_address = ?
         AND t.status IN ('confirmed', 'used')
       ORDER BY t.booked_at DESC`,
      [walletRow.wallet_address],
    );

    res.json({ success: true, data: rows.map(normalizeTicket) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "내 입장권 조회 실패" });
  }
});

// ─── 티켓 상세 ────────────────────────────────────────────
router.get("/detail/:ticketId", requireAuth, async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user.user_id;

    const [[walletRow]] = await _pool.query(
      "SELECT wallet_address FROM user_wallets WHERE user_id = ?",
      [userId],
    );

    const [rows] = await _pool.query("SELECT * FROM tickets WHERE id = ?", [ticketId]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "티켓을 찾을 수 없습니다" });
    }

    if (rows[0].wallet_address !== walletRow?.wallet_address) {
      return res.status(403).json({ success: false, message: "접근 권한이 없습니다" });
    }

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "티켓 상세 조회 실패" });
  }
});

module.exports = { router, setPool };
