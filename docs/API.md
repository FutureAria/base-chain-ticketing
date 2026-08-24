# API 레퍼런스

`server/routes/` 에서 추출한 **엔드포인트 89개**입니다. 코드가 기준이며, 어긋나면 코드가 맞습니다.

- 베이스 URL — 로컬 `http://localhost:4000`, 배포 `https://juyoung-basechain.duckdns.org`
- 응답 형식 — JSON
- 관련 문서 — [아키텍처](ARCHITECTURE.md) · [데이터베이스](DATABASE.md) · [개발 환경](DEVELOPMENT.md)

## 인증

로그인하면 JWT를 받고, 이후 요청에 헤더로 실어 보냅니다.

```http
Authorization: Bearer <token>
```

| 표기 | 의미 |
|---|---|
| 공개 | 토큰 없이 호출 가능 |
| 로그인 | 유효한 JWT 필요 (`middleware/auth.js` 의 `requireAuth`) |
| 관리자 | JWT + `users.role = 'admin'` |

> `JWT_SECRET` 이 비어 있으면 **서버가 시작되지 않습니다.** 의도된 동작입니다.

## 레이트 리밋

| 대상 | 기본값 | 환경변수 |
|---|---|---|
| `/api/auth/*` | 10분당 20회 | `RATE_LIMIT_AUTH_MAX` |
| `/api/*` 전체 | 10분당 300회 | `RATE_LIMIT_GENERAL_MAX` |

## 공통 오류

| 상태 | 언제 |
|---|---|
| `400` | 요청 값이 유효하지 않음 (좌석 형식, 금액 불일치 등) |
| `401` | 토큰 없음·만료·비활성 계정 |
| `403` | 권한 부족 (관리자 전용, 남의 자원 접근) |
| `409` | 이미 팔린 좌석, 중복 처리 (좌석 유니크 제약 위반) |
| `429` | 레이트 리밋 초과 |
| `500` | 서버 오류 — 전역 에러 핸들러가 잡아 프로세스는 죽지 않음 |

---


## 인증·회원·멤버십

`/api/auth` — 회원가입·로그인·비밀번호 찾기·멤버십 가입과 티어 혜택 수령  
<sub>`server/routes/auth.js` · 16개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `POST` | `/api/auth/register` | 공개 |
| `POST` | `/api/auth/login` | 공개 |
| `POST` | `/api/auth/google` | 공개 |
| `POST` | `/api/auth/find-id` | 공개 |
| `POST` | `/api/auth/find-password` | 공개 |
| `POST` | `/api/auth/reset-password` | 공개 |
| `GET` | `/api/auth/me` | 🔑 로그인 |
| `GET` | `/api/auth/admin/recent-logins` | 👑 관리자 |
| `GET` | `/api/auth/wallet` | 🔑 로그인 |
| `GET` | `/api/auth/membership` | 🔑 로그인 |
| `GET` | `/api/auth/tier-rewards` | 🔑 로그인 |
| `POST` | `/api/auth/claim-tier-reward` | 🔑 로그인 |
| `POST` | `/api/auth/join-membership` | 🔑 로그인 |
| `GET` | `/api/auth/early-access-count` | 🔑 로그인 |
| `POST` | `/api/auth/tier-up` | 🔑 로그인 |
| `POST` | `/api/auth/claim-monthly-raffles` | 🔑 로그인 |

## 조각 합성·박스

`/api` — 조각 합성으로 카드 발급, 랜덤 박스 개봉  
<sub>`server/routes/combine.js` · 4개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `GET` | `/api/inventory` | 🔑 로그인 |
| `POST` | `/api/combine` | 🔑 로그인 |
| `POST` | `/api/box/open` | 🔑 로그인 |
| `GET` | `/api/box/rewards` | 공개 |

## DID

`/api/did` — 지갑 주소를 해시한 분산 신원값 발급·조회  
<sub>`server/routes/did.js` · 2개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `POST` | `/api/did/create` | 🔑 로그인 |
| `GET` | `/api/did/status` | 🔑 로그인 |

## 입장 검표

`/api/entry` — QR 토큰 검증과 입장 처리  
<sub>`server/routes/entryRoutes.js` · 1개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `POST` | `/api/entry/verify` | 🔑 로그인 |

## 교환

