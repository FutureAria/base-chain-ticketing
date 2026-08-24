import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Coins, MinusCircle, PlusCircle, WalletCards } from "lucide-react";
import { useAppSettings } from "../context/AppSettingsContext";

const API_BASE = import.meta.env.VITE_API_URL;

type PointEvent = {
  id: string;
  event_type: string;
  reason: string;
  amount: number;
  created_at: string;
};

type PointHistoryData = {
  month: string;
  walletAddress: string | null;
  balance: number;
  totalEarned: number;
  totalUsed: number;
  earnedThisMonth: number;
  usedThisMonth: number;
  events: PointEvent[];
};

const eventTypeLabel = (eventType: string) => {
  if (eventType.includes("ENTRY")) return "입장";
  if (eventType.includes("TRADE") || eventType.includes("MARKET")) return "거래";
  if (eventType.includes("EXCHANGE")) return "교환";
  if (eventType.includes("TICKET")) return "예매";
  return "포인트";
};

function shiftMonth(month: string, diff: number) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(year, monthIndex - 1 + diff, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function PointHistory() {
  const { walletAddress } = useAppSettings();
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<PointHistoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const monthLabel = useMemo(() => {
    const [year, mm] = month.split("-");
    return `${year}년 ${Number(mm)}월`;
  }, [month]);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      setError("로그인이 필요합니다.");
      return;
    }

    const params = new URLSearchParams({ month });
    if (walletAddress) params.set("walletAddress", walletAddress);

    setLoading(true);
    setError("");
    fetch(`${API_BASE}/api/points/history?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || "포인트 내역을 불러오지 못했습니다.");
        setData(json.data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "포인트 내역 조회 중 오류가 발생했습니다."))
      .finally(() => setLoading(false));
  }, [month, walletAddress]);

  const events = data?.events ?? [];

  return (
    <div className="page-shell space-y-8">
      <Link to="/mypage/membership" className="inline-flex items-center gap-2 text-[0.9rem] font-semibold" style={{ color: "#4d5f78" }}>
        <ArrowLeft className="h-4 w-4" />
        멤버십으로 돌아가기
      </Link>

      <header className="page-header">
        <div className="page-header-main">
          <p className="page-eyebrow mb-3" style={{ color: "#1456a0" }}>Membership Points</p>
          <h1 className="page-title mb-2" style={{ color: "#1f3248" }}>포인트 적립·사용 내역</h1>
          <p className="page-subtitle" style={{ color: "#8a98b0" }}>
            적립과 사용 흐름을 월별로 확인할 수 있습니다.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-[16px] border px-3 py-2" style={{ background: "#fff", borderColor: "#dce5f2" }}>
          <button type="button" onClick={() => setMonth((prev) => shiftMonth(prev, -1))} className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "#eef4ff", color: "#2563eb" }}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex min-w-[132px] items-center justify-center gap-2 text-[0.92rem] font-black" style={{ color: "#20355b" }}>
            <CalendarDays className="h-4 w-4" />
            {monthLabel}
          </div>
          <button type="button" onClick={() => setMonth((prev) => shiftMonth(prev, 1))} className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "#eef4ff", color: "#2563eb" }}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          { label: "현재 포인트", value: data?.balance ?? 0, icon: Coins, color: "#2563eb" },
          { label: "누적 적립", value: data?.totalEarned ?? 0, icon: PlusCircle, color: "#10b981" },
          { label: "누적 사용", value: data?.totalUsed ?? 0, icon: MinusCircle, color: "#e11d48" },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-[20px] border px-6 py-5" style={{ background: "#fff", borderColor: "#dce5f2", boxShadow: "0 14px 30px rgba(31,50,72,0.05)" }}>
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4" style={{ color: item.color }} />
                <p className="text-[0.82rem] font-bold" style={{ color: "#7b8aa1" }}>{item.label}</p>
              </div>
              <p className="mt-3 text-[1.65rem] font-black" style={{ color: "#20355b" }}>
                {Number(item.value).toLocaleString()}<span className="ml-1 text-[0.86rem] font-bold" style={{ color: "#7c8aa1" }}>P</span>
              </p>
            </div>
          );
        })}
      </section>

      <section className="rounded-[24px] border" style={{ background: "#ffffff", borderColor: "#dce5f2", boxShadow: "0 18px 42px rgba(31,50,72,0.06)" }}>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-5" style={{ borderColor: "#dce5f2" }}>
          <div>
            <h2 className="text-[1.05rem] font-black" style={{ color: "#20355b" }}>{monthLabel} 내역</h2>
            <p className="mt-1 text-[0.84rem]" style={{ color: "#8a98b0" }}>
              적립 {Number(data?.earnedThisMonth ?? 0).toLocaleString()}P · 사용 {Number(data?.usedThisMonth ?? 0).toLocaleString()}P
            </p>
          </div>
          {data?.walletAddress && (
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[0.76rem] font-bold" style={{ background: "#eef4ff", color: "#46617f" }}>
              <WalletCards className="h-3.5 w-3.5" />
              {data.walletAddress.slice(0, 6)}...{data.walletAddress.slice(-4)}
            </span>
          )}
        </div>

        <div className="divide-y" style={{ borderColor: "#edf2f7" }}>
          {loading ? (
            <p className="px-6 py-12 text-center text-[0.9rem]" style={{ color: "#8a98b0" }}>포인트 내역을 불러오는 중입니다.</p>
          ) : error ? (
            <p className="px-6 py-12 text-center text-[0.9rem] font-semibold" style={{ color: "#be123c" }}>{error}</p>
          ) : events.length === 0 ? (
            <p className="px-6 py-12 text-center text-[0.9rem]" style={{ color: "#8a98b0" }}>이번 달 포인트 내역이 없습니다.</p>
          ) : events.map((event) => {
            const isEarn = Number(event.amount) > 0;
            return (
              <div key={event.id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: isEarn ? "#eaf8f0" : "#fff1f2", color: isEarn ? "#168557" : "#be123c" }}>
                    {isEarn ? <PlusCircle className="h-5 w-5" /> : <MinusCircle className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-black" style={{ color: "#20355b" }}>{event.reason}</p>
                      <span className="rounded-full px-2 py-0.5 text-[0.68rem] font-black" style={{ background: "#eef4ff", color: "#46617f" }}>
                        {eventTypeLabel(event.event_type)}
                      </span>
                    </div>
                    <p className="mt-1 text-[0.8rem]" style={{ color: "#8a98b0" }}>
                      {new Date(event.created_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
                <p className="text-[1rem] font-black" style={{ color: isEarn ? "#168557" : "#be123c" }}>
                  {isEarn ? "+" : "-"}{Math.abs(Number(event.amount)).toLocaleString()}P
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
