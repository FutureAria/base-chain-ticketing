# 데이터베이스

`server/db/init.js` 가 만드는 **테이블 40개**입니다. 첫 실행 시 데이터베이스·테이블·시드 데이터가
자동 생성됩니다. 코드가 기준이며, 이 문서와 어긋나면 코드가 맞습니다.

- 엔진 — MySQL 8 또는 MariaDB 10.6+
- 관련 문서 — [아키텍처](ARCHITECTURE.md) · [API](API.md) · [개발 환경](DEVELOPMENT.md)

---

## 먼저 읽을 것 — `tickets.seat_lock`

이 프로젝트에서 가장 중요한 한 줄입니다.

```sql
seat_lock VARCHAR(180) GENERATED ALWAYS AS (
  CASE
    WHEN status IN ('refunded','cancelled') THEN NULL
    WHEN block IS NULL OR row_num IS NULL OR seat_number IS NULL THEN NULL
    ELSE CONCAT(game_id, '|', block, '|', row_num, '|', seat_number)
  END
) STORED,
UNIQUE KEY uq_ticket_active_seat (seat_lock)
```

UNIQUE 인덱스는 `NULL` 을 중복으로 보지 않습니다. 그래서

- **살아 있는 티켓**은 `game_id|block|row|seat` 조합이 유일해야 합니다 → 좌석 이중 예매 불가
- **환불·취소된 티켓**은 `seat_lock` 이 `NULL` 이 되어 좌석이 **저절로 풀립니다**

