'use strict';
/**
 * 모든 서버 모듈이 실제로 로드되는지 확인한다.
 *
 * `node --check` 는 문법만 본다. 그래서 "지운 상수를 module.exports 가 여전히 참조" 같은
 * 실수를 잡지 못하고, 서버를 띄워야만 ReferenceError 로 드러난다.
 * (실제로 이 프로젝트에서 그 사고가 났다 — 상수를 제거하면서 export 를 남겨 서버가 기동하지 못했다)
 *
 * 이 테스트는 각 파일을 진짜로 require 해서 그런 종류의 오류를 즉시 잡는다.
 */
require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER_ROOT = path.join(__dirname, '..');
const SOURCE_DIRS = ['routes', 'services', 'mock', 'utils', 'config', 'db', 'middleware'];

function collectModules() {
  const files = [];
  for (const dir of SOURCE_DIRS) {
    const full = path.join(SERVER_ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full)) {
      if (name.endsWith('.js')) files.push(path.join(dir, name));
    }
  }
  return files.sort();
}

const modules = collectModules();

test('검사할 모듈을 찾았다', () => {
  assert.ok(modules.length > 10, `모듈을 ${modules.length}개만 찾았습니다 — 경로 규칙을 확인하세요`);
});

for (const relativePath of modules) {
  test(`${relativePath} 가 오류 없이 로드된다`, () => {
    assert.doesNotThrow(
      () => require(path.join(SERVER_ROOT, relativePath)),
      `${relativePath} 로드 실패`,
    );
  });
}

test('index.js 가 참조하는 라우트 모듈이 모두 존재한다', () => {
  const source = fs.readFileSync(path.join(SERVER_ROOT, 'index.js'), 'utf-8');
  const required = [...source.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)].map((m) => m[1]);

  assert.ok(required.length > 0, 'index.js 에서 require 구문을 찾지 못했습니다');

  for (const relative of required) {
    const candidates = [
      path.join(SERVER_ROOT, relative),
      path.join(SERVER_ROOT, `${relative}.js`),
      path.join(SERVER_ROOT, relative, 'index.js'),
    ];
    assert.ok(
      candidates.some((candidate) => fs.existsSync(candidate)),
      `index.js 가 require 하는 ${relative} 를 찾을 수 없습니다`,
    );
  }
});
