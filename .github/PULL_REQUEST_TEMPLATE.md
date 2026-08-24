## 무엇을 바꿨나

<!-- 한 줄로. "무엇을 고쳤는지"를 쓴다. -->

## 왜 바꿨나

<!-- 어떤 문제가 있었는지. 재현 방법이 있으면 함께. -->

## 어떻게 확인했나

<!-- 실행한 명령과 결과를 붙인다. "잘 될 것 같다"는 확인이 아니다. -->

```
$ 
```

## 체크리스트

- [ ] `server/` 를 고쳤다면 `cd server && npm test` 통과
- [ ] `Proje/` 를 고쳤다면 `cd Proje && npm run typecheck` 오류 0
- [ ] `blockchain/` 을 고쳤다면 `cd blockchain && npm test` 통과
- [ ] `.env` · 키 · 비밀번호를 커밋에 포함하지 않았다
- [ ] `TOSS_MODE` · `FABRIC_MODE` · `ENABLE_ONCHAIN_MINTING` 기본값을 켜지 않았다

## 영향 범위

- [ ] 프론트엔드 (`Proje/`)
- [ ] 백엔드 (`server/`)
- [ ] 블록체인 (`blockchain/`, `fabric/`)
- [ ] 배포·인프라 (`deploy/`, `docs/`)
