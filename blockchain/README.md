<div align="center">

# ⛓ BLOCKCHAIN — `blockchain/` · `fabric/`

**Solidity 0.8.28 · Hardhat · OpenZeppelin · Hyperledger Fabric (Go 체인코드)**

![Solidity](https://img.shields.io/badge/Solidity_0.8.28-363636?style=flat-square&logo=solidity&logoColor=white)
![Hardhat](https://img.shields.io/badge/Hardhat-FFF100?style=flat-square&logo=hardhat&logoColor=black)
![OpenZeppelin](https://img.shields.io/badge/OpenZeppelin-4E5EE4?style=flat-square&logo=openzeppelin&logoColor=white)
![Fabric](https://img.shields.io/badge/Hyperledger_Fabric-0F3B57?style=flat-square&logo=hyperledger&logoColor=white)
![tests](https://img.shields.io/badge/contract_tests-18_passed-brightgreen?style=flat-square)

</div>

> 📌 이 문서는 **`blockchain` 브랜치**의 영역 문서입니다.
> 프로젝트 전체 설명은 [메인 README](../README.md)를 보세요.

---

## 두 개의 체인이 하는 일이 다릅니다

| | 담당 | 기본값 |
|---|---|---|
| **Ethereum** (`blockchain/`) | NFT 입장권 발급·소유권·재판매 정산 | `ENABLE_ONCHAIN_MINTING=false` — **비활성** |
| **Hyperledger Fabric** (`fabric/`) | 포인트·멤버십·응모·예약 원장 | `FABRIC_MODE=mock` — **인메모리 mock** |
| **MySQL** (`server/`) | **좌석 점유의 단일 기준** | 항상 켜짐 |

> 좌석이 팔렸는지는 **DB가 확정**합니다. 온체인 확인을 기다리는 동안 좌석이 떠 있으면
> 이중 예매가 생기기 때문입니다. 체인은 **발급 증명과 이력**을 맡습니다.

---

## 1. 스마트 컨트랙트 — `blockchain/`

```bash
cd blockchain
npm install
npm run compile
npm test          # 18개 통과
```

| 컨트랙트 | 표준 | 하는 일 |
|---|---|---|
| **`TicketNFT.sol`** | ERC-721 | 입장권 발급. 좌석·경기 정보를 온체인 메타데이터로 보관, 좌석 중복 차단, 입장 처리(`markUsed`) |
| **`TicketMarketplace.sol`** | — | 티켓 재판매 등록·구매·취소. 수수료(bps)·플랫폼 지갑 설정, `ReentrancyGuard` 적용 |
| **`FragmentNFT.sol`** | ERC-1155 | 카드 조각 발행·소각, 조각 합성으로 카드 발급 |
| **`BoxNFT.sol`** | ERC-1155 | 랜덤 박스 발행·소각 |

**공통 접근제어** — 네 컨트랙트 모두 `Ownable` + `setMinter(address, bool)` 구조입니다.
소유자만 민터를 지정할 수 있고, 민터가 아니면 발행·소각·입장 처리를 할 수 없습니다.

### 컨트랙트 테스트 18개 (`test/TicketNFT.test.ts`)

| 묶음 | 개수 | 확인하는 것 |
|---|---:|---|
| 배포 · 민팅 권한 | 4 | minter가 아니면 발행 불가, owner만 minter 지정 가능 |
| 티켓 발급 | 4 | 소유자·메타데이터·이벤트·tokenId 순차 증가 |
| 좌석 중복 방지 | 4 | 같은 좌석 두 번 구매 시 revert, 금액 0이면 revert |
| 입장 처리 | 4 | `markUsed` 후 `used=true`, **같은 티켓 두 번 입장 불가** |
| 양도 | 2 | 소유자는 양도 가능, 승인 없는 이전은 차단 |

### 배포

```bash
npx hardhat run scripts/deployAll.ts --network <네트워크>
npm run deploy:fragment      # Hoodi 테스트넷
```

> ⚠️ 배포에는 `MINTER_PRIVATE_KEY`가 필요합니다. **절대 커밋하지 마세요.**
> `.env`는 `.gitignore`에 등록되어 있고, CI가 프라이빗 키 패턴(`0x` + 64 hex)을 검사합니다.

---

## 2. Hyperledger Fabric — `fabric/`

```
fabric/
├── chaincode/ticket/go/ticket.go    체인코드 (공개 함수 41개)
├── basic-network/                   네트워크 구성 (configtx, docker, 인증서 스크립트)
├── application/sdk/                 Fabric SDK — 관리자 등록, 사용자 등록
├── network.sh · setup.sh · start.sh 네트워크 기동 스크립트
└── collections_config.json          Private Data Collection 설정
```

### 체인코드가 다루는 것

| 묶음 | 대표 함수 |
|---|---|
| 멤버십 | `JoinMembership` · `TierUpMembership` · `GetMembership` |
| 티켓 | `RegisterTicket` · `VerifyEntry` · `TransferTicket` · `MapTicketNFT` |
| 포인트 | `UsePointForTicket` · `EarnPointFromTrade` · `GetPointBalance` |
| 교환 | `ExchangePointItem` · `CompletePointCardExchange` · `GetExchangeRecord` |
| 응모·추첨 | `RegisterRaffleNFT` · `CreateDraw` · `EnterDraw` · `ExecuteDraw` |
| 우선 예매 | `RegisterPreSaleConfig` · `SubmitRaffleNFTs` · `ExecutePreSaleDraw` · `UsePreSaleRight` |
| 환불·정산 | `RequestRefund` · `CancelGameRefundAll` · `CreateSettlement` |

**개인정보를 원장에 올리지 않습니다.** 지갑 주소는 `hashDid()`로 해시해서 저장합니다.

**접근제어는 MSP 기준입니다.** `requireMSP()`가 호출자의 조직을 검사합니다 —
체인코드 함수를 추가할 때 이 검사를 빠뜨리면 누구나 호출할 수 있게 됩니다.

**등급·한도는 체인코드가 계산합니다.** `calcGrade`(입장 횟수 → 티어), `getEarnRate`(티어별 적립률),
`preSaleMonthlySubmitLimit` · `exchangeMonthlyLimit`(월 한도)이 원장 안에서 결정됩니다.
서버가 계산해서 넘기지 않습니다.

**시간은 트랜잭션 타임스탬프를 씁니다.** `txNow()` / `nowISO()` — 피어마다 결과가 갈리지 않게
`time.Now()`를 직접 부르지 않습니다. **새 함수에서도 같은 규칙을 지키세요.**

---

## 3. 로컬에서 체인 없이 개발하기

기본값이 mock이라 **체인 없이도 전 기능이 돕니다.**

| 스위치 | 기본값 | 켜면 |
|---|---|---|
| `FABRIC_MODE` | `mock` | `real` — 실제 Fabric 네트워크에 연결 (`fabric/start.sh` 필요) |
| `ENABLE_ONCHAIN_MINTING` | `false` | `true` — 실제 온체인 민팅 시도 (가스비 발생) |

mock 구현은 `server/mock/mockFabricService.js` · `server/mock/mockNftBridgeService.js` 입니다.
**인메모리라 서버를 재시작하면 Fabric 측 기록이 사라집니다.**
포인트·멤버십은 DB의 `point_events`에서 다시 계산되어 복구됩니다.

## 확인 명령

```bash
cd blockchain && npm run compile && npm test    # 18 passing
```
