# Oracle Demo Deployment Notes

## 목적

이 문서는 BASE CHAIN을 Oracle 환경에 시연용으로 올릴 때 지켜야 할 안전 기준을 정리한다.

시연 목표는 다음과 같다.

- QR 입장 스캔이 실제 휴대폰 브라우저에서 동작한다.
- QR 입장 성공 시 멤버십 가입자에게 포인트가 적립된다.
- Toss 결제, Fabric, NFT 민팅은 mock 또는 demo-only 흐름으로 유지한다.
- Oracle VM과 DB 용량을 불필요하게 늘리지 않는다.

## 핵심 결정

### ngrok 필요 여부

Oracle 서버에 직접 배포하면 ngrok은 필요하지 않다.

다만 QR 카메라 스캔은 브라우저 보안 정책상 HTTPS가 필요하다. 로컬 개발에서는 `localhost`라서 카메라가 허용되지만, Oracle 배포 후 `http://<IP>:<PORT>`로 접속하면 모바일 Chrome/Safari에서 카메라 권한이 막힐 수 있다.

따라서 Oracle 시연 주소는 아래 둘 중 하나여야 한다.

- 추천: `https://도메인` + Nginx/Caddy reverse proxy + TLS 인증서
- 임시 대안: 로컬 개발 중에만 ngrok HTTPS 터널 사용

Oracle에 올린 뒤에는 `https://도메인/entry-scanner`에서 QR 스캔을 테스트한다.

### QR 입장 보상 정책

현재 구현 기준으로 QR 스캔 성공 시 흐름은 다음과 같다.

1. QR 토큰 검증
2. 티켓 상태 확인
3. 입장 처리
4. 티켓 상태를 `used`로 변경
5. 시즌 박스 1개 지급
6. 멤버십 가입자라면 입장 포인트 적립

즉, 포인트는 “QR 스캔 시도”가 아니라 “입장 성공”에만 지급한다. 이미 사용한 티켓, 만료된 QR, 환불된 티켓은 포인트가 지급되지 않아야 한다.

## Oracle Demo 환경변수

백엔드 `.env`는 시연 환경에서 아래 값을 기본으로 둔다.

```env
NODE_ENV=production
PORT=4000

FABRIC_MODE=mock
TOSS_MODE=mock
ENABLE_ONCHAIN_MINTING=false

QR_SECRET=<long-random-secret>
QR_SLOT_SECONDS=10
QR_DEMO_ALWAYS_ON_GAME_IDS=PRACTICE_ALL_DAY_GAME
RAFFLE_DEMO_ALWAYS_OPEN_GAME_IDS=PRESENTATION_RAFFLE_ALWAYS_ON
DEMO_PRESENTATION_AUTO_GRANT=true
DEMO_PRESENTATION_EMAILS=demo1@example.com,demo2@example.com

PUBLIC_WEB_URL=https://example.com
PUBLIC_API_URL=https://api.example.com
```

프론트엔드 `.env`는 아래처럼 Oracle API 주소를 바라보게 한다.

```env
VITE_API_URL=https://api.example.com
```

`ENABLE_ONCHAIN_MINTING=false` 상태에서는 서버 지갑, 컨트랙트 주소가 있더라도 온체인 민팅을 실행하지 않는다. 실제 온체인 기능을 켤 때는 별도 보안 리뷰와 사용자 승인이 필요하다.

## Mock 유지 기준

| 기능 | Oracle Demo 기본값 | 이유 |
|---|---|---|
| Toss 결제 | `TOSS_MODE=mock` | 실제 결제 승인/취소 호출 방지 |
| Fabric | `FABRIC_MODE=mock` | 별도 Fabric 네트워크 없이 시연 가능 |
| NFT 민팅 | `ENABLE_ONCHAIN_MINTING=false` | 가스비와 외부 RPC 의존성 방지 |
| QR 토큰 | 실제 HMAC 서명 | 스캔 시나리오는 진짜 흐름으로 검증 |
| BASE vs CHAIN QR | `QR_DEMO_ALWAYS_ON_GAME_IDS=PRACTICE_ALL_DAY_GAME` | 발표 중 2시간 전 제한으로 QR이 사라지지 않게 시연 티켓만 항상 표시 |
| 응모&선예매 시연 경기 | `RAFFLE_DEMO_ALWAYS_OPEN_GAME_IDS=PRESENTATION_RAFFLE_ALWAYS_ON` | 응모 시간이 지나도 시연용 경기가 사라지거나 마감되지 않게 유지 |
| 포인트 지급 | DB + mock Fabric | 시연 데이터로 충분함 |

