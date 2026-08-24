/**
 * 알림 이벤트 기록 서비스.
 *
 * 알림은 부수적인 기능이다 — 기록에 실패해도 본 작업은 성공해야 한다.
 * 그래서 이 모듈의 함수는 예외를 밖으로 던지지 않는다.
 */
'use strict';

const { v4: uuidv4 } = require('uuid');

/** 허용 카테고리. 목록에 없는 값은 SYSTEM 으로 떨어뜨린다. */
const ALLOWED_CATEGORIES = new Set(['TRADE', 'RAFFLE', 'MEMBERSHIP', 'POINT', 'BOX', 'SYSTEM']);

/**
 * 카테고리 문자열을 허용 목록 안의 값으로 정규화한다.
 * @param {string} category 원본 값
 * @returns {string} 허용 목록의 값, 모르는 값이면 'SYSTEM'
 */
function normalizeCategory(category) {
  const value = String(category || '').toUpperCase();
  return ALLOWED_CATEGORIES.has(value) ? value : 'SYSTEM';
}

/**
 * 알림 이벤트를 기록한다.
 *
 * **실패해도 예외를 던지지 않는다.** 알림 기록이 본 작업(예매·거래·환불)을 되돌리면
 * 안 되기 때문이다. 실패는 로그로 남기고 `null` 을 돌려준다.
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {object} params
 * @param {number} params.userId 수신자
 * @param {string} params.category TRADE·RAFFLE·MEMBERSHIP·POINT·BOX·SYSTEM
 * @param {string} params.title 알림 제목 (없으면 기록하지 않는다)
 * @param {string} [params.message] 본문
 * @param {number|null} [params.amount] 금액·포인트 등 숫자 정보
 * @param {object} [params.metadata] 화면에서 쓸 부가 정보
 * @returns {Promise<string|null>} 생성된 알림 id, 실패 시 null
 */
async function recordNotification(pool, {
  userId,
  category,
  title,
  message = '',
  amount = null,
  metadata = {},
}) {
  if (!pool || !userId || !title) return null;
  const id = uuidv4();
  try {
    await pool.query(
      `INSERT INTO notification_events
         (id, user_id, category, title, message, amount, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        userId,
        normalizeCategory(category),
        title,
        message || '',
        amount === null || amount === undefined ? null : Number(amount),
        JSON.stringify(metadata || {}),
      ],
    );
    return id;
  } catch (err) {
    console.error('[notificationService] record failed:', err.message);
    return null;
  }
}

module.exports = {
  recordNotification,
};
