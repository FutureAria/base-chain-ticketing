import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Award, Check, Coins, Gift, MapPin, PackageCheck, ShieldAlert, Sparkles, Ticket, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { Button } from "../components/ui/button";
import { useAppSettings } from "../context/AppSettingsContext";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const apiHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("auth_token") ?? ""}`,
});

const RAFFLE_PACKAGES = [{ id: 1, count: 1, price: 1500, label: "응모권 1장" }];

type CardOption = {
  id: number;
  team: string;
  name: string;
  image: string;
  note: string;
};

type ExchangeStatus = {
  tier: string | null;
  limits: { nft: number; raffle: number };
  used: { nft: number; raffle: number };
  remaining: { nft: number; raffle: number };
  cardNftCost: number;
  cardPool: CardOption[];
};

type TierReward = {
  tier: string;
  requiredCount: number;
  rewardCards: number;
  rewardRaffles: number;
  eligible: boolean;
  claimed: boolean;
};

type DeliveryAddress = {
  recipient: string;
  phone: string;
  zipcode: string;
  address: string;
  addressDetail: string;
};

type CardResult = CardOption & {
  nftId: string;
  pointUsed: number;
  remainingBalance: number;
};

const emptyAddress: DeliveryAddress = {
  recipient: "",
  phone: "",
  zipcode: "",
  address: "",
  addressDetail: "",
};

export function Exchange() {
  const navigate = useNavigate();
  const { theme, walletAddress } = useAppSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const isDark = theme === "dark";

  const neutralText = isDark ? "#dce8f4" : "#1f3248";
  const mutedText = isDark ? "#8fa5bc" : "#6f8094";
  const panelBg = isDark ? "rgba(25,34,45,0.94)" : "#ffffff";
  const panelBorder = isDark ? "1px solid rgba(88,110,134,0.28)" : "1px solid #dce5f2";
  const surfaceBg = isDark ? "rgba(36,48,62,0.9)" : "#f5f8fb";
  const surfaceBorder = isDark ? "1px solid rgba(88,110,134,0.22)" : "1px solid #e2e8f2";
  const accentBlue = "#2563eb";
  const accentGreen = "#10b981";

  const getTabFromParams = () => {
    const tab = searchParams.get("tab") || searchParams.get("type");
    if (tab === "raffle") return "raffle";
    if (tab === "tier") return "tier";
    return "card";
  };
  const [activeTab, setActiveTab] = useState<"card" | "raffle" | "tier">(getTabFromParams());
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState(0);
  const [raffleCount, setRaffleCount] = useState<number | null>(null);
  const [status, setStatus] = useState<ExchangeStatus | null>(null);
  const [tierRewards, setTierRewards] = useState<TierReward[]>([]);
  const [cardPurchasing, setCardPurchasing] = useState(false);
  const [rafflePurchasing, setRafflePurchasing] = useState<number | null>(null);
  const [claimingTier, setClaimingTier] = useState<string | null>(null);
  const [confirmCard, setConfirmCard] = useState(false);
  const [cardResult, setCardResult] = useState<CardResult | null>(null);
  const [showDelivery, setShowDelivery] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryAddress>(emptyAddress);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const showToast = (text: string, type: "success" | "error") => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    setActiveTab(getTabFromParams());
  }, [searchParams]);

  const selectTab = (tab: "card" | "raffle" | "tier") => {
    setActiveTab(tab);
    const nextParams = new URLSearchParams(searchParams);
    if (tab === "raffle") {
      nextParams.set("tab", "raffle");
    } else if (tab === "tier") {
      nextParams.set("tab", "tier");
    } else {
      nextParams.delete("tab");
      nextParams.delete("type");
    }
    setSearchParams(nextParams, { replace: true });
  };

  const fetchStatus = async () => {
    const res = await fetch(`${API_BASE}/api/exchange/status`, { headers: apiHeaders() });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "교환소 상태 조회 실패");
    setStatus(data);
    return data as ExchangeStatus;
  };

  const fetchTierRewards = async () => {
    const res = await fetch(`${API_BASE}/api/auth/tier-rewards`, { headers: apiHeaders() });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "티어 혜택 조회 실패");
    setTierRewards(data.rewards ?? []);
    return data.rewards as TierReward[];
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const tasks: Promise<unknown>[] = [fetchStatus(), fetchTierRewards()];
      if (walletAddress) {
        tasks.push(fetch(`${API_BASE}/api/points?walletAddress=${walletAddress}`, { headers: apiHeaders() }).then(r => r.json()));
        tasks.push(fetch(`${API_BASE}/api/raffle/my?walletAddress=${walletAddress}`, { headers: apiHeaders() }).then(r => r.json()).catch(() => ({ success: false, data: [] })));
      }

      const [, , pointData, raffleData] = await Promise.all(tasks);
      if (pointData && typeof pointData === "object" && "success" in pointData && pointData.success) {
        // 포인트 응답은 { data: { balance } } 형태와 { data: number } 형태가 모두 올 수 있다.
        const payload = (pointData as { data?: { balance?: number } | number }).data;
        const balance = typeof payload === "object" && payload !== null ? payload.balance : payload;
        setPoints(Number(balance ?? 0));
      }
      if (raffleData && typeof raffleData === "object" && "data" in raffleData && Array.isArray(raffleData.data)) {
        setRaffleCount(raffleData.data.filter((r: { status?: string }) => r.status === "ISSUED").length);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "교환소 정보를 불러오지 못했습니다.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [walletAddress]);

  const cardCost = status?.cardNftCost ?? 5000;
  const cardLimitReached = status ? status.remaining.nft <= 0 : false;
  const raffleLimitReached = status ? status.remaining.raffle <= 0 : false;
  const membershipRequired = !status?.tier;
  const cardEnoughPoints = points >= cardCost;
  const cardCanBuy = Boolean(walletAddress && !membershipRequired && !cardLimitReached && cardEnoughPoints && !cardPurchasing);
  const cardProbability = status?.cardPool?.length
    ? `${Number((100 / status.cardPool.length).toFixed(1)).toLocaleString()}%`
    : "-";

  const cardButtonLabel = useMemo(() => {
    if (cardPurchasing) return "처리 중...";
    if (!walletAddress) return "지갑 연결 필요";
    if (membershipRequired) return "멤버십 가입 필요";
    if (cardLimitReached) return "이번 달 한도 초과";
    if (!cardEnoughPoints) return `${(cardCost - points).toLocaleString()}P 부족`;
    return "5000P 사용하기";
  }, [cardPurchasing, walletAddress, membershipRequired, cardLimitReached, cardEnoughPoints, cardCost, points]);

  const handleBuyCardNft = async () => {
    if (!walletAddress || !cardCanBuy) return;
    setCardPurchasing(true);
    try {
      const res = await fetch(`${API_BASE}/api/exchange/buy-card-nft`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ walletAddress }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "실물 NFT 발급 실패");

      const result: CardResult = {
        ...data.card,
        pointUsed: Number(data.pointUsed ?? cardCost),
        remainingBalance: Number(data.remainingBalance ?? Math.max(0, points - cardCost)),
      };
      setCardResult(result);
      setConfirmCard(false);
      setPoints(result.remainingBalance);
      setDelivery(emptyAddress);
      setShowDelivery(false);
      await fetchStatus();
      showToast("랜덤 실물 NFT가 발급되었습니다.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "실물 NFT 발급 중 오류가 발생했습니다.", "error");
    } finally {
      setCardPurchasing(false);
    }
  };

  const handleBuyRaffle = async (pkg: typeof RAFFLE_PACKAGES[0]) => {
    if (points < pkg.price) { showToast("포인트가 부족합니다.", "error"); return; }
    if (!walletAddress) { showToast("지갑 연결이 필요합니다.", "error"); return; }
    setRafflePurchasing(pkg.id);
    try {
      const res = await fetch(`${API_BASE}/api/exchange/buy-raffle`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ walletAddress, count: pkg.count }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "응모권 교환 실패");
      setPoints(Number(data.remainingBalance ?? Math.max(0, points - pkg.price)));
      setRaffleCount(data.newCount ?? (raffleCount ?? 0) + pkg.count);
      await fetchStatus();
      showToast(`응모권 ${pkg.count}장을 교환했습니다.`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "응모권 교환 중 오류가 발생했습니다.", "error");
    } finally {
      setRafflePurchasing(null);
    }
  };

  const handleClaimTierReward = async (tier: string) => {
    if (!walletAddress) { showToast("지갑 연결이 필요합니다.", "error"); return; }
    setClaimingTier(tier);
    try {
      const res = await fetch(`${API_BASE}/api/auth/claim-tier-reward`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ walletAddress, tier }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "티어 혜택 수령 실패");
      await Promise.all([fetchTierRewards(), fetchStatus()]);
      setRaffleCount((prev) => (prev ?? 0) + Number(data.rewardRaffles ?? 0));
      const cardCount = Number(data.rewardCards ?? data.awardedCards?.length ?? 0);
      const raffleRewardCount = Number(data.rewardRaffles ?? data.issuedRaffleNftIds?.length ?? 0);
      showToast(`${tier} 혜택 수령 완료: 실물 NFT ${cardCount}장, 응모권 ${raffleRewardCount}장`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "티어 혜택 수령 중 오류가 발생했습니다.", "error");
    } finally {
      setClaimingTier(null);
    }
  };

  const deliveryFilled = delivery.recipient.trim() && delivery.phone.trim() && delivery.zipcode.trim() && delivery.address.trim();

  return (
    <div className="page-shell space-y-8">
      <header className="page-header">
        <div className="page-header-main">
          <p className="page-eyebrow text-[#1456a0] mb-3">Exchange</p>
          <h1 className="page-title mb-2" style={{ color: neutralText }}>교환소</h1>
          <p className="page-subtitle" style={{ color: mutedText }}>
            보유 포인트로 응모권과 랜덤 실물 NFT를 발급받을 수 있어요.
          </p>
        </div>
      </header>

      <div className="flex items-center gap-3">
        {[
          { key: "card", label: "랜덤 실물 NFT", icon: Gift },
          { key: "raffle", label: "응모권 교환", icon: Ticket },
          { key: "tier", label: "티어 혜택", icon: Award },
        ].map(tab => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => selectTab(tab.key as "card" | "raffle" | "tier")}
              className="flex items-center gap-2 px-5 py-2.5 rounded-[14px] text-[0.92rem] font-bold transition-all"
              style={{
                background: active ? (isDark ? "rgba(37,99,235,0.22)" : "#eef3ff") : surfaceBg,
                border: active ? `1px solid ${isDark ? "rgba(37,99,235,0.4)" : "#c0d0f5"}` : surfaceBorder,
                color: active ? accentBlue : mutedText,
              }}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
        <button
          onClick={() => navigate("/physical-exchange")}
          className="flex items-center gap-2 px-5 py-2.5 rounded-[14px] text-[0.92rem] font-bold transition-all"
          style={{
            background: surfaceBg,
            border: surfaceBorder,
            color: mutedText,
          }}
        >
          <PackageCheck className="w-4 h-4" />
          실물 교환
        </button>
      </div>

      <PointSummary
        isDark={isDark}
        points={points}
        tier={status?.tier ?? null}
        neutralText={neutralText}
        mutedText={mutedText}
        panelBg={panelBg}
        panelBorder={panelBorder}
        accentBlue={accentBlue}
      />

      <AnimatePresence mode="wait">
        {activeTab === "card" && (
          <motion.div key="card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            <div className="grid lg:grid-cols-[1.35fr_0.85fr] gap-5 items-stretch">
              <div className="rounded-[20px] border p-6" style={{ background: panelBg, border: panelBorder }}>
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-[15px] flex items-center justify-center shrink-0" style={{ background: isDark ? "rgba(37,99,235,0.18)" : "#eef3ff" }}>
                    <Sparkles className="w-6 h-6" style={{ color: accentBlue }} />
                  </div>
                  <div>
                    <h2 className="text-[1.25rem] font-black" style={{ color: neutralText }}>랜덤 실물 NFT 교환</h2>
                    <p className="mt-1 text-[0.9rem] leading-6" style={{ color: mutedText }}>
                      5000P를 사용해 원본 굿즈 NFT 중 1개를 동일 확률로 발급받을 수 있어요.
                    </p>
                  </div>
                </div>

                <div className="mt-6 rounded-[18px] border p-4" style={{ background: surfaceBg, border: surfaceBorder }}>
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <p className="font-black text-[0.95rem]" style={{ color: neutralText }}>나올 수 있는 NFT</p>
                    <span className="rounded-full px-3 py-1 text-[0.74rem] font-black" style={{ background: isDark ? "rgba(37,99,235,0.18)" : "#eef3ff", color: accentBlue }}>
                      동일 확률
                    </span>
                  </div>

                  {loading ? (
                    <div className="h-[250px] flex items-center justify-center" style={{ color: mutedText }}>목록을 불러오는 중...</div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {(status?.cardPool ?? []).map(card => (
                        <div key={card.id} className="rounded-[14px] border overflow-hidden" style={{ background: panelBg, border: surfaceBorder }}>
                          <div className="aspect-[4/3] overflow-hidden" style={{ background: isDark ? "rgba(88,110,134,0.12)" : "#e8edf4" }}>
                            <img src={card.image} alt={card.name} className="w-full h-full object-cover" />
                          </div>
                          <div className="px-3 py-2">
                            <p className="text-[0.72rem] font-bold" style={{ color: accentBlue }}>{card.team}</p>
                            <p className="mt-0.5 text-[0.8rem] font-black line-clamp-2" style={{ color: neutralText }}>{card.name}</p>
                            <p className="mt-1 text-[0.72rem] font-bold" style={{ color: mutedText }}>확률 {cardProbability}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-[20px] border p-6 flex flex-col" style={{ background: panelBg, border: panelBorder }}>
                <div className="flex items-center gap-3 pb-5" style={{ borderBottom: `1px solid ${isDark ? "rgba(88,110,134,0.2)" : "#e2e8f2"}` }}>
                  <ShieldAlert className="w-5 h-5" style={{ color: cardLimitReached ? "#ef4444" : accentBlue }} />
                  <div>
                    <p className="font-black text-[0.95rem]" style={{ color: neutralText }}>이번 달 발급 현황</p>
                    <p className="text-[0.78rem] mt-0.5" style={{ color: mutedText }}>
                      {status?.tier ? `${status.tier} 등급 · 월 ${status.limits.nft}회` : "멤버십 가입 후 이용 가능"}
                    </p>
                  </div>
                </div>

                <div className="py-6 text-center" style={{ borderBottom: `1px solid ${isDark ? "rgba(88,110,134,0.2)" : "#e2e8f2"}` }}>
                  <p className="text-[0.82rem] font-bold" style={{ color: mutedText }}>사용 포인트</p>
                  <p className="mt-1 text-[2.2rem] font-black tabular-nums" style={{ color: accentBlue }}>
                    {cardCost.toLocaleString()}<span className="text-[1rem] ml-1">P</span>
                  </p>
                  {status && (
                    <p className="mt-2 text-[0.86rem] font-bold" style={{ color: cardLimitReached ? "#ef4444" : mutedText }}>
                      {status.used.nft} / {status.limits.nft}회 사용
                    </p>
                  )}
                </div>

                <div className="mt-5 rounded-[14px] px-4 py-4 text-[0.84rem] leading-6" style={{ background: surfaceBg, border: surfaceBorder, color: mutedText }}>
                  <p>발급 즉시 보유 카드 NFT 목록에 추가됩니다.</p>
                  <p>원하면 결과 확인 후 실물 신청 정보를 입력할 수 있어요.</p>
                </div>

                <Button
                  disabled={!cardCanBuy}
                  onClick={() => setConfirmCard(true)}
                  className="w-full h-12 rounded-[13px] text-[0.95rem] font-black mt-auto"
                  style={{
                    background: cardCanBuy ? "linear-gradient(135deg, #132850, #2563eb)" : (isDark ? "rgba(88,110,134,0.2)" : "#e2e8f0"),
                    color: cardCanBuy ? "#fff" : mutedText,
                    cursor: cardCanBuy ? "pointer" : "not-allowed",
                  }}
                >
                  {cardButtonLabel}
                </Button>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === "raffle" && (
          <motion.div key="raffle" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            {RAFFLE_PACKAGES.map(pkg => {
              const enoughPoints = points >= pkg.price;
              const canBuy = Boolean(walletAddress && !membershipRequired && enoughPoints && !raffleLimitReached);
              const isBuying = rafflePurchasing === pkg.id;
              const btnLabel = isBuying ? "처리 중..." : !walletAddress ? "지갑 연결 필요" : membershipRequired ? "멤버십 가입 필요" : raffleLimitReached ? "이번 달 한도 초과" : !enoughPoints ? "포인트 부족" : "교환하기";
              return (
                <div key={pkg.id} className="grid sm:grid-cols-2 gap-4 items-stretch">
                  <motion.div whileHover={canBuy ? { y: -4, scale: 1.02 } : {}} transition={{ type: "spring", stiffness: 280 }}
                    className="relative rounded-[16px] overflow-hidden"
                    style={{
                      opacity: canBuy ? 1 : 0.5,
                      boxShadow: canBuy ? "0 8px 32px rgba(19,40,80,0.22)" : "none",
                      filter: canBuy ? "none" : "grayscale(0.6)",
                    }}>
                    <img src="/raffle-ticket.png" alt="야구장 좌석 우선 응모권" className="w-full h-auto block" draggable={false} />
                    <div className="absolute top-3 left-3 flex flex-col items-start gap-1">
                      <span className="rounded-full px-3 py-1 text-[1rem] font-black text-white leading-none" style={{ background: "rgba(13,34,64,0.82)", backdropFilter: "blur(4px)" }}>{pkg.count}장</span>
                      <span className="rounded-full px-2.5 py-0.5 text-[0.72rem] font-bold text-white" style={{ background: "rgba(13,34,64,0.65)", backdropFilter: "blur(4px)" }}>{pkg.price.toLocaleString()}P</span>
                    </div>
                  </motion.div>

                  <div className="rounded-[16px] border flex flex-col px-6 py-5 gap-0"
                    style={{
                      background: raffleLimitReached ? (isDark ? "rgba(239,68,68,0.08)" : "#fef2f2") : surfaceBg,
                      borderColor: raffleLimitReached ? (isDark ? "rgba(239,68,68,0.3)" : "#fca5a5") : (isDark ? "rgba(88,110,134,0.22)" : "#e2e8f2"),
                    }}>
                    <div className="flex items-center gap-3 pb-4" style={{ borderBottom: `1px solid ${isDark ? "rgba(88,110,134,0.2)" : "#e2e8f2"}` }}>
                      <div className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0" style={{ background: isDark ? "rgba(16,185,129,0.18)" : "#ecfdf5" }}>
                        <Ticket className="w-5 h-5" style={{ color: accentGreen }} />
                      </div>
                      <div>
                        <p className="text-[0.78rem] font-semibold" style={{ color: mutedText }}>보유 응모권</p>
                        <p className="text-[1.6rem] font-black leading-tight" style={{ color: neutralText }}>
                          {raffleCount !== null ? raffleCount : "-"}<span className="text-[0.9rem] ml-1" style={{ color: accentGreen }}>장</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col items-center gap-1 py-4" style={{ borderBottom: `1px solid ${isDark ? "rgba(88,110,134,0.2)" : "#e2e8f2"}` }}>
                      <p className="text-[0.84rem] font-bold" style={{ color: mutedText }}>이번 달 교환 현황</p>
                      {status ? (
                        <>
                          <span className="text-[2rem] font-black leading-none" style={{ color: raffleLimitReached ? "#ef4444" : accentGreen }}>
                            {status.used.raffle}<span className="text-[2rem]" style={{ color: mutedText }}> / {status.limits.raffle}</span>
                          </span>
                          <p className="text-[0.76rem] mt-0.5" style={{ color: mutedText }}>{status.tier ?? "미가입"} · 월 {status.limits.raffle}장</p>
                        </>
                      ) : (
                        <span className="text-[2rem] font-black" style={{ color: mutedText }}>-</span>
                      )}
                    </div>

                    <Button
                      onClick={() => handleBuyRaffle(pkg)}
                      disabled={!canBuy || isBuying}
                      className="w-full h-11 rounded-[12px] text-[0.9rem] font-black mt-4"
                      style={{
                        background: canBuy ? "linear-gradient(135deg, #132850, #2563eb)" : (isDark ? "rgba(88,110,134,0.2)" : "#e2e8f0"),
                        color: canBuy ? "#fff" : mutedText,
                        cursor: canBuy && !isBuying ? "pointer" : "not-allowed",
                      }}
                    >
                      {btnLabel}
                    </Button>
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}

        {activeTab === "tier" && (
          <motion.div key="tier" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-5">
            <div className="rounded-[20px] border p-6" style={{ background: panelBg, border: panelBorder }}>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-[15px] flex items-center justify-center shrink-0" style={{ background: isDark ? "rgba(245,158,11,0.16)" : "#fff7ed" }}>
                  <Award className="w-6 h-6" style={{ color: "#d97706" }} />
                </div>
                <div>
                  <h2 className="text-[1.25rem] font-black" style={{ color: neutralText }}>등급 달성 혜택</h2>
                  <p className="mt-1 text-[0.9rem] leading-6" style={{ color: mutedText }}>
                    티어가 오르면 최초 1회 실물 NFT와 우선 응모권을 받을 수 있어요.
                  </p>
                </div>
              </div>

              <div className="mt-6 grid md:grid-cols-3 gap-4">
                {tierRewards.map((reward) => {
                  const canClaim = walletAddress && reward.eligible && !reward.claimed && (reward.rewardCards > 0 || reward.rewardRaffles > 0);
                  const loadingTier = claimingTier === reward.tier;
                  return (
                    <div key={reward.tier} className="rounded-[16px] border p-4 flex flex-col min-h-[250px]" style={{ background: surfaceBg, border: surfaceBorder }}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="rounded-full px-3 py-1 text-[0.82rem] font-black" style={{
                          background: reward.tier === "골드" ? "#fff7ed" : reward.tier === "실버" ? "#eef2f7" : "#fff4e6",
                          color: reward.tier === "골드" ? "#b45309" : reward.tier === "실버" ? "#64748b" : "#b45309",
                        }}>
                          {reward.tier}
                        </span>
                        <span className="text-[0.75rem] font-bold" style={{ color: reward.claimed ? accentGreen : reward.eligible ? accentBlue : mutedText }}>
                          {reward.claimed ? "수령 완료" : reward.eligible ? "수령 가능" : `${reward.requiredCount}회 달성 필요`}
                        </span>
                      </div>

                      <div className="mt-5 space-y-3">
                        <InfoRow label="조건" value={`입장 ${reward.requiredCount}회`} mutedText={mutedText} neutralText={neutralText} surfaceBg={panelBg} surfaceBorder={surfaceBorder} />
                        <InfoRow label="실물 NFT" value={`${reward.rewardCards}장`} mutedText={mutedText} neutralText={neutralText} surfaceBg={panelBg} surfaceBorder={surfaceBorder} />
                        <InfoRow label="우선 응모권" value={`${reward.rewardRaffles}장`} mutedText={mutedText} neutralText={neutralText} surfaceBg={panelBg} surfaceBorder={surfaceBorder} />
                      </div>

                      <Button
                        disabled={!canClaim || loadingTier}
                        onClick={() => handleClaimTierReward(reward.tier)}
                        className="w-full h-11 rounded-[12px] text-[0.9rem] font-black mt-auto"
                        style={{
                          background: canClaim ? "linear-gradient(135deg, #132850, #2563eb)" : (isDark ? "rgba(88,110,134,0.2)" : "#e2e8f0"),
                          color: canClaim ? "#fff" : mutedText,
                          cursor: canClaim && !loadingTier ? "pointer" : "not-allowed",
                        }}
                      >
                        {loadingTier ? "수령 중..." : reward.claimed ? "이미 받았어요" : reward.eligible ? "실물 NFT 받기" : "아직 받을 수 없어요"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmCardModal
        open={confirmCard}
        onClose={() => setConfirmCard(false)}
        onConfirm={handleBuyCardNft}
        loading={cardPurchasing}
        points={points}
        cost={cardCost}
        tier={status?.tier ?? null}
        remaining={status?.remaining.nft ?? 0}
        isDark={isDark}
        neutralText={neutralText}
        mutedText={mutedText}
        panelBg={panelBg}
        panelBorder={panelBorder}
        surfaceBg={surfaceBg}
        surfaceBorder={surfaceBorder}
      />

      <ResultModal
        result={cardResult}
        showDelivery={showDelivery}
        setShowDelivery={setShowDelivery}
        delivery={delivery}
        setDelivery={setDelivery}
        deliveryFilled={Boolean(deliveryFilled)}
        onClose={() => { setCardResult(null); setShowDelivery(false); }}
        onSubmitDelivery={() => {
          showToast("배송 신청 정보가 확인되었습니다.", "success");
          setCardResult(null);
          setShowDelivery(false);
        }}
        isDark={isDark}
        neutralText={neutralText}
        mutedText={mutedText}
        panelBg={panelBg}
        panelBorder={panelBorder}
        surfaceBg={surfaceBg}
        surfaceBorder={surfaceBorder}
        accentBlue={accentBlue}
      />

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-6 py-3.5 rounded-[14px] shadow-xl"
            style={{
              background: toast.type === "success" ? (isDark ? "rgba(16,185,129,0.18)" : "#d1fae5") : (isDark ? "rgba(239,68,68,0.18)" : "#fee2e2"),
              border: `1px solid ${toast.type === "success" ? (isDark ? "rgba(16,185,129,0.35)" : "#a7f3d0") : (isDark ? "rgba(239,68,68,0.35)" : "#fca5a5")}`,
              color: toast.type === "success" ? "#065f46" : "#991b1b",
            }}>
            {toast.type === "success" ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
            <span className="font-semibold text-[0.9rem]">{toast.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PointSummary({
  isDark, points, tier, neutralText, mutedText, panelBg, panelBorder, accentBlue,
}: {
  isDark: boolean;
  points: number;
  tier: string | null;
  neutralText: string;
  mutedText: string;
  panelBg: string;
  panelBorder: string;
  accentBlue: string;
}) {
  return (
    <div className="rounded-[18px] border px-6 py-6 flex items-center gap-4" style={{ background: panelBg, border: panelBorder, boxShadow: `inset 0 4px 0 ${accentBlue}` }}>
      <div className="w-12 h-12 rounded-[14px] flex items-center justify-center shrink-0" style={{ background: isDark ? "rgba(37,99,235,0.18)" : "#eef3ff" }}>
        <Coins className="w-6 h-6" style={{ color: accentBlue }} />
      </div>
      <div className="flex-1">
        <p className="text-[0.8rem] font-semibold" style={{ color: mutedText }}>보유 포인트</p>
        <p className="text-[1.8rem] font-black leading-tight" style={{ color: neutralText }}>
          {points.toLocaleString()}<span className="text-[1rem] ml-1" style={{ color: accentBlue }}>P</span>
        </p>
      </div>
      <div className="rounded-full px-3 py-1 text-[0.8rem] font-black" style={{ background: isDark ? "rgba(37,99,235,0.18)" : "#eef3ff", color: accentBlue }}>
        {tier ? `${tier} 멤버십` : "멤버십 미가입"}
      </div>
    </div>
  );
}

function ConfirmCardModal({
  open, onClose, onConfirm, loading, points, cost, tier, remaining,
  isDark, neutralText, mutedText, panelBg, panelBorder, surfaceBg, surfaceBorder,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
  points: number;
  cost: number;
  tier: string | null;
  remaining: number;
  isDark: boolean;
  neutralText: string;
  mutedText: string;
  panelBg: string;
  panelBorder: string;
  surfaceBg: string;
  surfaceBorder: string;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
            className="w-full max-w-[440px] rounded-[22px] overflow-hidden"
            style={{ background: panelBg, border: panelBorder, boxShadow: "0 24px 56px rgba(0,0,0,0.22)" }}>
            <div className="flex items-center justify-between px-6 py-5 border-b" style={{ borderColor: isDark ? "rgba(88,110,134,0.2)" : "#e8edf4" }}>
              <p className="font-black text-[1.05rem]" style={{ color: neutralText }}>랜덤 실물 NFT 발급</p>
              <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:opacity-70" style={{ background: surfaceBg }}>
                <X className="w-4 h-4" style={{ color: mutedText }} />
              </button>
            </div>
            <div className="px-6 py-6 space-y-4">
              <InfoRow label="멤버십" value={tier ? `${tier} 등급` : "미가입"} mutedText={mutedText} neutralText={neutralText} surfaceBg={surfaceBg} surfaceBorder={surfaceBorder} />
              <InfoRow label="이번 달 남은 횟수" value={`${remaining}회`} mutedText={mutedText} neutralText={neutralText} surfaceBg={surfaceBg} surfaceBorder={surfaceBorder} />
              <InfoRow label="사용 포인트" value={`${cost.toLocaleString()}P`} mutedText={mutedText} neutralText={neutralText} surfaceBg={surfaceBg} surfaceBorder={surfaceBorder} />
              <InfoRow label="사용 후 포인트" value={`${Math.max(0, points - cost).toLocaleString()}P`} mutedText={mutedText} neutralText={neutralText} surfaceBg={surfaceBg} surfaceBorder={surfaceBorder} />

              <div className="rounded-[14px] px-4 py-3 text-[0.82rem] leading-6" style={{ background: surfaceBg, border: surfaceBorder, color: mutedText }}>
                원본 굿즈 NFT 목록 중 1개가 동일 확률로 발급됩니다. 확정 후에는 포인트 차감이 취소되지 않습니다.
              </div>

              <div className="flex gap-3">
                <button onClick={onClose} className="flex-1 py-3 rounded-[12px] text-[0.9rem] font-bold" style={{ background: surfaceBg, border: surfaceBorder, color: mutedText }}>
                  취소
                </button>
                <button onClick={onConfirm} disabled={loading} className="flex-1 py-3 rounded-[12px] text-[0.9rem] font-black text-white"
                  style={{ background: "linear-gradient(135deg, #132850, #2563eb)", opacity: loading ? 0.7 : 1 }}>
                  {loading ? "처리 중..." : "발급 확정"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function InfoRow({
  label, value, mutedText, neutralText, surfaceBg, surfaceBorder,
}: {
  label: string;
  value: string;
  mutedText: string;
  neutralText: string;
  surfaceBg: string;
  surfaceBorder: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-[12px] px-4 py-3" style={{ background: surfaceBg, border: surfaceBorder }}>
      <span className="text-[0.82rem] font-bold" style={{ color: mutedText }}>{label}</span>
      <span className="text-[0.9rem] font-black" style={{ color: neutralText }}>{value}</span>
    </div>
  );
}

function ResultModal({
  result, showDelivery, setShowDelivery, delivery, setDelivery, deliveryFilled,
  onClose, onSubmitDelivery, isDark, neutralText, mutedText, panelBg, panelBorder, surfaceBg, surfaceBorder, accentBlue,
}: {
  result: CardResult | null;
  showDelivery: boolean;
  setShowDelivery: (value: boolean) => void;
  delivery: DeliveryAddress;
  setDelivery: React.Dispatch<React.SetStateAction<DeliveryAddress>>;
  deliveryFilled: boolean;
  onClose: () => void;
  onSubmitDelivery: () => void;
  isDark: boolean;
  neutralText: string;
  mutedText: string;
  panelBg: string;
  panelBorder: string;
  surfaceBg: string;
  surfaceBorder: string;
  accentBlue: string;
}) {
  const inputStyle: CSSProperties = {
    background: surfaceBg,
    border: surfaceBorder,
    color: neutralText,
    borderRadius: 10,
    padding: "9px 12px",
    fontSize: "0.88rem",
    width: "100%",
    outline: "none",
  };
  const labelStyle: CSSProperties = { fontSize: "0.76rem", fontWeight: 700, color: mutedText, marginBottom: 4, display: "block" };

  return (
    <AnimatePresence>
      {result && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="w-full max-w-[500px] rounded-[24px] overflow-hidden overflow-y-auto"
            style={{ background: panelBg, border: panelBorder, boxShadow: "0 24px 56px rgba(0,0,0,0.22)", maxHeight: "90vh" }}>
            <div className="flex items-center justify-between px-6 py-5 border-b" style={{ borderColor: isDark ? "rgba(88,110,134,0.2)" : "#e8edf4" }}>
              <p className="font-black text-[1.05rem]" style={{ color: neutralText }}>발급 결과</p>
              <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:opacity-70" style={{ background: surfaceBg }}>
                <X className="w-4 h-4" style={{ color: mutedText }} />
              </button>
            </div>

            <div className="px-6 py-6 space-y-5">
              <div className="rounded-[18px] border overflow-hidden" style={{ background: surfaceBg, border: surfaceBorder }}>
                <div className="aspect-[16/9] overflow-hidden">
                  <img src={result.image} alt={result.name} className="w-full h-full object-cover" />
                </div>
                <div className="p-4">
                  <p className="text-[0.78rem] font-bold" style={{ color: accentBlue }}>{result.team}</p>
                  <p className="mt-1 text-[1.05rem] font-black" style={{ color: neutralText }}>{result.name}</p>
                  <p className="mt-1 text-[0.78rem]" style={{ color: mutedText }}>{result.nftId}</p>
                  <p className="mt-3 text-[0.82rem]" style={{ color: mutedText }}>
                    {result.pointUsed.toLocaleString()}P를 사용했고, 남은 포인트는 {result.remainingBalance.toLocaleString()}P입니다.
                  </p>
                </div>
              </div>

              {!showDelivery ? (
                <div className="flex gap-3">
                  <button onClick={onClose} className="flex-1 py-3 rounded-[12px] text-[0.9rem] font-bold" style={{ background: surfaceBg, border: surfaceBorder, color: mutedText }}>
                    나중에 하기
                  </button>
                  <button onClick={() => setShowDelivery(true)} className="flex-1 py-3 rounded-[12px] text-[0.9rem] font-black text-white" style={{ background: "linear-gradient(135deg, #132850, #2563eb)" }}>
                    실물 신청하기
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <MapPin className="w-4 h-4" style={{ color: accentBlue }} />
                    <p className="font-black text-[0.92rem]" style={{ color: neutralText }}>배송지 입력</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label style={labelStyle}>수령인</label>
                      <input style={inputStyle} placeholder="홍길동" value={delivery.recipient} onChange={e => setDelivery(p => ({ ...p, recipient: e.target.value }))} />
                    </div>
                    <div>
                      <label style={labelStyle}>연락처</label>
                      <input style={inputStyle} placeholder="010-0000-0000" value={delivery.phone} onChange={e => setDelivery(p => ({ ...p, phone: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>우편번호</label>
                    <input style={inputStyle} placeholder="12345" value={delivery.zipcode} onChange={e => setDelivery(p => ({ ...p, zipcode: e.target.value }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>주소</label>
                    <input style={inputStyle} placeholder="서울특별시 강남구 테헤란로 123" value={delivery.address} onChange={e => setDelivery(p => ({ ...p, address: e.target.value }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>상세주소</label>
                    <input style={inputStyle} placeholder="아파트 동호수, 층 등" value={delivery.addressDetail} onChange={e => setDelivery(p => ({ ...p, addressDetail: e.target.value }))} />
                  </div>
                  <button
                    onClick={onSubmitDelivery}
                    disabled={!deliveryFilled}
                    className="w-full py-3 rounded-[12px] text-[0.9rem] font-black"
                    style={{
                      background: deliveryFilled ? "linear-gradient(135deg, #132850, #2563eb)" : (isDark ? "rgba(88,110,134,0.2)" : "#e2e8f0"),
                      color: deliveryFilled ? "#fff" : mutedText,
                      cursor: deliveryFilled ? "pointer" : "not-allowed",
                    }}
                  >
                    배송 신청 완료
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
