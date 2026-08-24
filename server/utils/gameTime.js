'use strict';

// DEBUG_TIME_OFFSET_HOURS 기존 디버그 방식과 동일하게 적용
function getNowMs() {
  const offset = parseFloat(process.env.DEBUG_TIME_OFFSET_HOURS || '0');
  return Date.now() + offset * 60 * 60 * 1000;
}

function parseGameStartMs(gameDateStr, gameTimeStr) {
  const date = String(gameDateStr).slice(0, 10);
  const time = String(gameTimeStr || '18:30:00').slice(0, 8);
  const ms = new Date(`${date}T${time}+09:00`).getTime();
  if (isNaN(ms)) throw new Error(`경기 시간 파싱 실패: ${gameDateStr} ${gameTimeStr}`);
  return ms;
}

// 경기 시작 1시간 전 이전인지 (2차 거래 등록 가능 여부)
function isBeforeGameMinus1h(gameDateStr, gameTimeStr) {
  const gameMs = parseGameStartMs(gameDateStr, gameTimeStr);
  return getNowMs() < gameMs - 60 * 60 * 1000;
}

// 경기 시작 후 1시간 이내인지 (일반 예매 / 2차 거래 구매 가능 여부)
function isWithinGamePlus1h(gameDateStr, gameTimeStr) {
  const gameMs = parseGameStartMs(gameDateStr, gameTimeStr);
  return getNowMs() <= gameMs + 60 * 60 * 1000;
}

module.exports = { isBeforeGameMinus1h, isWithinGamePlus1h };
