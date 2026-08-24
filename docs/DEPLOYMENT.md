# 배포 절차

Oracle Cloud VM + Caddy(HTTPS) + systemd 기준. 라이브 주소는
https://juyoung-basechain.duckdns.org 입니다.

배포는 **로컬에서 rsync 로 파일을 올리는 방식**입니다. 서버는 git 저장소가 아니므로
`git pull` 로는 배포되지 않습니다.

> 시연 환경의 안전 기준(mock 유지 이유, QR 카메라와 HTTPS 관계)은
> [ORACLE_DEMO_DEPLOYMENT.md](ORACLE_DEMO_DEPLOYMENT.md)를 함께 보세요.

---

## 서버 구성 (실제 확인값)

| 항목 | 값 |
|---|---|
| 접속 | `ssh -i ~/.ssh/oracle_key ubuntu@juyoung-basechain.duckdns.org` |
| 백엔드 | `/home/ubuntu/basechain/server` |
| 프론트 정적 파일 | `/home/ubuntu/basechain/Proje/dist` |
| API 포트 | **4001** (`server/.env` 의 `PORT`) |
| systemd 서비스 | `basechain-api` (User=ubuntu, WorkingDirectory=서버 폴더) |
| 리버스 프록시 | Caddy — `/api/*` → `127.0.0.1:4001`, 그 외 → `Proje/dist` 정적 서빙 |

Caddy 설정(`/etc/caddy/Caddyfile`)은 이렇게 되어 있습니다.

```caddy
juyoung-basechain.duckdns.org {
    encode zstd gzip
    handle /music-curation/* { reverse_proxy 127.0.0.1:8090 }   # 다른 프로젝트
    handle /api/*            { reverse_proxy 127.0.0.1:4001 }
    handle {
        root * /home/ubuntu/basechain/Proje/dist
        try_files {path} /index.html
        file_server
    }
}
```

> `/var/www/basechain` 폴더가 서버에 남아 있지만 **Caddyfile 어디에서도 참조하지 않습니다.**
> 과거 경로로 보이며 지금은 쓰이지 않습니다. 여기에 올리면 화면이 바뀌지 않습니다.

---

## ⚠️ rsync 로 덮으면 안 되는 것

서버에만 있어야 하는 파일이 있습니다. `--delete` 를 쓸 때 특히 주의해야 합니다.

| 경로 | 이유 |
|---|---|
| `server/.env` | DB 비밀번호·JWT 키. 로컬 값과 다릅니다 |
| `Proje/.env` | 프론트 빌드 설정 |
| `server/node_modules/` | 서버에서 `npm ci` 로 설치합니다 |
| `server/uploads/` | 사용자가 올린 공지 이미지 (런타임 데이터) |

아래 명령들은 이 경로를 모두 `--exclude` 로 제외합니다. **직접 명령을 만들 때도 반드시 넣으세요.**

---

## 0. 배포 전 확인 (로컬)

여기서 실패하면 서버에 올리지 않습니다.

```bash
cd server     && npm ci && npm test
cd ../blockchain && npm ci && npm test
cd ../Proje      && npm ci && npm run build
```

기대 결과: 백엔드 83개 · 컨트랙트 18개 통과, 프론트 타입오류 0.

---

## 1. 환경변수 준비 (최초 1회 / 값이 바뀔 때)

`server/.env` 는 **서버에서 직접 편집**합니다. rsync 로 덮지 않습니다.

```bash
ssh -i ~/.ssh/oracle_key ubuntu@juyoung-basechain.duckdns.org
nano /home/ubuntu/basechain/server/.env
```

### 반드시 확인할 값

| 변수 | 값 | 안 하면 |
|---|---|---|
| `PORT` | `4001` | Caddy 프록시 대상과 어긋나 502 |
| `RESET_DB_ON_START` | `false` | **재시작마다 DB가 통째로 지워집니다** |
| `DEMO_ADMIN_PASSWORD` | 12자 이상 무작위 | 관리자 계정이 옛 비밀번호로 남습니다 (아래 참고) |
| `ROOT_ADMIN_PASSWORD` | 12자 이상 무작위 | 위와 같음 |
| `FRONTEND_ORIGINS` | `https://juyoung-basechain.duckdns.org` | 브라우저 요청이 CORS 차단 |
| `TRUST_PROXY_HOPS` | `1` | 레이트리밋이 모든 요청을 Caddy IP 하나로 묶습니다 |
| `JWT_SECRET` / `QR_SECRET` | 32자 이상 무작위 | 서버가 시작되지 않습니다 |
| `FABRIC_MODE` / `TOSS_MODE` | `mock` | 실제 결제·체인 연동이 켜집니다 |
| `ENABLE_ONCHAIN_MINTING` | `false` | 실제 온체인 민팅 발생 |
| `CORS_ALLOW_DEV_ORIGINS` | `false` | 누구나 등록 가능한 ngrok 도메인 허용 |

시크릿 생성: `openssl rand -hex 32`

### ⚠️ 기존 관리자 계정 비밀번호

