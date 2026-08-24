const jwt = require('jsonwebtoken');

let _pool = null;

function setPool(pool) {
  _pool = pool;
}

async function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '인증 토큰이 없습니다.' });
  }

  let payload;
  try {
    payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: '인증 정보가 유효하지 않습니다.' });
  }

  const [[user]] = await _pool.query(
    'SELECT user_id, nickname, email, login_type, role, is_active FROM users WHERE user_id = ?',
    [payload.sub]
  );
  if (!user) return res.status(401).json({ error: '사용자를 찾을 수 없습니다.' });

  // 비활성화된 계정은 이미 발급된 토큰으로도 들어올 수 없어야 한다.
  // 이 검사가 없으면 계정을 비활성화해도 만료 전(7일) 토큰이 계속 통한다.
  if (!user.is_active) {
    return res.status(403).json({ error: '비활성화된 계정입니다.' });
  }

  req.user = user;
  next();
}

// 토큰이 있으면 req.user 세팅, 없어도 통과
async function optionalAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) return next();
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    const [[user]] = await _pool.query(
      'SELECT user_id, nickname, email, login_type, role, is_active FROM users WHERE user_id = ?',
      [payload.sub]
    );
    if (user && user.is_active) req.user = user;
  } catch {
    // 토큰 이상해도 그냥 통과
  }
  next();
}

module.exports = { requireAuth, optionalAuth, setPool };
