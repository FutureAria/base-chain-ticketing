# BASE CHAIN Oracle Demo 구조

## 결론

Oracle 시연 배포는 `HTTPS 프론트 + Node API + MySQL + mock 결제/체인 + 실제 QR 입장 흐름`으로 구성한다.

ngrok은 로컬 개발용 HTTPS 터널이다. Oracle 서버에 HTTPS 도메인을 붙이면 ngrok 없이도 휴대폰에서 QR 카메라 스캔이 가능하다.

## 권장 구조

```text
사용자/스태프 휴대폰
  |
  | HTTPS
  v
Nginx 또는 Caddy
  |-- /              -> Proje/dist 정적 파일
  |-- /api/*         -> Node Express API :4000
  |
  v
MySQL

Mock boundary:
  - Toss 결제: TOSS_MODE=mock
  - Fabric: FABRIC_MODE=mock
  - NFT 온체인 민팅: ENABLE_ONCHAIN_MINTING=false
  - MetaMask 없는 판매 등록 시연: DEMO_ALLOW_MOCK_SIGNATURE=true
```

## 왜 이 구조인가

- QR 카메라 권한은 HTTPS에서 안정적으로 동작한다.
- 프론트는 정적 파일만 올리므로 Oracle VM 용량을 적게 쓴다.
- API 서버는 Node 프로세스 하나만 실행한다.
- 결제/체인/NFT는 mock으로 유지해서 실제 돈, 가스비, 외부 체인 비용이 나가지 않는다.
- MetaMask가 없는 시연 브라우저에서도 서버에 이미 DID 인증된 지갑이면 티켓 양도 등록 흐름을 보여줄 수 있다.
- QR 입장과 포인트 적립은 실제 시연 흐름처럼 검증할 수 있다.

## 시연에서 실제로 동작하는 범위

| 기능 | 시연 동작 | 실제 비용 |
|---|---|---:|
| 경기 예매 | mock Toss 승인 후 티켓 생성 | 없음 |
| QR 발급 | 서버 HMAC 토큰 생성 | 없음 |
| QR 스캔 | 카메라로 QR 읽고 API 검증 | 없음 |
| 입장 처리 | 티켓 상태 `used` 변경 | 없음 |
| 포인트 지급 | 멤버십 가입자에게 포인트 기록 | 없음 |
| 시즌 박스 | DB 상자 수량 증가 | 없음 |
| Fabric | mock store/API | 없음 |
| NFT 민팅 | mock token/txHash | 없음 |

## 포인트 지급 결정

포인트는 QR을 스캔한 순간이 아니라 `입장 성공`이 확정된 뒤 지급한다.

이유:

- 같은 QR 재스캔으로 포인트 중복 지급을 막을 수 있다.
- 환불/취소/이미 사용한 티켓은 포인트가 지급되지 않는다.
- 시연에서도 “입장 완료 -> 팬 리워드 지급” 흐름이 명확하다.

## Oracle에서 ngrok이 필요 없는 조건

아래 조건을 만족하면 ngrok이 필요 없다.

- 프론트 주소가 `https://...` 이다.
- API 주소도 `https://.../api` 또는 `https://api...` 이다.
- `VITE_API_URL`이 HTTPS API 주소를 바라본다.
- 모바일 브라우저에서 `/entry-scanner` 접속 시 카메라 권한 요청이 뜬다.

아래 방식은 QR 시연에 적합하지 않다.

- `http://<oracle-ip>:5173`
- `http://<oracle-ip>:4000`
- HTTPS 없는 IP:PORT 직접 접속

## 파일 구성

| 파일 | 용도 |
|---|---|
| `basechain-demo.env.example` | Oracle demo용 안전 환경변수 예시 |
| `basechain-api.service.example` | Node API systemd 서비스 예시 |
| `nginx.basechain.conf.example` | HTTPS reverse proxy 예시 |
| `preflight.js` | mock/용량/HTTPS 설정 사전 점검 |

## 배포 전 사전 점검

로컬에서 빌드 후 아래처럼 점검한다.

```bash
cd /Users/juyoung/Desktop/개발/TicketBlockChain
cd Proje && npm run build && cd ..
node deploy/oracle-demo/preflight.js \
  --env deploy/oracle-demo/basechain-demo.env.example \
  --frontend-env Proje/.env.example \
  --dist Proje/dist
```

## 가벼운 배포 패키지 만들기

Oracle VM에는 전체 개발 폴더를 그대로 올리지 않는다. `node_modules`, `.env`, 로그, 캐시를 제외한 시연용 패키지만 만든다.

```bash
cd /Users/juyoung/Desktop/개발/TicketBlockChain
chmod +x deploy/oracle-demo/create-demo-artifact.sh
./deploy/oracle-demo/create-demo-artifact.sh
```

생성 결과:

```text
deploy/oracle-demo/out/basechain-demo.tar.gz
```

이 패키지는 아래만 포함한다.

- `Proje/dist`
- `server` 런타임 소스
- `server/package.json`, `server/package-lock.json`
- Oracle demo 설정 예시
- QR/Oracle 시연 문서

이 패키지는 아래를 포함하지 않는다.

- `.env`
- `node_modules`
- 로그 파일
- 개발 캐시
- 운영 secret

실제 Oracle 서버에서는 `.env` 경로만 운영 파일로 바꿔서 실행한다.

```bash
node deploy/oracle-demo/preflight.js \
  --env /opt/basechain/server/.env \
  --frontend-env /opt/basechain/Proje/.env \
  --dist /var/www/basechain/dist
```

## Oracle 서버에서의 큰 흐름

아래는 실행 순서 예시이며, 실제 서버 접속/설치/도메인 연결은 사용자 승인 후 진행한다.

```bash
# 1. 패키지 업로드 후 서버에서 압축 해제
sudo mkdir -p /opt/basechain /var/www/basechain
sudo tar -xzf basechain-demo.tar.gz -C /opt/basechain --strip-components=1

# 2. 백엔드 의존성 설치
cd /opt/basechain/server
npm ci --omit=dev

# 3. 프론트 정적 파일 배치
sudo rsync -a /opt/basechain/Proje/dist/ /var/www/basechain/dist/

# 4. .env 작성 후 preflight
node /opt/basechain/deploy/oracle-demo/preflight.js \
  --env /opt/basechain/server/.env \
  --frontend-env /opt/basechain/Proje/.env \
  --dist /var/www/basechain/dist

# 5. systemd/nginx 설정 반영
# basechain-api.service.example, nginx.basechain.conf.example 참고
```

## Decision Required

아래 작업은 사용자 최종 승인 전에는 실행하지 않는다.

- Oracle VM 접속 및 서비스 설치
- Oracle DB 실제 연결 설정
- 도메인/DNS/TLS 인증서 발급
- `TOSS_MODE=real`
- `FABRIC_MODE=real`
- `ENABLE_ONCHAIN_MINTING=true`
- 실제 private key 또는 Toss secret 입력
- Oracle 리소스 생성/삭제/확장
