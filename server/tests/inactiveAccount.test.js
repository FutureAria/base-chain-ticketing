'use strict';
/**
 * 비활성화된 계정 차단 테스트.
 *
 * 운영자가 계정을 비활성화(is_active=0)해도 로컬 로그인과 기존 토큰은 그대로 통했다.
 * 구글 로그인에만 검사가 있었고 로컬 로그인·requireAuth 에는 빠져 있었기 때문이다.
 * 그래서 "비활성화"가 사실상 아무 효과가 없었다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-unit-test-only';

const { requireAuth, optionalAuth, setPool } = require('../middleware/auth');

/** users 테이블 조회에 지정한 행을 돌려주는 가짜 풀. */
function fakePool(userRow) {
  return {
    query: async () => [[userRow]],
  };
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const ACTIVE_USER = {
  user_id: 'u_active', nickname: '활성', email: 'a@test.dev',
  login_type: 'local', role: 'user', is_active: 1,
};
const INACTIVE_USER = { ...ACTIVE_USER, user_id: 'u_inactive', is_active: 0 };

function bearer(userId) {
  return { headers: { authorization: `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET)}` } };
}

test('활성 계정은 requireAuth 를 통과한다', async () => {
  setPool(fakePool(ACTIVE_USER));
  const res = fakeRes();
  let passed = false;

  await requireAuth(bearer('u_active'), res, () => { passed = true; });

  assert.equal(passed, true, 'next() 가 호출돼야 합니다');
  assert.equal(res.statusCode, null, '오류 응답이 나가면 안 됩니다');
});

test('비활성 계정은 유효한 토큰이 있어도 requireAuth 에서 막힌다', async () => {
  setPool(fakePool(INACTIVE_USER));
  const res = fakeRes();
  let passed = false;

  await requireAuth(bearer('u_inactive'), res, () => { passed = true; });

  assert.equal(passed, false, '비활성 계정은 통과하면 안 됩니다');
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /비활성화/);
});

test('optionalAuth 는 비활성 계정을 req.user 에 넣지 않는다', async () => {
  setPool(fakePool(INACTIVE_USER));
  const req = bearer('u_inactive');
  const res = fakeRes();

  await optionalAuth(req, res, () => {});

  assert.equal(req.user, undefined, '비활성 계정이 req.user 에 실리면 안 됩니다');
});

test('optionalAuth 는 활성 계정을 정상적으로 싣는다', async () => {
  setPool(fakePool(ACTIVE_USER));
  const req = bearer('u_active');
  const res = fakeRes();

  await optionalAuth(req, res, () => {});

  assert.equal(req.user?.user_id, 'u_active');
});

test('로그인 라우트 소스에 is_active 검사가 존재한다', () => {
  // 로그인은 DB·bcrypt 의존이 커서 여기서는 검사 존재 여부만 고정한다.
  // (구글 로그인에만 있고 로컬 로그인에는 없던 것이 원래 결함이었다)
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf-8');

  const loginStart = source.indexOf("router.post('/login'");
  const loginEnd = source.indexOf("router.post('/google'");
  assert.ok(loginStart > -1 && loginEnd > loginStart, '로그인 라우트를 찾지 못했습니다');

  const loginBody = source.slice(loginStart, loginEnd);
  assert.match(loginBody, /is_active/, '로컬 로그인에 is_active 검사가 없습니다');
});
