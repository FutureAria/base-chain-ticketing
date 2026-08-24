const jwt = require('jsonwebtoken');

/** @type {import('mysql2/promise').Pool|null} 앱 부팅 시 setPool 로 주입된다. */
let _pool = null;

/**
 * DB 풀을 주입한다. index.js 가 부팅 시 한 번 호출한다.
 * @param {import('mysql2/promise').Pool} pool
 */
function setPool(pool) {
  _pool = pool;
}

/**
 * JWT 를 검증하고 `req.user` 를 채운다. 실패하면 요청을 여기서 끝낸다.
 *
 * 토큰만 믿지 않고 **매 요청마다 DB 에서 사용자를 다시 읽는다.** 토큰은 7일간 유효한데,
 * 그 사이 계정이 비활성화되거나 권한이 바뀔 수 있기 때문이다.
 * 비용(쿼리 1회)보다 "정지된 계정이 계속 통하는" 문제가 크다고 판단했다.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>} 401 토큰 없음·유효하지 않음 / 403 비활성 계정
 */
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
/**
 * 토큰이 있으면 `req.user` 를 채우고, 없거나 잘못돼도 그냥 통과시킨다.
 *
 * 로그인 여부에 따라 응답이 달라지지만 비로그인도 허용해야 하는 화면(공개 목록 등)에 쓴다.
 * 잘못된 토큰을 오류로 만들지 않는 이유 — 만료된 토큰을 든 방문자에게
 * 공개 페이지까지 막으면 로그인 화면으로 튕기는 것 말고 할 수 있는 게 없다.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
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
