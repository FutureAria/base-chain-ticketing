# 기여 가이드

BASE CHAIN에 기여해 주셔서 감사합니다. 이 문서만 따라오면 첫 PR까지 갈 수 있습니다.

- 처음이신가요? → [처음 기여하는 분께](#처음-기여하는-분께)
- 버그를 찾으셨나요? → [이슈 열기](https://github.com/FutureAria/base-chain-ticketing/issues/new/choose)
- 브랜치 규칙이 궁금하신가요? → [`docs/BRANCHES.md`](docs/BRANCHES.md)

---

## 목차

1. [개발 환경 준비](#1-개발-환경-준비)
2. [브랜치 고르기](#2-브랜치-고르기)
3. [작업하기](#3-작업하기)
4. [커밋 메시지](#4-커밋-메시지)
5. [PR 보내기](#5-pr-보내기)
6. [리뷰에서 보는 것](#6-리뷰에서-보는-것)
7. [처음 기여하는 분께](#처음-기여하는-분께)

---

## 1. 개발 환경 준비

**필요한 것** — Node.js 20+ · MySQL 8 또는 MariaDB 10.6+ · Git

```bash
git clone https://github.com/FutureAria/base-chain-ticketing.git
cd base-chain-ticketing
```

세 부분 중 **고칠 곳만** 띄우면 됩니다. 전부 띄울 필요 없습니다.

| 고칠 곳 | 준비 | DB 필요? |
|---|---|---|
| 화면 (`Proje/`) | `cd Proje && npm install && cp .env.example .env && npm run dev` | 백엔드가 떠 있어야 함 |
| 서버 (`server/`) | `cd server && npm install && cp .env.example .env && npm start` | ✅ 필요 |
| 컨트랙트 (`blockchain/`) | `cd blockchain && npm install && npm test` | ❌ 불필요 |

> `server/.env`는 `JWT_SECRET`과 `QR_SECRET`이 **비어 있으면 서버가 시작되지 않습니다.**
> 로컬에서는 아무 값이나 넣어도 됩니다. 자세한 준비 과정과 자주 막히는 지점은
> [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)에 있습니다.

**체인 없이 개발할 수 있습니다.** `FABRIC_MODE=mock`·`ENABLE_ONCHAIN_MINTING=false`가 기본값이라
Fabric 네트워크나 지갑 없이도 전 기능이 동작합니다.

## 2. 브랜치 고르기

고칠 영역의 브랜치에서 갈라져 나오세요.

| 고칠 곳 | 시작 브랜치 |
|---|---|
| `Proje/` | `frontend` |
| `server/` | `backend` |
| `blockchain/`, `fabric/` | `blockchain` |
| 여러 영역에 걸치거나 애매하면 | `develop` |

```bash
git switch backend
git pull
git switch -c fix/좌석-환불-잠금키
```

`main`에는 직접 커밋하지 않습니다. 자세한 규칙은 [`docs/BRANCHES.md`](docs/BRANCHES.md).

## 3. 작업하기

**고치기 전에 이슈부터 열어 주세요.** 이미 누가 하고 있거나, 의도적으로 그렇게 둔 코드일 수 있습니다.
작은 오타나 문서 수정은 이슈 없이 바로 PR을 보내셔도 됩니다.

**바꾼 만큼만 바꿔 주세요.** 요청받지 않은 리팩터링·네이밍 통일·의존성 업그레이드가 섞이면
리뷰가 오래 걸립니다. 하고 싶은 정리가 보이면 **별도 이슈**로 남겨 주세요.

**확인 명령을 실제로 돌려 주세요.**

| 고친 곳 | 돌릴 것 | 통과 기준 |
|---|---|---|
| `Proje/` | `npm run typecheck` · `npm run build` | 오류 0 |
| `server/` | `npm test` | 0 fail |
| `blockchain/` | `npm run compile` · `npm test` | 18 passing |

DB가 없으면 좌석 동시성 테스트 8개는 **실패가 아니라 건너뜁니다**(75 pass / 8 skip / 0 fail).
그 상태로 PR을 보내셔도 됩니다.

## 4. 커밋 메시지

`<타입>: <무엇을 고쳤는지>` — 한국어로, **결과가 아니라 바뀐 사실**을 씁니다.

| 타입 | 쓰는 때 |
|---|---|
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `docs` | 문서만 |
| `refactor` | 동작 변화 없는 구조 변경 |
| `test` | 테스트 추가·수정 |
| `chore` | 빌드·설정 |

```
❌ fix: 개선
❌ update
✅ fix: 비활성화된 계정이 로그인·인증을 통과하던 문제 수정
✅ feat: 좌석 등급별 잔여석 수를 예매 화면에 표시
```

## 5. PR 보내기

```bash
git push origin fix/좌석-환불-잠금키
gh pr create --base backend   # 또는 GitHub 웹에서
```

PR 템플릿이 자동으로 채워집니다. **"어떻게 확인했나" 칸에 실제 명령과 출력을 붙여 주세요.**
"잘 될 것 같다"는 확인이 아닙니다.

CI(`.github/workflows/ci.yml`)가 백엔드 테스트·프론트 타입체크와 빌드·컨트랙트 테스트·
**시크릿 유출 검사**를 돌립니다. 빨간불이면 머지하지 않습니다.

## 6. 리뷰에서 보는 것

리뷰어는 아래 순서로 봅니다. 미리 알고 계시면 왕복이 줄어듭니다.

1. **안전장치를 우회했는가** — 좌석 유니크 제약, 서버 가격 재계산, 서명 검증을
   건너뛰는 경로가 새로 생겼는지 먼저 봅니다.
2. **기본값을 켰는가** — `TOSS_MODE` · `FABRIC_MODE` · `ENABLE_ONCHAIN_MINTING` ·
   `RESET_DB_ON_START` · `DEMO_ALLOW_MOCK_SIGNATURE`. 기본값을 바꾸는 PR은 이유가 필요합니다.
3. **상태가 어긋나는가** — 사용자가 보는 티켓 상태 / DB 예매 상태 / NFT 발급 상태 /
   재판매 상태. 하나만 바뀌고 나머지가 안 따라가면 되돌려 달라고 요청합니다.
4. **테스트가 같이 왔는가** — 버그 수정이면 그 버그를 재현하는 테스트가 함께 오는 것이 가장 좋습니다.
5. 그다음에 가독성·네이밍을 봅니다.

## 처음 기여하는 분께

**`good first issue` 라벨**이 붙은 이슈부터 보세요.
→ [good first issue 목록](https://github.com/FutureAria/base-chain-ticketing/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)

이 라벨이 붙은 이슈는 다음을 보장합니다.

- 어디를 고쳐야 하는지 **파일·함수까지 적혀 있습니다**
- 다른 부분을 몰라도 그 부분만 보고 고칠 수 있습니다
- 확인 명령이 이슈에 적혀 있습니다

막히면 이슈에 댓글로 물어봐 주세요. "이거 제가 해봐도 될까요?"도 환영합니다.

## 라이선스

기여하신 코드는 [MIT 라이선스](LICENSE)로 배포됩니다.
