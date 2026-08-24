<div align="center">

# ⚙️ BACKEND — `server/`

**Node.js 20 · Express 4 · MySQL/MariaDB · JWT · bcrypt**

![Node.js](https://img.shields.io/badge/Node.js_20-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express_4-000000?style=flat-square&logo=express&logoColor=white)
![MariaDB](https://img.shields.io/badge/MariaDB-003545?style=flat-square&logo=mariadb&logoColor=white)
![JWT](https://img.shields.io/badge/JWT-000000?style=flat-square&logo=jsonwebtokens&logoColor=white)
![tests](https://img.shields.io/badge/tests-83_passed-brightgreen?style=flat-square)

</div>

> 📌 이 문서는 **`backend` 브랜치**의 영역 문서입니다.
> 프로젝트 전체 설명은 [메인 README](../README.md)를 보세요.

---

## 실행

```bash
cd server
npm install
cp .env.example .env      # 값을 채운 뒤
npm start                 # http://localhost:4000
```

첫 실행 시 데이터베이스·테이블 **40개**·시드 데이터가 자동 생성됩니다 (`db/init.js`).

| 명령 | 하는 일 |
|---|---|
| `npm start` | 서버 실행 |
| `npm run dev` | nodemon 자동 재시작 |
| `npm test` | 전체 테스트 83개 |
| `npm run test:unit` | 좌석 가격 테스트만 |
| `npm run seed:practice-admin` | 연습용 관리자 계정 생성 (비밀번호를 인자로 직접 넣어야 함) |

## API 라우트 17개

| 경로 | 담당 |
|---|---|
| `/api/auth` | 회원가입·로그인·비밀번호 재설정 (레이트 리밋 적용) |
| `/api/wallet` `/api/did` | 지갑 연결, DID 해시 발급 |
| `/api/tickets` `/api/my-tickets` | 예매·좌석 조회, 내 입장권 |
| `/api/entry` | QR 검표·입장 처리 |
| `/api/market` `/api/ticket-resale` | 장터, 티켓 재판매 |
| `/api/points` `/api/refunds` `/api/settlements` | 포인트, 환불, 정산 |
| `/api/raffle` `/api/exchange` | 응모·추첨, 조각 합성·굿즈 교환 |
| `/api/notices` `/api/notifications` `/api/tx-history` | 공지, 알림, 거래 이력 |

## 구조

```
server/
├── index.js          앱 부팅 · 라우트 마운트 · 전역 에러 핸들러
├── routes/           API 라우트 17개 · 엔드포인트 89개
├── services/         비즈니스 로직
│   ├── ticketService.js          예매·좌석 확보·환불 (핵심)
│   ├── tossPayService.js         결제 승인·취소 (mock/real 게이트)
│   ├── membershipService.js      티어 계산·혜택 지급
│   ├── fabricService.js          Fabric 연동 (mock/real 스위치)
│   ├── nftBridgeService.js       온체인 민팅 브리지
│   ├── onchainPaymentService.js  온체인 결제 검증
│   └── schemaGuardService.js     스키마 드리프트 감지
├── config/seatPricing.js   좌석 가격표 — 결제 금액의 최종 기준
├── db/                     init.js(테이블 40개 생성·시드), schema.sql
├── middleware/auth.js      JWT 검증 · 관리자 권한
├── mock/                   Fabric · NFT 브리지 인메모리 mock
└── tests/                  테스트 83개
```

## 테스트

```bash
npm test
```

| 파일 | 개수 | 확인하는 것 |
|---|---:|---|
| `moduleLoad` | 38 | 모든 서버 모듈이 실제로 로드되는지 (파일 하나당 1개 자동 생성) |
| `onchainPayment` | 13 | 온체인 결제의 수신자·금액·확정·재사용 검증 |
| `seatPricing` | 10 | 좌석 가격 조작 차단, 프론트·서버 가격표 일치 |
| `seatConcurrency` | 5 | 좌석 동시 예매, 부분 실패 롤백 |
| `inactiveAccount` | 5 | 비활성 계정이 로그인·인증을 통과하지 못하는지 |
| `tossMockGuard` | 5 | 실결제 모드에서 mock 우회가 막히는지 |
| `raffleFairness` | 4 | 추첨 셔플의 분포 균등성 |
| `combineConcurrency` | 3 | 조각 합성 시 카드 복제 차단 |

> DB에 연결할 수 없으면 동시성 테스트는 **실패가 아니라 건너뜁니다** (75 pass / 8 skip / 0 fail).
> CI는 이 상태로 돌아갑니다.

## 이 영역에서 주의할 점

**좌석은 DB가 최종 판단합니다.**
`SELECT ... FOR UPDATE`로 직렬화하고, 그게 뚫려도 유니크 제약 `uq_ticket_active_seat`가
INSERT를 거부합니다. 검사와 INSERT 사이의 틈은 코드로 못 없애기 때문입니다.
좌석 로직을 고칠 때 **제약을 우회하는 경로를 만들지 마세요.**

**결제 금액은 클라이언트를 믿지 않습니다.**
요청에 실려 온 가격은 검증용이고, 승인 금액은 `config/seatPricing.js`에서 다시 계산합니다.

**순서는 좌석 확보 → 결제입니다.**
결제를 먼저 하면 "돈은 나갔는데 좌석은 남이 가져간" 상태가 생깁니다.
실패 시 결제 취소와 좌석 반환을 **함께** 수행해야 합니다.

**기본값을 켜지 마세요.**
`TOSS_MODE=mock` · `FABRIC_MODE=mock` · `ENABLE_ONCHAIN_MINTING=false` 가 기본입니다.
`tossMockGuard` 테스트가 실결제 모드에서 mock 우회를 막는지 검사합니다.

**`RESET_DB_ON_START=false`를 유지하세요.**
`true`면 서버 재시작 시 사용자 데이터가 전부 지워집니다.

**관리자 계정은 환경변수가 있어야만 생깁니다.**
`DEMO_ADMIN_PASSWORD` · `ROOT_ADMIN_PASSWORD` 를 넣지 않으면 관리자 계정을 만들지 않습니다.
하드코딩된 `admin1234` 같은 계정은 제거되었습니다 — **되살리지 마세요.**

## 확인 명령

```bash
npm test                      # 0 fail 이어야 함
node -e "require('./index.js')"   # 모듈 로드 확인
```
