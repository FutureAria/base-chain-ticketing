'use strict';
/**
 * 추첨 공정성 테스트.
 *
 * 우선 예매권을 나눠주는 추첨이라, "정말 무작위인가"를 말이 아니라 수치로 보여야 한다.
 * 이전 구현은 `[...arr].sort(() => Math.random() - 0.5)` 였는데,
 * 비교 함수가 일관되지 않아 특정 자리가 눈에 띄게 유리해진다(측정 시 편차 70% 이상).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// mockFabricService 내부 구현과 동일한 셔플.
// (서비스 전체를 로드하면 DB·env 의존이 생겨서 알고리즘만 그대로 옮겨 검증한다)
function cryptoShuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** 각 원소가 각 자리에 놓인 횟수를 세어, 균등 기대치 대비 최대 편차를 돌려준다. */
function maxPositionDeviation(shuffle, size, trials) {
  const counts = Array.from({ length: size }, () => new Array(size).fill(0));
  const source = Array.from({ length: size }, (_, i) => i);

  for (let t = 0; t < trials; t++) {
    shuffle(source).forEach((value, position) => {
      counts[value][position] += 1;
    });
  }

  const expected = trials / size;
  let maxDeviation = 0;
  for (const row of counts) {
    for (const count of row) {
      maxDeviation = Math.max(maxDeviation, Math.abs(count - expected) / expected);
    }
  }
  return maxDeviation;
}

test('셔플 결과가 모든 자리에 고르게 분포한다', () => {
  const deviation = maxPositionDeviation(cryptoShuffle, 6, 20000);
  assert.ok(
    deviation < 0.15,
    `자리별 분포 편차가 ${(deviation * 100).toFixed(1)}% 로 너무 큽니다 (기준 15% 미만)`,
  );
});

test('편향된 sort 셔플은 이 기준을 통과하지 못한다 — 회귀 방지', () => {
  // 예전 구현을 다시 넣으면 위 테스트가 왜 필요한지 알 수 있도록 대조군을 남긴다.
  const biasedShuffle = (items) => [...items].sort(() => Math.random() - 0.5);
  const deviation = maxPositionDeviation(biasedShuffle, 6, 20000);
  assert.ok(
    deviation > 0.15,
    '편향 셔플이 기준을 통과했습니다 — 대조군이 무의미해졌으니 테스트를 재검토하세요',
  );
});

test('셔플은 원본을 바꾸지 않고 같은 원소를 모두 보존한다', () => {
  const original = [1, 2, 3, 4, 5, 6, 7, 8];
  const shuffled = cryptoShuffle(original);

  assert.deepEqual(original, [1, 2, 3, 4, 5, 6, 7, 8], '원본 배열이 변경되면 안 됩니다');
  assert.equal(shuffled.length, original.length);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), original, '원소가 유실되거나 중복되면 안 됩니다');
});

test('원소가 0개나 1개여도 안전하다', () => {
  assert.deepEqual(cryptoShuffle([]), []);
  assert.deepEqual(cryptoShuffle(['하나']), ['하나']);
});
