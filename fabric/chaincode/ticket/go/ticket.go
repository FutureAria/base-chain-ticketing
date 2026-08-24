package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

var didPepper string

func init() {
	if p := os.Getenv("DID_PEPPER"); p != "" {
		didPepper = p
	} else {
		didPepper = "ticket-blockchain-pepper"
	}
}

// ─── 데이터 구조체 ─────────────────────────────────────────

type TicketRecord struct {
	TicketId     string  `json:"ticketId"`
	TokenId      string  `json:"tokenId"`
	GameId       string  `json:"gameId"`
	SeatId       string  `json:"seatId"`
	UserDidHash  string  `json:"userDidHash"`
	Status       string  `json:"status"`       // ACTIVE, USED, REFUND_PROCESSING, REFUNDED
	PurchaseType string  `json:"purchaseType"` // PRIMARY, TRANSFERRED, PRESALE
	Price        float64 `json:"price"`
	PointUsed    float64 `json:"pointUsed"`
	GameDate     string  `json:"gameDate"` // YYYY-MM-DD
	CreatedAt    string  `json:"createdAt"`
	UpdatedAt    string  `json:"updatedAt"`
}

type PointRecord struct {
	UserDidHash   string  `json:"userDidHash"`
	Balance       float64 `json:"balance"`
	TotalEarned   float64 `json:"totalEarned"`
	TotalUsed     float64 `json:"totalUsed"`
	LastUpdatedAt string  `json:"lastUpdatedAt"`
}

type MembershipRecord struct {
	UserDidHash                string `json:"userDidHash"`
	Grade                      string `json:"grade"` // BASIC, BRONZE, SILVER, GOLD
	Joined                     bool   `json:"joined"`
	JoinedAt                   string `json:"joinedAt"`
	EntryCount                 int    `json:"entryCount"`
	MonthlyRaffleExchangeCount int    `json:"monthlyRaffleExchangeCount"`
	MonthlyCardExchangeCount   int    `json:"monthlyCardExchangeCount"`
	MonthlyRaffleSubmitCount   int    `json:"monthlyRaffleSubmitCount"` // 우선 예매 응모권 제출 횟수
	LastResetMonth             string `json:"lastResetMonth"`
	UpdatedAt                  string `json:"updatedAt"`
}

type RefundRecord struct {
	RefundId      string  `json:"refundId"`
	TicketId      string  `json:"ticketId"`
	PurchaseType  string  `json:"purchaseType"`
	RefundRate    float64 `json:"refundRate"`
	OriginalPrice float64 `json:"originalPrice"`
	PointRestored float64 `json:"pointRestored"`
	RefundReason  string  `json:"refundReason"`
	RefundAmount  float64 `json:"refundAmount"`
	RefundStatus  string  `json:"refundStatus"` // PROCESSING, COMPLETED, REJECTED
	RequestedAt   string  `json:"requestedAt"`
	CompletedAt   string  `json:"completedAt"`
}

type ExchangeRecord struct {
	ExchangeId  string  `json:"exchangeId"`
	UserDidHash string  `json:"userDidHash"`
	ItemType    string  `json:"itemType"` // RAFFLE_NFT, CARD_NFT
	PointUsed   float64 `json:"pointUsed"`
	Status      string  `json:"status"`
	RequestedAt string  `json:"requestedAt"`
	CardTypeId  string  `json:"cardTypeId"`
	NftId       string  `json:"nftId"`
	MintTxHash  string  `json:"mintTxHash"`
	CompletedAt string  `json:"completedAt"`
}

type SettlementRecord struct {
	SettlementId     string  `json:"settlementId"`
	GameId           string  `json:"gameId"`
	TotalSales       float64 `json:"totalSales"`
	RefundAmount     float64 `json:"refundAmount"`
	PointUsedAmount  float64 `json:"pointUsedAmount"`
	PlatformFee      float64 `json:"platformFee"`
	ClubRevenue      float64 `json:"clubRevenue"`
	SettlementStatus string  `json:"settlementStatus"`
	CreatedAt        string  `json:"createdAt"`
}

