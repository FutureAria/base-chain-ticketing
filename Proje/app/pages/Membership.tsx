import { Award, Check, ChevronLeft, Clock3, Gift, Lock, Star, Ticket } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { FaBaseballBall, FaTrophy } from "react-icons/fa";
import { GiBaseballBat, GiBaseballGlove } from "react-icons/gi";
import { useAppSettings } from "../context/AppSettingsContext";
import { getDidStatus } from "../api/didApi";

const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");

const TIER_ORDER = ["베이직", "브론즈", "실버", "골드"] as const;
type TierName = typeof TIER_ORDER[number];

const tierMeta: Record<TierName, {
  entry: number;
  condition: string;
  earnRate: string;
  monthlyRaffle: number;
  firstReward: string;
  color: string;
  bg: string;
}> = {
  베이직: { entry: 0, condition: "멤버십 가입 시", earnRate: "0.5%", monthlyRaffle: 0, firstReward: "없음", color: "#6b7280", bg: "#e5e7eb" },
  브론즈: { entry: 3, condition: "입장 횟수 3회 달성", earnRate: "0.7%", monthlyRaffle: 0, firstReward: "실물 NFT 1개", color: "#b45309", bg: "#ffedd5" },
  실버: { entry: 6, condition: "입장 횟수 6회 달성", earnRate: "1.0%", monthlyRaffle: 1, firstReward: "실물 NFT 2개 + 우선 응모권 1장", color: "#64748b", bg: "#e2e8f0" },
  골드: { entry: 10, condition: "입장 횟수 10회 달성", earnRate: "1.5%", monthlyRaffle: 2, firstReward: "실물 NFT 3개 + 우선 응모권 2장", color: "#d97706", bg: "#fef3c7" },
};

type MembershipInfo = {
  joined: boolean;
  currentTier: TierName | null;
  season_count: number;
  nextTier: TierName | null;
  nextTierCount: number | null;
  canTierUp: boolean;
  monthlyRaffleLimit: number;
  monthlyRaffleClaimed: number;
  monthlyRaffleRemaining: number;
};

