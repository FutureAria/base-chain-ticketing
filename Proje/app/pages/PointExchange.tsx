import { useEffect, useState, useCallback } from "react";
import { Gift, Star, Trophy, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "../components/ui/button";
import { useAppSettings } from "../context/AppSettingsContext";

// ─── 타입 ─────────────────────────────────────────────────

interface PointData {
  balance:      number;
  totalEarned:  number;
  totalUsed:    number;
}

interface MembershipData {
  grade:       "BASIC" | "BRONZE" | "SILVER" | "GOLD";
  entryCount:  number;
  monthlyRaffleExchangeCount: number;
  monthlyCardExchangeCount:   number;
}

interface ExchangeResult {
  exchangeId:       string;
  itemType:         string;
  pointUsed:        number;
  remainingBalance: number;
  status:           string;
}

// ─── 상수 ─────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  BASIC:  "#6d7d90",
  BRONZE: "#c97b3c",
  SILVER: "#7b8fa8",
  GOLD:   "#d4a017",
};

const GRADE_LIMITS = {
  BASIC:  { RAFFLE_NFT: 1, CARD_NFT: 1 },
  BRONZE: { RAFFLE_NFT: 1, CARD_NFT: 1 },
  SILVER: { RAFFLE_NFT: 2, CARD_NFT: 1 },
  GOLD:   { RAFFLE_NFT: 2, CARD_NFT: 2 },
};

const EXCHANGE_COSTS = { RAFFLE_NFT: 1500, CARD_NFT: 5000 };

// ─── 메인 컴포넌트 ────────────────────────────────────────