`QR_DEMO_ALWAYS_ON_GAME_IDS`는 시연용 allowlist다. 기본 시연 경기인 `PRACTICE_ALL_DAY_GAME`의 `BASE vs CHAIN` 티켓만 경기 시작 2시간 전/종료 후 제한 없이 QR을 계속 표시한다. 단, QR 토큰 자체는 일반 티켓과 동일하게 `QR_SLOT_SECONDS` 주기로 계속 갱신된다. 일반 경기 QR은 기존처럼 `QR_HOURS_BEFORE`와 `QR_SLOT_SECONDS` 정책을 따른다.

`RAFFLE_DEMO_ALWAYS_OPEN_GAME_IDS`는 응모&선예매 시연용 allowlist다. 기본 시연 경기 `PRESENTATION_RAFFLE_ALWAYS_ON`은 일반 응모 마감 시간과 무관하게 계속 `응모 가능` 상태로 표시된다. 이 값은 발표용 계정 seed 스크립트 `npm run seed:presentation-demo-users -- --apply`가 생성하는 경기 ID와 맞춰야 한다.

`DEMO_PRESENTATION_AUTO_GRANT=true`는 발표용 계정 자동 지급 스위치다. `DEMO_PRESENTATION_EMAILS`에 포함된 Google 계정이 로그인하면 포인트, 파편, 박스, 멤버십 등급이 자동 보정되고, 지갑 연결 후 응모권 99장이 보정된다. 운영 서버에서는 이 값을 `false`로 둔다.

## 용량 관리

Oracle Free Tier 또는 소형 VM에서 용량을 아끼기 위해 아래 원칙을 지킨다.

- 서버에 `node_modules`를 오래 보관하지 않는다. 빌드 산출물과 런타임 의존성만 남긴다.
- 프론트는 `Proje/dist` 정적 파일만 배포한다.
- 업로드 이미지, QR 이미지 원본, 대용량 로그를 저장하지 않는다.
- QR은 서버에 이미지 파일로 저장하지 않고, 짧은 토큰만 생성한다.
- `fabric_events`, `point_events`, `notification_events`는 JSON payload를 작게 유지한다.
- 로그는 systemd 또는 pm2 log rotation을 설정한다.
- DB seed는 시연에 필요한 최소 경기/좌석/티켓만 유지한다.

## 배포 전 체크리스트

- [ ] 프론트가 `https://도메인`으로 접속된다.
- [ ] 백엔드 API가 `https://api.도메인` 또는 같은 도메인의 `/api`로 접속된다.
- [ ] 모바일 브라우저에서 `/entry-scanner` 카메라 권한이 뜬다.
- [ ] `FABRIC_MODE=mock`이다.
- [ ] `TOSS_MODE=mock`이다.
- [ ] `ENABLE_ONCHAIN_MINTING=false`이다.
- [ ] 실제 Toss secret, private key, wallet secret을 서버에 넣지 않았다.
- [ ] `QR_DEMO_ALWAYS_ON_GAME_IDS`가 시연 경기 ID로만 제한되어 있다.
- [ ] `RAFFLE_DEMO_ALWAYS_OPEN_GAME_IDS`가 시연 응모 경기 ID로만 제한되어 있다.
- [ ] `DEMO_PRESENTATION_AUTO_GRANT=true`는 Oracle 시연 서버에서만 켰다.
- [ ] `DEMO_PRESENTATION_EMAILS`에 발표용 Google 이메일만 들어 있다.
- [ ] 발표용 계정 seed가 필요한 경우 Oracle 서버에서 `npm run seed:presentation-demo-users -- --apply`를 1회 실행했다.
- [ ] QR 입장 성공 시 티켓이 `used`로 바뀐다.
- [ ] 멤버십 가입자에게만 포인트가 적립된다.
- [ ] 같은 QR을 다시 스캔하면 `ALREADY_USED`로 거부된다.
- [ ] `df -h`로 Oracle 디스크 여유 공간을 확인했다.

## 실제 결제/온체인 전환 금지선

아래 작업은 시연 환경에서 바로 진행하지 않는다.

- `TOSS_MODE=real`
- `ENABLE_ONCHAIN_MINTING=true`
- 실제 `MINTER_PRIVATE_KEY` 입력
- 실제 Oracle DB migration
- 운영 DB 데이터 삭제
- Oracle Object Storage 업로드 활성화
- Oracle VM 디스크/Block Volume 변경

이 단계로 넘어갈 때는 보안 리뷰와 사용자 최종 승인이 필요하다.
