# 개발 환경

처음 클론한 사람이 **막히는 지점**을 순서대로 적었습니다.
절차만 필요하면 [CONTRIBUTING.md](../CONTRIBUTING.md), 구조가 궁금하면 [ARCHITECTURE.md](ARCHITECTURE.md).

## 목차

1. [필요한 것](#1-필요한-것)
2. [고칠 곳만 띄우기](#2-고칠-곳만-띄우기)
3. [백엔드](#3-백엔드)
4. [프론트엔드](#4-프론트엔드)
5. [스마트 컨트랙트](#5-스마트-컨트랙트)
6. [Hyperledger Fabric (선택)](#6-hyperledger-fabric-선택)
7. [테스트 돌리기](#7-테스트-돌리기)
8. [자주 막히는 곳](#8-자주-막히는-곳)
9. [새 기능을 추가하려면](#9-새-기능을-추가하려면)

---

## 1. 필요한 것

| | 버전 | 확인 |
|---|---|---|
| Node.js | 20 이상 | `node -v` |
| npm | 10 이상 | `npm -v` |
| MySQL 또는 MariaDB | MySQL 8 / MariaDB 10.6+ | `mysql --version` |
| Git | — | `git --version` |

**필요 없는 것** — Docker, Hyperledger Fabric 네트워크, 테스트넷 지갑, 가스비.
기본값이 mock 이라 없어도 전 기능이 돕니다.

## 2. 고칠 곳만 띄우기

전부 띄울 필요 없습니다.

| 고칠 곳 | 띄울 것 | DB |
|---|---|---|
| 화면 (`Proje/`) | 프론트 + 백엔드 | 필요 |
| 서버 (`server/`) | 백엔드만 | 필요 |
| 컨트랙트 (`blockchain/`) | 아무것도 | **불필요** |
| 체인코드 (`fabric/`) | Fabric 네트워크 | 불필요(테스트만 볼 때) |
| 문서 | 아무것도 | 불필요 |

## 3. 백엔드

```bash
cd server
npm install
cp .env.example .env
```

`.env` 에서 **최소한 이 네 가지**를 채웁니다.

```bash
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=<본인 MySQL 비밀번호>
JWT_SECRET=아무거나-로컬용
QR_SECRET=아무거나-로컬용
```

> `JWT_SECRET` 또는 `QR_SECRET` 이 비어 있으면 서버가 **시작되지 않습니다.**
> ```
> [startup] 필수 환경변수 미설정: JWT_SECRET — server/.env 를 확인하세요
> ```
> 의도된 동작입니다. 빈 키로 서명하면 누구나 토큰을 위조할 수 있습니다.

```bash
npm start        # http://localhost:4000
```

첫 실행 시 데이터베이스·테이블 40개·시드 데이터가 자동으로 만들어집니다.
`npm run dev` 를 쓰면 파일이 바뀔 때 자동 재시작합니다.

**관리자 계정이 필요하면** — `.env` 에 비밀번호를 넣어야 생깁니다.

```bash
DEMO_ADMIN_EMAIL=admin@example.com
DEMO_ADMIN_PASSWORD=<강한 값>
```

비워 두면 **관리자 계정을 만들지 않습니다.** 하드코딩된 `admin1234` 같은 계정은 제거되었습니다.

## 4. 프론트엔드

백엔드가 떠 있는 상태에서:

```bash
cd Proje
npm install
cp .env.example .env
npm run dev      # http://localhost:5173
```

`VITE_API_URL` 을 비워 두면 Vite 프록시가 `/api` 를 로컬 백엔드로 넘깁니다.
같은 네트워크의 휴대폰에서도 접속됩니다 (`--host 0.0.0.0`).

| 명령 | 하는 일 |
|---|---|
| `npm run typecheck` | 타입만 검사 (빠름) |
| `npm run build` | 타입 검사 + 프로덕션 빌드 |
| `npm run preview` | 빌드 결과 확인 |

## 5. 스마트 컨트랙트

**DB도 서버도 필요 없습니다.**

```bash
cd blockchain
npm install
npm run compile
npm test         # 18 passing
```

배포는 `MINTER_PRIVATE_KEY` 가 필요합니다. **로컬 개발에는 필요 없습니다.**

## 6. Hyperledger Fabric (선택)

체인코드를 직접 고칠 때만 필요합니다. 그 외에는 mock 으로 충분합니다.

```bash
cd fabric
./setup.sh       # 도구·인증서 준비
./start.sh       # 네트워크 기동
```

서버에서 실제 Fabric 을 쓰려면 `server/.env` 에 `FABRIC_MODE=real`.
**되돌릴 때 `mock` 으로 다시 바꾸는 것을 잊지 마세요.**

## 7. 테스트 돌리기

```bash
cd server     && npm test        # 83개
cd blockchain && npm test        # 18개
cd Proje      && npm run typecheck
```

**DB 없이 백엔드 테스트를 돌리면**

```
# tests 83
# pass 75
# fail 0
# skipped 8
```

좌석 동시성 등 DB가 필요한 8개는 **실패가 아니라 건너뜁니다.** 이 상태로 PR 을 보내셔도 됩니다.
CI 도 같은 상태로 돕니다.

**특정 파일만 돌리기**

```bash
cd server
node --test tests/seatPricing.test.js
```

## 8. 자주 막히는 곳

<details open>
<summary><b>서버가 바로 죽는다 — <code>필수 환경변수 미설정</code></b></summary>

`server/.env` 의 `JWT_SECRET` 또는 `QR_SECRET` 이 비어 있습니다. 아무 문자열이나 넣으세요.
</details>

<details>
<summary><b><code>ER_ACCESS_DENIED_ERROR</code> / DB에 못 붙는다</b></summary>

`DB_USER` · `DB_PASSWORD` 를 확인하세요. MySQL 이 떠 있는지도 확인합니다.

```bash
mysql -u root -p -e "SELECT 1"
```

DB 없이 개발하고 싶다면 컨트랙트(`blockchain/`)나 문서 작업을 하시면 됩니다.
</details>

<details>
<summary><b>재판매 등록에서 "서명을 검증할 수 없습니다"만 나온다</b></summary>

`VITE_DEMO_ALLOW_MOCK_SIGNATURE`(프론트)와 `DEMO_ALLOW_MOCK_SIGNATURE`(서버)가
**다릅니다.** 한쪽만 켜면 프론트는 가짜 서명을 만들고 서버는 거부합니다.

두 값을 같게 맞추세요. 기본값은 양쪽 모두 `false` 이고, 그 상태에서는 MetaMask 가 필요합니다.
</details>

<details>
<summary><b>서버를 재시작했더니 티켓·응모 기록이 사라졌다</b></summary>

mock Fabric 은 **인메모리**입니다. 재시작하면 Fabric 측 기록(티켓 등록·예약·응모)이 사라집니다.
포인트와 멤버십은 MySQL `point_events` 에서 다시 계산되어 복구됩니다.

이건 알려진 한계이고 [ROADMAP](../ROADMAP.md) v1.1 항목입니다.
</details>

<details>
<summary><b>서버를 재시작했더니 <i>사용자 계정까지</i> 사라졌다</b></summary>

`RESET_DB_ON_START=true` 로 되어 있습니다. **`false` 로 바꾸세요.**
</details>

<details>
<summary><b>좌석 가격을 바꿨더니 테스트가 깨진다</b></summary>

정상입니다. 가격표가 두 벌 있고 (`Proje/app/data/ticketing.ts` · `server/config/seatPricing.js`)
`seatPricing` 테스트가 둘의 일치를 검사합니다. **양쪽을 같이 고치세요.**
</details>

<details>
<summary><b>QR 이 계속 바뀌어서 테스트하기 어렵다</b></summary>

의도된 동작입니다. 슬롯은 `QR_SLOT_SECONDS` 로 늘릴 수 있습니다(기본 10초).
경기 시작 시각 조건 때문에 QR 이 안 뜬다면 `DEBUG_TIME_OFFSET_HOURS` 로
현재 시각을 앞당길 수 있습니다.
</details>

<details>
<summary><b>포트가 이미 쓰이고 있다</b></summary>

백엔드는 `PORT`(기본 4000), 프론트는 `--port`(기본 5173)로 바꿉니다.
프론트 포트를 바꾸면 서버 `FRONTEND_ORIGINS` 에도 추가해야 CORS 가 통과합니다.
</details>

<details>
<summary><b>컨트랙트 테스트가 <code>npm install</code> 에서 오래 걸린다</b></summary>

Hardhat 의존성이 641개입니다. 최초 1회는 30초 안팎 걸립니다. 정상입니다.
</details>

## 9. 새 기능을 추가하려면

**API 엔드포인트 추가**

1. `server/routes/<도메인>.js` 에 라우트 추가 — 요청 파싱과 권한 확인만
2. 비즈니스 규칙은 `server/services/` 로 — `req`/`res` 를 서비스에 넘기지 않습니다
3. 새 파일을 만들었다면 `moduleLoad` 테스트가 **자동으로 1개 늘어납니다**
4. [`docs/API.md`](API.md) 에 표 한 줄 추가

**화면 추가**

1. `Proje/app/pages/<이름>.tsx` 생성
2. `Proje/app/routes.tsx` 에 경로 등록
3. `npm run typecheck` 로 오류 0 확인

**테이블 추가**

1. `server/db/init.js` 에 `CREATE TABLE IF NOT EXISTS` 추가
2. 기존 DB에도 적용되도록 **`INFORMATION_SCHEMA` 로 존재 확인 후 `ALTER`** 하는 패턴을 따르세요
3. [`docs/DATABASE.md`](DATABASE.md) 에 표 한 줄 추가

**체인코드 함수 추가**

1. `fabric/chaincode/ticket/go/ticket.go`
2. **`requireMSP()` 검사를 빼먹지 마세요** — 없으면 누구나 호출할 수 있습니다
3. 시각은 `txNow()` / `nowISO()` 를 씁니다. `time.Now()` 를 직접 부르면 피어마다 결과가 갈립니다