export function PointExchange() {
  const { walletAddress } = useAppSettings();

  const [point,        setPoint]        = useState<PointData | null>(null);
  const [membership,   setMembership]   = useState<MembershipData | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [refreshing,   setRefreshing]   = useState(false);
  const [toast,        setToast]        = useState<{ ok: boolean; msg: string } | null>(null);

  const authHeader = () => {
    const token = localStorage.getItem("auth_token") || "";
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };

  const fetchData = useCallback(async (silent = false) => {
    if (!walletAddress) return;
    if (!silent) setRefreshing(true);
    const base = import.meta.env.VITE_API_URL;
    try {
      const [pRes, mRes] = await Promise.all([
        fetch(`${base}/api/points?walletAddress=${walletAddress}`,           { headers: authHeader() }),
        fetch(`${base}/api/points/membership?walletAddress=${walletAddress}`, { headers: authHeader() }),
      ]);
      const pData = await pRes.json();
      const mData = await mRes.json();
      if (pData.success) setPoint(pData.data);
      if (mData.success) setMembership(mData.data);
    } catch (err) {
      console.error("[PointExchange] fetchData error:", err);
    } finally {
      setRefreshing(false);
    }
  }, [walletAddress]);

  // 마운트 + walletAddress 변경 시 조회
  useEffect(() => { fetchData(true); }, [fetchData]);

  // 탭 포커스 시 자동 갱신 (다른 페이지 갔다 돌아올 때)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") fetchData(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchData]);

  const showToast = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const handleExchange = async (itemType: "RAFFLE_NFT" | "CARD_NFT") => {
    if (!walletAddress || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/points/exchange`, {
        method:  "POST",
        headers: authHeader(),
        body:    JSON.stringify({ walletAddress, itemType }),
      });
      const data = await res.json();
      if (data.success) {
        const r: ExchangeResult = data.data;
        const suffix = itemType === "RAFFLE_NFT" ? " · 응모권 NFT 발급 완료!" : "";
        showToast(true, `교환 완료! ${r.pointUsed.toLocaleString()}P 차감 → 잔액 ${r.remainingBalance.toLocaleString()}P${suffix}`);
        fetchData();
      } else {
        showToast(false, data.error ?? "교환 실패");
      }
    } catch {
      showToast(false, "서버 오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  };

  const grade     = membership?.grade ?? "BASIC";
  const gradeColor = GRADE_COLORS[grade];
  const limits    = GRADE_LIMITS[grade as keyof typeof GRADE_LIMITS];

  return (
    <div className="page-shell max-w-lg mx-auto">
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <p className="page-eyebrow text-[#1456a0] mb-3">Rewards</p>
            <h1 className="page-title mb-3" style={{ color: "#14253f" }}>포인트 교환소</h1>
            <p className="page-subtitle" style={{ color: "#55657d" }}>적립 포인트로 특별한 NFT를 교환하세요</p>
          </div>
          <button
            onClick={() => fetchData()}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium"
            style={{ background: "#f0f6ff", color: "#1456a0", border: "1px solid #bfd0e2" }}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "조회 중" : "새로고침"}
          </button>
        </div>
      </div>

      {!walletAddress ? (
        <div className="rounded-2xl px-6 py-10 text-center"
          style={{ background: "#f8fbfd", border: "1px solid #d8e3ec" }}>
          <AlertCircle className="w-10 h-10 mx-auto mb-3" style={{ color: "#9ca3af" }} />
          <p className="font-semibold" style={{ color: "#21354b" }}>MetaMask 지갑을 연결해주세요</p>
        </div>
      ) : (
        <>
          {/* 포인트 + 멤버십 카드 */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl p-6 mb-6"
            style={{
              background:  "linear-gradient(135deg, #0f2744, #1456a0)",
              boxShadow:   "0 18px 48px rgba(20,86,160,0.25)",
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5" style={{ color: gradeColor }} />
                <span className="text-sm font-bold" style={{ color: gradeColor }}>
                  {grade} 멤버
                </span>
              </div>
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                입장 {membership?.entryCount ?? 0}회
              </span>
            </div>

            <p className="text-[2rem] font-extrabold text-white tabular-nums">
              {(point?.balance ?? 0).toLocaleString()}
              <span className="text-lg font-semibold ml-1" style={{ color: "rgba(255,255,255,0.6)" }}>P</span>
            </p>
            <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.45)" }}>
              총 적립 {(point?.totalEarned ?? 0).toLocaleString()}P · 총 사용 {(point?.totalUsed ?? 0).toLocaleString()}P
            </p>
          </motion.div>

          {/* 교환 아이템 */}
          <div className="grid gap-4">
            {/* 응모권 NFT */}
            <ExchangeCard
              title="응모권 NFT"
              description="추첨을 통해 특별 경품을 받을 수 있는 NFT"
              icon={<Star className="w-8 h-8" style={{ color: "#f59e0b" }} />}
              cost={EXCHANGE_COSTS.RAFFLE_NFT}
              monthlyUsed={membership?.monthlyRaffleExchangeCount ?? 0}
              monthlyLimit={limits.RAFFLE_NFT}
              balance={point?.balance ?? 0}
              loading={loading}
              onExchange={() => handleExchange("RAFFLE_NFT")}
              accent="#f59e0b"
            />

            {/* 실물 카드 NFT */}
            <ExchangeCard
              title="실물 카드 NFT"
              description="한정판 선수 카드 NFT (실물 카드 포함)"
              icon={<Gift className="w-8 h-8" style={{ color: "#8b5cf6" }} />}
              cost={EXCHANGE_COSTS.CARD_NFT}
              monthlyUsed={membership?.monthlyCardExchangeCount ?? 0}
              monthlyLimit={limits.CARD_NFT}
              balance={point?.balance ?? 0}
              loading={loading}
              onExchange={() => handleExchange("CARD_NFT")}
              accent="#8b5cf6"
            />
          </div>

          {/* 멤버십 안내 */}
          <div className="mt-6 rounded-xl p-4 text-xs"
            style={{ background: "#f5f8fb", border: "1px solid #dbe4ed", color: "#6d7d90" }}>
            <p className="font-semibold mb-2" style={{ color: "#34465c" }}>멤버십 등급 안내</p>
            <div className="grid grid-cols-2 gap-1">
              <span>BASIC · 적립률 0.5%</span>
              <span>BRONZE (3회↑) · 0.7%</span>
              <span>SILVER (6회↑) · 1.0%</span>
              <span>GOLD (10회↑) · 1.5%</span>
            </div>
          </div>
        </>
      )}

      {/* Toast */}
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-lg z-50"
          style={{ background: toast.ok ? "#2dba73" : "#ef4444" }}
        >
          {toast.msg}
        </motion.div>
      )}
    </div>
  );
}

// ─── 교환 카드 ────────────────────────────────────────────

function ExchangeCard({
  title, description, icon, cost, monthlyUsed, monthlyLimit,
  balance, loading, onExchange, accent,
}: {
  title:        string;
  description:  string;
  icon:         React.ReactNode;
  cost:         number;
  monthlyUsed:  number;
  monthlyLimit: number;
  balance:      number;
  loading:      boolean;
  onExchange:   () => void;
  accent:       string;
}) {
  const canExchange   = balance >= cost && monthlyUsed < monthlyLimit;
  const limitReached  = monthlyUsed >= monthlyLimit;
  const notEnough     = balance < cost;

  return (
    <div className="rounded-2xl p-5"
      style={{ background: "#ffffff", border: `1px solid ${accent}22`, boxShadow: "0 8px 24px rgba(17,40,73,0.06)" }}>
      <div className="flex items-start gap-4">
        <div className="rounded-xl p-3 flex-shrink-0"
          style={{ background: `${accent}15` }}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold mb-0.5" style={{ color: "#14253f" }}>{title}</h3>
          <p className="text-xs mb-3" style={{ color: "#6d7d90" }}>{description}</p>

          <div className="flex items-center justify-between mb-3">
            <span className="text-lg font-extrabold tabular-nums" style={{ color: accent }}>
              {cost.toLocaleString()}P
            </span>
            <span className="text-xs" style={{ color: "#9ca3af" }}>
              이번 달 {monthlyUsed} / {monthlyLimit}회
            </span>
          </div>

          <Button
            className="w-full h-10 font-bold text-white rounded-xl text-sm"
            style={{
              background:  canExchange ? `linear-gradient(135deg, ${accent}, ${accent}bb)` : "#d1d5db",
              cursor:      canExchange && !loading ? "pointer" : "not-allowed",
            }}
            disabled={!canExchange || loading}
            onClick={onExchange}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : limitReached ? (
              "이번 달 교환 완료"
            ) : notEnough ? (
              `${(cost - balance).toLocaleString()}P 부족`
            ) : (
              "교환하기"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
