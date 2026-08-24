/**
 * ESLint 설정 (flat config)
 *
 * 목적은 스타일 통일이 아니라 **버그로 이어지는 것**을 잡는 것이다.
 * 들여쓰기·따옴표 같은 취향 규칙은 넣지 않는다 — 리뷰에서 다툴 거리만 늘고
 * 실제 결함은 안 잡힌다.
 *
 * 실행: npm run lint  (자동 수정: npm run lint:fix)
 */
const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly', module: 'writable', exports: 'writable',
        process: 'readonly', console: 'readonly', globalThis: 'readonly',
        __dirname: 'readonly', __filename: 'readonly', Buffer: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', setImmediate: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', fetch: 'readonly',
        TextEncoder: 'readonly', TextDecoder: 'readonly',
        AbortController: 'readonly', structuredClone: 'readonly', queueMicrotask: 'readonly',
      },
    },
    rules: {
      // 미사용 변수는 대부분 "지우다 만 코드"다. 의도적으로 남기는 인자는 _ 접두사로 표시한다.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 빈 catch 는 허용한다. 다만 그 이유를 주석으로 남기는 것이 이 저장소의 관례다.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-console': 'off',        // 서버 로그가 운영 관측 수단이다
      'eqeqeq': ['warn', 'smart'],
      'no-var': 'error',
      'prefer-const': 'warn',
    },
  },
  {
    // 테스트는 node:test 러너를 쓴다.
    files: ['tests/**/*.js'],
    languageOptions: { globals: { describe: 'readonly', it: 'readonly', before: 'readonly', after: 'readonly', beforeEach: 'readonly', afterEach: 'readonly' } },
  },
  { ignores: ['node_modules/**', 'uploads/**'] },
];
