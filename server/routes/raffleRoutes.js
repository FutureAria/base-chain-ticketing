'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');
const fabricService = require('../services/fabricBridge');
const membershipService = require('../services/membershipService');
const notificationService = require('../services/notificationService');

const router = express.Router();

// 추첨 생성·실행은 운영자만 할 수 있어야 한다.
// 검사가 없으면 응모자가 자기 응모권만 들어간 시점에 직접 추첨을 실행해
// 확정 당첨을 만들 수 있다.
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: '관리자만 추첨을 진행할 수 있습니다.' });
  }
  next();
}
let _pool;
function setPool(pool) { _pool = pool; }

const TIER_MAX_TICKETS = { '베이직': 1, '브론즈': 1, '실버': 2, '골드': 2 };
const RAFFLE_APPLY_WINDOW_MS = Math.max(1, Number(process.env.RAFFLE_APPLY_WINDOW_HOURS || 24)) * 60 * 60 * 1000;
const RAFFLE_RESULT_DELAY_MS = Math.max(1, Number(process.env.RAFFLE_RESULT_DELAY_SECONDS || 10)) * 1000;
const DEFAULT_DEMO_ALWAYS_OPEN_GAME_IDS = ['PRESENTATION_RAFFLE_ALWAYS_ON'];
const DEFAULT_PRIORITY_WINNER_CAP = 10; // T1/T2 각 5좌석

function priorityWinnerCap() {
  const value = Number(process.env.PRIORITY_RAFFLE_WINNER_CAP || DEFAULT_PRIORITY_WINNER_CAP);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_PRIORITY_WINNER_CAP;
}

