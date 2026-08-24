const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { addressToDid } = require('../utils/didUtils');

const router = express.Router();
let _pool;

const PRACTICE_ADMIN = {
  userId: 'practice_admin',
  email: 'practice@basechain.dev',
  walletAddress: '0x9999999999999999999999999999999999999999',
  didValue: 'did:basechain:practice-admin',
};

function setPool(pool) {
  _pool = pool;
}

function isDemoAdmin(user) {
  return user?.role === 'admin';
}

function demoAdminWalletAddress(user) {
  if (user?.user_id === PRACTICE_ADMIN.userId && user?.email === PRACTICE_ADMIN.email) {
    return PRACTICE_ADMIN.walletAddress;
  }
  const seed = `${user?.user_id || 'admin'}:${user?.email || 'basechain'}`;
  return `0x${crypto.createHash('sha256').update(`basechain-demo-admin:${seed}`).digest('hex').slice(0, 40)}`;
}

async function ensureDemoAdminCredential(user) {
  const [[existingWallet]] = await _pool.query(
    'SELECT wallet_address FROM user_wallets WHERE user_id = ?',
    [user.user_id]
  );
  const walletAddress = existingWallet?.wallet_address || demoAdminWalletAddress(user);
  const didValue =
    user.user_id === PRACTICE_ADMIN.userId && user.email === PRACTICE_ADMIN.email
      ? PRACTICE_ADMIN.didValue
      : addressToDid(walletAddress);

  await _pool.query(
    `INSERT INTO user_wallets
       (user_id, wallet_address, nonce, is_verified, connected_at, verified_at)
     VALUES (?, ?, NULL, 1, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       wallet_address = VALUES(wallet_address),
       nonce = NULL,
       is_verified = 1,
       verified_at = NOW()`,
    [user.user_id, walletAddress]
  );

  await _pool.query(
    `INSERT INTO did_verifications
       (user_id, did_value, wallet_address, last_signature, status, verified_at)
     VALUES (?, ?, ?, 'practice-demo-signature', 'verified', NOW())
     ON DUPLICATE KEY UPDATE
       did_value = VALUES(did_value),
       wallet_address = VALUES(wallet_address),
       last_signature = VALUES(last_signature),
       status = 'verified',
       verified_at = NOW()`,
    [user.user_id, didValue, walletAddress]
  );

  return { walletAddress, didValue };
}

// POST /api/did/create — 지갑 서명 검증 완료 후 DID 생성
router.post('/create', requireAuth, async (req, res) => {
  try {
    if (isDemoAdmin(req.user)) {
      const { didValue } = await ensureDemoAdminCredential(req.user);
      return res.json({
        message: '실습용 관리자 계정은 DID 인증이 자동 완료되어 있습니다.',
        did: didValue,
        already_exists: true,
        practice_bypass: true,
      });
    }

    const [[wallet]] = await _pool.query(
      'SELECT * FROM user_wallets WHERE user_id = ?',
      [req.user.user_id]
    );
    if (!wallet) return res.status(400).json({ error: '먼저 지갑을 연결해주세요.' });
    if (!wallet.is_verified) return res.status(400).json({ error: '지갑 서명 검증을 먼저 완료해주세요.' });

    const [[existing]] = await _pool.query(
      'SELECT * FROM did_verifications WHERE user_id = ?',
      [req.user.user_id]
    );

    if (existing && existing.status === 'verified') {
      return res.json({
        message: '이미 DID 인증이 완료된 계정입니다.',
        did: existing.did_value,
        already_exists: true,
      });
    }

    const did = addressToDid(wallet.wallet_address);

    if (existing) {
      await _pool.query(
        'UPDATE did_verifications SET did_value = ?, wallet_address = ?, status = ?, verified_at = NOW() WHERE user_id = ?',
        [did, wallet.wallet_address, 'verified', req.user.user_id]
      );
    } else {
      await _pool.query(
        'INSERT INTO did_verifications (user_id, did_value, wallet_address, status, verified_at) VALUES (?, ?, ?, ?, NOW())',
        [req.user.user_id, did, wallet.wallet_address, 'verified']
      );
    }

    res.json({ message: 'DID 인증이 완료되었습니다!', did, already_exists: false });
  } catch (err) {
    console.error('[did/create]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/did/status — 전체 인증 단계 상태 조회
router.get('/status', requireAuth, async (req, res) => {
  try {
    if (isDemoAdmin(req.user)) {
      await ensureDemoAdminCredential(req.user);
    }

    const [[wallet]] = await _pool.query(
      'SELECT wallet_address, is_verified FROM user_wallets WHERE user_id = ?',
      [req.user.user_id]
    );
    const [[did]] = await _pool.query(
      'SELECT did_value, status, verified_at FROM did_verifications WHERE user_id = ?',
      [req.user.user_id]
    );

    res.json({
      user_id: req.user.user_id,
      nickname: req.user.nickname,
      wallet_connected: Boolean(wallet),
      wallet_address: wallet?.wallet_address ?? null,
      wallet_verified: Boolean(wallet?.is_verified),
      did_value: did?.did_value ?? null,
      did_status: did?.status ?? 'none',
      did_verified_at: did?.verified_at ?? null,
      auth_steps: {
        step1_registered: true,
        step2_wallet_connected: Boolean(wallet),
        step3_wallet_verified: Boolean(wallet?.is_verified),
        step4_did_created: did?.status === 'verified',
      },
    });
  } catch (err) {
    console.error('[did/status]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = { router, setPool };