운영 DB에는 `admin_user`·`root_user`·`practice_admin` 세 계정이 이미 있고,
**옛 코드가 서버 기동 때마다 하드코딩된 비밀번호로 덮어썼습니다.**
수정본은 더 이상 하드코딩하지 않지만, **이미 만들어진 계정을 지우지도 않습니다.**

- `DEMO_ADMIN_PASSWORD` / `ROOT_ADMIN_PASSWORD` 를 설정하고 재시작하면
  `admin_user` / `root_user` 는 새 값으로 갱신됩니다.
- `practice_admin` 은 시드 루틴이 건드리지 않으므로 **직접 처리해야 합니다.**
  시연에 쓰지 않으면 비활성화가 가장 간단합니다.

```sql
UPDATE users SET is_active = 0 WHERE user_id = 'practice_admin';
```

### 서명 우회 플래그 — 결정 필요

`DEMO_ALLOW_MOCK_SIGNATURE`(서버)와 `VITE_DEMO_ALLOW_MOCK_SIGNATURE`(프론트)는
**반드시 같은 값**이어야 합니다. 다르면 프론트는 가짜 서명을 만들고 서버는 거부해,
MetaMask 없는 사용자에게 "서명을 검증할 수 없습니다" 오류만 보입니다.

| 값 | 결과 |
|---|---|
| `false` (권장) | MetaMask 필요. 서명 검증이 실제로 동작함을 보여줄 수 있음 |
| `true` | MetaMask 없이 시연되지만 "지갑 서명으로 본인 확인" 보증이 사라짐 |

### 검사

```bash
node deploy/oracle-demo/preflight.js --env server/.env --frontend-env Proje/.env
```

`ok: true` 가 아니면 배포하지 않습니다.

---

## 2. 백엔드 배포 (rsync)

로컬 프로젝트 루트(`원본/`)에서 실행합니다.

```bash
rsync -avz --delete \
  --exclude '.env' \
  --exclude 'node_modules/' \
  --exclude 'uploads/' \
  -e "ssh -i ~/.ssh/oracle_key" \
  server/ ubuntu@juyoung-basechain.duckdns.org:/home/ubuntu/basechain/server/
```

> `server/` 끝의 슬래시가 중요합니다. 빼면 `server/server/` 로 들어갑니다.
> 먼저 `--dry-run` 을 붙여 무엇이 지워지고 무엇이 올라가는지 확인하는 것을 권합니다.

의존성 설치 후 재시작:

```bash
ssh -i ~/.ssh/oracle_key ubuntu@juyoung-basechain.duckdns.org \
  'cd /home/ubuntu/basechain/server && npm ci --omit=dev && sudo systemctl restart basechain-api'
```

> `express-rate-limit` 이 새로 추가됐습니다. `npm ci` 를 건너뛰면
> `Cannot find module 'express-rate-limit'` 로 서버가 뜨지 않습니다.

### 재시작 직후 로그 확인 (중요)

```bash
ssh -i ~/.ssh/oracle_key ubuntu@juyoung-basechain.duckdns.org \
  'sudo journalctl -u basechain-api -n 60 --no-pager'
```

**이번 배포에서 처음 실행되는 DB 마이그레이션이 있습니다.**

| 로그 | 의미 |
|---|---|
| `tickets.status ENUM에 cancelled 추가` | 정상 |
| `tickets 좌석 중복 방지 제약(uq_ticket_active_seat) 추가 완료` | **정상 — 이게 떠야 합니다** |
| `조회 인덱스 추가: ...` | 정상 |
| `⚠️ 좌석 중복 N건이 이미 존재해 UNIQUE 제약을 걸 수 없습니다` | **조치 필요 (아래)** |
| `기존 DB 유지 모드: 재시작 시 데이터를 보존합니다` | 정상 |
| `관리자 비밀번호 환경변수가 없어 계정 생성을 건너뜁니다` | 1단계 확인 |

#### 좌석 중복 경고가 뜬 경우

수정 전 코드에서 같은 좌석이 두 번 팔렸을 수 있습니다. 서버는 죽지 않고 로그로 알려줍니다.

```sql
SELECT game_id, block, row_num, seat_number, COUNT(*) AS cnt, GROUP_CONCAT(id)
  FROM tickets
 WHERE status NOT IN ('refunded','cancelled')
   AND block IS NOT NULL AND row_num IS NOT NULL AND seat_number IS NOT NULL
 GROUP BY game_id, block, row_num, seat_number
HAVING COUNT(*) > 1;
```

`booked_at`(먼저 예매한 쪽)과 결제 이력을 보고 남길 티켓을 정한 뒤, 나머지는
환불 처리하거나 `status = 'cancelled'` 로 바꿉니다. **DELETE 하지 마세요** —
결제 이력과 어긋납니다.

---

## 3. 프론트엔드 배포 (rsync)

프론트는 **로컬에서 빌드해서 `dist/` 만 올립니다.** 서버에 `Proje/node_modules` 가
없으므로 서버에서는 빌드할 수 없습니다.

