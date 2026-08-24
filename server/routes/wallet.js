const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { verifyEthSignature } = require('../utils/didUtils');
const fabricService = require('../services/fabricBridge');
const { grantPresentationDemoAssetsIfEligible } = require('../services/presentationDemoService');

const router = express.Router();
let _pool;

function setPool(pool) {
  _pool = pool;
}

// POST /api/wallet/connect — 지갑 주소 서버에 등록
router.post('/connect', requireAuth, async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: 'address가 필요합니다.' });

    const normalizedAddress = address.toLowerCase();

    // 다른 유저가 이미 사용 중인 지갑인지 확인
    const [[otherUser]] = await _pool.query(
      'SELECT user_id FROM user_wallets WHERE wallet_address = ? AND user_id != ?',
      [normalizedAddress, req.user.user_id]
    );
    if (otherUser) {
      return res.status(400).json({ error: '이미 다른 계정에 연결된 지갑 주소입니다.' });
    }

    const [[existing]] = await _pool.query(
      'SELECT wallet_id FROM user_wallets WHERE user_id = ?',
      [req.user.user_id]
    );

    if (existing) {
      // 재연결 — 주소가 바뀌면 검증 초기화
      await _pool.query(
        'UPDATE user_wallets SET wallet_address = ?, is_verified = FALSE, verified_at = NULL, nonce = NULL WHERE user_id = ?',
        [normalizedAddress, req.user.user_id]
      );
    } else {
      await _pool.query(
        'INSERT INTO user_wallets (user_id, wallet_address) VALUES (?, ?)',
        [req.user.user_id, normalizedAddress]
      );
    }

    try {
      await grantPresentationDemoAssetsIfEligible(_pool, req.user.user_id, fabricService);
    } catch (demoErr) {
      console.error('[wallet/connect] 시연용 자동 지급 실패:', demoErr.message);
    }

    res.json({ message: '지갑이 등록되었습니다. 서명 검증을 진행해주세요.', address: normalizedAddress });
  } catch (err) {
    console.error('[wallet/connect]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/wallet/challenge — 서명용 nonce 발급 (DB에 저장)
router.get('/challenge', requireAuth, async (req, res) => {
  try {
    const [[wallet]] = await _pool.query(
      'SELECT wallet_id FROM user_wallets WHERE user_id = ?',
      [req.user.user_id]
    );
    if (!wallet) return res.status(400).json({ error: '먼저 지갑을 연결해주세요.' });

    const nonce = `BASE-CHAIN-AUTH:${crypto.randomBytes(16).toString('hex')}`;
    await _pool.query(
      'UPDATE user_wallets SET nonce = ? WHERE user_id = ?',
      [nonce, req.user.user_id]
    );

    res.json({ nonce });
  } catch (err) {
    console.error('[wallet/challenge]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/wallet/verify — MetaMask personal_sign 서명 검증
router.post('/verify', requireAuth, async (req, res) => {
  try {
    const { signature } = req.body;
    if (!signature) return res.status(400).json({ error: 'signature가 필요합니다.' });

    const [[wallet]] = await _pool.query(
      'SELECT * FROM user_wallets WHERE user_id = ?',
      [req.user.user_id]
    );
    if (!wallet) return res.status(400).json({ error: '먼저 지갑을 연결해주세요.' });
    if (!wallet.nonce) return res.status(400).json({ error: 'challenge를 먼저 발급받아주세요.' });

    const valid = verifyEthSignature(wallet.nonce, signature, wallet.wallet_address);
    if (!valid) {
      return res.status(400).json({ error: '서명 검증 실패. 올바른 지갑으로 서명했는지 확인하세요.' });
    }

    // 검증 완료 — nonce 초기화
    await _pool.query(
      'UPDATE user_wallets SET is_verified = TRUE, verified_at = NOW(), nonce = NULL WHERE user_id = ?',
      [req.user.user_id]
    );

    try {
      await grantPresentationDemoAssetsIfEligible(_pool, req.user.user_id, fabricService);
    } catch (demoErr) {
      console.error('[wallet/verify] 시연용 자동 지급 실패:', demoErr.message);
    }

    res.json({ message: '지갑 서명 검증 완료!', verified: true, address: wallet.wallet_address });
  } catch (err) {
    console.error('[wallet/verify]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/wallet/info — 현재 지갑 상태 조회
router.get('/info', requireAuth, async (req, res) => {
  try {
    const [[wallet]] = await _pool.query(
      'SELECT wallet_address, is_verified, connected_at, verified_at FROM user_wallets WHERE user_id = ?',
      [req.user.user_id]
    );
    if (!wallet) return res.json({ connected: false });
    res.json({
      connected: true,
      address: wallet.wallet_address,
      is_verified: Boolean(wallet.is_verified),
      connected_at: wallet.connected_at,
      verified_at: wallet.verified_at,
    });
  } catch (err) {
    console.error('[wallet/info]', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

module.exports = { router, setPool };
