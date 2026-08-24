const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const fabricService = require('../services/fabricBridge');
const membershipService = require('../services/membershipService');
const notificationService = require('../services/notificationService');
const { grantPresentationDemoAssetsIfEligible } = require('../services/presentationDemoService');

const router = express.Router();
let _pool;
let loginTrackingReady = false;

function setPool(pool) {
  _pool = pool;
}

const jwtSecret = () => process.env.JWT_SECRET;

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || null;
}

async function ensureLoginTrackingColumns() {
  if (loginTrackingReady) return;
  const [columns] = await _pool.query(`SHOW COLUMNS FROM users`);
  const existing = new Set(columns.map((column) => column.Field));
  const alters = [];
  if (!existing.has('last_login_at')) {
    alters.push(`ADD COLUMN last_login_at DATETIME DEFAULT NULL AFTER updated_at`);
  }
  if (!existing.has('last_login_ip')) {
    alters.push(`ADD COLUMN last_login_ip VARCHAR(100) DEFAULT NULL AFTER last_login_at`);
  }
  if (!existing.has('last_login_user_agent')) {
    alters.push(`ADD COLUMN last_login_user_agent VARCHAR(255) DEFAULT NULL AFTER last_login_ip`);
  }
  if (alters.length > 0) {
    await _pool.query(`ALTER TABLE users ${alters.join(', ')}`);
  }
  loginTrackingReady = true;
}

async function recordLogin(req, userId) {
  try {
    await ensureLoginTrackingColumns();
    await _pool.query(
      `UPDATE users
          SET last_login_at = NOW(),
              last_login_ip = ?,
              last_login_user_agent = ?
        WHERE user_id = ?`,
      [
        getClientIp(req),
        String(req.headers['user-agent'] || '').slice(0, 255) || null,
        userId,
      ],
    );
  } catch (err) {
    console.error('[auth] 로그인 추적 저장 실패:', err.message);
  }
}

function requireAdminUser(req, res) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    return false;
  }
  return true;
}

function tierRewardRows(membership, claimedTiers = new Set()) {
  const currentIdx = membership.joined ? membershipService.TIER_ORDER.indexOf(membership.tier) : -1;
  return membershipService.TIER_ORDER
    .filter((tier) => tier !== '베이직')
    .map((tier) => {
      const idx = membershipService.TIER_ORDER.indexOf(tier);
      const reward = membershipService.TIER_REWARDS[tier] || { cards: 0, raffles: 0 };
      return {
        tier,
        requiredCount: membershipService.TIER_REQUIREMENTS[tier] || 0,
        rewardCards: reward.cards,
        rewardRaffles: reward.raffles,
        eligible: membership.joined && idx <= currentIdx,
        claimed: claimedTiers.has(tier),
      };
    });
}

