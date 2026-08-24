#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return fallback;
  return args[index + 1];
}

function parseEnv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    env[key] = value;
  }
  return env;
}

function dirSizeBytes(dirPath) {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  const stack = [dirPath];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        total += fs.statSync(fullPath).size;
      }
    }
  }
  return total;
}

function mb(bytes) {
  return bytes / 1024 / 1024;
}

function pushIf(condition, list, message) {
  if (condition) list.push(message);
}

const envPath = argValue('--env', 'deploy/oracle-demo/basechain-demo.env.example');
const frontendEnvPath = argValue('--frontend-env', 'Proje/.env.example');
const distPath = argValue('--dist', 'Proje/dist');
const maxDistMb = Number(argValue('--max-dist-mb', '80'));

const errors = [];
const warnings = [];

if (!fs.existsSync(envPath)) {
  errors.push(`Backend env file not found: ${envPath}`);
} else {
  const env = parseEnv(envPath);
  pushIf(env.FABRIC_MODE !== 'mock', errors, 'FABRIC_MODE must be mock for Oracle demo.');
  pushIf(env.TOSS_MODE !== 'mock', errors, 'TOSS_MODE must be mock for Oracle demo.');
  pushIf(String(env.ENABLE_ONCHAIN_MINTING).toLowerCase() !== 'false', errors, 'ENABLE_ONCHAIN_MINTING must be false for Oracle demo.');
  pushIf(!env.QR_SECRET || env.QR_SECRET.includes('YOUR_'), warnings, 'QR_SECRET is still placeholder. Replace it before a shared demo.');
  pushIf(!env.JWT_SECRET || env.JWT_SECRET.includes('YOUR_'), warnings, 'JWT_SECRET is still placeholder. Replace it before a shared demo.');
  pushIf(!String(env.PUBLIC_WEB_URL || '').startsWith('https://'), warnings, 'PUBLIC_WEB_URL should be HTTPS for mobile QR camera access.');
  pushIf(!String(env.PUBLIC_API_URL || '').startsWith('https://'), warnings, 'PUBLIC_API_URL should be HTTPS for mobile QR camera access.');

  // ── 운영 데이터 보호 ─────────────────────────────────────
  // true 로 두면 서버가 재시작될 때마다 DB를 통째로 지운다.
  pushIf(
    String(env.RESET_DB_ON_START).toLowerCase() === 'true',
    errors,
    'RESET_DB_ON_START must be false. true wipes the whole database on every restart.',
  );

  // ── 관리자 계정 ──────────────────────────────────────────
  // 공지 작성·QR 검표·정산·추첨은 관리자 계정에서만 동작한다.
  // 비밀번호를 설정하지 않으면 계정이 생성되지 않아 해당 기능을 아무도 쓸 수 없다.
  const adminPasswords = [
    ['DEMO_ADMIN_PASSWORD', env.DEMO_ADMIN_PASSWORD],
    ['ROOT_ADMIN_PASSWORD', env.ROOT_ADMIN_PASSWORD],
  ];
  for (const [name, value] of adminPasswords) {
    pushIf(!value, warnings, `${name} is empty. Admin-only features (notices, QR scan, settlement, raffle) will be unavailable.`);
    pushIf(
      Boolean(value) && (value.length < 12 || /^(admin|root|test|demo|1234)/i.test(value)),
      errors,
      `${name} is too weak or guessable. This repository is public.`,
    );
  }

  // ── 서명 우회 플래그 ─────────────────────────────────────
  // 프론트와 서버 값이 다르면 프론트는 가짜 서명을 만들고 서버는 거부해서,
  // MetaMask 없는 사용자에게 원인을 알기 어려운 오류만 보인다.
  const serverMockSig = String(env.DEMO_ALLOW_MOCK_SIGNATURE || 'false').toLowerCase() === 'true';
  if (fs.existsSync(frontendEnvPath)) {
    const frontMockSig = String(parseEnv(frontendEnvPath).VITE_DEMO_ALLOW_MOCK_SIGNATURE || 'false').toLowerCase() === 'true';
    pushIf(
      serverMockSig !== frontMockSig,
      errors,
      `Mock signature flags disagree (server=${serverMockSig}, frontend=${frontMockSig}). Set both to the same value.`,
    );
  }
  pushIf(
    serverMockSig,
    warnings,
    'DEMO_ALLOW_MOCK_SIGNATURE is true. Seller identity is no longer proven by a wallet signature.',
  );

  // ── 시크릿 강도 ──────────────────────────────────────────
  for (const name of ['JWT_SECRET', 'QR_SECRET']) {
    const value = env[name];
    pushIf(Boolean(value) && value.length < 32, warnings, `${name} is shorter than 32 characters. Use a long random value.`);
  }

  // ── 시간 조작 플래그 ─────────────────────────────────────
  // 예매 마감·QR 활성화 시각이 전부 이 값만큼 밀린다. 운영에서 켜져 있으면 안 된다.
  pushIf(
    Number(env.DEBUG_TIME_OFFSET_HOURS || 0) !== 0,
    errors,
    `DEBUG_TIME_OFFSET_HOURS is ${env.DEBUG_TIME_OFFSET_HOURS}. This shifts every booking deadline and QR window.`,
  );

  // ── 시연용 자동 지급 ─────────────────────────────────────
  // 켜져 있으면 허용 목록의 이메일로 로그인하는 것만으로 포인트·조각·응모권이 지급된다.
  pushIf(
    String(env.DEMO_PRESENTATION_AUTO_GRANT).toLowerCase() === 'true',
    warnings,
    'DEMO_PRESENTATION_AUTO_GRANT is true. Listed emails receive free demo assets on login.',
  );

  // ── CORS ────────────────────────────────────────────────
  pushIf(
    String(env.CORS_ALLOW_DEV_ORIGINS).toLowerCase() === 'true',
    warnings,
    'CORS_ALLOW_DEV_ORIGINS is true. This allows any *.ngrok domain and private IP range with credentials.',
  );
  pushIf(
    !env.FRONTEND_ORIGINS,
    warnings,
    'FRONTEND_ORIGINS is empty. Browser requests from the deployed domain may be blocked by CORS.',
  );
}

if (!fs.existsSync(frontendEnvPath)) {
  warnings.push(`Frontend env file not found: ${frontendEnvPath}`);
} else {
  const frontendEnv = parseEnv(frontendEnvPath);
  pushIf(!String(frontendEnv.VITE_API_URL || '').startsWith('https://') && !String(frontendEnv.VITE_API_URL || '').includes('localhost'), warnings, 'VITE_API_URL should be HTTPS on Oracle demo.');
}

if (!fs.existsSync(distPath)) {
  warnings.push(`Frontend dist not found: ${distPath}. Run cd Proje && npm run build first.`);
} else {
  const sizeMb = mb(dirSizeBytes(distPath));
  pushIf(sizeMb > maxDistMb, warnings, `Frontend dist is ${sizeMb.toFixed(1)}MB, over ${maxDistMb}MB target.`);
}

const result = {
  ok: errors.length === 0,
  envPath,
  frontendEnvPath,
  distPath,
  maxDistMb,
  errors,
  warnings,
};

console.log(JSON.stringify(result, null, 2));
process.exit(errors.length === 0 ? 0 : 1);
