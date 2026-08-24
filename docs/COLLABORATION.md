# 협업과 관리 체계

이 프로젝트가 **어떻게 굴러갔는지**를 기록으로 남깁니다. 수치는 전부 저장소에서 뽑은 값입니다.

---

## 저장소가 두 개인 이유

| | 저장소 | 역할 |
|---|---|---|
| **팀 원본** | [`hsw0914-window/TicketBlockChain`](https://github.com/hsw0914-window/TicketBlockChain) | 4명이 실제로 협업한 곳. 커밋 164개의 원본 이력 |
| **이 저장소** | `FutureAria/base-chain-ticketing` | 코드를 영역별로 정리하고 오픈소스 기여 체계를 갖춘 곳 |

**이 저장소는 히스토리를 새로 시작했습니다.** 팀 원본 히스토리에 `.env` 가 커밋된 구간이 있고,
그 안에 지갑 프라이빗 키·JWT 키·DB 비밀번호가 들어 있습니다.
그대로 공개 저장소로 옮기면 커밋을 되짚어 키를 꺼낼 수 있으므로,
`git archive` 로 **추적 파일만** 뽑아 단일 초기 커밋으로 시작했습니다.

원본 협업 이력은 위 링크에서 그대로 확인할 수 있습니다.

---

## 1. 팀 원본에서의 협업 (2026.04 ~ 2026.08)

### 기여자 4명 · 커밋 164개

```bash
$ git shortlog -sne --all
   126  hsw0914 <20214197@bu.ac.kr>
    28  박주영 (juwwkd / FutureAria)
     7  [sang]
     3  jeahyun
```

| 이름 | 커밋 | 맡은 것 |
|---|---:|---|
| 한승우 | 126 | 메인 페이지, 커뮤니티, 프로젝트 총괄 |
| 박주영 | 28 | 예매·결제 흐름, 백엔드 API 통합, Oracle 배포·운영, 보안·안정성 보완 |
| [sang] | 7 | 결제 연동 |
| jeahyun | 3 | 기능 분담 |

**기간** 2026-04-06 (첫 커밋) ~ 2026-08-13 (마지막 커밋) — 약 4개월

### 브랜치 13개로 나눠 작업

```
develop                    통합 브랜치 (기본 브랜치)
juyoung  hsw  newhsw  park  sy      사람별 작업 브랜치
feature/jaehyun  feat/nft-minting-logic  toss   기능별 브랜치
fix/security-hardening     보안 보완
수정본  최종본             시연 기준 스냅샷
```

사람별 브랜치와 기능별 브랜치를 함께 썼습니다.
학기 중 팀 프로젝트에서 흔한 방식이고, 실제로 충돌을 줄이는 데는 효과가 있었습니다.

### Pull Request 3건 (모두 머지)

| PR | 제목 | 내용 |
|---|---|---|
| [#3](https://github.com/hsw0914-window/TicketBlockChain/pull/3) | 보안·안정성 전면 보완 및 운영 배포 | 좌석 이중 예매, 결제 금액 조작, 계정 탈취 경로 수정 + 테스트 도입 |
| [#2](https://github.com/hsw0914-window/TicketBlockChain/pull/2) | finalize basechain demo | 흩어진 버전 통합, 시연본 확정 |
| [#1](https://github.com/hsw0914-window/TicketBlockChain/pull/1) | complete ticket auth and onchain resale flow | 티켓 인증·온체인 재판매 흐름 완성 |

### 되돌아보면 부족했던 것

정직하게 적습니다.

- **이슈를 쓰지 않았습니다.** 할 일을 카카오톡과 대면으로 나눴습니다.
  그래서 "왜 이렇게 했는지"가 코드 밖에 남지 않았고, 나중에 합칠 때 같은 논의를 반복했습니다.
- **PR 이 3건뿐이었습니다.** 대부분 자기 브랜치에 직접 커밋하고 나중에 몰아서 합쳤습니다.
  통합 시점에 충돌이 크게 났습니다.
- **코드 리뷰가 사실상 없었습니다.** 보안 결함(좌석 이중 예매, 결제 금액 조작,
  하드코딩 관리자 계정)이 시연 직전 레드팀 검토에서야 나왔습니다.
- **테스트가 0개였습니다.** 회귀를 사람 눈으로 잡고 있었습니다.

---

## 2. 이 저장소에서 고친 관리 방식

위 네 가지를 그대로 두지 않았습니다.

| 문제 | 이 저장소에서 |
|---|---|
| 이슈를 안 씀 | **이슈 템플릿 3종**(버그·기능·질문) + 실제 이슈 등록. 라벨 13종·마일스톤 2개로 분류 |
| PR 이 적음 | 모든 변경을 **PR 로**. 단위를 작게 나눠 리뷰 가능하게 |
| 리뷰가 없음 | **PR 템플릿**에 "어떻게 확인했나"를 필수 칸으로. CI 가 4개 잡을 자동 검사 |
| 테스트 0개 | 백엔드 **83개** · 컨트랙트 **18개** · 타입 검사 · 린트 |

### 브랜치 전략

```
main ──────────●──────────●  릴리스 (v1.0.0)
                \        /
develop ─────────●──────●    통합
                / | \
        frontend backend blockchain   영역별 작업
```

규칙은 [`docs/BRANCHES.md`](BRANCHES.md)에 있습니다. `main` 에 직접 커밋하지 않습니다.

### CI — 매 변경마다 자동 검사

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) 이 4개 잡을 돌립니다.

| 잡 | 검사 |
|---|---|
| 백엔드 린트·테스트 | ESLint + 테스트 83개 (DB 없으면 8개 skip) |
| 프론트엔드 린트·타입체크·빌드 | ESLint + `tsc --noEmit` + 프로덕션 빌드 |
| 스마트 컨트랙트 테스트 | 컴파일 + 테스트 18개 |
| **시크릿 유출 검사** | `.env` 커밋 여부 + 프라이빗 키 패턴(`0x` + 64 hex) |

마지막 잡이 있는 이유는 위에 적었습니다 — 팀 원본에서 실제로 겪은 일입니다.

### 이슈 관리 규칙

- **라벨** — 종류(`bug`/`enhancement`/`question`/`documentation`), 영역(`frontend`/`backend`/`blockchain`/`security`),
  우선순위(`P0`/`P1`/`P2`), 진입(`good first issue`/`help wanted`)
- **`good first issue` 의 기준** — 고칠 파일과 함수가 적혀 있고, 확인 명령이 있고,
  다른 영역을 몰라도 고칠 수 있는 것만 붙입니다. 라벨만 붙이고 방치하지 않습니다.
- **마일스톤** — `v1.1`(기능 완결성) · `v1.2`(구조 개선). 근거는 [`ROADMAP.md`](../ROADMAP.md)

### 커밋 메시지

`<타입>: <무엇을 고쳤는지>` — 결과가 아니라 **바뀐 사실**을 적습니다.

```
❌ fix: 개선                 ❌ update
✅ fix: 비활성화된 계정이 로그인·인증을 통과하던 문제 수정
✅ feat: 코드 품질 정비 — 린트 도입·NatSpec 작성·JSDoc 보강
```

---

## 3. 지금 이 저장소의 상태

| | 수 |
|---|---:|
| 브랜치 | 5 (`main` `develop` `frontend` `backend` `blockchain`) |
| 문서 | 루트 5종 + `docs/` 8종 |
| CI 잡 | 4 |
| 테스트 | 백엔드 83 · 컨트랙트 18 |
| 라벨 | 13 |
| 마일스톤 | 2 |

### 기여를 기다립니다

- [`good first issue`](https://github.com/FutureAria/base-chain-ticketing/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) 부터 보세요
- 절차는 [`CONTRIBUTING.md`](../CONTRIBUTING.md)
- 개발 환경에서 막히면 [`docs/DEVELOPMENT.md`](DEVELOPMENT.md)의 "자주 막히는 곳"
