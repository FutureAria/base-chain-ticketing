const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
let _pool;

function setPool(pool) { _pool = pool; }

const ACTION_LABEL = {
  BOX_OPEN:           '박스 개봉',
  COMBINE_CARD:       '파편 조합',
  FRAGMENT_LIST:      '파편 판매 등록',
  FRAGMENT_UNLIST:    '파편 판매 취소',
  FRAGMENT_TRANSFER:  '파편 거래',
  TICKET_MINT:        '티켓 민팅',
  TICKET_USE:         '티켓 사용',
};

// GET /api/tx-history
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user.user_id;
  try {
    const [rows] = await _pool.query(
      `SELECT id, action_type, tx_hash, token_id, payload_json, created_at
       FROM onchain_tx_logs
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    const data = rows.map(r => ({
      id:          r.id,
      actionType:  r.action_type,
      label:       ACTION_LABEL[r.action_type] ?? r.action_type,
      txHash:      r.tx_hash,
      tokenId:     r.token_id,
      payload:     r.payload_json,
      createdAt:   r.created_at,
      explorerUrl: `https://explorer.hoodi.ethpandaops.io/tx/${r.tx_hash}`,
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('[tx-history]', err);
    res.status(500).json({ success: false, error: '서버 오류' });
  }
});

module.exports = { router, setPool };
