/**
 * 로그인 토큰을 담은 요청 헤더를 만든다.
 *
 * 공지 관리와 QR 검표처럼 관리자만 호출할 수 있는 API가 있어서,
 * 각 화면이 제각각 localStorage를 직접 읽는 대신 여기로 모았다.
 *
 * FormData를 보낼 때는 Content-Type을 직접 지정하면 안 된다
 * (브라우저가 multipart 경계값을 붙여야 하므로). 그래서 여기서는 Authorization만 넣는다.
 */
export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("auth_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}
