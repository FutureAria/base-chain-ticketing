require('dotenv').config();

// 필수 보안 환경변수 미설정 시 서버 시작 거부
for (const key of ['JWT_SECRET', 'QR_SECRET']) {
  if (!process.env[key]) {
    console.error(`[startup] 필수 환경변수 미설정: ${key} — server/.env 를 확인하세요`);
    process.exit(1);
  }
}

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const mysql = require("mysql2/promise");
const { initDB, DB_NAME, DB_CONFIG } = require("./db/init");

const authMiddleware = require('./middleware/auth');
const authRoute      = require('./routes/auth');
const walletRoute    = require('./routes/wallet');
const didRoute       = require('./routes/did');
const ticketRoute    = require('./routes/ticket');
const myTicketRoute  = require('./routes/myTicket');
const noticeRoute    = require('./routes/notice');
const combineRoute   = require('./routes/combine');
const marketRoute       = require('./routes/market');
const ticketResaleRoute = require('./routes/ticketResale');
const txHistoryRoute    = require('./routes/txHistory');
const entryRoute        = require('./routes/entryRoutes');
const pointRoute        = require('./routes/pointRoutes');
const refundRoute       = require('./routes/refundRoutes');
const settlementRoute   = require('./routes/settlementRoutes');
const raffleRoute       = require('./routes/raffleRoutes');
const exchangeRoute     = require('./routes/exchange');
const notificationRoute = require('./routes/notificationRoutes');
const mockFabric        = require('./services/fabricBridge');
const { ensureRuntimeSchema } = require('./services/schemaGuardService');

const app = express();

// 프록시(Caddy) 뒤에서 실제 클라이언트 IP를 얻기 위해 필요.
// 레이트 리밋이 모든 요청을 프록시 IP 하나로 묶어버리는 것을 막는다.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

const configuredFrontendOrigins = (process.env.FRONTEND_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// 개발 편의를 위한 느슨한 허용(ngrok 와일드카드, 사설 IP 대역)은 기본적으로 꺼 둔다.
// 누구나 등록할 수 있는 도메인을 credentials 허용 목록에 넣어두면 그 자체가 구멍이다.
const allowDevOrigins = String(process.env.CORS_ALLOW_DEV_ORIGINS || '').toLowerCase() === 'true';

const staticAllowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...configuredFrontendOrigins,
]);

function isOriginAllowed(origin) {
  // 같은 출처 요청·서버 간 호출은 Origin 헤더가 없다.
  if (!origin) return true;
  if (staticAllowedOrigins.has(origin)) return true;
  if (!allowDevOrigins) return false;
  return (
    origin.endsWith('.ngrok-free.app') ||
    origin.endsWith('.ngrok-free.dev') ||
    origin.endsWith('.ngrok.io') ||
    /^https?:\/\/(192\.168\.|10\.|172\.)/.test(origin)
  );
}

app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) return callback(null, true);
    callback(new Error('CORS 차단: ' + origin));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// ─── 레이트 리밋 ──────────────────────────────────────────
// 로그인·비밀번호 재설정처럼 무차별 대입이 통하는 지점을 좁게 막는다.
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_AUTH_MAX ?? 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.' },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_GENERAL_MAX ?? 300),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.' },
});

app.use('/api', generalLimiter);

/**
 * async 라우트 핸들러를 감싸 거부(rejection)를 Express 에러 처리로 넘긴다.
 * Express 4는 async 함수의 거부를 스스로 잡지 못해서, 감싸지 않으면
 * DB 오류 한 번에 unhandledRejection 으로 프로세스가 통째로 죽는다.
 */
const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

let pool;

// ─── 서버 시작 ────────────────────────────────────────────