"환불하면 좌석을 반환한다"는 코드를 **어디에도 쓰지 않습니다.** 상태만 바꾸면 따라옵니다.
반환을 빠뜨릴 코드 경로 자체가 없습니다.
→ 자세한 배경은 [아키텍처: 좌석 점유](ARCHITECTURE.md#4-좌석-점유--이-프로젝트의-핵심)

> 기존 DB에 중복 좌석이 있으면 이 제약을 거는 `ALTER` 가 실패합니다.
> `db/init.js` 는 제약을 걸기 전에 중복을 먼저 조회해서 **서버를 죽이지 않고** 로그로 알려줍니다.

---

## 상태 ENUM 한눈에

| 테이블 | 컬럼 | 값 |
|---|---|---|
| `tickets` | `status` | `confirmed` `used` `listed` `sold` `refund_processing` `refund_rejected` `refunded` `cancelled` |
| `games` | `status` | `OPEN` `ALMOST` `SOLDOUT` `UPCOMING` `ENDED` `CANCELLED` |
| `raffle_nfts` | `status` | `ISSUED` `ENTERED` `WINNER` `LOST` `USED` `EXPIRED` |
| `reservations` | `status` | `PENDING` `CONFIRMED` `CANCELLED` `EXPIRED` |
| `draws` | `status` | `PENDING` `COMPLETED` |
| `refunds` | `status` | `processing` `completed` `rejected` |
| `game_raffle_entries` | `status` | `applied` `won` `lost` `used` |
| `physical_redemption_requests` | `status` | `requested` `shipping` `completed` `cancelled` |
| `did_verifications` | `status` | `pending` `verified` `revoked` |
| `users` | `role` / `membership_tier` | `user` `admin` / `베이직` `브론즈` `실버` `골드` |

---

## 테이블 40개


### 사용자·인증

로그인 계정, 비밀번호 재설정 토큰, 지갑 연결, DID

| 테이블 | 컬럼 수 | 설명 |
|---|---:|---|
| `users` | 13 | 계정. `role`(user/admin) · `membership_tier`(베이직/브론즈/실버/골드) · `is_active` |
| `password_reset_tokens` | 6 | 1회용 재설정 토큰. **평문 비밀번호를 돌려주지 않기 위해** 도입 |
| `user_wallets` | 7 | 지갑 주소와 nonce. 서명으로 소유를 증명하면 `is_verified` |
| `did_verifications` | 8 | 지갑 주소를 해시한 분산 신원값 |

### 경기·좌석

구장과 경기 일정

| 테이블 | 컬럼 수 | 설명 |
|---|---:|---|
| `stadiums` | 4 | 구장. 이름·위치·수용인원 |
| `games` | 10 | 경기. `status`(OPEN/ALMOST/SOLDOUT/UPCOMING/ENDED/CANCELLED) · 예매·응모 오픈 시각 |

### 티켓

예매의 중심. 좌석 점유가 여기서 확정된다

| 테이블 | 컬럼 수 | 설명 |
|---|---:|---|
| `tickets` | 17 | **핵심 테이블.** `status` 8단계 + `seat_lock` 생성 컬럼으로 좌석 점유를 DB가 확정 |
| `refunds` | 12 | 환불 요청. `status`(processing/completed/rejected) · 환불율·원금·환불액 |
| `fabric_events` | 8 | Fabric 으로 보낸 이벤트 로그. mock 모드에서도 기록된다 |

### 티켓 재판매

정가 이하 재판매

| 테이블 | 컬럼 수 | 설명 |
|---|---:|---|
| `ticket_listings` | 17 | 재판매 매물. 지갑 서명(`list_signature`)으로 판매자 본인 확인 |
| `ticket_trades` | 9 | 체결된 재판매. 플랫폼 수수료와 정산액 분리 기록 |

### 포인트·멤버십

입장 실적 기반 티어와 혜택

| 테이블 | 컬럼 수 | 설명 |
|---|---:|---|
| `point_events` | 9 | 포인트 적립·차감 **이벤트 로그**. 잔액을 저장하지 않고 여기서 재계산한다 |
| `membership_tier_rewards` | 8 | 티어 달성 보상 (카드·응모권) 지급 기록 |
| `membership_monthly_raffle_claims` | 8 | 월별 응모권 수령 한도 관리 |

### 응모·추첨·우선 예매

응모권 NFT 로 추첨하고 우선 예매권을 준다

| 테이블 | 컬럼 수 | 설명 |
|---|---:|---|
| `raffle_nfts` | 13 | 응모권. `status`(ISSUED/ENTERED/WINNER/LOST/USED/EXPIRED) · `source`(티어보상/월지급/포인트교환/관리자) |
| `draws` | 7 | 추첨. `status`(PENDING/COMPLETED) · 당첨자 수·총 응모 수 |
| `reservations` | 11 | 우선 예매권. `status`(PENDING/CONFIRMED/CANCELLED/EXPIRED) · 만료 시각 |
| `game_raffle_entries` | 8 | 경기별 응모 내역. `status`(applied/won/lost/used) |

### NFT 조각·카드·박스

조각을 모아 카드를 만들고, 실물 굿즈로 교환

| 테이블 | 컬럼 수 | 설명 |
|---|---:|---|
| `fragment_types` | 8 | 조각 종류 정의 (온체인 id · 구단 · 이미지) |
| `card_types` | 5 | 카드 종류 정의 |
| `combine_recipes` | 4 | 합성 레시피 — 어떤 조각 몇 개로 어떤 카드가 되는가 |
| `box_reward_pool` | 8 | 랜덤 박스 보상 풀과 **가중치** |
| `user_fragments` | 4 | 보유 조각 수량 |
| `user_cards` | 10 | 보유 카드. 표시용 정보를 스냅샷으로 함께 저장 |
| `user_boxes` | 2 | 보유 박스 수 |
| `combine_logs` | 8 | 합성 이력. 조각 복제 방지 테스트(`combineConcurrency`)의 근거 |
| `box_open_logs` | 12 | 박스 개봉 이력 |
| `physical_redemption_requests` | 10 | 실물 굿즈 교환 신청. 수령인 정보는 `address_json` 에 분리 보관 |

### 조각 장터

조각 거래 마켓

| 테이블 | 컬럼 수 | 설명 |
|---|---:|---|
| `market_assets` | 9 | 장터에 노출되는 조각 자산 메타 (티어·색상·수요 점수) |
| `market_listings` | 12 | 매물. 예약(`reserved_by`/`reserved_until`)으로 동시 구매 충돌 완화 |
| `trades` | 14 | 체결 거래 |
| `purchase_history` | 14 | 구매 이력 |
| `price_history` | 3 | 일별 가격 이력 |

### 온체인 연동

체인에 올라간 것의 그림자 기록

| 테이블 | 컬럼 수 | 설명 |
|---|---:|---|
| `nft_tokens` | 13 | 발급된 토큰. 소유자·상태·민팅 트랜잭션 해시 |
| `onchain_tx_logs` | 8 | 온체인 트랜잭션 로그. 어떤 행동이 어떤 tx 가 되었는지 |

### 커뮤니티·알림

게시판과 공지, 알림

| 테이블 | 컬럼 수 | 설명 |
|---|---:|---|
| `posts` | 12 | 게시글. `category`(ticket/fragment/baseball/strategy) · `hidden`/`deleted` 분리 |
| `comments` | 9 | 댓글. `parent_id` 로 대댓글 |
| `post_likes` | 3 | 좋아요 (user_id + post_id 복합키) |
| `notices` | 9 | 공지. `type`(공지/이벤트/업데이트) · 고정 여부 |
| `notification_events` | 9 | 사용자 알림. `read_at` 으로 읽음 처리 |

> 합계 **40개**.

---

## 설계에서 지킨 것

**잔액을 저장하지 않습니다.** 포인트는 `point_events` 에 적립·차감 **이벤트**로만 쌓이고,
잔액은 거기서 재계산합니다. 잔액 컬럼을 두면 이벤트와 어긋나는 순간을 찾을 수 없습니다.
mock Fabric 이 재시작으로 날아가도 포인트·멤버십이 복구되는 이유이기도 합니다.

**삭제하지 않고 표시합니다.** 게시글·댓글은 `hidden` 과 `deleted` 를 분리해 둡니다.
관리자가 가린 것과 작성자가 지운 것은 다른 사건입니다.

**개인정보를 분리합니다.** 실물 굿즈 교환의 수령인 주소는 `address_json` 에 모아 두고,
Fabric 원장에는 지갑 주소를 **해시(`hashDid`)해서** 올립니다. 원장에는 개인정보가 올라가지 않습니다.

**수수료와 정산액을 나눠 적습니다.** `ticket_trades` · `trades` 는 `price` ·
`platform_fee` · `settlement_amount` 를 각각 기록합니다. 나중에 역산하지 않아도 됩니다.

**표시용 값을 스냅샷으로 남깁니다.** `user_cards` 는 카드 이름·이미지를 복사해 둡니다.
`card_types` 의 정의가 나중에 바뀌어도 **이미 받은 카드는 받았을 때의 모습**을 유지합니다.

## 마이그레이션

`db/init.js` 가 서버 시작 시 실행됩니다.

- 테이블이 없으면 만들고, 있으면 건너뜁니다 (`CREATE TABLE IF NOT EXISTS`)
- 컬럼·인덱스 추가는 `INFORMATION_SCHEMA` 를 먼저 조회해 **이미 있으면 건너뜁니다**
- `services/schemaGuardService.js` 가 코드가 기대하는 스키마와 실제 DB의 차이를 감지합니다

> ⚠️ `RESET_DB_ON_START=true` 면 **시작할 때마다 DB를 초기화합니다.**
> 운영에서는 반드시 `false` 여야 합니다.