function getDemoAlwaysOpenGameIds() {
  return String(process.env.RAFFLE_DEMO_ALWAYS_OPEN_GAME_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function isDemoAlwaysOpenGame(gameId) {
  return new Set([...DEFAULT_DEMO_ALWAYS_OPEN_GAME_IDS, ...getDemoAlwaysOpenGameIds()]).has(gameId);
}

function raffleApplyCloseAt(openAt) {
  if (!openAt) return null;
  return new Date(new Date(openAt).getTime() + RAFFLE_APPLY_WINDOW_MS);
}

function raffleResultAt(appliedAt) {
  if (!appliedAt) return null;
  return new Date(new Date(appliedAt).getTime() + RAFFLE_RESULT_DELAY_MS);
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

async function ensureDraw(conn, gameId) {
  const [[existing]] = await conn.query(
    `SELECT * FROM draws
      WHERE game_id = ? AND status <> 'COMPLETED'
      ORDER BY created_at DESC
      LIMIT 1`,
    [gameId],
  );
  if (existing) {
    console.log(`[raffle] 기존 추첨 사용: game=${gameId}, draw=${existing.id}, status=${existing.status}`);
    return existing;
  }

  const [[game]] = await conn.query(
    'SELECT raffle_winners_count FROM games WHERE id = ?',
    [gameId],
  );
  const drawId = uuidv4();
  const winnerCount = Math.min(Number(game?.raffle_winners_count ?? 5), priorityWinnerCap());
  await conn.query(
    `INSERT INTO draws (id, game_id, status, winner_count, total_entries)
     VALUES (?, ?, 'PENDING', ?, 0)`,
    [drawId, gameId, winnerCount],
  );
  try {
    await fabricService.createDraw({ drawId, gameId, winnerCount });
    console.log(`[raffle] 체인코드 추첨 생성 완료: game=${gameId}, draw=${drawId}, winners=${winnerCount}`);
  } catch (err) {
    console.error('[raffleRoutes] Fabric createDraw 실패 (무시):', err.message);
  }
  return { id: drawId, game_id: gameId, status: 'PENDING', winner_count: winnerCount, total_entries: 0 };
}

async function enterDrawWithRecoveredRaffleNft({ raffleNftId, userDidHash, drawId, gameId }) {
  try {
    return await fabricService.enterDraw({ raffleNftId, userDidHash, drawId });
  } catch (err) {
    if (!String(err.message || '').includes('RAFFLE_NFT_NOT_FOUND')) throw err;
    await fabricService.registerRaffleNFT({ raffleNftId, userDidHash, gameId });
    return fabricService.enterDraw({ raffleNftId, userDidHash, drawId });
  }
}

async function recoverDrawEntriesOnFabric(conn, { drawId, gameId, entryIds }) {
  if (!entryIds.length) return;
  const placeholders = entryIds.map(() => '?').join(',');
  const [nfts] = await conn.query(
    `SELECT id, user_did_hash
       FROM raffle_nfts
      WHERE id IN (${placeholders})`,
    entryIds,
  );
  for (const nft of nfts) {
    try {
      await fabricService.registerRaffleNFT({ raffleNftId: nft.id, userDidHash: nft.user_did_hash, gameId });
    } catch (err) {
      if (!String(err.message || '').includes('RAFFLE_NFT_ALREADY_EXISTS')) throw err;
    }
    try {
      await fabricService.enterDraw({ raffleNftId: nft.id, userDidHash: nft.user_did_hash, drawId });
    } catch (err) {
      if (!String(err.message || '').includes('RAFFLE_NFT_ALREADY_USED')) throw err;
    }
  }
}

async function runRaffleDraw(gameId) {
  const conn = await _pool.getConnection();
  try {
    console.log(`[raffle] 자동 추첨 확인 시작: game=${gameId}`);
    await conn.beginTransaction();
    const [entries] = await conn.query(
      `SELECT * FROM game_raffle_entries
        WHERE game_id = ? AND status = 'applied'
        FOR UPDATE`,
      [gameId],
    );
    if (entries.length === 0) {
      await conn.query(`UPDATE draws SET status = 'COMPLETED', executed_at = NOW() WHERE id = ?`, [draw.id]);
      await conn.commit();
      console.log(`[raffle] 자동 추첨 완료: game=${gameId}, draw=${draw.id}, 응모자 없음`);
      return;
    }

    let [[draw]] = await conn.query(
      `SELECT d.*, g.raffle_winners_count
         FROM draws d
         JOIN games g ON g.id = d.game_id
        WHERE d.game_id = ? AND d.status <> 'COMPLETED'
        ORDER BY d.created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [gameId],
    );
    if (!draw) {
      draw = await ensureDraw(conn, gameId);
      console.log(`[raffle] 완료된 추첨 이후 새 응모 감지: game=${gameId}, draw=${draw.id}`);
    }

    const entryNfts = entries.map((entry) => ({
      entry,
      ids: parseJsonArray(entry.raffle_nft_ids),
    }));
    const entryIds = entryNfts.flatMap((item) => item.ids);
    if (entryIds.length === 0) {
      await conn.rollback();
      return;
    }

    let winnerIds = [];
    try {
      console.log(`[raffle] 체인코드 추첨 실행 요청: game=${gameId}, draw=${draw.id}, entries=${entryIds.length}`);
      const fabricResult = await fabricService.executeDraw({ drawId: draw.id, entryIds });
      winnerIds = Array.isArray(fabricResult?.winners) ? fabricResult.winners : [];
    } catch (err) {
      if (err.message && err.message.includes('DRAW_NOT_FOUND')) {
        await fabricService.createDraw({ drawId: draw.id, gameId, winnerCount: draw.winner_count });
        await recoverDrawEntriesOnFabric(conn, { drawId: draw.id, gameId, entryIds });
        console.log(`[raffle] 체인코드 추첨 재생성 후 실행: game=${gameId}, draw=${draw.id}`);
        const fabricResult = await fabricService.executeDraw({ drawId: draw.id, entryIds });
        winnerIds = Array.isArray(fabricResult?.winners) ? fabricResult.winners : [];
      } else {
        throw err;
      }
    }
    winnerIds = winnerIds.slice(0, priorityWinnerCap());

    const winnerSet = new Set(winnerIds);
    const resultNotifications = [];
    for (const { entry, ids } of entryNfts) {
      const winningId = ids.find((id) => winnerSet.has(id));
      const status = winningId ? 'won' : 'lost';
      await conn.query(`UPDATE game_raffle_entries SET status = ? WHERE id = ?`, [status, entry.id]);
      resultNotifications.push({ userId: entry.user_id, entryId: entry.id, status, winningId });

      if (winningId) {
        await conn.query(
          `UPDATE raffle_nfts SET status = 'WINNER', updated_at = NOW() WHERE id = ?`,
          [winningId],
        );
        const losingIds = ids.filter((id) => id !== winningId);
        if (losingIds.length > 0) {
          const placeholders = losingIds.map(() => '?').join(',');
          await conn.query(
            `UPDATE raffle_nfts SET status = 'LOST', updated_at = NOW() WHERE id IN (${placeholders})`,
            losingIds,
          );
        }
      } else {
        const placeholders = ids.map(() => '?').join(',');
        await conn.query(
          `UPDATE raffle_nfts SET status = 'LOST', updated_at = NOW() WHERE id IN (${placeholders})`,
          ids,
        );
      }
    }

    await conn.query(`UPDATE draws SET status = 'COMPLETED', executed_at = NOW() WHERE id = ?`, [draw.id]);
    await conn.query(
      `INSERT INTO fabric_events (id, event_name, game_id, payload_json)
       VALUES (?, 'DRAW_EXECUTED', ?, ?)`,
      [uuidv4(), gameId, JSON.stringify({ drawId: draw.id, winners: winnerIds })],
    );
    await conn.commit();
    for (const item of resultNotifications) {
      await notificationService.recordNotification(_pool, {
        userId: item.userId,
        category: 'RAFFLE',
        title: item.status === 'won' ? '응모 당첨' : '응모 결과 확인',
        message: item.status === 'won'
          ? '응모에 당첨되었습니다. 우선 예매 화면에서 1좌석을 예매할 수 있습니다.'
          : '응모 결과가 공개되었습니다. 아쉽게도 이번 응모는 당첨되지 않았습니다.',
        metadata: { gameId, drawId: draw.id, entryId: item.entryId, status: item.status, raffleNftId: item.winningId || null },
      });
    }
    console.log(`[raffle] 추첨 완료: game=${gameId}, draw=${draw.id}, winners=${winnerIds.length}, entries=${entries.length}, winnerNfts=${winnerIds.join(',') || '-'}`);
  } catch (err) {
    await conn.rollback();
    console.error('[raffle] 추첨 실패:', err.message);
    throw err;
  } finally {
    conn.release();
  }
}

// ─── POST /api/raffle/register ────────────────────────────
// 포인트 교환 후 호출 → Fabric에 응모권 NFT 등록 + DB raffle_nfts 저장
// Body: { walletAddress, gameId? }
router.post('/register', requireAuth, async (req, res) => {
  try {
    const { walletAddress, gameId } = req.body;
    if (!walletAddress) return res.status(400).json({ error: 'walletAddress 필요' });

    const [[wallet]] = await _pool.query(
      'SELECT user_id FROM user_wallets WHERE wallet_address = ?',
      [walletAddress]
    );
    if (!wallet) return res.status(404).json({ error: '등록된 지갑 없음' });

    const userDidHash  = fabricService.hashDid(walletAddress);
    const raffleNftId  = uuidv4();

    await fabricService.registerRaffleNFT({ raffleNftId, userDidHash, gameId: gameId || '' });

    await _pool.query(
      `INSERT INTO raffle_nfts
         (id, user_id, wallet_address, user_did_hash, game_id, status, source, expires_at)
       VALUES (?, ?, ?, ?, ?, 'ISSUED', 'POINT_EXCHANGE', ?)`,
      [raffleNftId, wallet.user_id, walletAddress, userDidHash, gameId || null, membershipService.addDays(new Date(), 60)]
    );

    await _pool.query(
      `INSERT INTO fabric_events (id, event_name, user_did_hash, payload_json)
       VALUES (?, 'RAFFLE_NFT_REGISTERED', ?, ?)`,
      [uuidv4(), userDidHash, JSON.stringify({ raffleNftId, gameId })]
    );

    res.json({ success: true, data: { raffleNftId, status: 'ISSUED' } });
  } catch (err) {
    console.error('[raffleRoutes] POST /register:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/raffle/my ───────────────────────────────────
// 내 응모권 NFT 목록 조회 (DB 기준)
// Query: walletAddress
router.get('/my', requireAuth, async (req, res) => {
  try {
    const { walletAddress } = req.query;
    if (!walletAddress) return res.status(400).json({ error: 'walletAddress 필요' });

    const [rows] = await _pool.query(
      `SELECT r.*, d.game_id AS draw_game_id,
              DATE_FORMAT(g.game_date,'%Y-%m-%d') AS game_date,
              g.home_team, g.away_team
       FROM raffle_nfts r
       LEFT JOIN draws d ON r.draw_id = d.id
       LEFT JOIN games g ON COALESCE(r.game_id, d.game_id) = g.id
       WHERE r.wallet_address = ?
       ORDER BY r.issued_at DESC`,
      [walletAddress]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[raffleRoutes] GET /my:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/raffle/draws ────────────────────────────────
// 전체 추첨 목록 조회 (진행 중 draws)
router.get('/draws', async (req, res) => {
  try {
    const [rows] = await _pool.query(
      `SELECT d.*,
              DATE_FORMAT(g.game_date,'%Y-%m-%d') AS game_date,
              g.home_team, g.away_team, g.stadium_id,
              COUNT(r.id) AS entry_count
       FROM draws d
       JOIN games g ON d.game_id = g.id
       LEFT JOIN raffle_nfts r ON r.draw_id = d.id AND r.status = 'ENTERED'
       GROUP BY d.id
       ORDER BY d.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[raffleRoutes] GET /draws:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/raffle/draws/:gameId ────────────────────────
// 특정 경기 추첨 조회
router.get('/draws/:gameId', async (req, res) => {
  try {
    const [rows] = await _pool.query(
      `SELECT d.*,
              DATE_FORMAT(g.game_date,'%Y-%m-%d') AS game_date,
              g.home_team, g.away_team
       FROM draws d
       JOIN games g ON d.game_id = g.id
       WHERE d.game_id = ?
       ORDER BY d.created_at DESC`,
      [req.params.gameId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[raffleRoutes] GET /draws/:gameId:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/raffle/draw/create ─────────────────────────
// (관리자용) 추첨 생성
// Body: { gameId, winnerCount }
router.post('/draw/create', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { gameId, winnerCount } = req.body;
    if (!gameId) return res.status(400).json({ error: 'gameId 필요' });

    const drawId = uuidv4();
    await _pool.query(
      `INSERT INTO draws (id, game_id, status, winner_count) VALUES (?, ?, 'PENDING', ?)`,
      [drawId, gameId, winnerCount || 10]
    );
    await fabricService.createDraw({ drawId, gameId, winnerCount: winnerCount || 10 });

    res.json({ success: true, data: { drawId, gameId, status: 'PENDING' } });
  } catch (err) {
    console.error('[raffleRoutes] POST /draw/create:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/raffle/enter ───────────────────────────────
// 응모권 NFT로 추첨 참여
// Body: { raffleNftId, walletAddress, drawId }
router.post('/enter', requireAuth, async (req, res) => {
  const conn = await _pool.getConnection();
  try {
    const { raffleNftId, walletAddress, drawId } = req.body;
    if (!raffleNftId || !walletAddress || !drawId) {
      return res.status(400).json({ error: '필수 항목 누락 (raffleNftId, walletAddress, drawId)' });
    }

    const [[nft]] = await _pool.query(
      'SELECT * FROM raffle_nfts WHERE id = ? AND wallet_address = ?',
      [raffleNftId, walletAddress]
    );
    if (!nft) return res.status(404).json({ error: '응모권 NFT를 찾을 수 없습니다' });
    if (nft.status !== 'ISSUED') return res.status(400).json({ error: `이미 사용된 응모권: ${nft.status}` });

    const [[draw]] = await _pool.query('SELECT * FROM draws WHERE id = ?', [drawId]);
    if (!draw) return res.status(404).json({ error: '추첨을 찾을 수 없습니다' });
    if (draw.status === 'COMPLETED') return res.status(400).json({ error: '이미 완료된 추첨입니다' });

    await conn.beginTransaction();

    await conn.query(
      "UPDATE raffle_nfts SET status = 'ENTERED', draw_id = ?, updated_at = NOW() WHERE id = ?",
      [drawId, raffleNftId]
    );
    await conn.query(
      "UPDATE draws SET total_entries = total_entries + 1 WHERE id = ?",
      [drawId]
    );

    const userDidHash = fabricService.hashDid(walletAddress);
    await enterDrawWithRecoveredRaffleNft({ raffleNftId, userDidHash, drawId, gameId: draw.game_id });

    await conn.query(
      `INSERT INTO fabric_events (id, event_name, user_did_hash, payload_json)
       VALUES (?, 'RAFFLE_ENTERED', ?, ?)`,
      [uuidv4(), userDidHash, JSON.stringify({ raffleNftId, drawId })]
    );

    await conn.commit();
    res.json({ success: true, data: { raffleNftId, drawId, status: 'ENTERED' } });
  } catch (err) {
    await conn.rollback();
    console.error('[raffleRoutes] POST /enter:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ─── POST /api/raffle/draw/execute ────────────────────────
// (관리자용) 추첨 실행
// Body: { drawId }
router.post('/draw/execute', requireAuth, requireAdmin, async (req, res) => {
  const conn = await _pool.getConnection();
  try {
    const { drawId } = req.body;
    if (!drawId) return res.status(400).json({ error: 'drawId 필요' });

    const [[draw]] = await _pool.query('SELECT * FROM draws WHERE id = ?', [drawId]);
    if (!draw) return res.status(404).json({ error: '추첨을 찾을 수 없습니다' });
    if (draw.status === 'COMPLETED') return res.status(400).json({ error: '이미 완료된 추첨입니다' });

    // 참여한 응모권 목록 조회
    const [enteredNfts] = await _pool.query(
      "SELECT id FROM raffle_nfts WHERE draw_id = ? AND status = 'ENTERED'",
      [drawId]
    );
    const entryIds = enteredNfts.map(n => n.id);
    if (entryIds.length === 0) {
      return res.status(400).json({ error: '참여한 응모권이 없습니다' });
    }

    // Fabric 원장에 draw가 없으면 (DB 시드 데이터 등) 먼저 생성
    let fabricResult;
    try {
      fabricResult = await fabricService.executeDraw({ drawId, entryIds });
    } catch (execErr) {
      if (execErr.message && execErr.message.includes('DRAW_NOT_FOUND')) {
        await fabricService.createDraw({ drawId: draw.id, gameId: draw.game_id, winnerCount: draw.winner_count });
        fabricResult = await fabricService.executeDraw({ drawId, entryIds });
      } else {
        throw execErr;
      }
    }

    await conn.beginTransaction();

    // winners → WINNER, others → LOST
    if (fabricResult.winners && fabricResult.winners.length > 0) {
      const placeholders = fabricResult.winners.map(() => '?').join(',');
      await conn.query(
        `UPDATE raffle_nfts SET status = 'WINNER', updated_at = NOW()
         WHERE id IN (${placeholders}) AND draw_id = ?`,
        [...fabricResult.winners, drawId]
      );
    }
    await conn.query(
      `UPDATE raffle_nfts SET status = 'LOST', updated_at = NOW()
       WHERE draw_id = ? AND status = 'ENTERED'`,
      [drawId]
    );
    await conn.query(
      "UPDATE draws SET status = 'COMPLETED', executed_at = NOW() WHERE id = ?",
      [drawId]
    );

    await conn.query(
      `INSERT INTO fabric_events (id, event_name, game_id, payload_json)
       VALUES (?, 'DRAW_EXECUTED', ?, ?)`,
      [uuidv4(), draw.game_id, JSON.stringify(fabricResult)]
    );

    await conn.commit();
    res.json({ success: true, data: fabricResult });
  } catch (err) {
    await conn.rollback();
    console.error('[raffleRoutes] POST /draw/execute:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ─── GET /api/raffle/winners/:gameId ─────────────────────
// 특정 경기 당첨자 목록 조회
router.get('/winners/:gameId', async (req, res) => {
  try {
    // 당첨자 명단은 공개하되, 필요한 항목만 내보낸다.
    // 예전에는 r.* 를 그대로 돌려줘서 user_id·wallet_address·user_did_hash 까지 노출됐다.
    // 닉네임과 지갑 주소가 함께 공개되면 신원 연결이 가능하고,
    // 응모권 id + 지갑 주소 조합은 아래 /use 를 노리는 데 그대로 쓰인다.
    const [rows] = await _pool.query(
      `SELECT u.nickname, r.status, r.updated_at
       FROM raffle_nfts r
       JOIN users u ON r.user_id = u.user_id
       JOIN draws d ON r.draw_id = d.id
       WHERE d.game_id = ? AND r.status IN ('WINNER','USED')
       ORDER BY r.updated_at DESC`,
      [req.params.gameId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[raffleRoutes] GET /winners/:gameId:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/raffle/use ─────────────────────────────────
// 당첨된 응모권으로 우선 예매 확정 (티켓 구매 후 호출)
// Body: { raffleNftId, walletAddress, ticketId }
router.post('/use', requireAuth, async (req, res) => {
  try {
    const { raffleNftId, walletAddress, ticketId } = req.body;
    if (!raffleNftId || !walletAddress || !ticketId) {
      return res.status(400).json({ error: '필수 항목 누락' });
    }

    // 소유권은 로그인 사용자 기준으로 확인한다.
    // 요청 본문의 walletAddress 만 믿으면, 당첨자 명단에서 얻은 지갑 주소와 응모권 id 로
    // 남의 당첨 응모권을 사용 처리(소각)할 수 있다.
    const [[nft]] = await _pool.query(
      'SELECT * FROM raffle_nfts WHERE id = ? AND user_id = ?',
      [raffleNftId, req.user.user_id]
    );
    if (!nft) return res.status(404).json({ error: '응모권 NFT 없음' });
    if (String(nft.wallet_address || '').toLowerCase() !== String(walletAddress).toLowerCase()) {
      return res.status(403).json({ error: '응모권에 연결된 지갑이 아닙니다.' });
    }
    if (nft.status !== 'WINNER') return res.status(400).json({ error: `당첨 상태가 아님: ${nft.status}` });

    const userDidHash = fabricService.hashDid(walletAddress);
    await fabricService.useRaffleNFT({ raffleNftId, userDidHash, ticketId });

    await _pool.query(
      "UPDATE raffle_nfts SET status = 'USED', updated_at = NOW() WHERE id = ?",
      [raffleNftId]
    );

    res.json({ success: true, data: { raffleNftId, status: 'USED', ticketId } });
  } catch (err) {
    console.error('[raffleRoutes] POST /use:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/raffle/apply ───────────────────────────────
// Body: { gameId, ticketsUsed }
router.post('/apply', requireAuth, async (req, res) => {
  const userId = req.user.user_id;
  const { gameId } = req.body;
  const ticketsUsed = Math.min(Math.max(1, Number(req.body.ticketsUsed || 1)), 2);
  if (!gameId) return res.status(400).json({ error: '경기 ID가 필요합니다.' });

  const conn = await _pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[game]] = await conn.query(
      `SELECT id, raffle_open_at, raffle_winners_count FROM games WHERE id = ?`,
      [gameId],
    );
    if (!game) {
      await conn.rollback();
      return res.status(404).json({ error: '경기를 찾을 수 없습니다.' });
    }
    const isDemoAlwaysOpen = isDemoAlwaysOpenGame(game.id);
    if (!game.raffle_open_at && !isDemoAlwaysOpen) {
      await conn.rollback();
      return res.status(400).json({ error: '이 경기는 응모가 지원되지 않습니다.' });
    }

    const openAt = game.raffle_open_at ? new Date(game.raffle_open_at) : new Date(0);
    const closeAt = isDemoAlwaysOpen ? null : raffleApplyCloseAt(game.raffle_open_at);
    const now = new Date();
    if (!isDemoAlwaysOpen && now < openAt) {
      await conn.rollback();
      return res.status(400).json({ error: '아직 응모 시간이 아닙니다.' });
    }
    if (!isDemoAlwaysOpen && closeAt && now >= closeAt) {
      await conn.rollback();
      return res.status(400).json({ error: '응모 시간이 마감되었습니다.' });
    }

    const membership = req.user?.role === 'admin'
      ? { joined: true, tier: '골드' }
      : await membershipService.getUserMembership(conn, userId);
    if (!membership.joined) {
      await conn.rollback();
      return res.status(400).json({ error: '멤버십 가입 후 응모할 수 있습니다.' });
    }
    const tier = membership.tier;
    const maxTickets = TIER_MAX_TICKETS[tier] || 1;
    if (ticketsUsed > maxTickets) {
      await conn.rollback();
      return res.status(400).json({ error: `${tier} 등급은 경기당 최대 ${maxTickets}장까지 응모할 수 있습니다.` });
    }

    const [[existing]] = await conn.query(
      `SELECT id, status FROM game_raffle_entries
        WHERE user_id = ? AND game_id = ? AND status <> 'lost'
        ORDER BY applied_at DESC
        LIMIT 1`,
      [userId, gameId],
    );
    if (existing) {
      await conn.rollback();
      return res.status(400).json({ error: '이미 응모한 경기입니다.' });
    }
    const [[retryableLost]] = await conn.query(
      `SELECT id FROM game_raffle_entries
        WHERE user_id = ? AND game_id = ? AND status = 'lost'
        ORDER BY applied_at DESC
        LIMIT 1
        FOR UPDATE`,
      [userId, gameId],
    );

    const [[wallet]] = await conn.query(
      `SELECT wallet_address FROM user_wallets WHERE user_id = ?`,
      [userId],
    );
    if (!wallet?.wallet_address) {
      await conn.rollback();
      return res.status(400).json({ error: '지갑 연결 후 응모할 수 있습니다.' });
    }

    const [nfts] = await conn.query(
      `SELECT id, user_did_hash
         FROM raffle_nfts
        WHERE user_id = ? AND status = 'ISSUED'
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY issued_at ASC
        LIMIT ? FOR UPDATE`,
      [userId, ticketsUsed],
    );
    if (nfts.length < ticketsUsed) {
      await conn.rollback();
      return res.status(400).json({ error: `응모권이 부족합니다. 필요 ${ticketsUsed}장, 보유 ${nfts.length}장` });
    }

    const draw = await ensureDraw(conn, gameId);
    const nftIds = nfts.map((nft) => nft.id);
    const appliedAt = new Date();
    const resultAt = raffleResultAt(appliedAt);
    console.log(`[raffle] 응모 접수: user=${userId}, game=${gameId}, draw=${draw.id}, tickets=${ticketsUsed}, nftIds=${nftIds.join(',')}, resultAt=${resultAt?.toISOString()}`);
    const placeholders = nftIds.map(() => '?').join(',');
    await conn.query(
      `UPDATE raffle_nfts
          SET status = 'ENTERED', draw_id = ?, game_id = ?, updated_at = NOW()
        WHERE id IN (${placeholders})`,
      [draw.id, gameId, ...nftIds],
    );
    if (retryableLost) {
      await conn.query(
        `UPDATE game_raffle_entries
            SET tickets_used = ?,
                raffle_nft_ids = ?,
                status = 'applied',
                applied_at = NOW(),
                used_at = NULL
          WHERE id = ?`,
        [ticketsUsed, JSON.stringify(nftIds), retryableLost.id],
      );
    } else {
      await conn.query(
        `INSERT INTO game_raffle_entries (user_id, game_id, tickets_used, raffle_nft_ids, status)
         VALUES (?, ?, ?, ?, 'applied')`,
        [userId, gameId, ticketsUsed, JSON.stringify(nftIds)],
      );
    }
    await conn.query(
      `UPDATE draws SET total_entries = total_entries + ? WHERE id = ?`,
      [ticketsUsed, draw.id],
    );

    for (const nft of nfts) {
      await enterDrawWithRecoveredRaffleNft({
        raffleNftId: nft.id,
        userDidHash: nft.user_did_hash || fabricService.hashDid(wallet.wallet_address),
        drawId: draw.id,
        gameId,
      });
      console.log(`[raffle] 체인코드 응모 참여 완료: nft=${nft.id}, draw=${draw.id}`);
    }

    await conn.query(
      `INSERT INTO fabric_events (id, event_name, user_did_hash, game_id, payload_json)
       VALUES (?, 'RAFFLE_ENTERED', ?, ?, ?)`,
      [uuidv4(), fabricService.hashDid(wallet.wallet_address), gameId, JSON.stringify({ drawId: draw.id, nftIds, ticketsUsed })],
    );
    await conn.commit();
    await notificationService.recordNotification(_pool, {
      userId,
      category: 'RAFFLE',
      title: '응모 참여 완료',
      message: `${ticketsUsed}장의 응모권으로 응모가 완료되었습니다. 결과는 약 10초 후 확인할 수 있습니다.`,
      amount: ticketsUsed,
      metadata: { gameId, drawId: draw.id, raffleNftIds: nftIds, resultAt: resultAt?.toISOString() },
    });
    res.json({ success: true, message: '응모 완료', raffle_close_at: raffleResultAt(appliedAt)?.toISOString() ?? null });
  } catch (err) {
    await conn.rollback();
    // 같은 사용자가 동시에 두 번 응모하면 uq_game_raffle_user 제약에 걸린다.
    // 이건 정상적으로 막힌 것이므로 500 이 아니라 안내로 돌려준다.
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: '이미 응모한 경기입니다.' });
    }
    console.error('[raffle/apply]', err);
    res.status(500).json({ error: err.message || '응모 처리 중 오류가 발생했습니다.' });
  } finally {
    conn.release();
  }
});

// ─── GET /api/raffle/my-entries ───────────────────────────
router.get('/my-entries', requireAuth, async (req, res) => {
  try {
    const fetchEntries = () => _pool.query(
      `SELECT e.id, e.game_id, e.status, e.tickets_used, e.applied_at,
              g.home_team, g.away_team,
              DATE_FORMAT(g.game_date, '%Y-%m-%d') AS game_date,
              TIME_FORMAT(g.game_time, '%H:%i') AS game_time,
              s.name AS stadium_name,
              DATE_FORMAT(g.raffle_open_at, '%Y-%m-%dT%H:%i:%s+09:00') AS raffle_open_at,
              DATE_FORMAT(g.booking_open_at, '%Y-%m-%dT%H:%i:%s+09:00') AS booking_open_at,
              g.raffle_winners_count
         FROM game_raffle_entries e
         JOIN games g ON e.game_id = g.id
         JOIN stadiums s ON g.stadium_id = s.id
        WHERE e.user_id = ?
        ORDER BY e.applied_at DESC`,
      [req.user.user_id],
    );

    const [rows] = await fetchEntries();
    const now = new Date();
    const gamesToDraw = new Set();
    for (const row of rows) {
      if (row.status !== 'applied') continue;
      const closeAt = raffleResultAt(row.applied_at);
      if (closeAt && now >= closeAt) gamesToDraw.add(row.game_id);
    }
    for (const gameId of gamesToDraw) {
      await runRaffleDraw(gameId);
    }
    const [finalRows] = gamesToDraw.size > 0 ? await fetchEntries() : [rows];
    const visibleNow = new Date();
    const data = finalRows.map((row) => {
      const closeAt = raffleResultAt(row.applied_at);
      const resultVisible = closeAt ? visibleNow >= closeAt : true;
      return {
        ...row,
        status: resultVisible ? row.status : 'applied',
        result_visible: resultVisible,
        raffle_close_at: closeAt ? closeAt.toISOString() : null,
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    console.error('[raffle/my-entries]', err);
    res.status(500).json({ error: err.message || '응모 내역 조회 실패' });
  }
});

// ─── GET /api/raffle/:raffleNftId ────────────────────────
// 단건 조회
router.get('/:raffleNftId', async (req, res) => {
  try {
    const [[row]] = await _pool.query(
      `SELECT r.*, g.home_team, g.away_team,
              DATE_FORMAT(g.game_date,'%Y-%m-%d') AS game_date
       FROM raffle_nfts r
       LEFT JOIN games g ON r.game_id = g.id
       WHERE r.id = ?`,
      [req.params.raffleNftId]
    );
    if (!row) return res.status(404).json({ error: '응모권 NFT 없음' });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[raffleRoutes] GET /:raffleNftId:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, setPool };