async function start() {
  await initDB();

  pool = mysql.createPool({ ...DB_CONFIG, database: DB_NAME });
  await ensureRuntimeSchema(pool);

  // 테스트/시연 계정 Fabric 포인트/멤버십 사전 세팅 (DB 실제 지갑 주소 기준)
  const seedWallets = ['0x15f7cc396e4C66296cE92225830e24f491941Fc2'];
  try {
    const [rows] = await pool.query(
      `SELECT wallet_address
         FROM user_wallets
        WHERE user_id IN ('test_user', 'practice_admin')`
    );
    for (const row of rows) {
      if (row?.wallet_address && !seedWallets.includes(row.wallet_address)) {
        seedWallets.push(row.wallet_address);
      }
    }
  } catch (_) {}
  for (const walletAddress of seedWallets) {
    await mockFabric.seedUser({
      walletAddress,
      pointBalance: walletAddress.toLowerCase() === '0x9999999999999999999999999999999999999999' ? 990000 : 10000,
      totalEarned: walletAddress.toLowerCase() === '0x9999999999999999999999999999999999999999' ? 990000 : 10000,
      totalUsed: 0,
      entryCount: walletAddress.toLowerCase() === '0x9999999999999999999999999999999999999999' ? 99 : 7,
      joined: true,
      grade: walletAddress.toLowerCase() === '0x9999999999999999999999999999999999999999' ? 'GOLD' : 'SILVER',
    });
  }
  console.log(`[Seed] 포인트 시드 완료: ${seedWallets.join(', ')}`);

  // pool 주입
  authMiddleware.setPool(pool);
  authRoute.setPool(pool);
  walletRoute.setPool(pool);
  didRoute.setPool(pool);
  ticketRoute.setPool(pool);
  myTicketRoute.setPool(pool);
  noticeRoute.setPool(pool);
  combineRoute.setPool(pool);
  marketRoute.setPool(pool);
  ticketResaleRoute.setPool(pool);
  txHistoryRoute.setPool(pool);
  entryRoute.setPool(pool);
  pointRoute.setPool(pool);
  refundRoute.setPool(pool);
  settlementRoute.setPool(pool);
  raffleRoute.setPool(pool);
  exchangeRoute.setPool(pool);
  notificationRoute.setPool(pool);

  // ─── 신규 라우트 ────────────────────────────────────────
  app.use('/api/auth',       authLimiter, authRoute.router);
  app.use('/api/wallet',     walletRoute.router);
  app.use('/api/did',        didRoute.router);
  app.use('/api/tickets',    ticketRoute.router);
  app.use('/api/my-tickets', myTicketRoute.router);
  app.use('/api/notices',    noticeRoute.router);
  app.use('/api',            combineRoute.router);
  app.use('/api/market',        marketRoute.router);
  app.use('/api/ticket-resale', ticketResaleRoute.router);
  app.use('/api/tx-history',   txHistoryRoute.router);
  app.use('/api/entry',        entryRoute.router);
  app.use('/api/points',       pointRoute.router);
  app.use('/api/refunds',      refundRoute.router);
  app.use('/api/settlements',  settlementRoute.router);
  app.use('/api/raffle',       raffleRoute.router);
  app.use('/api/exchange',      exchangeRoute.router);
  app.use('/api/notifications', notificationRoute.router);

  // 업로드 이미지 정적 서빙
  app.use('/uploads', express.static(require('path').join(__dirname, 'uploads')));

  // ─── 기존 게시판 라우트 ─────────────────────────────────

  app.get("/api/users", asyncHandler(async (req, res) => {
    const [rows] = await pool.query("SELECT user_id, nickname FROM users");
    res.json(rows);
  }));

  app.get("/api/posts", asyncHandler(async (req, res) => {
    // 페이지네이션 없이 전체 글을 내려주면 글이 쌓일수록 응답이 무한정 커진다.
    const limit  = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const [[{ total }]] = await pool.query(
      "SELECT COUNT(*) AS total FROM posts WHERE deleted = FALSE"
    );
    const [rows] = await pool.query(
      `SELECT p.*, u.nickname AS author_nickname
       FROM posts p
       JOIN users u ON p.user_id = u.user_id
       WHERE p.deleted = FALSE
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    // 기존 프론트가 배열을 그대로 기대하므로 배열을 유지하고, 총 개수는 헤더로 알린다.
    res.set('X-Total-Count', String(total));
    res.json(rows);
  }));

  app.get("/api/posts/:id", asyncHandler(async (req, res) => {
    await pool.query(
      "UPDATE posts SET view_count = view_count + 1 WHERE post_id = ?",
      [req.params.id]
    );
    const [[row]] = await pool.query(
      `SELECT p.*, u.nickname AS author_nickname
       FROM posts p JOIN users u ON p.user_id = u.user_id
       WHERE p.post_id = ? AND p.deleted = FALSE`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: "게시글 없음" });
    res.json(row);
  }));

  app.post("/api/posts", authMiddleware.requireAuth, asyncHandler(async (req, res) => {
    const { title, excerpt, content, category } = req.body;
    if (!title || !content || !category)
      return res.status(400).json({ error: "필수 항목 누락" });

    const [result] = await pool.query(
      "INSERT INTO posts (user_id, title, excerpt, content, category) VALUES (?, ?, ?, ?, ?)",
      [req.user.user_id, title, excerpt ?? "", content, category]
    );
    const [[newPost]] = await pool.query(
      "SELECT * FROM posts WHERE post_id = ?",
      [result.insertId]
    );
    res.status(201).json(newPost);
  }));

  app.put("/api/posts/:id", authMiddleware.requireAuth, asyncHandler(async (req, res) => {
    const { title, excerpt, content, category } = req.body;
    const [[post]] = await pool.query(
      "SELECT user_id FROM posts WHERE post_id = ? AND deleted = FALSE",
      [req.params.id]
    );
    if (!post) return res.status(404).json({ error: "게시글 없음" });
    if (post.user_id !== req.user.user_id) {
      return res.status(403).json({ error: "본인 글만 수정할 수 있습니다." });
    }

    await pool.query(
      "UPDATE posts SET title=?, excerpt=?, content=?, category=? WHERE post_id=?",
      [title, excerpt, content, category, req.params.id]
    );
    const [[updated]] = await pool.query(
      "SELECT * FROM posts WHERE post_id = ?",
      [req.params.id]
    );
    res.json(updated);
  }));

  app.delete("/api/posts/:id", authMiddleware.requireAuth, asyncHandler(async (req, res) => {
    const [[post]] = await pool.query(
      "SELECT user_id FROM posts WHERE post_id = ? AND deleted = FALSE",
      [req.params.id]
    );
    if (!post) return res.status(404).json({ error: "게시글 없음" });
    if (post.user_id !== req.user.user_id) {
      return res.status(403).json({ error: "본인 글만 삭제할 수 있습니다." });
    }

    await pool.query(
      "UPDATE posts SET deleted = TRUE WHERE post_id = ?",
      [req.params.id]
    );
    res.json({ ok: true });
  }));

  app.post("/api/posts/:id/like", authMiddleware.requireAuth, asyncHandler(async (req, res) => {
    const user_id = req.user.user_id;
    const postId = req.params.id;

    const [[existing]] = await pool.query(
      "SELECT * FROM post_likes WHERE user_id=? AND post_id=?",
      [user_id, postId]
    );

    if (existing) {
      await pool.query("DELETE FROM post_likes WHERE user_id=? AND post_id=?", [user_id, postId]);
      await pool.query("UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE post_id=?", [postId]);
      res.json({ liked: false });
    } else {
      await pool.query("INSERT INTO post_likes (user_id, post_id) VALUES (?, ?)", [user_id, postId]);
      await pool.query("UPDATE posts SET like_count = like_count + 1 WHERE post_id=?", [postId]);
      res.json({ liked: true });
    }
  }));

  app.get("/api/posts/:id/comments", asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT c.*, u.nickname AS author_nickname
       FROM comments c JOIN users u ON c.user_id = u.user_id
       WHERE c.post_id = ? AND c.deleted = FALSE
       ORDER BY c.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  }));

  app.post("/api/posts/:id/comments", authMiddleware.requireAuth, asyncHandler(async (req, res) => {
    const { content, parent_id } = req.body;
    if (!content)
      return res.status(400).json({ error: "필수 항목 누락" });

    const [result] = await pool.query(
      "INSERT INTO comments (post_id, user_id, content, parent_id) VALUES (?, ?, ?, ?)",
      [req.params.id, req.user.user_id, content, parent_id ?? null]
    );
    const [[newComment]] = await pool.query(
      "SELECT * FROM comments WHERE comment_id = ?",
      [result.insertId]
    );
    res.status(201).json(newComment);
  }));

  app.delete("/api/comments/:id", authMiddleware.requireAuth, asyncHandler(async (req, res) => {
    const [[comment]] = await pool.query(
      "SELECT user_id FROM comments WHERE comment_id = ? AND deleted = FALSE",
      [req.params.id]
    );
    if (!comment) return res.status(404).json({ error: "댓글 없음" });
    if (comment.user_id !== req.user.user_id) {
      return res.status(403).json({ error: "본인 댓글만 삭제할 수 있습니다." });
    }

    await pool.query(
      "UPDATE comments SET deleted = TRUE WHERE comment_id = ?",
      [req.params.id]
    );
    res.json({ ok: true });
  }));

  app.get("/api/comments", asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT c.*, u.nickname AS author_nickname
       FROM comments c JOIN users u ON c.user_id = u.user_id
       WHERE c.deleted = FALSE
       ORDER BY c.created_at ASC`
    );
    res.json(rows);
  }));

  // ─── 헬스 체크 ──────────────────────────────────────────
  app.get('/api/health', asyncHandler(async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true, uptime: Math.round(process.uptime()), time: new Date().toISOString() });
  }));

  // ─── 404 ────────────────────────────────────────────────
  app.use('/api', (req, res) => {
    res.status(404).json({ error: '존재하지 않는 API 경로입니다.' });
  });

  // ─── 전역 에러 핸들러 ────────────────────────────────────
  // 여기가 없으면 라우트에서 새어나온 오류가 그대로 프로세스를 죽인다.
  // 마지막에 등록해야 앞선 모든 라우트의 오류를 받는다.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    const status = Number(err?.statusCode) || 500;
    if (status >= 500) {
      console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    } else {
      console.warn(`[warn] ${req.method} ${req.originalUrl} — ${err?.message}`);
    }

    // 500대 오류의 내부 메시지는 클라이언트에 그대로 노출하지 않는다.
    res.status(status).json({
      error: status >= 500 ? '서버 오류가 발생했습니다.' : (err?.message || '잘못된 요청입니다.'),
    });
  });

  app.listen(process.env.PORT || 4000, () => {
    console.log(`🚀 서버 실행 중: http://localhost:${process.env.PORT || 4000}`);
  });
}

// 어디서도 잡지 못한 오류를 마지막으로 기록한다.
// 로그 한 줄 없이 프로세스가 사라지는 상황을 막기 위함이다.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] 처리되지 않은 Promise 거부:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[fatal] 처리되지 않은 예외:', err);
  process.exit(1);
});

start().catch((err) => {
  console.error("❌ 서버 시작 실패:", err);
  process.exit(1);
});