type PointSummary = {
  balance: number;
  totalEarned: number;
  totalUsed: number;
};

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("auth_token") ?? ""}`,
  };
}

function TierIcon({ tier }: { tier: TierName }) {
  const style = { color: tierMeta[tier].color, filter: "drop-shadow(0 1px 1px rgba(51,65,85,0.22))" };
  if (tier === "베이직") return <FaBaseballBall className="h-7 w-7" style={style} />;
  if (tier === "브론즈") {
    return (
      <div className="relative h-8 w-8">
        <GiBaseballBat className="absolute left-0 top-0 h-8 w-8 -rotate-[32deg]" style={style} />
        <FaBaseballBall className="absolute bottom-0 right-0 h-4 w-4" style={style} />
      </div>
    );
  }
  if (tier === "골드") return <FaTrophy className="h-7 w-7" style={style} />;
  return <GiBaseballGlove className="h-8 w-8" style={style} />;
}

export function Membership() {
  const navigate = useNavigate();
  const { walletAddress, walletConnected, connectWallet } = useAppSettings();
  const [membership, setMembership] = useState<MembershipInfo | null>(null);
  const [point, setPoint] = useState<PointSummary>({ balance: 0, totalEarned: 0, totalUsed: 0 });
  const [raffleCount, setRaffleCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const currentTier = membership?.currentTier;
  const seasonCount = membership?.season_count ?? 0;
  const currentIdx = currentTier ? TIER_ORDER.indexOf(currentTier) : -1;
  const currentMin = currentTier ? tierMeta[currentTier].entry : 0;
  const progressPct = membership?.nextTier && membership.nextTierCount
    ? Math.min(100, Math.max(0, Math.round(((seasonCount - currentMin) / (membership.nextTierCount - currentMin)) * 100)))
    : membership?.joined ? 100 : 0;

  const actionLabel = membership?.joined ? "UP!" : "멤버십 가입하기";
  const canAction = membership?.joined ? Boolean(membership.nextTier && membership.canTierUp) : true;
  const monthlyCanClaim = Boolean(membership?.joined && membership.monthlyRaffleRemaining > 0);

  const tierCards = useMemo(() => TIER_ORDER.map((tier, index) => ({
    tier,
    meta: tierMeta[tier],
    current: tier === currentTier,
    complete: membership?.joined ? index < currentIdx : false,
    locked: membership?.joined ? index > currentIdx : index > 0,
  })), [currentTier, currentIdx, membership?.joined]);

  async function fetchData() {
    const token = localStorage.getItem("auth_token");
    if (!token) return;
    try {
      const [membershipRes, raffleRes] = await Promise.all([
        fetch(`${API_BASE}/api/auth/membership`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API_BASE}/api/auth/early-access-count`, { headers: authHeaders() }).then((r) => r.json()).catch(() => ({ success: false })),
      ]);
      if (membershipRes.success) setMembership(membershipRes);
      if (raffleRes.success) setRaffleCount(Number(raffleRes.count ?? 0));

      if (walletAddress) {
        const pointRes = await fetch(`${API_BASE}/api/points?walletAddress=${walletAddress}`, { headers: authHeaders() }).then((r) => r.json());
        if (pointRes.success) {
          setPoint({
            balance: Number(pointRes.data?.balance ?? 0),
            totalEarned: Number(pointRes.data?.totalEarned ?? 0),
            totalUsed: Number(pointRes.data?.totalUsed ?? 0),
          });
        }
      } else {
        setPoint({ balance: 0, totalEarned: 0, totalUsed: 0 });
      }
    } catch {
      setMessage({ type: "error", text: "멤버십 정보를 불러오지 못했습니다." });
    }
  }

  useEffect(() => { void fetchData(); }, [walletAddress]);

  async function ensureWallet() {
    if (walletConnected && walletAddress) return walletAddress;
    const connected = await connectWallet();
    if (!connected) throw new Error("지갑 인증 후 이용할 수 있습니다.");
    const accounts = window.ethereum
      ? await window.ethereum.request({ method: "eth_accounts" }) as string[]
      : [];
    if (!accounts?.[0]) throw new Error("지갑 주소를 확인할 수 없습니다.");
    return accounts[0];
  }

  async function handleMainAction() {
    setLoading(true);
    setMessage(null);
    try {
      if (!membership?.joined) {
        const did = await getDidStatus().catch(() => null);
        if (did?.did_status !== "verified") {
          navigate("/mypage#did");
          return;
        }
      }

      const address = await ensureWallet();
      const endpoint = membership?.joined ? "tier-up" : "join-membership";
      const res = await fetch(`${API_BASE}/api/auth/${endpoint}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ walletAddress: address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "처리 중 오류가 발생했습니다.");
      setMessage({ type: "success", text: data.message || "처리되었습니다." });
      await fetchData();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "처리 중 오류가 발생했습니다." });
    } finally {
      setLoading(false);
    }
  }

  async function handleMonthlyClaim() {
    setLoading(true);
    setMessage(null);
    try {
      const address = await ensureWallet();
      const res = await fetch(`${API_BASE}/api/auth/claim-monthly-raffles`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ walletAddress: address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "월 응모권 수령 실패");
      setMessage({ type: "success", text: data.message });
      await fetchData();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "월 응모권 수령 중 오류가 발생했습니다." });
    } finally {
      setLoading(false);
    }
  }

  const stats = [
    { icon: Clock3, label: "멤버십 입장 횟수", value: seasonCount.toLocaleString(), unit: "회" },
    { icon: Star, label: "현재 포인트", value: point.balance.toLocaleString(), unit: "P" },
    { icon: Ticket, label: "사용 가능 응모권", value: raffleCount.toLocaleString(), unit: "장" },
  ];

  return (
    <div className="page-shell space-y-8">
      <Link to="/mypage" className="inline-flex items-center gap-2 text-[0.9rem] font-semibold" style={{ color: "#4d5f78" }}>
        <ChevronLeft className="h-4 w-4" />
        마이페이지로 돌아가기
      </Link>

      <header className="page-header">
        <div className="page-header-main">
        <p className="page-eyebrow mb-3" style={{ color: "#1456a0" }}>Membership</p>
        <h1 className="page-title mb-2" style={{ color: "#1f3248" }}>멤버십</h1>
        <p className="page-subtitle" style={{ color: "#8a98b0" }}>
          가입 후 입장 기록을 쌓고, 조건 달성 시 등급을 상승시켜 혜택을 받을 수 있습니다.
        </p>
        </div>
      </header>

      <section className="rounded-[24px] border px-9 py-9" style={{ background: "#ffffff", borderColor: "#dce5f2", boxShadow: "inset 0 4px 0 #2563eb, inset -5px 0 0 #2dd4bf, 0 22px 46px rgba(31,50,72,0.06)" }}>
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h2 className="text-[1.4rem] font-black" style={{ color: "#1f3248" }}>
              {membership?.joined ? `${currentTier} 멤버십` : "멤버십 미가입"}
            </h2>
            <p className="mt-2 text-[0.9rem]" style={{ color: "#98a5ba" }}>
              {membership?.joined ? "가입 후 발생한 입장 기록과 포인트가 반영됩니다." : "가입 전에는 포인트가 적립되지 않습니다."}
            </p>
          </div>
          <button
            onClick={handleMainAction}
            disabled={loading || (membership?.joined ? !canAction : false)}
            className="rounded-[14px] px-6 py-3 text-[0.9rem] font-black transition-all"
            style={{
              background: canAction ? "linear-gradient(135deg, #10b981, #2563eb)" : "#e2e8f0",
              color: canAction ? "#fff" : "#94a3b8",
              cursor: !loading && canAction ? "pointer" : "not-allowed",
            }}
          >
            {loading ? "처리 중..." : actionLabel}
          </button>
        </div>

        <div className="my-8 border-t border-dashed border-[#d7e0ee]" />

        <div className="rounded-[20px] border px-8 py-8" style={{ background: "linear-gradient(135deg, #f4f8ff 0%, #eefcf6 100%)", borderColor: "#d8e3ef" }}>
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-[0.78rem] font-extrabold uppercase tracking-[0.2em]" style={{ color: "#2563eb" }}>Progress</p>
              <p className="mt-2 text-[2.6rem] font-black leading-none" style={{ color: "#20355b" }}>
                {seasonCount}<span className="ml-1 text-[0.95rem] font-bold">회 입장</span>
              </p>
            </div>
            <div className="text-right text-[0.9rem] font-semibold" style={{ color: "#61708a" }}>
              {membership?.joined && membership.nextTier ? (
                <>
                  <p>다음 등급 <span className="font-black" style={{ color: "#1f3248" }}>{membership.nextTier}</span></p>
                  <p className="mt-1"><span className="font-black" style={{ color: "#10b981" }}>{Math.max(0, (membership.nextTierCount ?? 0) - seasonCount)}회</span> 남음</p>
                </>
              ) : membership?.joined ? (
                <p className="font-black" style={{ color: "#10b981" }}>최고 등급 달성</p>
              ) : (
                <p>가입하면 베이직부터 시작합니다</p>
              )}
            </div>
          </div>

          <div className="mt-10">
            <div className="h-3 overflow-hidden rounded-full bg-[#dbe4f0]">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${progressPct}%`, background: "linear-gradient(90deg, #2f6df6, #14b8a6)" }} />
            </div>
            <div className="mt-8 grid grid-cols-4 gap-4">
              {tierCards.map(({ tier, meta, current, complete, locked }) => (
                <div key={tier} className="flex flex-col items-center gap-3">
                  <div className="relative">
                    <div className="flex h-16 w-16 items-center justify-center" style={{ clipPath: "polygon(50% 3%, 92% 25%, 92% 75%, 50% 97%, 8% 75%, 8% 25%)", background: current ? "linear-gradient(145deg, #2f6df6, #0f3f91)" : "linear-gradient(145deg, #f8fafc, #cbd5e1)", opacity: locked ? 0.58 : 1 }}>
                      <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-white" style={{ background: meta.bg }}>
                        <TierIcon tier={tier} />
                      </div>
                    </div>
                    {complete && <span className="absolute right-0 top-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[#10b981]"><Check className="h-3.5 w-3.5 text-white" /></span>}
                    {locked && <span className="absolute right-0 top-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[#8b95a7]"><Lock className="h-3.5 w-3.5 text-white" /></span>}
                  </div>
                  <div className="text-center">
                    <p className="text-[0.82rem] font-bold" style={{ color: current ? "#2563eb" : "#71809a" }}>{meta.entry}회</p>
                    <p className="mt-1 text-[0.86rem] font-bold" style={{ color: current ? "#2563eb" : "#56657d" }}>{tier}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-7 grid gap-4 md:grid-cols-3">
          {stats.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-[16px] border px-5 py-5" style={{ borderColor: "#dce5f2", background: "#fff" }}>
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" style={{ color: "#2563eb" }} />
                  <p className="text-[0.82rem]" style={{ color: "#8391a9" }}>{item.label}</p>
                </div>
                <p className="mt-3 text-[1.55rem] font-black" style={{ color: "#20355b" }}>{item.value}<span className="ml-1 text-[0.85rem] font-bold" style={{ color: "#7c8aa1" }}>{item.unit}</span></p>
              </div>
            );
          })}
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <button
            type="button"
            onClick={() => navigate("/mypage/points")}
            className="rounded-[18px] border px-6 py-5 text-left transition hover:-translate-y-0.5"
            style={{ borderColor: "#dce5f2", background: "#fff", boxShadow: "0 12px 24px rgba(31,50,72,0.04)" }}
          >
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4" style={{ color: "#2563eb" }} />
              <p className="font-black" style={{ color: "#20355b" }}>포인트 적립·사용 내역</p>
            </div>
            <p className="mt-3 text-[0.88rem] leading-6" style={{ color: "#72819a" }}>
              월별 적립과 사용 내역을 한 화면에서 확인합니다.
            </p>
          </button>
          <div className="rounded-[18px] border px-6 py-5" style={{ borderColor: monthlyCanClaim ? "#a7d7c0" : "#dce5f2", background: monthlyCanClaim ? "#f0faf4" : "#fff" }}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Gift className="h-4 w-4" style={{ color: "#10b981" }} />
                  <p className="font-black" style={{ color: "#20355b" }}>월 응모권</p>
                </div>
                <p className="mt-2 text-[0.86rem]" style={{ color: "#72819a" }}>
                  {membership?.joined ? `${membership.monthlyRaffleClaimed}/${membership.monthlyRaffleLimit}장 수령` : "가입 후 수령 가능"}
                </p>
              </div>
              <button
                onClick={handleMonthlyClaim}
                disabled={!monthlyCanClaim || loading}
                className="rounded-[12px] px-4 py-2 text-[0.82rem] font-black"
                style={{ background: monthlyCanClaim ? "#10b981" : "#e2e8f0", color: monthlyCanClaim ? "#fff" : "#94a3b8", cursor: monthlyCanClaim && !loading ? "pointer" : "not-allowed" }}
              >
                수령
              </button>
            </div>
          </div>
        </div>

        {message && (
          <div className="mt-5 rounded-[12px] px-4 py-3 text-[0.86rem] font-semibold" style={{ background: message.type === "success" ? "#d1fae5" : "#fee2e2", color: message.type === "success" ? "#065f46" : "#991b1b" }}>
            {message.text}
          </div>
        )}

        <section className="mt-8">
          <div className="mb-5 flex items-center gap-4">
            <span className="h-2 w-2 rounded-full bg-[#2563eb]" />
            <p className="text-[0.86rem] font-extrabold uppercase tracking-[0.22em]" style={{ color: "#4c5d78" }}>Tier Overview</p>
            <div className="h-px flex-1 bg-[#dbe4f0]" />
          </div>
          <div className="overflow-hidden rounded-[16px] border" style={{ borderColor: "#dce5f2" }}>
            <div className="grid grid-cols-[0.9fr_1fr_0.8fr_0.8fr_1.8fr] bg-[#f5f7fb] px-6 py-4 text-[0.78rem] font-bold" style={{ color: "#8a98b0" }}>
              <span>등급</span><span>조건</span><span>적립률</span><span>월 응모권</span><span>최초 혜택</span>
            </div>
            {TIER_ORDER.map((tier) => {
              const meta = tierMeta[tier];
              return (
                <div key={tier} className="grid grid-cols-[0.9fr_1fr_0.8fr_0.8fr_1.8fr] items-center gap-3 border-t px-6 py-5 text-[0.9rem]" style={{ borderColor: "#dce5f2", background: tier === currentTier ? "linear-gradient(90deg, #eef4ff 0%, #f7fbff 100%)" : "#fff", color: "#465773" }}>
                  <span className="inline-flex w-fit items-center gap-1 rounded-full px-3 py-1 text-[0.76rem] font-extrabold" style={{ background: meta.bg, color: meta.color }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
                    {tier}
                  </span>
                  <span>{meta.condition}</span>
                  <span className="font-black" style={{ color: "#20355b" }}>{meta.earnRate}</span>
                  <span className="font-black" style={{ color: "#20355b" }}>{meta.monthlyRaffle}장</span>
                  <span>{meta.firstReward}</span>
                </div>
              );
            })}
          </div>
        </section>

        {raffleCount > 0 && (
          <button
            onClick={() => navigate("/mypage/raffle")}
            className="mt-6 w-full rounded-[14px] py-3 text-[0.9rem] font-black"
            style={{ background: "linear-gradient(135deg, #2563eb, #10b981)", color: "#fff" }}
          >
            응모권으로 우선 응모하기
          </button>
        )}
      </section>
    </div>
  );
}