async function claimTierReward({ userId, walletAddress, tier }) {
  const [[existingReward]] = await _pool.query(
    `SELECT id FROM membership_tier_rewards WHERE user_id = ? AND tier = ?`,
    [userId, tier],
  );
  if (existingReward) {
    const err = new Error('이미 해당 티어 혜택을 수령했습니다.');
    err.statusCode = 409;
    throw err;
  }

  const reward = membershipService.TIER_REWARDS[tier] || { cards: 0, raffles: 0 };
  const awardedCards = await membershipService.issueRewardCards(_pool, userId, reward.cards, tier);
  const issuedRaffleNftIds = await membershipService.issueRaffleNfts({
    pool: _pool,
    fabricService,
    userId,
    walletAddress,
    count: reward.raffles,
    source: 'TIER_REWARD',
    expiresAt: membershipService.addDays(new Date(), 60),
  });

  await _pool.query(
    `INSERT INTO membership_tier_rewards
       (id, user_id, tier, reward_cards, reward_raffles, card_payload_json, raffle_nft_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      userId,
      tier,
      reward.cards,
      reward.raffles,
      JSON.stringify(awardedCards),
      JSON.stringify(issuedRaffleNftIds),
    ],
  );

  const rewardMessage = [
    reward.cards > 0 ? `실물 NFT ${reward.cards}장` : '',
    reward.raffles > 0 ? `응모권 ${reward.raffles}장` : '',
  ].filter(Boolean).join(', ');
  await notificationService.recordNotification(_pool, {
    userId,
    category: 'MEMBERSHIP',
    title: `${tier} 티어 혜택 수령 완료`,
    message: rewardMessage ? `${tier} 최초 혜택으로 ${rewardMessage}이 지급되었습니다.` : '티어 혜택 수령이 완료되었습니다.',
    metadata: { tier, rewardCards: reward.cards, rewardRaffles: reward.raffles, issuedRaffleNftIds },
  });
  if (issuedRaffleNftIds.length > 0) {
    await notificationService.recordNotification(_pool, {
      userId,
      category: 'RAFFLE',
      title: '응모권 획득',
      message: `${tier} 최초 혜택으로 응모권 ${issuedRaffleNftIds.length}장이 지급되었습니다.`,
      amount: issuedRaffleNftIds.length,
      metadata: { source: 'TIER_REWARD', tier, raffleNftIds: issuedRaffleNftIds },
    });
  }

  return { reward, awardedCards, issuedRaffleNftIds };
}

async function syncFabricMembershipTier({ walletAddress, tier }) {
  const userDidHash = fabricService.hashDid(walletAddress);
  const targetGrade = membershipService.toFabricTier(tier);
  try {
    await fabricService.tierUpMembership({ userDidHash, targetGrade });
  } catch (err) {
    if (err?.message !== 'MEMBERSHIP_REQUIRED') throw err;
    await fabricService.joinMembership({ userDidHash });
    await fabricService.tierUpMembership({ userDidHash, targetGrade });
  }
}

// POST /api/auth/register — 회원가입
router.post('/register', async (req, res) => {
  try {
    const { email, password, nickname } = req.body;
    if (!email || !password || !nickname) {
      return res.status(400).json({ error: '이메일, 비밀번호, 닉네임을 모두 입력해주세요.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
    }

    const [[existing]] = await _pool.query(
      'SELECT user_id FROM users WHERE email = ?',
      [email]
    );
    if (existing) return res.status(400).json({ error: '이미 등록된 이메일입니다.' });

    const user_id = 'u_' + crypto.randomBytes(8).toString('hex');
    const password_hash = await bcrypt.hash(password, 10);

    await _pool.query(
      'INSERT INTO users (user_id, nickname, email, password_hash, login_type, role) VALUES (?, ?, ?, ?, ?, ?)',
      [user_id, nickname, email, password_hash, 'local', 'user']
    );

    const token = jwt.sign({ sub: user_id }, jwtSecret(), { expiresIn: '7d' });
    await recordLogin(req, user_id);
    console.log(`[auth] 회원가입: ${email} | 닉네임: ${nickname} | ID: ${user_id}`);
    res.status(201).json({ token, user: { user_id, nickname, email, role: 'user' } });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/auth/login — 로그인
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
    }

    const [[user]] = await _pool.query(
      'SELECT * FROM users WHERE email = ? AND login_type = ?',
      [email, 'local']
    );
    if (!user) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    // 비활성화된 계정은 로그인시키지 않는다.
    // 구글 로그인에는 이 검사가 있었는데 로컬 로그인에는 빠져 있었다.
    // 그래서 운영자가 계정을 비활성화해도 이메일·비밀번호로는 그대로 들어올 수 있었다.
    if (!user.is_active) {
      return res.status(403).json({ error: '비활성화된 계정입니다.' });
    }

    const token = jwt.sign({ sub: user.user_id }, jwtSecret(), { expiresIn: '7d' });
    await recordLogin(req, user.user_id);
    console.log(`[auth] 로그인: ${email} | ID: ${user.user_id}`);
    res.json({
      token,
      user: {
        user_id: user.user_id,
        nickname: user.nickname,
        email: user.email,
        role: user.role ?? 'user',
      },
    });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/auth/google — 구글 로그인 / 자동 회원가입
router.post('/google', async (req, res) => {
  try {
    const { access_token } = req.body;
    if (!access_token) return res.status(400).json({ error: 'access_token이 필요합니다.' });

    // Google userinfo API로 사용자 정보 검증
    const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!googleRes.ok) return res.status(401).json({ error: '구글 토큰 검증 실패' });

    const { sub: google_id, email, name, picture } = await googleRes.json();
    if (!google_id || !email) return res.status(401).json({ error: '구글 사용자 정보를 가져올 수 없습니다.' });

    // 1) google_id로 기존 사용자 조회
    let [[user]] = await _pool.query('SELECT * FROM users WHERE google_id = ?', [google_id]);

    if (!user) {
      // 2) 이메일로 기존 로컬 계정 확인 → 있으면 google_id 연결
      [[user]] = await _pool.query('SELECT * FROM users WHERE email = ?', [email]);

      if (user) {
        await _pool.query(
          'UPDATE users SET google_id = ?, profile_image = COALESCE(profile_image, ?) WHERE user_id = ?',
          [google_id, picture ?? null, user.user_id]
        );
        [[user]] = await _pool.query('SELECT * FROM users WHERE user_id = ?', [user.user_id]);
      } else {
        // 3) 신규 사용자 자동 회원가입
        const user_id = 'u_' + crypto.randomBytes(8).toString('hex');
        const nickname = name ?? email.split('@')[0];

        await _pool.query(
          'INSERT INTO users (user_id, nickname, email, google_id, login_type, profile_image) VALUES (?, ?, ?, ?, ?, ?)',
          [user_id, nickname, email, google_id, 'google', picture ?? null]
        );
        [[user]] = await _pool.query('SELECT * FROM users WHERE user_id = ?', [user_id]);
      }
    }

    if (!user.is_active) return res.status(403).json({ error: '비활성화된 계정입니다.' });

    const token = jwt.sign({ sub: user.user_id }, jwtSecret(), { expiresIn: '7d' });
    await recordLogin(req, user.user_id);
    try {
      await grantPresentationDemoAssetsIfEligible(_pool, user.user_id, fabricService);
    } catch (demoErr) {
      console.error('[auth/google] 시연용 자동 지급 실패:', demoErr.message);
    }
    console.log(`[auth] 구글 로그인: ${email} | ID: ${user.user_id}`);
    res.json({
      token,
      user: {
        user_id: user.user_id,
        nickname: user.nickname,
        email: user.email,
        profile_image: user.profile_image ?? null,
        role: user.role ?? 'user',
      },
    });
  } catch (err) {
    console.error('[google-auth]', err);
    res.status(500).json({ error: '구글 로그인에 실패했습니다.' });
  }
});

// POST /api/auth/find-id — 닉네임으로 이메일(아이디) 찾기
router.post('/find-id', async (req, res) => {
  try {
    const { nickname } = req.body;
    if (!nickname) return res.status(400).json({ error: '닉네임을 입력해주세요.' });

    const [[user]] = await _pool.query(
      "SELECT email FROM users WHERE nickname = ? AND login_type = 'local'",
      [nickname]
    );
    if (!user) return res.status(404).json({ error: '해당 닉네임으로 등록된 계정이 없습니다.' });

    // 이메일 마스킹: ex***@gmail.com
    const [local, domain] = user.email.split('@');
    const masked = local.slice(0, 2) + '*'.repeat(Math.max(local.length - 2, 3)) + '@' + domain;
    res.json({ maskedEmail: masked });
  } catch (err) {
    console.error('[find-id]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/auth/find-password — 비밀번호 재설정 요청
//
// 예전 구현은 이메일 주소만 받으면 그 자리에서 비밀번호를 바꾸고 새 비밀번호를 응답에 실어 보냈다.
// 남의 이메일만 알면 계정을 통째로 가져갈 수 있는 구조였다.
// 지금은 (1) 요청만으로는 아무것도 바꾸지 않고, (2) 1회용 토큰을 만들어 두고,
// (3) 계정 존재 여부가 응답으로 드러나지 않도록 언제나 같은 답을 돌려준다.
const RESET_TOKEN_TTL_MINUTES = 30;
const GENERIC_RESET_MESSAGE =
  '비밀번호 재설정 안내를 처리했습니다. 등록된 계정이라면 재설정 링크를 받게 됩니다.';

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issuePasswordResetToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

  // 이전에 발급했던 미사용 토큰은 무효화한다 (동시에 여러 개가 살아있지 않도록).
  await _pool.query(
    `UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL`,
    [userId],
  );
  await _pool.query(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
    [crypto.randomUUID(), userId, hashResetToken(token), expiresAt],
  );
  return { token, expiresAt };
}

router.post('/find-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim();
    if (!email) return res.status(400).json({ error: '이메일을 입력해주세요.' });

    const [[user]] = await _pool.query(
      "SELECT user_id FROM users WHERE email = ? AND login_type = 'local'",
      [email]
    );

    // 계정이 없어도 성공과 똑같은 응답을 준다 — 응답 차이로 가입 여부를 캐낼 수 없게.
    if (user) {
      const { token, expiresAt } = await issuePasswordResetToken(user.user_id);
      // TODO(메일 연동): 지금은 메일 발송 경로가 없어 서버 로그로만 토큰을 남긴다.
      // 운영에 올릴 때는 이 로그를 지우고 메일/SMS 발송으로 대체해야 한다.
      console.log(
        `[auth] 비밀번호 재설정 토큰 발급: user=${user.user_id} 만료=${expiresAt.toISOString()} token=${token}`
      );
    }

    res.json({ message: GENERIC_RESET_MESSAGE });
  } catch (err) {
    console.error('[find-password]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/auth/reset-password — 발급받은 토큰으로 새 비밀번호 설정
router.post('/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.newPassword || '');

    if (!token || !newPassword) {
      return res.status(400).json({ error: '토큰과 새 비밀번호를 모두 입력해주세요.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: '비밀번호는 8자 이상이어야 합니다.' });
    }

    const [[row]] = await _pool.query(
      `SELECT id, user_id
         FROM password_reset_tokens
        WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()`,
      [hashResetToken(token)],
    );
    if (!row) {
      return res.status(400).json({ error: '유효하지 않거나 만료된 토큰입니다.' });
    }

    const password_hash = await bcrypt.hash(newPassword, 10);
    await _pool.query('UPDATE users SET password_hash = ? WHERE user_id = ?', [password_hash, row.user_id]);
    await _pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?', [row.id]);

    console.log(`[auth] 비밀번호 재설정 완료: user=${row.user_id}`);
    res.json({ message: '비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.' });
  } catch (err) {
    console.error('[reset-password]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/auth/me — 내 정보 조회 (JWT 필요)
router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// GET /api/auth/admin/recent-logins — 관리자 최근 로그인 확인
router.get('/admin/recent-logins', requireAuth, async (req, res) => {
  try {
    if (!requireAdminUser(req, res)) return;
    await ensureLoginTrackingColumns();
    const [rows] = await _pool.query(
      `SELECT user_id, nickname, email, login_type, role,
              DATE_FORMAT(last_login_at, '%Y-%m-%dT%H:%i:%s+09:00') AS last_login_at,
              last_login_ip
         FROM users
        WHERE last_login_at IS NOT NULL
        ORDER BY last_login_at DESC
        LIMIT 50`,
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('[auth/admin/recent-logins]', err);
    res.status(500).json({ error: '최근 로그인 조회 실패' });
  }
});

// GET /api/auth/wallet — 내 등록 지갑 주소 조회 (JWT 필요)
router.get('/wallet', requireAuth, async (req, res) => {
  try {
    const [[row]] = await _pool.query(
      'SELECT wallet_address FROM user_wallets WHERE user_id = ?',
      [req.user.user_id]
    );
    res.json({ walletAddress: row?.wallet_address ?? null });
  } catch (err) {
    console.error('[auth/wallet]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/auth/membership — 가입 상태, 티어, 혜택, 월 응모권 조회
router.get('/membership', requireAuth, async (req, res) => {
  try {
    let summary = await membershipService.getMembershipSummary(_pool, req.user.user_id);
    const walletAddress = await membershipService.getVerifiedWallet(_pool, req.user.user_id);
    if (walletAddress) {
      await membershipService.syncFabricUserFromDb({
        pool: _pool,
        fabricService,
        userId: req.user.user_id,
        walletAddress,
      });
      const userDidHash = fabricService.hashDid(walletAddress);
      const fabricMembership = await fabricService.getMembership({ userDidHash });
      summary = membershipService.applyFabricMembershipToSummary(summary, fabricMembership);
    }
    res.json(summary);
  } catch (err) {
    console.error('[auth/membership]', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// GET /api/auth/tier-rewards — 현재 티어 기준 수령 가능한 최초 혜택 조회
router.get('/tier-rewards', requireAuth, async (req, res) => {
  try {
    const membership = await membershipService.getUserMembership(_pool, req.user.user_id);
    const [claimed] = await _pool.query(
      `SELECT tier FROM membership_tier_rewards WHERE user_id = ?`,
      [req.user.user_id],
    );
    res.json({
      success: true,
      currentTier: membership.tier,
      joined: membership.joined,
      rewards: tierRewardRows(membership, new Set(claimed.map((row) => row.tier))),
    });
  } catch (err) {
    console.error('[auth/tier-rewards]', err);
    res.status(500).json({ error: '티어 혜택 조회 실패' });
  }
});

// POST /api/auth/claim-tier-reward — 이미 달성한 티어 최초 혜택 수령
router.post('/claim-tier-reward', requireAuth, async (req, res) => {
  try {
    const tier = String(req.body.tier || '').trim();
    if (!tier || !membershipService.TIER_REWARDS[tier]) {
      return res.status(400).json({ error: '수령할 티어를 선택해주세요.' });
    }

    const membership = await membershipService.getUserMembership(_pool, req.user.user_id);
    if (!membership.joined) return res.status(400).json({ error: '멤버십 가입 후 티어 혜택을 받을 수 있습니다.' });

    const currentIdx = membershipService.TIER_ORDER.indexOf(membership.tier);
    const targetIdx = membershipService.TIER_ORDER.indexOf(tier);
    if (targetIdx < 0 || targetIdx > currentIdx) {
      return res.status(400).json({ error: `${tier} 티어 달성 후 받을 수 있습니다.` });
    }

    const walletAddress = await membershipService.getVerifiedWallet(
      _pool,
      req.user.user_id,
      String(req.body.walletAddress || '').trim(),
    );
    if (!walletAddress) return res.status(400).json({ error: '인증된 지갑 연결이 필요합니다.' });

    const { reward, awardedCards, issuedRaffleNftIds } = await claimTierReward({
      userId: req.user.user_id,
      walletAddress,
      tier,
    });

    res.json({
      success: true,
      message: `${tier} 티어 혜택을 수령했습니다.`,
      tier,
      rewardCards: reward.cards,
      rewardRaffles: reward.raffles,
      awardedCards,
      issuedRaffleNftIds,
    });
  } catch (err) {
    console.error('[auth/claim-tier-reward]', err);
    res.status(err.statusCode || 500).json({ error: err.message || '티어 혜택 수령 실패' });
  }
});

// POST /api/auth/join-membership — 멤버십 가입(베이직 시작)
router.post('/join-membership', requireAuth, async (req, res) => {
  try {
    const walletAddress = await membershipService.getVerifiedWallet(
      _pool,
      req.user.user_id,
      String(req.body.walletAddress || '').trim(),
    );
    if (!walletAddress) {
      return res.status(400).json({ error: '멤버십 가입은 인증된 지갑 연결 후 가능합니다.' });
    }

    const current = await membershipService.getUserMembership(_pool, req.user.user_id);
    if (current.joined) {
      return res.json({ success: true, message: '이미 멤버십에 가입되어 있습니다.', currentTier: current.tier });
    }

    const userDidHash = fabricService.hashDid(walletAddress);
    await fabricService.joinMembership({ userDidHash });
    await _pool.query(
      `UPDATE users
          SET membership_tier = '베이직', membership_joined_at = NOW()
        WHERE user_id = ?`,
      [req.user.user_id],
    );
    await _pool.query(
      `INSERT INTO user_boxes (user_id, season_count)
       VALUES (?, 0)
       ON DUPLICATE KEY UPDATE season_count = season_count`,
      [req.user.user_id],
    );
    await notificationService.recordNotification(_pool, {
      userId: req.user.user_id,
      category: 'MEMBERSHIP',
      title: '멤버십 가입 완료',
      message: '베이직 등급으로 시작합니다. 이제 포인트 적립과 티어업 혜택을 받을 수 있습니다.',
      metadata: { tier: '베이직' },
    });

    res.json({ success: true, message: '멤버십 가입 완료! 베이직 등급으로 시작합니다.', currentTier: '베이직' });
  } catch (err) {
    console.error('[auth/join-membership]', err);
    res.status(500).json({ error: err.message || '멤버십 가입 실패' });
  }
});

// GET /api/auth/early-access-count — 사용 가능한 응모권 수 조회
router.get('/early-access-count', requireAuth, async (req, res) => {
  try {
    await _pool.query(
      `UPDATE raffle_nfts
          SET status = 'EXPIRED'
        WHERE user_id = ? AND status = 'ISSUED' AND expires_at IS NOT NULL AND expires_at < NOW()`,
      [req.user.user_id],
    );
    const [[row]] = await _pool.query(
      `SELECT COUNT(*) AS cnt
         FROM raffle_nfts
        WHERE user_id = ? AND status = 'ISSUED'
          AND (expires_at IS NULL OR expires_at > NOW())`,
      [req.user.user_id],
    );
    const membership = await membershipService.getUserMembership(_pool, req.user.user_id);
    res.json({ success: true, count: row?.cnt ?? 0, tier: membership.tier, joined: membership.joined });
  } catch (err) {
    console.error('[auth/early-access-count]', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

// POST /api/auth/tier-up — 수동 티어업 + 최초 달성 혜택 지급
router.post('/tier-up', requireAuth, async (req, res) => {
  try {
    const membership = await membershipService.getUserMembership(_pool, req.user.user_id);
    if (!membership.joined) return res.status(400).json({ error: '멤버십 가입 후 티어업할 수 있습니다.' });

    const seasonCount = await membershipService.getSeasonCount(_pool, req.user.user_id);
    const currentIdx = membershipService.TIER_ORDER.indexOf(membership.tier);
    const nextTier = currentIdx < membershipService.TIER_ORDER.length - 1
      ? membershipService.TIER_ORDER[currentIdx + 1]
      : null;

    if (!nextTier) return res.status(400).json({ error: '이미 최고 등급입니다.' });
    if (seasonCount < membershipService.TIER_REQUIREMENTS[nextTier]) {
      return res.status(400).json({ error: `${nextTier} 달성 조건 미충족(필요: ${membershipService.TIER_REQUIREMENTS[nextTier]}회)` });
    }

    const walletAddress = await membershipService.getVerifiedWallet(
      _pool,
      req.user.user_id,
      String(req.body.walletAddress || '').trim(),
    );
    if (!walletAddress) return res.status(400).json({ error: '인증된 지갑 연결이 필요합니다.' });

    await syncFabricMembershipTier({ walletAddress, tier: nextTier });

    const [[existingReward]] = await _pool.query(
      `SELECT id FROM membership_tier_rewards WHERE user_id = ? AND tier = ?`,
      [req.user.user_id, nextTier],
    );

    await _pool.query(
      'UPDATE users SET membership_tier = ? WHERE user_id = ?',
      [nextTier, req.user.user_id],
    );
    if (existingReward) {
      return res.json({
        success: true,
        message: `${nextTier} 등급으로 티어업 완료! 해당 등급 혜택은 이미 수령했습니다.`,
        newTier: nextTier,
        rewardAlreadyClaimed: true,
        raffleCount: 0,
        issuedRaffleNftIds: [],
        awardedCards: [],
      });
    }

    const { reward, awardedCards, issuedRaffleNftIds } = await claimTierReward({
      userId: req.user.user_id,
      walletAddress,
      tier: nextTier,
    });

    res.json({
      success: true,
      message: `${nextTier} 등급으로 티어업 완료! 최초 달성 혜택이 지급되었습니다.`,
      newTier: nextTier,
      raffleCount: issuedRaffleNftIds.length,
      issuedRaffleNftIds,
      awardedCards,
    });
  } catch (err) {
    console.error('[auth/tier-up]', err);
    res.status(err.statusCode || 500).json({ error: err.message || '서버 오류' });
  }
});

// POST /api/auth/claim-monthly-raffles — 등급별 월 응모권 수령
router.post('/claim-monthly-raffles', requireAuth, async (req, res) => {
  try {
    const membership = await membershipService.getUserMembership(_pool, req.user.user_id);
    if (!membership.joined) return res.status(400).json({ error: '멤버십 가입 후 월 응모권을 받을 수 있습니다.' });

    const limit = membershipService.TIER_MONTHLY_RAFFLES[membership.tier] || 0;
    if (limit <= 0) return res.status(400).json({ error: `${membership.tier} 등급은 월 응모권 지급 대상이 아닙니다.` });

    const claimMonth = membershipService.formatMonth();
    const [[existing]] = await _pool.query(
      `SELECT id FROM membership_monthly_raffle_claims WHERE user_id = ? AND claim_month = ?`,
      [req.user.user_id, claimMonth],
    );
    if (existing) return res.status(400).json({ error: '이번 달 응모권은 이미 수령했습니다.' });

    const walletAddress = await membershipService.getVerifiedWallet(
      _pool,
      req.user.user_id,
      String(req.body.walletAddress || '').trim(),
    );
    if (!walletAddress) return res.status(400).json({ error: '인증된 지갑 연결이 필요합니다.' });

    const expiresAt = membershipService.nextMonthEnd();
    const issuedRaffleNftIds = await membershipService.issueRaffleNfts({
      pool: _pool,
      fabricService,
      userId: req.user.user_id,
      walletAddress,
      count: limit,
      source: 'MONTHLY_GRANT',
      expiresAt,
      claimedMonth: claimMonth,
    });

    await _pool.query(
      `INSERT INTO membership_monthly_raffle_claims
         (id, user_id, claim_month, tier, claimed_count, raffle_nft_ids, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), req.user.user_id, claimMonth, membership.tier, limit, JSON.stringify(issuedRaffleNftIds), expiresAt],
    );
    await notificationService.recordNotification(_pool, {
      userId: req.user.user_id,
      category: 'MEMBERSHIP',
      title: '월 응모권 수령 완료',
      message: `${claimMonth} 월 응모권 ${limit}장이 지급되었습니다.`,
      amount: limit,
      metadata: { claimMonth, tier: membership.tier, raffleNftIds: issuedRaffleNftIds },
    });
    await notificationService.recordNotification(_pool, {
      userId: req.user.user_id,
      category: 'RAFFLE',
      title: '응모권 획득',
      message: `멤버십 월 혜택으로 응모권 ${limit}장이 지급되었습니다.`,
      amount: limit,
      metadata: { source: 'MONTHLY_GRANT', claimMonth, raffleNftIds: issuedRaffleNftIds },
    });

    res.json({
      success: true,
      message: `${claimMonth} 월 응모권 ${limit}장이 지급되었습니다.`,
      count: limit,
      raffleNftIds: issuedRaffleNftIds,
      expiresAt,
    });
  } catch (err) {
    console.error('[auth/claim-monthly-raffles]', err);
    res.status(500).json({ error: err.message || '월 응모권 수령 실패' });
  }
});

module.exports = { router, setPool };