```bash
cd Proje
npm run build:oracle

rsync -avz --delete \
  -e "ssh -i ~/.ssh/oracle_key" \
  dist/ ubuntu@juyoung-basechain.duckdns.org:/home/ubuntu/basechain/Proje/dist/
```

> `build:oracle` 은 `VITE_DEMO_ALLOW_MOCK_SIGNATURE` 를 강제하지 않습니다.
> 로컬 `Proje/.env` 값이 그대로 빌드에 들어가므로, 1단계에서 서버 값과 맞췄는지 확인하세요.
> `build` 에 타입 검사가 포함돼 있어 타입 오류가 있으면 빌드가 멈춥니다.

Caddy 는 파일을 직접 읽으므로 재시작이 필요 없습니다. 브라우저 캐시만 비우면 됩니다.

---

## 4. 배포 확인

```bash
curl -s https://juyoung-basechain.duckdns.org/api/health
curl -s -o /dev/null -w "%{http_code}\n" https://juyoung-basechain.duckdns.org/api/tickets/games
curl -s -o /dev/null -w "%{http_code}\n" https://juyoung-basechain.duckdns.org/api/nope
```

기대: `{"ok":true,...}` / `200` / `404`

### 권한이 실제로 막히는지

```bash
curl -s -o /dev/null -w "entry/verify → %{http_code}\n" -X POST \
  https://juyoung-basechain.duckdns.org/api/entry/verify \
  -H 'Content-Type: application/json' -d '{"ticketId":"x","qrToken":"y"}'
```

**401 이어야 합니다.** 배포 전에는 200 이었습니다.

> 공지 삭제(`DELETE /api/notices`)로는 확인하지 마세요 — 옛 코드에서는 실제로
> 공지가 전부 지워집니다. 위 `entry/verify` 는 상태를 바꾸지 않아 안전합니다.

### 화면 확인

- [ ] 로그인 → 예매 → 좌석 선택 → 결제(mock) → 내 입장권까지 한 번 통과
- [ ] 관리자 계정으로 `/entry-scanner` → QR 스캔 화면이 뜨는지
- [ ] 일반 계정으로 `/entry-scanner` → "관리자 전용" 안내가 뜨는지

---

## 5. 롤백

rsync 배포는 이전 버전이 자동으로 남지 않습니다. **배포 전에 서버에서 백업하세요.**

```bash
ssh -i ~/.ssh/oracle_key ubuntu@juyoung-basechain.duckdns.org \
  'cd /home/ubuntu && tar czf basechain-backup-$(date +%Y%m%d-%H%M).tar.gz \
     --exclude=node_modules --exclude=.env basechain/'
```

되돌릴 때:

```bash
ssh -i ~/.ssh/oracle_key ubuntu@juyoung-basechain.duckdns.org \
  'cd /home/ubuntu && tar xzf basechain-backup-<시각>.tar.gz && \
   cd basechain/server && npm ci --omit=dev && sudo systemctl restart basechain-api'
```

> **DB 마이그레이션은 롤백되지 않습니다.** `seat_lock` 컬럼·유니크 제약,
> `password_reset_tokens` 테이블, 조회 인덱스는 남습니다.
> 이전 코드도 이 스키마에서 동작합니다.

### 증상별 원인

| 증상 | 원인 | 조치 |
|---|---|---|
| 502 Bad Gateway | 서버가 죽었거나 포트 불일치 | `journalctl -u basechain-api`, `.env` 의 `PORT=4001` 확인 |
| `Cannot find module 'express-rate-limit'` | `npm ci` 누락 | 2단계 다시 |
| `필수 환경변수 미설정: JWT_SECRET` | rsync 가 `.env` 를 덮음 | `--exclude '.env'` 확인 후 `.env` 복구 |
| 공지 이미지가 사라짐 | rsync 가 `uploads/` 를 지움 | `--exclude 'uploads/'` 확인 |
| 화면이 그대로 | 잘못된 경로에 올림 | `/home/ubuntu/basechain/Proje/dist` 가 맞는지 확인 (`/var/www/basechain` 아님) |
| 브라우저에서 API 전부 실패 | CORS | `FRONTEND_ORIGINS` 에 배포 도메인 추가 |
| 재판매 등록 시 서명 오류 | 플래그 불일치 | 서버·프론트 값을 맞추고 프론트 재빌드 |
| 로그인이 429 | 레이트 리밋 | 정상. 10분 뒤 풀림 |
| 사용자 데이터 사라짐 | `RESET_DB_ON_START=true` | 즉시 `false`. 복구는 백업에서만 |

---

## 6. 배포 후 남는 일

- [ ] `MINTER_PRIVATE_KEY` 재발급 — 기존 키가 로컬 `.env` 에 평문으로 있었습니다
- [ ] `practice_admin` 비활성화 또는 비밀번호 교체 (1단계 참고)
- [ ] mock Fabric 은 인메모리라 **재시작 시 티켓·예약·응모 기록이 사라집니다.**
      시연 직전 재시작했다면 시연 데이터를 다시 준비하세요
      (포인트·멤버십은 `point_events` 에서 자동 복구)