`/api/exchange` — 포인트로 카드 NFT 구매, 실물 굿즈 교환 신청  
<sub>`server/routes/exchange.js` · 5개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `GET` | `/api/exchange/status` | 🔑 로그인 |
| `POST` | `/api/exchange/buy-card-nft` | 🔑 로그인 |
| `GET` | `/api/exchange/physical-options` | 🔑 로그인 |
| `POST` | `/api/exchange/physical-redeem` | 🔑 로그인 |
| `POST` | `/api/exchange/buy-raffle` | 🔑 로그인 |

## 조각 장터

`/api/market` — NFT 조각 매물 등록·구매·취소  
<sub>`server/routes/market.js` · 10개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `GET` | `/api/market/fragments` | 선택 |
| `GET` | `/api/market/fragments/:id` | 선택 |
| `POST` | `/api/market/buy/prepare` | 🔑 로그인 |
| `POST` | `/api/market/buy` | 🔑 로그인 |
| `POST` | `/api/market/listings` | 🔑 로그인 |
| `DELETE` | `/api/market/listings/:id` | 🔑 로그인 |
| `PATCH` | `/api/market/listings/:id` | 🔑 로그인 |
| `GET` | `/api/market/purchases` | 🔑 로그인 |
| `GET` | `/api/market/sales` | 🔑 로그인 |
| `POST` | `/api/market/toss-confirm` | 🔑 로그인 |

## 내 입장권

`/api/my-tickets` — 보유 티켓 목록과 상세, 가장 가까운 경기  
<sub>`server/routes/myTicket.js` · 3개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `GET` | `/api/my-tickets/nearest` | 🔑 로그인 |
| `GET` | `/api/my-tickets/` | 🔑 로그인 |
| `GET` | `/api/my-tickets/detail/:ticketId` | 🔑 로그인 |

## 공지

`/api/notices` — 공지 목록·작성·수정·삭제  
<sub>`server/routes/notice.js` · 5개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `GET` | `/api/notices/` | 공개 |
| `DELETE` | `/api/notices/` | 👑 관리자 |
| `POST` | `/api/notices/` | 👑 관리자 |
| `PUT` | `/api/notices/:id` | 👑 관리자 |
| `DELETE` | `/api/notices/:id` | 👑 관리자 |

## 알림

`/api/notifications` — 알림 목록·읽음 처리  
<sub>`server/routes/notificationRoutes.js` · 2개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `GET` | `/api/notifications/` | 🔑 로그인 |
| `POST` | `/api/notifications/read` | 🔑 로그인 |

## 포인트

`/api/points` — 포인트 잔액·이력·사용·교환  
<sub>`server/routes/pointRoutes.js` · 7개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `GET` | `/api/points/history` | 🔑 로그인 |
| `GET` | `/api/points/` | 선택 |
| `GET` | `/api/points/membership` | 선택 |
| `POST` | `/api/points/use` | 🔑 로그인 |
| `POST` | `/api/points/exchange` | 🔑 로그인 |
| `GET` | `/api/points/events` | 🔑 로그인 |
| `POST` | `/api/points/events/read` | 🔑 로그인 |

## 응모·추첨

`/api/raffle` — 응모권 등록, 추첨 생성·실행, 당첨자 조회, 우선 예매권 사용  
<sub>`server/routes/raffleRoutes.js` · 12개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `POST` | `/api/raffle/register` | 🔑 로그인 |
| `GET` | `/api/raffle/my` | 🔑 로그인 |
| `GET` | `/api/raffle/draws` | 공개 |
| `GET` | `/api/raffle/draws/:gameId` | 공개 |
| `POST` | `/api/raffle/draw/create` | 👑 관리자 |
| `POST` | `/api/raffle/enter` | 🔑 로그인 |
| `POST` | `/api/raffle/draw/execute` | 👑 관리자 |
| `GET` | `/api/raffle/winners/:gameId` | 공개 |
| `POST` | `/api/raffle/use` | 🔑 로그인 |
| `POST` | `/api/raffle/apply` | 🔑 로그인 |
| `GET` | `/api/raffle/my-entries` | 🔑 로그인 |
| `GET` | `/api/raffle/:raffleNftId` | 공개 |

## 환불

