# 보안 정책

## 이 저장소의 기본 상태

이 프로젝트는 **실제 결제와 실제 온체인 거래가 꺼진 상태**가 기본값입니다.

| 스위치 | 기본값 | 의미 |
|---|---|---|
| `TOSS_MODE` | `mock` | 실제 결제가 발생하지 않습니다 |
| `FABRIC_MODE` | `mock` | 인메모리 mock — 실제 Fabric 네트워크에 붙지 않습니다 |
| `ENABLE_ONCHAIN_MINTING` | `false` | 실제 온체인 민팅을 시도하지 않습니다 |
| `RESET_DB_ON_START` | `false` | 재시작 시 DB를 지우지 않습니다 |
| `DEMO_ALLOW_MOCK_SIGNATURE` | `false` | 지갑 서명 검증을 건너뛰지 않습니다 |

**이 값들을 켜면 실제 돈·가스비·데이터 삭제가 발생할 수 있습니다.**
데모나 시연 목적으로 켰다면, 끝난 뒤 반드시 되돌리세요.

## 취약점을 발견했다면

공개 이슈로 올리지 말고 [Security Advisories](https://github.com/FutureAria/base-chain-ticketing/security/advisories/new)로 알려주세요.

알려주실 때 다음이 있으면 확인이 빠릅니다.

- 재현 절차 (어떤 요청을, 어떤 순서로)
- 영향 범위 (어떤 데이터가 노출·변조되는지)
- 해당 코드 위치를 아신다면 파일·줄 번호

## 저장소에 절대 들어가면 안 되는 것

`.gitignore`가 막고 있고, CI(`.github/workflows/ci.yml`)의 **시크릿 유출 검사** 잡이 매 푸시마다 다시 확인합니다.

- `.env` (모든 위치)
- `MINTER_PRIVATE_KEY` — 지갑 프라이빗 키
- `JWT_SECRET` · `QR_SECRET` — 로그인·QR 서명 키
- DB 비밀번호, Toss 시크릿 키
- Fabric이 생성한 인증서 (`fabric/basic-network/organizations/*Organizations/`)

제출용 ZIP은 반드시 [`scripts/make-submission.sh`](scripts/make-submission.sh)로 만드세요 —
`.env`가 들어가면 ZIP을 삭제하고 중단합니다.

## 이미 적용된 방어

| 항목 | 방식 |
|---|---|
| 좌석 이중 예매 | 트랜잭션 `FOR UPDATE` + DB 유니크 제약 (2중 방어) |
| 결제 금액 조작 | 서버 가격표로 항상 재계산 — 클라이언트 값은 검증용 |
| QR 위조·재사용 | `HMAC-SHA256(ticketId:슬롯)`, 기본 10초마다 회전 |
| 무차별 대입 | 인증 API 레이트 리밋 (기본 10분당 20회) |
| CORS | 와일드카드 기본 차단, `FRONTEND_ORIGINS`로 명시 |
| 관리자 계정 | 환경변수가 없으면 **계정을 만들지 않음** (하드코딩 계정 제거) |
| 계정 열거 | 비밀번호 찾기 응답을 항상 동일하게 처리, 1회용 토큰 재설정 |
| 프로세스 크래시 | 전역 에러 핸들러 + async 라우트 래핑 |

## 범위 밖

정직하게 적어 둡니다. 다음은 **수행하지 않았습니다.**

- 전문 보안 감사, 침투 테스트
- 부하 테스트
- 스마트 컨트랙트 외부 감사

로그인 토큰을 `localStorage`에 보관합니다. httpOnly 쿠키 전환은 CSRF 대응이 함께 필요해
이번 범위에서 다루지 않았습니다.