type RaffleNFTRecord struct {
	RaffleNftId string `json:"raffleNftId"`
	UserDidHash string `json:"userDidHash"`
	GameId      string `json:"gameId"`
	Status      string `json:"status"` // ISSUED, ENTERED, WINNER, LOST, USED, EXPIRED
	DrawId      string `json:"drawId"`
	IssuedAt    string `json:"issuedAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type DrawRecord struct {
	DrawId       string `json:"drawId"`
	GameId       string `json:"gameId"`
	Status       string `json:"status"` // PENDING, COMPLETED
	WinnerCount  int    `json:"winnerCount"`
	TotalEntries int    `json:"totalEntries"`
	ExecutedAt   string `json:"executedAt"`
	CreatedAt    string `json:"createdAt"`
}

type ReservationRecord struct {
	ReservationId string `json:"reservationId"`
	UserDidHash   string `json:"userDidHash"`
	GameId        string `json:"gameId"`
	RaffleNftId   string `json:"raffleNftId"`
	IsPriority    bool   `json:"isPriority"`
	TicketId      string `json:"ticketId"`
	Status        string `json:"status"` // PENDING, CONFIRMED, CANCELLED, EXPIRED
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

// ─── 우선 예매 추첨 구조체 ────────────────────────────────

type PreSaleConfig struct {
	MatchId          string   `json:"matchId"`
	PreSaleSeatCount int      `json:"preSaleSeatCount"`
	PreSaleSeatList  []string `json:"preSaleSeatList"`
	ApplyStartTime   string   `json:"applyStartTime"`   // 응모 시작 (RFC3339)
	ApplyEndTime     string   `json:"applyEndTime"`     // 응모 마감 (RFC3339)
	DrawTime         string   `json:"drawTime"`         // 추첨 실행 가능 시각 (RFC3339)
	PreSaleStartTime string   `json:"preSaleStartTime"` // 우선 예매 시작 = 일반 예매 2시간 전 (RFC3339)
	PreSaleEndTime   string   `json:"preSaleEndTime"`   // 우선 예매 종료 = 일반 예매 시작 (RFC3339)
	Status           string   `json:"status"`           // OPEN, DRAW_PENDING, DRAW_COMPLETED, CLOSED
	CreatedAt        string   `json:"createdAt"`
	UpdatedAt        string   `json:"updatedAt"`
}

type PreSaleEntry struct {
	EntryId      string   `json:"entryId"`
	MatchId      string   `json:"matchId"`
	UserDidHash  string   `json:"userDidHash"`
	RaffleNftIds []string `json:"raffleNftIds"` // 제출한 응모권 ID 목록
	SubmitCount  int      `json:"submitCount"`  // 제출 수 = 가중치
	SubmittedAt  string   `json:"submittedAt"`
}

type PreSaleRight struct {
	RightId          string `json:"rightId"`
	MatchId          string `json:"matchId"`
	UserDidHash      string `json:"userDidHash"`
	RightStatus      string `json:"rightStatus"` // GRANTED, USED, EXPIRED, CANCELLED
	PreSaleStartTime string `json:"preSaleStartTime"`
	PreSaleEndTime   string `json:"preSaleEndTime"`
	GrantedAt        string `json:"grantedAt"`
	UpdatedAt        string `json:"updatedAt"`
}

// ─── 체인코드 구조체 ───────────────────────────────────────

type TicketChaincode struct {
	contractapi.Contract
}

// ─── 키 상수 ──────────────────────────────────────────────

const (
	keyPrefixTicket      = "TICKET:"
	keyPrefixPoint       = "POINT:"
	keyPrefixMembership  = "MEMBERSHIP:"
	keyPrefixRefund      = "REFUND:"
	keyPrefixExchange    = "EXCHANGE:"
	keyPrefixSettlement  = "SETTLEMENT:"
	keyPrefixRaffleNFT   = "RAFFLE_NFT:"
	keyPrefixDraw        = "DRAW:"
	keyPrefixReservation = "RESERVATION:"
	keyPrefixSeat        = "SEAT:"

	keyPrefixPreSaleConfig = "PRESALE_CONFIG:"
	keyPrefixPreSaleEntry  = "PRESALE_ENTRY:"
	keyPrefixPreSaleRight  = "PRESALE_RIGHT:"

	// Private Data Collection 이름
	collectionOrg1     = "collectionOrg1"
	collectionOrg1Org2 = "collectionOrg1Org2"
)

// ─── 유틸 함수 ────────────────────────────────────────────

func nowISO(ctx contractapi.TransactionContextInterface) string {
	ts, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return time.Now().UTC().Format(time.RFC3339)
	}
	return time.Unix(ts.Seconds, int64(ts.Nanos)).UTC().Format(time.RFC3339)
}

func currentMonth(ctx contractapi.TransactionContextInterface) string {
	ts, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return time.Now().UTC().Format("2006-01")
	}
	return time.Unix(ts.Seconds, int64(ts.Nanos)).UTC().Format("2006-01")
}

func hashDid(walletAddress string) string {
	h := sha256.Sum256([]byte(didPepper + strings.ToLower(walletAddress)))
	return fmt.Sprintf("%x", h)
}

func calcGrade(entryCount int) string {
	if entryCount >= 10 {
		return "GOLD"
	}
	if entryCount >= 6 {
		return "SILVER"
	}
	if entryCount >= 3 {
		return "BRONZE"
	}
	return "BASIC"
}

func getEarnRate(grade string) float64 {
	rates := map[string]float64{"BASIC": 0.005, "BRONZE": 0.007, "SILVER": 0.010, "GOLD": 0.015}
	if r, ok := rates[grade]; ok {
		return r
	}
	return 0.005
}

func exchangeCost(itemType string) (float64, error) {
	costs := map[string]float64{"RAFFLE_NFT": 1500, "CARD_NFT": 5000}
	if c, ok := costs[itemType]; ok {
		return c, nil
	}
	return 0, fmt.Errorf("INVALID_ITEM_TYPE: %s", itemType)
}

func txNow(ctx contractapi.TransactionContextInterface) time.Time {
	ts, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return time.Now().UTC()
	}
	return time.Unix(ts.Seconds, int64(ts.Nanos)).UTC()
}

func resetMonthlyIfNeeded(m *MembershipRecord, month string) {
	if m.LastResetMonth != month {
		m.MonthlyRaffleExchangeCount = 0
		m.MonthlyCardExchangeCount = 0
		m.MonthlyRaffleSubmitCount = 0
		m.LastResetMonth = month
	}
}

func preSaleMonthlySubmitLimit(grade string) int {
	if grade == "SILVER" || grade == "GOLD" {
		return 2
	}
	return 1
}

func exchangeMonthlyLimit(grade, itemType string) int {
	limits := map[string]map[string]int{
		"BASIC":  {"RAFFLE_NFT": 1, "CARD_NFT": 1},
		"BRONZE": {"RAFFLE_NFT": 1, "CARD_NFT": 1},
		"SILVER": {"RAFFLE_NFT": 2, "CARD_NFT": 1},
		"GOLD":   {"RAFFLE_NFT": 2, "CARD_NFT": 2},
	}
	if m, ok := limits[grade]; ok {
		if v, ok2 := m[itemType]; ok2 {
			return v
		}
	}
	return 1
}

// ─── 호출자 권한 검증 ─────────────────────────────────────

func requireMSP(ctx contractapi.TransactionContextInterface, allowedMSPs ...string) error {
	mspId, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return fmt.Errorf("MSP 조회 실패: %s", err)
	}
	for _, allowed := range allowedMSPs {
		if mspId == allowed {
			return nil
		}
	}
	return fmt.Errorf("ACCESS_DENIED: %s 조직은 이 함수를 호출할 수 없습니다", mspId)
}

// ─── 원장 조회/저장 헬퍼 ─────────────────────────────────

func getTicketRecord(ctx contractapi.TransactionContextInterface, ticketId string) (*TicketRecord, error) {
	b, err := ctx.GetStub().GetState(keyPrefixTicket + ticketId)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, nil
	}
	var r TicketRecord
	if err = json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func putTicketRecord(ctx contractapi.TransactionContextInterface, r *TicketRecord) error {
	r.UpdatedAt = nowISO(ctx)
	b, err := json.Marshal(r)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState(keyPrefixTicket+r.TicketId, b)
}

func getOrCreatePoint(ctx contractapi.TransactionContextInterface, userDidHash string) (*PointRecord, error) {
	b, err := ctx.GetStub().GetPrivateData(collectionOrg1, keyPrefixPoint+userDidHash)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return &PointRecord{UserDidHash: userDidHash, LastUpdatedAt: nowISO(ctx)}, nil
	}
	var r PointRecord
	if err = json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func putPoint(ctx contractapi.TransactionContextInterface, r *PointRecord) error {
	r.LastUpdatedAt = nowISO(ctx)
	b, err := json.Marshal(r)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutPrivateData(collectionOrg1, keyPrefixPoint+r.UserDidHash, b)
}

func getOrCreateMembership(ctx contractapi.TransactionContextInterface, userDidHash string) (*MembershipRecord, error) {
	b, err := ctx.GetStub().GetPrivateData(collectionOrg1, keyPrefixMembership+userDidHash)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return &MembershipRecord{
			UserDidHash:    userDidHash,
			Grade:          "BASIC",
			Joined:         false,
			LastResetMonth: currentMonth(ctx),
			UpdatedAt:      nowISO(ctx),
		}, nil
	}
	var r MembershipRecord
	if err = json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	return &r, nil
}

func putMembership(ctx contractapi.TransactionContextInterface, r *MembershipRecord) error {
	r.UpdatedAt = nowISO(ctx)
	b, err := json.Marshal(r)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutPrivateData(collectionOrg1, keyPrefixMembership+r.UserDidHash, b)
}

func (t *TicketChaincode) JoinMembership(
	ctx contractapi.TransactionContextInterface,
	userDidHash string,
) (string, error) {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return "", err
	}
	if userDidHash == "" {
		return "", fmt.Errorf("INVALID_PARAM: userDidHash는 필수입니다")
	}
	membership, err := getOrCreateMembership(ctx, userDidHash)
	if err != nil {
		return "", err
	}
	if membership.Joined {
		out, _ := json.Marshal(map[string]interface{}{"success": true, "grade": membership.Grade, "joined": true})
		return string(out), nil
	}
	membership.Joined = true
	membership.JoinedAt = nowISO(ctx)
	membership.Grade = "BASIC"
	membership.EntryCount = 0
	resetMonthlyIfNeeded(membership, currentMonth(ctx))
	if err = putMembership(ctx, membership); err != nil {
		return "", err
	}
	out, _ := json.Marshal(map[string]interface{}{"success": true, "grade": membership.Grade, "joined": true})
	return string(out), nil
}

func (t *TicketChaincode) SeedUserForTest(
	ctx contractapi.TransactionContextInterface,
	userDidHash string,
	pointBalanceStr string,
	totalEarnedStr string,
	totalUsedStr string,
	entryCountStr string,
	grade string,
	joinedStr string,
) (string, error) {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return "", err
	}
	pointBalance, err := strconv.ParseFloat(pointBalanceStr, 64)
	if err != nil {
		return "", fmt.Errorf("INVALID_POINT_BALANCE")
	}
	totalEarned, err := strconv.ParseFloat(totalEarnedStr, 64)
	if err != nil {
		return "", fmt.Errorf("INVALID_TOTAL_EARNED")
	}
	totalUsed, err := strconv.ParseFloat(totalUsedStr, 64)
	if err != nil {
		return "", fmt.Errorf("INVALID_TOTAL_USED")
	}
	entryCount, err := strconv.Atoi(entryCountStr)
	if err != nil {
		return "", fmt.Errorf("INVALID_ENTRY_COUNT")
	}

	joined := strings.EqualFold(joinedStr, "true") || joinedStr == "1" || strings.EqualFold(joinedStr, "yes")
	normalizedGrade := strings.ToUpper(strings.TrimSpace(grade))
	if normalizedGrade == "" {
		normalizedGrade = "BASIC"
	}
	validGrades := map[string]bool{"BASIC": true, "BRONZE": true, "SILVER": true, "GOLD": true}
	if !validGrades[normalizedGrade] {
		return "", fmt.Errorf("INVALID_MEMBERSHIP_GRADE: %s", grade)
	}

	point := &PointRecord{
		UserDidHash:   userDidHash,
		Balance:       pointBalance,
		TotalEarned:   totalEarned,
		TotalUsed:     totalUsed,
		LastUpdatedAt: nowISO(ctx),
	}
	if err = putPoint(ctx, point); err != nil {
		return "", err
	}

	membership := &MembershipRecord{
		UserDidHash:                userDidHash,
		Grade:                      normalizedGrade,
		Joined:                     joined,
		EntryCount:                 entryCount,
		MonthlyRaffleExchangeCount: 0,
		MonthlyCardExchangeCount:   0,
		MonthlyRaffleSubmitCount:   0,
		LastResetMonth:             currentMonth(ctx),
		UpdatedAt:                  nowISO(ctx),
	}
	if err = putMembership(ctx, membership); err != nil {
		return "", err
	}

	out, _ := json.Marshal(map[string]interface{}{
		"userDidHash": userDidHash,
		"balance":     point.Balance,
		"totalEarned": point.TotalEarned,
		"totalUsed":   point.TotalUsed,
		"grade":       membership.Grade,
		"joined":      membership.Joined,
		"entryCount":  membership.EntryCount,
	})
	return string(out), nil
}

func (t *TicketChaincode) TierUpMembership(
	ctx contractapi.TransactionContextInterface,
	userDidHash, targetGrade string,
) (string, error) {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return "", err
	}
	if userDidHash == "" || targetGrade == "" {
		return "", fmt.Errorf("INVALID_PARAM: userDidHash, targetGrade는 필수입니다")
	}
	targetGrade = strings.ToUpper(targetGrade)
	membership, err := getOrCreateMembership(ctx, userDidHash)
	if err != nil {
		return "", err
	}
	if !membership.Joined {
		return "", fmt.Errorf("MEMBERSHIP_REQUIRED: 멤버십 가입 후 이용할 수 있습니다")
	}
	required := map[string]int{"BRONZE": 3, "SILVER": 6, "GOLD": 10}
	if _, ok := required[targetGrade]; !ok {
		return "", fmt.Errorf("INVALID_GRADE: %s", targetGrade)
	}
	order := map[string]int{"BASIC": 0, "BRONZE": 1, "SILVER": 2, "GOLD": 3}
	if order[targetGrade] != order[membership.Grade]+1 {
		return "", fmt.Errorf("INVALID_TIER_STEP: 한 단계씩만 승급할 수 있습니다")
	}
	if membership.EntryCount < required[targetGrade] {
		return "", fmt.Errorf("TIER_REQUIREMENT_NOT_MET: %s requires %d entries", targetGrade, required[targetGrade])
	}
	membership.Grade = targetGrade
	resetMonthlyIfNeeded(membership, currentMonth(ctx))
	if err = putMembership(ctx, membership); err != nil {
		return "", err
	}
	out, _ := json.Marshal(map[string]interface{}{"success": true, "grade": membership.Grade, "entryCount": membership.EntryCount})
	return string(out), nil
}

// ─── 1. RegisterTicket ────────────────────────────────────

func (t *TicketChaincode) RegisterTicket(
	ctx contractapi.TransactionContextInterface,
	ticketId, tokenId, gameId, seatId, walletAddress, purchaseType, gameDate string,
	price float64,
) error {
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return err
	}
	if ticketId == "" || gameId == "" || walletAddress == "" {
		return fmt.Errorf("INVALID_PARAM: ticketId, gameId, walletAddress는 필수입니다")
	}
	if price <= 0 {
		return fmt.Errorf("INVALID_PARAM: price는 0보다 커야 합니다")
	}

	existing, err := getTicketRecord(ctx, ticketId)
	if err != nil {
		return err
	}
	if existing != nil {
		return fmt.Errorf("TICKET_ALREADY_EXISTS: %s", ticketId)
	}

	// 좌석 중복 등록 방지
	if seatId != "" {
		seatKey, err := ctx.GetStub().CreateCompositeKey(keyPrefixSeat, []string{gameId, seatId})
		if err != nil {
			return err
		}
		seatData, err := ctx.GetStub().GetState(seatKey)
		if err != nil {
			return err
		}
		if seatData != nil {
			return fmt.Errorf("SEAT_ALREADY_TAKEN: 경기 %s 좌석 %s는 이미 등록되었습니다", gameId, seatId)
		}
		if err = ctx.GetStub().PutState(seatKey, []byte(ticketId)); err != nil {
			return err
		}
	}

	if purchaseType == "" {
		purchaseType = "PRIMARY"
	}

	r := &TicketRecord{
		TicketId:     ticketId,
		TokenId:      tokenId,
		GameId:       gameId,
		SeatId:       seatId,
		UserDidHash:  hashDid(walletAddress),
		Status:       "ACTIVE",
		PurchaseType: purchaseType,
		Price:        price,
		GameDate:     gameDate,
		CreatedAt:    nowISO(ctx),
		UpdatedAt:    nowISO(ctx),
	}
	return putTicketRecord(ctx, r)
}

// ─── 2. VerifyEntry ───────────────────────────────────────

type VerifyEntryResult struct {
	Allowed         bool    `json:"allowed"`
	Reason          string  `json:"reason"`
	EntryId         string  `json:"entryId"`
	EarnedPoint     float64 `json:"earnedPoint"`
	MembershipGrade string  `json:"membershipGrade"`
}

func (t *TicketChaincode) VerifyEntry(
	ctx contractapi.TransactionContextInterface,
	ticketId, gateId string,
) (string, error) {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return "", err
	}
	ticket, err := getTicketRecord(ctx, ticketId)
	if err != nil {
		return "", err
	}
	if ticket == nil {
		r, _ := json.Marshal(VerifyEntryResult{Allowed: false, Reason: "TICKET_NOT_FOUND"})
		return string(r), nil
	}
	if ticket.Status == "USED" {
		r, _ := json.Marshal(VerifyEntryResult{Allowed: false, Reason: "ALREADY_USED"})
		return string(r), nil
	}
	if ticket.Status != "ACTIVE" {
		r, _ := json.Marshal(VerifyEntryResult{Allowed: false, Reason: "INVALID_STATUS:" + ticket.Status})
		return string(r), nil
	}

	ticket.Status = "USED"
	if err = putTicketRecord(ctx, ticket); err != nil {
		return "", err
	}

	point, err := getOrCreatePoint(ctx, ticket.UserDidHash)
	if err != nil {
		return "", err
	}
	membership, err := getOrCreateMembership(ctx, ticket.UserDidHash)
	if err != nil {
		return "", err
	}

	earnedPoint := 0.0
	if membership.Joined {
		// 월 초기화
		resetMonthlyIfNeeded(membership, currentMonth(ctx))
		earnedPoint = math.Floor(ticket.Price * getEarnRate(membership.Grade))
		point.Balance += earnedPoint
		point.TotalEarned += earnedPoint
		if err = putPoint(ctx, point); err != nil {
			return "", err
		}
		membership.EntryCount++
	}
	if err = putMembership(ctx, membership); err != nil {
		return "", err
	}

	txId := ctx.GetStub().GetTxID()
	res := VerifyEntryResult{
		Allowed:         true,
		EntryId:         "entry-" + txId[:12],
		EarnedPoint:     earnedPoint,
		MembershipGrade: membership.Grade,
	}
	out, _ := json.Marshal(res)
	return string(out), nil
}

// ─── 3. UsePointForTicket ─────────────────────────────────

func (t *TicketChaincode) UsePointForTicket(
	ctx contractapi.TransactionContextInterface,
	userDidHash, ticketId string,
	pointAmount float64,
) error {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return err
	}
	if pointAmount < 1000 {
		return fmt.Errorf("MIN_POINT_1000: 최소 1,000P 이상 사용 가능")
	}
	membership, err := getOrCreateMembership(ctx, userDidHash)
	if err != nil {
		return err
	}
	if !membership.Joined {
		return fmt.Errorf("MEMBERSHIP_REQUIRED: 멤버십 가입 후 포인트를 사용할 수 있습니다")
	}
	point, err := getOrCreatePoint(ctx, userDidHash)
	if err != nil {
		return err
	}
	if point.Balance < pointAmount {
		return fmt.Errorf("INSUFFICIENT_POINT: 잔액 %.0f P, 요청 %.0f P", point.Balance, pointAmount)
	}

	point.Balance -= pointAmount
	point.TotalUsed += pointAmount
	if err = putPoint(ctx, point); err != nil {
		return err
	}

	if ticketId != "" {
		ticket, err2 := getTicketRecord(ctx, ticketId)
		if err2 != nil {
			return err2
		}
		if ticket != nil {
			ticket.PointUsed = pointAmount
			if err2 = putTicketRecord(ctx, ticket); err2 != nil {
				return err2
			}
		}
	}
	return nil
}

// ─── 4. ExchangePointItem ────────────────────────────────

func (t *TicketChaincode) ExchangePointItem(
	ctx contractapi.TransactionContextInterface,
	userDidHash, itemType string,
) (string, error) {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return "", err
	}
	cost, err := exchangeCost(itemType)
	if err != nil {
		return "", err
	}

	point, err := getOrCreatePoint(ctx, userDidHash)
	if err != nil {
		return "", err
	}
	if point.Balance < cost {
		return "", fmt.Errorf("INSUFFICIENT_POINT: 잔액 %.0f P, 필요 %.0f P", point.Balance, cost)
	}

	membership, err := getOrCreateMembership(ctx, userDidHash)
	if err != nil {
		return "", err
	}
	if !membership.Joined {
		return "", fmt.Errorf("MEMBERSHIP_REQUIRED: 멤버십 가입 후 교환할 수 있습니다")
	}

	resetMonthlyIfNeeded(membership, currentMonth(ctx))

	limit := exchangeMonthlyLimit(membership.Grade, itemType)
	if itemType == "RAFFLE_NFT" && membership.MonthlyRaffleExchangeCount >= limit {
		return "", fmt.Errorf("EXCHANGE_LIMIT_EXCEEDED: 이번 달 응모권 NFT 교환 횟수 초과")
	}
	if itemType == "CARD_NFT" && membership.MonthlyCardExchangeCount >= limit {
		return "", fmt.Errorf("EXCHANGE_LIMIT_EXCEEDED: 이번 달 실물 NFT 카드 교환 횟수 초과")
	}

	point.Balance -= cost
	point.TotalUsed += cost
	if err = putPoint(ctx, point); err != nil {
		return "", err
	}

	if itemType == "RAFFLE_NFT" {
		membership.MonthlyRaffleExchangeCount++
	}
	if itemType == "CARD_NFT" {
		membership.MonthlyCardExchangeCount++
	}
	if err = putMembership(ctx, membership); err != nil {
		return "", err
	}

	exchangeId := "exchange-" + ctx.GetStub().GetTxID()[:12]
	rec := ExchangeRecord{
		ExchangeId:  exchangeId,
		UserDidHash: userDidHash,
		ItemType:    itemType,
		PointUsed:   cost,
		Status:      "MINT_REQUESTED",
		RequestedAt: nowISO(ctx),
	}
	b, err := json.Marshal(rec)
	if err != nil {
		return "", err
	}
	if err = ctx.GetStub().PutPrivateData(collectionOrg1, keyPrefixExchange+exchangeId, b); err != nil {
		return "", err
	}

	out, _ := json.Marshal(map[string]interface{}{
		"exchangeId":       exchangeId,
		"itemType":         itemType,
		"pointUsed":        cost,
		"remainingBalance": point.Balance,
		"status":           "MINT_REQUESTED",
	})
	return string(out), nil
}

func (t *TicketChaincode) CompletePointCardExchange(
	ctx contractapi.TransactionContextInterface,
	exchangeId, userDidHash, cardTypeId, nftId, mintTxHash string,
) (string, error) {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return "", err
	}
	if exchangeId == "" {
		return "", fmt.Errorf("EXCHANGE_ID_REQUIRED")
	}
	if userDidHash == "" {
		return "", fmt.Errorf("USER_DID_HASH_REQUIRED")
	}
	if cardTypeId == "" {
		return "", fmt.Errorf("CARD_TYPE_ID_REQUIRED")
	}
	if nftId == "" {
		return "", fmt.Errorf("NFT_ID_REQUIRED")
	}
	if mintTxHash == "" {
		return "", fmt.Errorf("MINT_TX_HASH_REQUIRED")
	}

	b, err := ctx.GetStub().GetPrivateData(collectionOrg1, keyPrefixExchange+exchangeId)
	if err != nil {
		return "", err
	}
	if b == nil {
		return "", fmt.Errorf("EXCHANGE_NOT_FOUND: %s", exchangeId)
	}

	var rec ExchangeRecord
	if err = json.Unmarshal(b, &rec); err != nil {
		return "", err
	}
	if rec.UserDidHash != userDidHash {
		return "", fmt.Errorf("EXCHANGE_OWNER_MISMATCH")
	}
	if rec.ItemType != "CARD_NFT" {
		return "", fmt.Errorf("INVALID_EXCHANGE_ITEM: %s", rec.ItemType)
	}
	if rec.Status == "MINT_COMPLETED" {
		out, _ := json.Marshal(rec)
		return string(out), nil
	}
	if rec.Status != "MINT_REQUESTED" {
		return "", fmt.Errorf("INVALID_EXCHANGE_STATUS: %s", rec.Status)
	}

	rec.Status = "MINT_COMPLETED"
	rec.CardTypeId = cardTypeId
	rec.NftId = nftId
	rec.MintTxHash = mintTxHash
	rec.CompletedAt = nowISO(ctx)

	rb, err := json.Marshal(rec)
	if err != nil {
		return "", err
	}
	if err = ctx.GetStub().PutPrivateData(collectionOrg1, keyPrefixExchange+exchangeId, rb); err != nil {
		return "", err
	}

	out, _ := json.Marshal(rec)
	return string(out), nil
}

func (t *TicketChaincode) GetExchangeRecord(
	ctx contractapi.TransactionContextInterface,
	exchangeId string,
) (string, error) {
	if exchangeId == "" {
		return "", fmt.Errorf("EXCHANGE_ID_REQUIRED")
	}
	b, err := ctx.GetStub().GetPrivateData(collectionOrg1, keyPrefixExchange+exchangeId)
	if err != nil {
		return "", err
	}
	if b == nil {
		return "", fmt.Errorf("EXCHANGE_NOT_FOUND: %s", exchangeId)
	}
	return string(b), nil
}

// ─── 환불율 계산 ──────────────────────────────────────────
// TRANSFERRED: 항상 0%
// PRIMARY: 7일 이상=100%, 3일 이상=90%, 1일 이상=80%, 당일/이후=0%

func calcRefundRate(ctx contractapi.TransactionContextInterface, gameDateStr, purchaseType string) float64 {
	if purchaseType == "TRANSFERRED" {
		return 0
	}
	if gameDateStr == "" {
		return 100
	}
	var now time.Time
	if ts, err := ctx.GetStub().GetTxTimestamp(); err == nil {
		now = time.Unix(ts.Seconds, int64(ts.Nanos)).UTC().Truncate(24 * time.Hour)
	} else {
		now = time.Now().UTC().Truncate(24 * time.Hour)
	}
	game, err := time.Parse("2006-01-02", gameDateStr)
	if err != nil {
		return 100
	}
	game = game.UTC().Truncate(24 * time.Hour)
	days := int(game.Sub(now).Hours() / 24)

	if days >= 7 {
		return 100
	}
	if days >= 3 {
		return 90
	}
	if days >= 1 {
		return 80
	}
	return 0
}

// ─── 5. RequestRefund ────────────────────────────────────

func (t *TicketChaincode) RequestRefund(
	ctx contractapi.TransactionContextInterface,
	ticketId, refundReason string,
) (string, error) {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return "", err
	}
	ticket, err := getTicketRecord(ctx, ticketId)
	if err != nil {
		return "", err
	}
	if ticket == nil {
		return "", fmt.Errorf("TICKET_NOT_FOUND: %s", ticketId)
	}
	if ticket.Status == "USED" {
		return "", fmt.Errorf("REFUND_DENIED: 입장 완료된 티켓 환불 불가")
	}
	if ticket.Status == "REFUNDED" {
		return "", fmt.Errorf("ALREADY_REFUNDED")
	}
	if ticket.Status == "REFUND_PROCESSING" {
		return "", fmt.Errorf("REFUND_ALREADY_PROCESSING")
	}

	rate := calcRefundRate(ctx, ticket.GameDate, ticket.PurchaseType)
	if rate == 0 {
		return "", fmt.Errorf("REFUND_DENIED: 환불 불가 기간입니다")
	}

	baseAmount := ticket.Price - ticket.PointUsed
	refundAmount := math.Floor(baseAmount * rate / 100)

	// 사용한 포인트 복구
	pointRestored := ticket.PointUsed
	if pointRestored > 0 {
		point, err := getOrCreatePoint(ctx, ticket.UserDidHash)
		if err != nil {
			return "", err
		}
		point.Balance += pointRestored
		point.TotalUsed -= pointRestored
		if point.TotalUsed < 0 {
			point.TotalUsed = 0
		}
		if err = putPoint(ctx, point); err != nil {
			return "", err
		}
	}

	ticket.Status = "REFUNDED"
	if err = putTicketRecord(ctx, ticket); err != nil {
		return "", err
	}

	refundId := "refund-" + ctx.GetStub().GetTxID()[:12]
	rec := RefundRecord{
		RefundId:      refundId,
		TicketId:      ticketId,
		PurchaseType:  ticket.PurchaseType,
		RefundRate:    rate,
		OriginalPrice: ticket.Price,
		PointRestored: pointRestored,
		RefundReason:  refundReason,
		RefundAmount:  refundAmount,
		RefundStatus:  "COMPLETED",
		RequestedAt:   nowISO(ctx),
		CompletedAt:   nowISO(ctx),
	}

	b, err := json.Marshal(rec)
	if err != nil {
		return "", err
	}
	if err = ctx.GetStub().PutPrivateData(collectionOrg1, keyPrefixRefund+refundId, b); err != nil {
		return "", err
	}

	out, _ := json.Marshal(map[string]interface{}{
		"refundId":      refundId,
		"ticketId":      ticketId,
		"refundRate":    rate,
		"refundAmount":  refundAmount,
		"pointRestored": pointRestored,
		"purchaseType":  ticket.PurchaseType,
		"status":        "COMPLETED",
	})
	return string(out), nil
}

// ─── 6. CancelGameRefundAll ──────────────────────────────

func (t *TicketChaincode) CancelGameRefundAll(
	ctx contractapi.TransactionContextInterface,
	gameId, ticketIdsJSON string,
) (string, error) {
	if err := requireMSP(ctx, "Org1MSP", "Org2MSP"); err != nil {
		return "", err
	}
	if gameId == "" {
		return "", fmt.Errorf("INVALID_PARAM: gameId는 필수입니다")
	}

	var ticketIds []string
	if err := json.Unmarshal([]byte(ticketIdsJSON), &ticketIds); err != nil {
		return "", fmt.Errorf("INVALID_PARAM: ticketIdsJSON 파싱 실패: %s", err)
	}

	successCount := 0
	skippedCount := 0
	failedIds := make([]string, 0)

	for _, ticketId := range ticketIds {
		ticket, err := getTicketRecord(ctx, ticketId)
		if err != nil || ticket == nil {
			failedIds = append(failedIds, ticketId)
			continue
		}
		if ticket.GameId != gameId {
			skippedCount++
			continue
		}
		if ticket.Status != "ACTIVE" {
			skippedCount++
			continue
		}

		// 포인트 복구
		if ticket.PointUsed > 0 {
			point, err := getOrCreatePoint(ctx, ticket.UserDidHash)
			if err != nil {
				failedIds = append(failedIds, ticketId)
				continue
			}
			point.Balance += ticket.PointUsed
			point.TotalUsed -= ticket.PointUsed
			if point.TotalUsed < 0 {
				point.TotalUsed = 0
			}
			if err = putPoint(ctx, point); err != nil {
				failedIds = append(failedIds, ticketId)
				continue
			}
		}

		ticket.Status = "REFUNDED"
		if err = putTicketRecord(ctx, ticket); err != nil {
			failedIds = append(failedIds, ticketId)
			continue
		}

		refundId := "refund-cancel-" + ctx.GetStub().GetTxID()[:8] + fmt.Sprintf("-%d", successCount)
		rec := RefundRecord{
			RefundId:      refundId,
			TicketId:      ticketId,
			PurchaseType:  ticket.PurchaseType,
			RefundRate:    100,
			OriginalPrice: ticket.Price,
			PointRestored: ticket.PointUsed,
			RefundReason:  "경기 취소",
			RefundAmount:  ticket.Price - ticket.PointUsed,
			RefundStatus:  "COMPLETED",
			RequestedAt:   nowISO(ctx),
			CompletedAt:   nowISO(ctx),
		}
		rb, err := json.Marshal(rec)
		if err != nil {
			failedIds = append(failedIds, ticketId)
			continue
		}
		if err = ctx.GetStub().PutPrivateData(collectionOrg1, keyPrefixRefund+refundId, rb); err != nil {
			failedIds = append(failedIds, ticketId)
			continue
		}
		successCount++
	}

	out, _ := json.Marshal(map[string]interface{}{
		"gameId":       gameId,
		"successCount": successCount,
		"skippedCount": skippedCount,
		"failedIds":    failedIds,
	})
	return string(out), nil
}

// ─── 7. EarnPointFromTrade ───────────────────────────────
// 판매자 포인트 적립: 티켓 양도 0.3%, 굿즈/파편 장터 0.1%

func (t *TicketChaincode) EarnPointFromTrade(
	ctx contractapi.TransactionContextInterface,
	userDidHash string,
	amount, rate float64,
) (string, error) {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return "", err
	}
	membership, err := getOrCreateMembership(ctx, userDidHash)
	if err != nil {
		return "", err
	}
	earnedPoint := 0.0
	if membership.Joined {
		earnedPoint = math.Floor(amount * rate)
	}

	point, err := getOrCreatePoint(ctx, userDidHash)
	if err != nil {
		return "", err
	}

	if earnedPoint > 0 {
		point.Balance += earnedPoint
		point.TotalEarned += earnedPoint
		if err = putPoint(ctx, point); err != nil {
			return "", err
		}
	}

	out, _ := json.Marshal(map[string]interface{}{
		"earnedPoint": earnedPoint,
		"balance":     point.Balance,
	})
	return string(out), nil
}

// ─── 8. TransferTicket ───────────────────────────────────

func (t *TicketChaincode) TransferTicket(
	ctx contractapi.TransactionContextInterface,
	ticketId, fromWalletAddress, toWalletAddress string,
	transferPrice float64,
) (string, error) {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return "", err
	}
	if ticketId == "" || fromWalletAddress == "" || toWalletAddress == "" {
		return "", fmt.Errorf("INVALID_PARAM: ticketId, fromWalletAddress, toWalletAddress는 필수입니다")
	}
	if transferPrice <= 0 {
		return "", fmt.Errorf("INVALID_PARAM: transferPrice는 0보다 커야 합니다")
	}

	ticket, err := getTicketRecord(ctx, ticketId)
	if err != nil {
		return "", err
	}
	if ticket == nil {
		return "", fmt.Errorf("TICKET_NOT_FOUND: %s", ticketId)
	}
	if ticket.Status != "ACTIVE" {
		return "", fmt.Errorf("TRANSFER_DENIED: 티켓 상태가 ACTIVE가 아닙니다 (%s)", ticket.Status)
	}
	if ticket.PurchaseType == "PRESALE" {
		return "", fmt.Errorf("TRANSFER_DENIED: 우선 예매 티켓은 2차 거래가 불가합니다")
	}
	if ticket.UserDidHash != hashDid(fromWalletAddress) {
		return "", fmt.Errorf("NOT_OWNER: 티켓 소유자가 아닙니다")
	}

	fromDidHash := hashDid(fromWalletAddress)
	toDidHash := hashDid(toWalletAddress)

	ticket.UserDidHash = toDidHash
	ticket.PurchaseType = "TRANSFERRED"
	ticket.PointUsed = 0
	if err = putTicketRecord(ctx, ticket); err != nil {
		return "", err
	}

	// 판매자 포인트는 일일 적립 한도 적용을 위해 백엔드 라우터에서
	// EarnPointFromTrade로 별도 처리한다.
	earnedPoint := 0.0

	out, _ := json.Marshal(map[string]interface{}{
		"ticketId":          ticketId,
		"fromDidHash":       fromDidHash,
		"toDidHash":         toDidHash,
		"transferPrice":     transferPrice,
		"sellerEarnedPoint": earnedPoint,
		"status":            "TRANSFERRED",
	})
	return string(out), nil
}

// ─── 9. CreateSettlement ────────────────────────────────

func (t *TicketChaincode) CreateSettlement(
	ctx contractapi.TransactionContextInterface,
	gameId string,
	totalSales, refundAmount, pointUsedAmount float64,
) (string, error) {
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return "", err
	}
	if gameId == "" {
		return "", fmt.Errorf("INVALID_PARAM: gameId는 필수입니다")
	}

	platformFee := math.Floor(totalSales * 0.03)
	clubRevenue := totalSales - refundAmount - pointUsedAmount - platformFee
	settlementId := "settlement-" + ctx.GetStub().GetTxID()[:12]

	rec := SettlementRecord{
		SettlementId:     settlementId,
		GameId:           gameId,
		TotalSales:       totalSales,
		RefundAmount:     refundAmount,
		PointUsedAmount:  pointUsedAmount,
		PlatformFee:      platformFee,
		ClubRevenue:      clubRevenue,
		SettlementStatus: "DRAFT",
		CreatedAt:        nowISO(ctx),
	}
	b, err := json.Marshal(rec)
	if err != nil {
		return "", err
	}
	if err = ctx.GetStub().PutPrivateData(collectionOrg1, keyPrefixSettlement+settlementId, b); err != nil {
		return "", err
	}

	out, _ := json.Marshal(rec)
	return string(out), nil
}

// ─── 10. 조회 함수 ───────────────────────────────────────

func (t *TicketChaincode) GetTicket(
	ctx contractapi.TransactionContextInterface,
	ticketId string,
) (string, error) {
	ticket, err := getTicketRecord(ctx, ticketId)
	if err != nil {
		return "", err
	}
	if ticket == nil {
		return "", fmt.Errorf("TICKET_NOT_FOUND: %s", ticketId)
	}
	out, _ := json.Marshal(ticket)
	return string(out), nil
}

func (t *TicketChaincode) GetPointBalance(
	ctx contractapi.TransactionContextInterface,
	userDidHash string,
) (string, error) {
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return "", err
	}
	point, err := getOrCreatePoint(ctx, userDidHash)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(point)
	return string(out), nil
}

func (t *TicketChaincode) GetMembership(
	ctx contractapi.TransactionContextInterface,
	userDidHash string,
) (string, error) {
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return "", err
	}
	membership, err := getOrCreateMembership(ctx, userDidHash)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(membership)
	return string(out), nil
}

// ─── 11. RegisterRaffleNFT ───────────────────────────────

func (t *TicketChaincode) RegisterRaffleNFT(
	ctx contractapi.TransactionContextInterface,
	raffleNftId, userDidHash, gameId string,
) error {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return err
	}
	b, err := ctx.GetStub().GetState(keyPrefixRaffleNFT + raffleNftId)
	if err != nil {
		return err
	}
	if b != nil {
		return fmt.Errorf("RAFFLE_NFT_ALREADY_EXISTS: %s", raffleNftId)
	}

	rec := RaffleNFTRecord{
		RaffleNftId: raffleNftId,
		UserDidHash: userDidHash,
		GameId:      gameId,
		Status:      "ISSUED",
		IssuedAt:    nowISO(ctx),
		UpdatedAt:   nowISO(ctx),
	}
	rb, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	if err = ctx.GetStub().PutState(keyPrefixRaffleNFT+raffleNftId, rb); err != nil {
		return err
	}

	ck, err := ctx.GetStub().CreateCompositeKey("RAFFLE_NFT_USER", []string{userDidHash, raffleNftId})
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState(ck, []byte{0x00})
}

// ─── 12. EnterDraw ───────────────────────────────────────

func (t *TicketChaincode) EnterDraw(
	ctx contractapi.TransactionContextInterface,
	raffleNftId, userDidHash, drawId string,
) error {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return err
	}
	rb, err := ctx.GetStub().GetState(keyPrefixRaffleNFT + raffleNftId)
	if err != nil {
		return err
	}
	if rb == nil {
		return fmt.Errorf("RAFFLE_NFT_NOT_FOUND: %s", raffleNftId)
	}

	var raffle RaffleNFTRecord
	if err = json.Unmarshal(rb, &raffle); err != nil {
		return err
	}
	if raffle.UserDidHash != userDidHash {
		return fmt.Errorf("NOT_OWNER")
	}
	if raffle.Status != "ISSUED" {
		return fmt.Errorf("RAFFLE_NFT_ALREADY_USED: %s", raffle.Status)
	}

	raffle.Status = "ENTERED"
	raffle.DrawId = drawId
	raffle.UpdatedAt = nowISO(ctx)
	rb2, err := json.Marshal(raffle)
	if err != nil {
		return err
	}
	if err = ctx.GetStub().PutState(keyPrefixRaffleNFT+raffleNftId, rb2); err != nil {
		return err
	}

	db, err := ctx.GetStub().GetState(keyPrefixDraw + drawId)
	if err != nil {
		return err
	}
	if db != nil {
		var draw DrawRecord
		if err = json.Unmarshal(db, &draw); err != nil {
			return err
		}
		draw.TotalEntries++
		db2, err := json.Marshal(draw)
		if err != nil {
			return err
		}
		if err = ctx.GetStub().PutState(keyPrefixDraw+drawId, db2); err != nil {
			return err
		}
	}
	return nil
}

// ─── 13. CreateDraw ──────────────────────────────────────

func (t *TicketChaincode) CreateDraw(
	ctx contractapi.TransactionContextInterface,
	drawId, gameId string,
	winnerCount int,
) error {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return err
	}
	rec := DrawRecord{
		DrawId:      drawId,
		GameId:      gameId,
		Status:      "PENDING",
		WinnerCount: winnerCount,
		CreatedAt:   nowISO(ctx),
	}
	b, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState(keyPrefixDraw+drawId, b)
}

// ─── 14. ExecuteDraw ─────────────────────────────────────

func (t *TicketChaincode) ExecuteDraw(
	ctx contractapi.TransactionContextInterface,
	drawId string,
	entryIdsJSON string,
) (string, error) {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return "", err
	}
	db, err := ctx.GetStub().GetState(keyPrefixDraw + drawId)
	if err != nil {
		return "", err
	}
	if db == nil {
		return "", fmt.Errorf("DRAW_NOT_FOUND: %s", drawId)
	}

	var draw DrawRecord
	if err = json.Unmarshal(db, &draw); err != nil {
		return "", err
	}
	if draw.Status == "COMPLETED" {
		return "", fmt.Errorf("DRAW_ALREADY_COMPLETED")
	}

	var entryIds []string
	if err = json.Unmarshal([]byte(entryIdsJSON), &entryIds); err != nil {
		return "", err
	}
	if len(entryIds) == 0 {
		return "", fmt.Errorf("INVALID_PARAM: 참가자가 없습니다")
	}

	txId := ctx.GetStub().GetTxID()
	h := sha256.Sum256([]byte(txId))
	seed := int(h[0]) + int(h[1])<<8

	winnerCount := draw.WinnerCount
	if winnerCount > len(entryIds) {
		winnerCount = len(entryIds)
	}

	winners := make([]string, 0, winnerCount)
	used := make(map[int]bool)
	for i := 0; i < winnerCount; i++ {
		idx := (seed + i*37) % len(entryIds)
		for used[idx] {
			idx = (idx + 1) % len(entryIds)
		}
		used[idx] = true
		winners = append(winners, entryIds[idx])
	}

	for _, raffleNftId := range entryIds {
		rb, err2 := ctx.GetStub().GetState(keyPrefixRaffleNFT + raffleNftId)
		if err2 != nil || rb == nil {
			continue
		}
		var raffle RaffleNFTRecord
		if err2 = json.Unmarshal(rb, &raffle); err2 != nil {
			continue
		}
		isWinner := false
		for _, w := range winners {
			if w == raffleNftId {
				isWinner = true
				break
			}
		}
		if isWinner {
			raffle.Status = "WINNER"
		} else {
			raffle.Status = "LOST"
		}
		raffle.UpdatedAt = nowISO(ctx)
		rb2, err2 := json.Marshal(raffle)
		if err2 != nil {
			continue
		}
		if err2 = ctx.GetStub().PutState(keyPrefixRaffleNFT+raffleNftId, rb2); err2 != nil {
			continue
		}
	}

	draw.Status = "COMPLETED"
	draw.ExecutedAt = nowISO(ctx)
	db2, err := json.Marshal(draw)
	if err != nil {
		return "", err
	}
	if err = ctx.GetStub().PutState(keyPrefixDraw+drawId, db2); err != nil {
		return "", err
	}

	out, _ := json.Marshal(map[string]interface{}{"drawId": drawId, "winners": winners})
	return string(out), nil
}

// ─── 15. UseRaffleNFT ────────────────────────────────────

func (t *TicketChaincode) UseRaffleNFT(
	ctx contractapi.TransactionContextInterface,
	raffleNftId, userDidHash, ticketId string,
) error {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return err
	}
	rb, err := ctx.GetStub().GetState(keyPrefixRaffleNFT + raffleNftId)
	if err != nil {
		return err
	}
	if rb == nil {
		return fmt.Errorf("RAFFLE_NFT_NOT_FOUND")
	}

	var raffle RaffleNFTRecord
	if err = json.Unmarshal(rb, &raffle); err != nil {
		return err
	}
	if raffle.UserDidHash != userDidHash {
		return fmt.Errorf("NOT_OWNER")
	}
	if raffle.Status != "WINNER" {
		return fmt.Errorf("NOT_WINNER: %s", raffle.Status)
	}

	raffle.Status = "USED"
	raffle.UpdatedAt = nowISO(ctx)
	rb2, err := json.Marshal(raffle)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState(keyPrefixRaffleNFT+raffleNftId, rb2)
}

// ─── 16. CreateReservation ───────────────────────────────

func (t *TicketChaincode) CreateReservation(
	ctx contractapi.TransactionContextInterface,
	reservationId, userDidHash, gameId, raffleNftId string,
	isPriority bool,
) error {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return err
	}
	rec := ReservationRecord{
		ReservationId: reservationId,
		UserDidHash:   userDidHash,
		GameId:        gameId,
		RaffleNftId:   raffleNftId,
		IsPriority:    isPriority,
		Status:        "PENDING",
		CreatedAt:     nowISO(ctx),
		UpdatedAt:     nowISO(ctx),
	}
	b, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState(keyPrefixReservation+reservationId, b)
}

// ─── 17. ConfirmReservation ──────────────────────────────

func (t *TicketChaincode) ConfirmReservation(
	ctx contractapi.TransactionContextInterface,
	reservationId, ticketId string,
) error {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return err
	}
	rb, err := ctx.GetStub().GetState(keyPrefixReservation + reservationId)
	if err != nil {
		return err
	}
	if rb == nil {
		return fmt.Errorf("RESERVATION_NOT_FOUND: %s", reservationId)
	}

	var rec ReservationRecord
	if err = json.Unmarshal(rb, &rec); err != nil {
		return err
	}
	rec.TicketId = ticketId
	rec.Status = "CONFIRMED"
	rec.UpdatedAt = nowISO(ctx)
	b, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState(keyPrefixReservation+reservationId, b)
}

// ─── 18. CancelReservation ───────────────────────────────

func (t *TicketChaincode) CancelReservation(
	ctx contractapi.TransactionContextInterface,
	reservationId string,
) error {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return err
	}
	rb, err := ctx.GetStub().GetState(keyPrefixReservation + reservationId)
	if err != nil {
		return err
	}
	if rb == nil {
		return fmt.Errorf("RESERVATION_NOT_FOUND: %s", reservationId)
	}

	var rec ReservationRecord
	if err = json.Unmarshal(rb, &rec); err != nil {
		return err
	}
	rec.Status = "CANCELLED"
	rec.UpdatedAt = nowISO(ctx)
	b, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState(keyPrefixReservation+reservationId, b)
}

// ─── 19. MapTicketNFT ────────────────────────────────────

func (t *TicketChaincode) MapTicketNFT(
	ctx contractapi.TransactionContextInterface,
	ticketId, tokenId string,
) error {
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return err
	}
	ticket, err := getTicketRecord(ctx, ticketId)
	if err != nil {
		return err
	}
	if ticket == nil {
		return fmt.Errorf("TICKET_NOT_FOUND: %s", ticketId)
	}
	ticket.TokenId = tokenId
	return putTicketRecord(ctx, ticket)
}

// ─── 20. 조회 함수 (Raffle / Draw / Reservation) ─────────

func (t *TicketChaincode) GetRaffleNFT(
	ctx contractapi.TransactionContextInterface,
	raffleNftId string,
) (string, error) {
	b, err := ctx.GetStub().GetState(keyPrefixRaffleNFT + raffleNftId)
	if err != nil {
		return "", err
	}
	if b == nil {
		return "", fmt.Errorf("RAFFLE_NFT_NOT_FOUND: %s", raffleNftId)
	}
	return string(b), nil
}

func (t *TicketChaincode) GetDraw(
	ctx contractapi.TransactionContextInterface,
	drawId string,
) (string, error) {
	b, err := ctx.GetStub().GetState(keyPrefixDraw + drawId)
	if err != nil {
		return "", err
	}
	if b == nil {
		return "", fmt.Errorf("DRAW_NOT_FOUND: %s", drawId)
	}
	return string(b), nil
}

func (t *TicketChaincode) GetReservation(
	ctx contractapi.TransactionContextInterface,
	reservationId string,
) (string, error) {
	b, err := ctx.GetStub().GetState(keyPrefixReservation + reservationId)
	if err != nil {
		return "", err
	}
	if b == nil {
		return "", fmt.Errorf("RESERVATION_NOT_FOUND: %s", reservationId)
	}
	return string(b), nil
}

func (t *TicketChaincode) GetUserRaffleNFTs(
	ctx contractapi.TransactionContextInterface,
	userDidHash string,
) (string, error) {
	iter, err := ctx.GetStub().GetStateByPartialCompositeKey("RAFFLE_NFT_USER", []string{userDidHash})
	if err != nil {
		return "", err
	}
	defer iter.Close()

	records := make([]RaffleNFTRecord, 0)
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			continue
		}
		_, parts, err := ctx.GetStub().SplitCompositeKey(kv.Key)
		if err != nil || len(parts) < 2 {
			continue
		}
		raffleNftId := parts[1]

		rb, err := ctx.GetStub().GetState(keyPrefixRaffleNFT + raffleNftId)
		if err != nil || rb == nil {
			continue
		}
		var rec RaffleNFTRecord
		if err = json.Unmarshal(rb, &rec); err != nil {
			continue
		}
		records = append(records, rec)
	}
	out, _ := json.Marshal(records)
	return string(out), nil
}

// ─── 21. HashDid (쿼리용 유틸) ───────────────────────────

func (t *TicketChaincode) HashDid(
	ctx contractapi.TransactionContextInterface,
	walletAddress string,
) (string, error) {
	return hashDid(walletAddress), nil
}

// ─── 22. GetAllDraws ─────────────────────────────────────

func (t *TicketChaincode) GetAllDraws(
	ctx contractapi.TransactionContextInterface,
) (string, error) {
	iter, err := ctx.GetStub().GetStateByRange(keyPrefixDraw, keyPrefixDraw+"~")
	if err != nil {
		return "", err
	}
	defer iter.Close()

	draws := make([]DrawRecord, 0)
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			continue
		}
		var rec DrawRecord
		if err = json.Unmarshal(kv.Value, &rec); err != nil {
			continue
		}
		draws = append(draws, rec)
	}
	out, _ := json.Marshal(draws)
	return string(out), nil
}

// ─── 25. RegisterPreSaleConfig ───────────────────────────

func (t *TicketChaincode) RegisterPreSaleConfig(
	ctx contractapi.TransactionContextInterface,
	matchId string,
	preSaleSeatCount int,
	preSaleSeatListJSON string,
	applyStartTime, applyEndTime, drawTime, preSaleStartTime, preSaleEndTime string,
) error {
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return err
	}
	if matchId == "" {
		return fmt.Errorf("INVALID_PARAM: matchId는 필수입니다")
	}
	if preSaleSeatCount <= 0 {
		return fmt.Errorf("INVALID_PARAM: preSaleSeatCount는 1 이상이어야 합니다")
	}

	var seatList []string
	if err := json.Unmarshal([]byte(preSaleSeatListJSON), &seatList); err != nil {
		return fmt.Errorf("INVALID_PARAM: preSaleSeatListJSON 파싱 실패: %s", err)
	}
	if len(seatList) < preSaleSeatCount {
		return fmt.Errorf("INVALID_PARAM: 좌석 목록 수(%d)가 우선 예매 좌석 수(%d)보다 작습니다", len(seatList), preSaleSeatCount)
	}

	timeFields := []string{applyStartTime, applyEndTime, drawTime, preSaleStartTime, preSaleEndTime}
	for _, tf := range timeFields {
		if _, err := time.Parse(time.RFC3339, tf); err != nil {
			return fmt.Errorf("INVALID_PARAM: 시간 형식 오류 (%s) — RFC3339 필요", tf)
		}
	}

	existing, err := ctx.GetStub().GetState(keyPrefixPreSaleConfig + matchId)
	if err != nil {
		return err
	}
	if existing != nil {
		return fmt.Errorf("PRESALE_CONFIG_ALREADY_EXISTS: %s", matchId)
	}

	config := PreSaleConfig{
		MatchId:          matchId,
		PreSaleSeatCount: preSaleSeatCount,
		PreSaleSeatList:  seatList,
		ApplyStartTime:   applyStartTime,
		ApplyEndTime:     applyEndTime,
		DrawTime:         drawTime,
		PreSaleStartTime: preSaleStartTime,
		PreSaleEndTime:   preSaleEndTime,
		Status:           "OPEN",
		CreatedAt:        nowISO(ctx),
		UpdatedAt:        nowISO(ctx),
	}
	b, err := json.Marshal(config)
	if err != nil {
		return err
	}
	return ctx.GetStub().PutState(keyPrefixPreSaleConfig+matchId, b)
}

// ─── 26. SubmitRaffleNFTs ────────────────────────────────
// 사용자가 응모권 1~N장을 한 경기 추첨에 제출한다.
// - 멤버십 등급별 월간 제출 한도 검증 (BASIC/BRONZE: 1장, SILVER/GOLD: 2장)
// - 한 경기에 중복 제출 불가
// - 각 NFT는 본인 소유 + ISSUED 상태여야 함

func (t *TicketChaincode) SubmitRaffleNFTs(
	ctx contractapi.TransactionContextInterface,
	matchId, userDidHash, raffleNftIdsJSON string,
) (string, error) {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return "", err
	}
	var raffleNftIds []string
	if err := json.Unmarshal([]byte(raffleNftIdsJSON), &raffleNftIds); err != nil {
		return "", fmt.Errorf("INVALID_PARAM: raffleNftIdsJSON 파싱 실패: %s", err)
	}
	if len(raffleNftIds) == 0 {
		return "", fmt.Errorf("INVALID_PARAM: 응모권을 1개 이상 제출해야 합니다")
	}

	// PreSaleConfig 조회 및 응모 기간 검증
	configB, err := ctx.GetStub().GetState(keyPrefixPreSaleConfig + matchId)
	if err != nil {
		return "", err
	}
	if configB == nil {
		return "", fmt.Errorf("PRESALE_CONFIG_NOT_FOUND: %s", matchId)
	}
	var config PreSaleConfig
	if err = json.Unmarshal(configB, &config); err != nil {
		return "", err
	}
	if config.Status != "OPEN" {
		return "", fmt.Errorf("PRESALE_NOT_OPEN: 응모 가능 상태가 아닙니다 (%s)", config.Status)
	}

	now := txNow(ctx)
	applyStart, _ := time.Parse(time.RFC3339, config.ApplyStartTime)
	applyEnd, _ := time.Parse(time.RFC3339, config.ApplyEndTime)
	if now.Before(applyStart) {
		return "", fmt.Errorf("APPLY_NOT_STARTED: 응모 시작 전입니다")
	}
	if now.After(applyEnd) {
		return "", fmt.Errorf("APPLY_ENDED: 응모 마감되었습니다")
	}

	// 멤버십 조회 및 월간 제출 한도 검증
	membership, err := getOrCreateMembership(ctx, userDidHash)
	if err != nil {
		return "", err
	}
	if !membership.Joined {
		return "", fmt.Errorf("MEMBERSHIP_REQUIRED: 멤버십 가입 후 응모할 수 있습니다")
	}
	resetMonthlyIfNeeded(membership, currentMonth(ctx))

	limit := preSaleMonthlySubmitLimit(membership.Grade)
	if membership.MonthlyRaffleSubmitCount+len(raffleNftIds) > limit {
		return "", fmt.Errorf("SUBMIT_LIMIT_EXCEEDED: 월간 제출 한도(%d장) 초과 (현재 %d장 사용)", limit, membership.MonthlyRaffleSubmitCount)
	}

	// 이 경기에 이미 제출했는지 확인
	entryLookupKey, err := ctx.GetStub().CreateCompositeKey("PRESALE_ENTRY_USER", []string{matchId, userDidHash})
	if err != nil {
		return "", err
	}
	if existing, err2 := ctx.GetStub().GetState(entryLookupKey); err2 != nil {
		return "", err2
	} else if existing != nil {
		return "", fmt.Errorf("ALREADY_SUBMITTED: 이미 이 경기에 응모했습니다")
	}

	// 각 응모권 유효성 검증: 소유자 + ISSUED 상태
	for _, nftId := range raffleNftIds {
		rb, err2 := ctx.GetStub().GetState(keyPrefixRaffleNFT + nftId)
		if err2 != nil {
			return "", err2
		}
		if rb == nil {
			return "", fmt.Errorf("RAFFLE_NFT_NOT_FOUND: %s", nftId)
		}
		var raffle RaffleNFTRecord
		if err2 = json.Unmarshal(rb, &raffle); err2 != nil {
			return "", err2
		}
		if raffle.UserDidHash != userDidHash {
			return "", fmt.Errorf("NOT_OWNER: 응모권 %s의 소유자가 아닙니다", nftId)
		}
		if raffle.Status != "ISSUED" {
			return "", fmt.Errorf("RAFFLE_NFT_NOT_AVAILABLE: %s 상태가 ISSUED가 아닙니다 (%s)", nftId, raffle.Status)
		}
	}

	// 응모권 상태 → ENTERED
	for _, nftId := range raffleNftIds {
		rb, _ := ctx.GetStub().GetState(keyPrefixRaffleNFT + nftId)
		var raffle RaffleNFTRecord
		json.Unmarshal(rb, &raffle)
		raffle.Status = "ENTERED"
		raffle.DrawId = matchId
		raffle.UpdatedAt = nowISO(ctx)
		rb2, _ := json.Marshal(raffle)
		if err2 := ctx.GetStub().PutState(keyPrefixRaffleNFT+nftId, rb2); err2 != nil {
			return "", err2
		}
	}

	// PreSaleEntry 저장
	entryId := "psentry-" + ctx.GetStub().GetTxID()[:12]
	entry := PreSaleEntry{
		EntryId:      entryId,
		MatchId:      matchId,
		UserDidHash:  userDidHash,
		RaffleNftIds: raffleNftIds,
		SubmitCount:  len(raffleNftIds),
		SubmittedAt:  nowISO(ctx),
	}
	entryB, err := json.Marshal(entry)
	if err != nil {
		return "", err
	}
	if err = ctx.GetStub().PutState(keyPrefixPreSaleEntry+entryId, entryB); err != nil {
		return "", err
	}
	// 역조회 키: {matchId, userDidHash} → entryId
	if err = ctx.GetStub().PutState(entryLookupKey, []byte(entryId)); err != nil {
		return "", err
	}

	// 월간 제출 횟수 업데이트
	membership.MonthlyRaffleSubmitCount += len(raffleNftIds)
	if err = putMembership(ctx, membership); err != nil {
		return "", err
	}

	out, _ := json.Marshal(map[string]interface{}{
		"entryId":          entryId,
		"matchId":          matchId,
		"submitCount":      len(raffleNftIds),
		"monthlyRemaining": limit - membership.MonthlyRaffleSubmitCount,
	})
	return string(out), nil
}

// ─── 27. ExecutePreSaleDraw ──────────────────────────────
// 가중치 기반 사용자 단위 추첨을 실행하고 당첨자에게 우선 예매 권리를 부여한다.
// - 응모권 수 = 가중치 (확률 증가)
// - 최종 당첨은 사용자 단위 (중복 당첨 없음)
// - 좌석 수만큼 서로 다른 사용자 선정

func (t *TicketChaincode) ExecutePreSaleDraw(
	ctx contractapi.TransactionContextInterface,
	matchId string,
) (string, error) {
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return "", err
	}

	configB, err := ctx.GetStub().GetState(keyPrefixPreSaleConfig + matchId)
	if err != nil {
		return "", err
	}
	if configB == nil {
		return "", fmt.Errorf("PRESALE_CONFIG_NOT_FOUND: %s", matchId)
	}
	var config PreSaleConfig
	if err = json.Unmarshal(configB, &config); err != nil {
		return "", err
	}
	if config.Status != "OPEN" && config.Status != "DRAW_PENDING" {
		return "", fmt.Errorf("DRAW_INVALID_STATUS: 추첨 가능 상태가 아닙니다 (%s)", config.Status)
	}

	now := txNow(ctx)
	drawTime, _ := time.Parse(time.RFC3339, config.DrawTime)
	if now.Before(drawTime) {
		return "", fmt.Errorf("DRAW_TOO_EARLY: 추첨 시각 이전입니다")
	}

	// 이 경기의 응모 목록 전체 수집
	iter, err := ctx.GetStub().GetStateByPartialCompositeKey("PRESALE_ENTRY_USER", []string{matchId})
	if err != nil {
		return "", err
	}
	defer iter.Close()

	var entries []PreSaleEntry
	for iter.HasNext() {
		kv, err2 := iter.Next()
		if err2 != nil {
			continue
		}
		entryId := string(kv.Value)
		entryB, err2 := ctx.GetStub().GetState(keyPrefixPreSaleEntry + entryId)
		if err2 != nil || entryB == nil {
			continue
		}
		var entry PreSaleEntry
		if err2 = json.Unmarshal(entryB, &entry); err2 != nil {
			continue
		}
		entries = append(entries, entry)
	}
	if len(entries) == 0 {
		return "", fmt.Errorf("NO_ENTRIES: 응모자가 없습니다")
	}

	// 가중 풀 구성: userDidHash를 submitCount만큼 반복 추가
	var pool []string
	for _, e := range entries {
		for i := 0; i < e.SubmitCount; i++ {
			pool = append(pool, e.UserDidHash)
		}
	}

	// txId 해시를 시드로 결정적 랜덤 생성
	txId := ctx.GetStub().GetTxID()
	baseHash := sha256.Sum256([]byte(txId))

	winners := make([]string, 0, config.PreSaleSeatCount)
	wonSet := make(map[string]bool)

	for step := 0; len(winners) < config.PreSaleSeatCount && len(pool) > 0; step++ {
		stepInput := make([]byte, 34)
		copy(stepInput, baseHash[:])
		stepInput[32] = byte(step)
		stepInput[33] = byte(step >> 8)
		h := sha256.Sum256(stepInput)

		idx := (int(h[0]) | int(h[1])<<8 | int(h[2])<<16) % len(pool)
		picked := pool[idx]

		// 해당 유저의 모든 항목을 풀에서 제거
		newPool := make([]string, 0, len(pool))
		for _, u := range pool {
			if u != picked {
				newPool = append(newPool, u)
			}
		}
		pool = newPool

		if !wonSet[picked] {
			wonSet[picked] = true
			winners = append(winners, picked)
		}
	}

	// 당첨자에게 PreSaleRight(GRANTED) 부여
	rightIds := make([]string, 0, len(winners))
	for i, winner := range winners {
		rightId := fmt.Sprintf("psright-%s-%d", txId[:12], i)
		right := PreSaleRight{
			RightId:          rightId,
			MatchId:          matchId,
			UserDidHash:      winner,
			RightStatus:      "GRANTED",
			PreSaleStartTime: config.PreSaleStartTime,
			PreSaleEndTime:   config.PreSaleEndTime,
			GrantedAt:        nowISO(ctx),
			UpdatedAt:        nowISO(ctx),
		}
		rightB, err2 := json.Marshal(right)
		if err2 != nil {
			return "", err2
		}
		if err2 = ctx.GetStub().PutState(keyPrefixPreSaleRight+rightId, rightB); err2 != nil {
			return "", err2
		}
		// 역조회: {userDidHash, rightId}
		ck1, err2 := ctx.GetStub().CreateCompositeKey("PRESALE_RIGHT_USER", []string{winner, rightId})
		if err2 != nil {
			return "", err2
		}
		if err2 = ctx.GetStub().PutState(ck1, []byte{0x00}); err2 != nil {
			return "", err2
		}
		// 역조회: {matchId, rightId}
		ck2, err2 := ctx.GetStub().CreateCompositeKey("PRESALE_RIGHT_MATCH", []string{matchId, rightId})
		if err2 != nil {
			return "", err2
		}
		if err2 = ctx.GetStub().PutState(ck2, []byte{0x00}); err2 != nil {
			return "", err2
		}
		rightIds = append(rightIds, rightId)
	}

	// 응모권 상태 업데이트: 당첨자 → WINNER, 낙첨자 → LOST
	for _, e := range entries {
		isWinner := wonSet[e.UserDidHash]
		for _, nftId := range e.RaffleNftIds {
			rb, err2 := ctx.GetStub().GetState(keyPrefixRaffleNFT + nftId)
			if err2 != nil || rb == nil {
				continue
			}
			var raffle RaffleNFTRecord
			if err2 = json.Unmarshal(rb, &raffle); err2 != nil {
				continue
			}
			if isWinner {
				raffle.Status = "WINNER"
			} else {
				raffle.Status = "LOST"
			}
			raffle.UpdatedAt = nowISO(ctx)
			rb2, _ := json.Marshal(raffle)
			ctx.GetStub().PutState(keyPrefixRaffleNFT+nftId, rb2)
		}
	}

	// PreSaleConfig 상태 → DRAW_COMPLETED
	config.Status = "DRAW_COMPLETED"
	config.UpdatedAt = nowISO(ctx)
	configB2, err := json.Marshal(config)
	if err != nil {
		return "", err
	}
	if err = ctx.GetStub().PutState(keyPrefixPreSaleConfig+matchId, configB2); err != nil {
		return "", err
	}

	out, _ := json.Marshal(map[string]interface{}{
		"matchId":      matchId,
		"totalEntries": len(entries),
		"winnerCount":  len(winners),
		"rightIds":     rightIds,
	})
	return string(out), nil
}

// ─── 28. UsePreSaleRight ─────────────────────────────────
// 우선 예매 당첨자가 권리를 사용해 좌석을 예매한다.
// 검증: 권리 소유 + GRANTED 상태 + 예매 시간 범위 + 대상 좌석 + 미점유 + 1인 1좌석

func (t *TicketChaincode) UsePreSaleRight(
	ctx contractapi.TransactionContextInterface,
	rightId, userDidHash, seatId string,
) (string, error) {
	// 원장을 바꾸는 함수는 서버 조직(Org1)만 호출할 수 있다.
	if err := requireMSP(ctx, "Org1MSP"); err != nil {
		return "", err
	}
	rightB, err := ctx.GetStub().GetState(keyPrefixPreSaleRight + rightId)
	if err != nil {
		return "", err
	}
	if rightB == nil {
		return "", fmt.Errorf("PRESALE_RIGHT_NOT_FOUND: %s", rightId)
	}
	var right PreSaleRight
	if err = json.Unmarshal(rightB, &right); err != nil {
		return "", err
	}

	if right.RightStatus != "GRANTED" {
		return "", fmt.Errorf("RIGHT_NOT_GRANTED: 현재 상태 %s", right.RightStatus)
	}
	if right.UserDidHash != userDidHash {
		return "", fmt.Errorf("NOT_OWNER: 우선 예매 권리 소유자가 아닙니다")
	}

	now := txNow(ctx)
	preSaleStart, _ := time.Parse(time.RFC3339, right.PreSaleStartTime)
	preSaleEnd, _ := time.Parse(time.RFC3339, right.PreSaleEndTime)
	if now.Before(preSaleStart) {
		return "", fmt.Errorf("PRESALE_NOT_STARTED: 우선 예매 시작 전입니다")
	}
	if now.After(preSaleEnd) {
		return "", fmt.Errorf("PRESALE_ENDED: 우선 예매 시간이 종료되었습니다. 일반 예매를 이용하세요")
	}

	// 우선 예매 설정에서 좌석 목록 검증
	configB, err := ctx.GetStub().GetState(keyPrefixPreSaleConfig + right.MatchId)
	if err != nil {
		return "", err
	}
	if configB == nil {
		return "", fmt.Errorf("PRESALE_CONFIG_NOT_FOUND: %s", right.MatchId)
	}
	var config PreSaleConfig
	if err = json.Unmarshal(configB, &config); err != nil {
		return "", err
	}

	seatAllowed := false
	for _, s := range config.PreSaleSeatList {
		if s == seatId {
			seatAllowed = true
			break
		}
	}
	if !seatAllowed {
		return "", fmt.Errorf("SEAT_NOT_IN_PRESALE: 좌석 %s은 우선 예매 대상 좌석이 아닙니다", seatId)
	}

	// 좌석 점유 여부 확인
	seatKey, err := ctx.GetStub().CreateCompositeKey("PRESALE_SEAT", []string{right.MatchId, seatId})
	if err != nil {
		return "", err
	}
	if seatData, err2 := ctx.GetStub().GetState(seatKey); err2 != nil {
		return "", err2
	} else if seatData != nil {
		return "", fmt.Errorf("SEAT_ALREADY_TAKEN: 좌석 %s은 이미 예매되었습니다", seatId)
	}

	// 권리 상태 → USED + 좌석 점유
	right.RightStatus = "USED"
	right.UpdatedAt = nowISO(ctx)
	rightB2, err := json.Marshal(right)
	if err != nil {
		return "", err
	}
	if err = ctx.GetStub().PutState(keyPrefixPreSaleRight+rightId, rightB2); err != nil {
		return "", err
	}
	if err = ctx.GetStub().PutState(seatKey, []byte(rightId)); err != nil {
		return "", err
	}

	out, _ := json.Marshal(map[string]interface{}{
		"rightId": rightId,
		"matchId": right.MatchId,
		"seatId":  seatId,
		"status":  "USED",
		"message": "우선 예매 완료. 티켓 발권을 진행하세요.",
	})
	return string(out), nil
}

// ─── 29. ExpirePreSaleRights ─────────────────────────────
// preSaleEndTime이 지난 GRANTED 권리를 EXPIRED로 처리한다.
// 해당 좌석은 별도 점유 기록이 없으므로 자동으로 일반 예매 전환된다.

func (t *TicketChaincode) ExpirePreSaleRights(
	ctx contractapi.TransactionContextInterface,
	matchId string,
) (string, error) {
	if err := requireMSP(ctx, "Org1MSP", "Org2MSP"); err != nil {
		return "", err
	}

	now := txNow(ctx)

	iter, err := ctx.GetStub().GetStateByPartialCompositeKey("PRESALE_RIGHT_MATCH", []string{matchId})
	if err != nil {
		return "", err
	}
	defer iter.Close()

	expiredCount := 0
	expiredRightIds := make([]string, 0)

	for iter.HasNext() {
		kv, err2 := iter.Next()
		if err2 != nil {
			continue
		}
		_, parts, err2 := ctx.GetStub().SplitCompositeKey(kv.Key)
		if err2 != nil || len(parts) < 2 {
			continue
		}
		rightId := parts[1]

		rightB, err2 := ctx.GetStub().GetState(keyPrefixPreSaleRight + rightId)
		if err2 != nil || rightB == nil {
			continue
		}
		var right PreSaleRight
		if err2 = json.Unmarshal(rightB, &right); err2 != nil {
			continue
		}
		if right.RightStatus != "GRANTED" {
			continue
		}

		preSaleEnd, err2 := time.Parse(time.RFC3339, right.PreSaleEndTime)
		if err2 != nil {
			continue
		}
		if now.After(preSaleEnd) {
			right.RightStatus = "EXPIRED"
			right.UpdatedAt = nowISO(ctx)
			rightB2, _ := json.Marshal(right)
			ctx.GetStub().PutState(keyPrefixPreSaleRight+rightId, rightB2)
			expiredCount++
			expiredRightIds = append(expiredRightIds, rightId)
		}
	}

	// 만료 처리된 권리가 있으면 PreSaleConfig → CLOSED
	if expiredCount > 0 {
		configB, err2 := ctx.GetStub().GetState(keyPrefixPreSaleConfig + matchId)
		if err2 == nil && configB != nil {
			var config PreSaleConfig
			if json.Unmarshal(configB, &config) == nil && config.Status == "DRAW_COMPLETED" {
				config.Status = "CLOSED"
				config.UpdatedAt = nowISO(ctx)
				configB2, _ := json.Marshal(config)
				ctx.GetStub().PutState(keyPrefixPreSaleConfig+matchId, configB2)
			}
		}
	}

	out, _ := json.Marshal(map[string]interface{}{
		"matchId":         matchId,
		"expiredCount":    expiredCount,
		"expiredRightIds": expiredRightIds,
		"message":         "만료된 좌석은 일반 예매 전환 가능합니다",
	})
	return string(out), nil
}

// ─── 30. 조회 함수 (PreSale) ─────────────────────────────

func (t *TicketChaincode) GetPreSaleConfig(
	ctx contractapi.TransactionContextInterface,
	matchId string,
) (string, error) {
	b, err := ctx.GetStub().GetState(keyPrefixPreSaleConfig + matchId)
	if err != nil {
		return "", err
	}
	if b == nil {
		return "", fmt.Errorf("PRESALE_CONFIG_NOT_FOUND: %s", matchId)
	}
	return string(b), nil
}

func (t *TicketChaincode) GetPreSaleRight(
	ctx contractapi.TransactionContextInterface,
	rightId string,
) (string, error) {
	b, err := ctx.GetStub().GetState(keyPrefixPreSaleRight + rightId)
	if err != nil {
		return "", err
	}
	if b == nil {
		return "", fmt.Errorf("PRESALE_RIGHT_NOT_FOUND: %s", rightId)
	}
	return string(b), nil
}

func (t *TicketChaincode) GetUserPreSaleRights(
	ctx contractapi.TransactionContextInterface,
	userDidHash string,
) (string, error) {
	iter, err := ctx.GetStub().GetStateByPartialCompositeKey("PRESALE_RIGHT_USER", []string{userDidHash})
	if err != nil {
		return "", err
	}
	defer iter.Close()

	rights := make([]PreSaleRight, 0)
	for iter.HasNext() {
		kv, err2 := iter.Next()
		if err2 != nil {
			continue
		}
		_, parts, err2 := ctx.GetStub().SplitCompositeKey(kv.Key)
		if err2 != nil || len(parts) < 2 {
			continue
		}
		rightId := parts[1]
		rightB, err2 := ctx.GetStub().GetState(keyPrefixPreSaleRight + rightId)
		if err2 != nil || rightB == nil {
			continue
		}
		var right PreSaleRight
		if err2 = json.Unmarshal(rightB, &right); err2 != nil {
			continue
		}
		rights = append(rights, right)
	}
	out, _ := json.Marshal(rights)
	return string(out), nil
}

func (t *TicketChaincode) GetPreSaleEntries(
	ctx contractapi.TransactionContextInterface,
	matchId string,
) (string, error) {
	iter, err := ctx.GetStub().GetStateByPartialCompositeKey("PRESALE_ENTRY_USER", []string{matchId})
	if err != nil {
		return "", err
	}
	defer iter.Close()

	entries := make([]PreSaleEntry, 0)
	for iter.HasNext() {
		kv, err2 := iter.Next()
		if err2 != nil {
			continue
		}
		entryId := string(kv.Value)
		entryB, err2 := ctx.GetStub().GetState(keyPrefixPreSaleEntry + entryId)
		if err2 != nil || entryB == nil {
			continue
		}
		var entry PreSaleEntry
		if err2 = json.Unmarshal(entryB, &entry); err2 != nil {
			continue
		}
		entries = append(entries, entry)
	}
	out, _ := json.Marshal(entries)
	return string(out), nil
}

// ─── main ─────────────────────────────────────────────────

func main() {
	cc, err := contractapi.NewChaincode(new(TicketChaincode))
	if err != nil {
		panic(err.Error())
	}

	if err := cc.Start(); err != nil {
		fmt.Printf("Error starting TicketChaincode: %s\n", err)
	}
}