`/api/refunds` — 환불 요청·미리보기, 경기 취소 일괄 환불  
<sub>`server/routes/refundRoutes.js` · 3개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `POST` | `/api/refunds/` | 🔑 로그인 |
| `GET` | `/api/refunds/preview` | 🔑 로그인 |
| `POST` | `/api/refunds/cancel-game` | 👑 관리자 |

## 정산

`/api/settlements` — 경기별 정산 생성·조회  
<sub>`server/routes/settlementRoutes.js` · 2개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `POST` | `/api/settlements/` | 👑 관리자 |
| `GET` | `/api/settlements/:gameId` | 👑 관리자 |

## 예매

`/api/tickets` — 경기·좌석 조회, 좌석 확보와 결제, QR 발급  
<sub>`server/routes/ticket.js` · 6개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `GET` | `/api/tickets/games` | 공개 |
| `GET` | `/api/tickets/games/:id` | 공개 |
| `GET` | `/api/tickets/seats/:gameId` | 공개 |
| `POST` | `/api/tickets/purchase` | 🔑 로그인 |
| `GET` | `/api/tickets/:ticketId/qr` | 🔑 로그인 |
| `POST` | `/api/tickets/toss/confirm` | 🔑 로그인 |

## 티켓 재판매

`/api/ticket-resale` — 정가 이하 재판매 등록·구매·취소  
<sub>`server/routes/ticketResale.js` · 6개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `GET` | `/api/ticket-resale/my-tickets` | 🔑 로그인 |
| `GET` | `/api/ticket-resale/listings` | 선택 |
| `GET` | `/api/ticket-resale/my` | 🔑 로그인 |
| `POST` | `/api/ticket-resale/listings` | 🔑 로그인 |
| `POST` | `/api/ticket-resale/toss-confirm/:id` | 🔑 로그인 |
| `DELETE` | `/api/ticket-resale/listings/:id` | 🔑 로그인 |

## 거래 이력

`/api/tx-history` — 온체인 트랜잭션 로그 조회  
<sub>`server/routes/txHistory.js` · 1개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `GET` | `/api/tx-history/` | 🔑 로그인 |

## 지갑 연결

`/api/wallet` — MetaMask 연결과 서명 기반 소유 증명(nonce 챌린지)  
<sub>`server/routes/wallet.js` · 4개</sub>

| 메서드 | 경로 | 인증 |
|---|---|---|
| `POST` | `/api/wallet/connect` | 🔑 로그인 |
| `GET` | `/api/wallet/challenge` | 🔑 로그인 |
| `POST` | `/api/wallet/verify` | 🔑 로그인 |
| `GET` | `/api/wallet/info` | 🔑 로그인 |

---

## 눈여겨볼 엔드포인트

**`POST /api/tickets/purchase`** — 좌석 확보와 결제가 한 흐름으로 묶입니다.
좌석을 트랜잭션으로 확보(`SELECT ... FOR UPDATE` + 유니크 제약)한 뒤 결제를 승인하고,
이후 어느 단계에서 실패하든 **결제 취소와 좌석 반환을 함께** 수행합니다.
요청에 실려 온 금액은 검증용이고, 승인 금액은 `server/config/seatPricing.js` 에서 다시 계산합니다.
→ [아키텍처: 예매 트랜잭션](ARCHITECTURE.md#예매-한-건이-흐르는-순서)

**`GET /api/tickets/:ticketId/qr`** — 매번 다른 값을 돌려줍니다.
`HMAC-SHA256(ticketId:슬롯)` 이며 슬롯은 기본 10초입니다(`QR_SLOT_SECONDS`).
**캐싱하면 안 됩니다.** 캡처한 QR은 다음 슬롯에서 통하지 않습니다.

**`POST /api/entry/verify`** — 입장 처리는 1회만 성공합니다.
같은 티켓을 두 번 처리하려 하면 거부되고, 티켓 상태가 `used` 로 바뀝니다.

**`POST /api/ticket-resale/listings`** — MetaMask 서명으로 판매자 본인을 확인합니다.
`DEMO_ALLOW_MOCK_SIGNATURE` 를 켜면 이 검증을 건너뜁니다.
**프론트와 서버 값이 반드시 같아야 합니다** — 한쪽만 켜면 "서명을 검증할 수 없습니다" 오류만 남습니다.

**`POST /api/raffle/draw/execute`** (관리자) — 추첨 셔플의 분포 균등성을
테스트(`raffleFairness`, 4개)로 검증합니다.
