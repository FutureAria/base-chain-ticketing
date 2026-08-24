import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  AlertCircle,
  Bell,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  Gift,
  Loader2,
  Ticket,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { useAppSettings } from "../context/AppSettingsContext";
import { useAuth } from "../context/AuthContext";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const authHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${localStorage.getItem("auth_token") ?? ""}`,
});

type Game = {
  id: string;
  home_team: string;
  away_team: string;
  game_date: string;
  game_time: string;
  stadium_name: string;
  status: string;
  raffle_open_at: string | null;
  booking_open_at: string | null;
};

type Entry = {
  id: number;
  game_id: string;
  status: "applied" | "won" | "lost" | "used";
  tickets_used: number;
  result_visible: boolean;
  raffle_close_at: string | null;
  home_team: string;
  away_team: string;
  game_date: string;
  game_time: string;
  stadium_name: string;
  booking_open_at: string | null;
};

type Tier = "베이직" | "브론즈" | "실버" | "골드";
type RaffleState = "before" | "open" | "closed";

const TIER_MAX_TICKETS: Record<Tier, number> = { 베이직: 1, 브론즈: 1, 실버: 2, 골드: 2 };
const DEMO_ALWAYS_OPEN_GAME_IDS = new Set(["PRESENTATION_RAFFLE_ALWAYS_ON"]);

function isDemoAlwaysOpenGame(game: Pick<Game, "id"> | null | undefined) {
  return Boolean(game && DEMO_ALWAYS_OPEN_GAME_IDS.has(game.id));
}

function fmtDateTime(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return date.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })
    + " "
    + date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtCompactDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return date.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", weekday: "short" });
}

function fmtTime(value: string | null | undefined) {
  return value ? String(value).slice(0, 5) : "-";
}

function getPriorityBookingOpenAt(game: Pick<Game, "booking_open_at" | "game_date" | "game_time"> | null | undefined) {
  if (!game) return null;
  const baseMs = game.booking_open_at
    ? new Date(game.booking_open_at).getTime()
    : new Date(`${String(game.game_date).slice(0, 10)}T${String(game.game_time || "18:30:00").slice(0, 8)}+09:00`).getTime();
  if (Number.isNaN(baseMs)) return null;
  return new Date(baseMs - 2 * 60 * 60 * 1000).toISOString();
}

function getRaffleCloseAt(game: Game) {
  if (isDemoAlwaysOpenGame(game)) return null;
  if (!game.raffle_open_at) return null;
  return new Date(new Date(game.raffle_open_at).getTime() + 2 * 60 * 60 * 1000).toISOString();
}

function remainingLabel(value: string | null, nowMs: number) {
  if (!value) return "";
  const diff = Math.max(0, new Date(value).getTime() - nowMs);
  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor(totalMin / 60) % 24;
  const mins = totalMin % 60;
  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${mins}분`;
  if (mins > 0) return `${mins}분`;
  return "곧";
}

function dDayLabel(value: string | null, nowMs: number) {
  if (!value) return "-";
  const diff = new Date(value).getTime() - nowMs;
  if (diff <= 0) return "D-Day";
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  return `D-${days}`;
}

function raffleState(game: Game, nowMs: number): RaffleState {
  if (isDemoAlwaysOpenGame(game)) return "open";
  if (!game.raffle_open_at) return "before";
  const open = new Date(game.raffle_open_at).getTime();
  const close = open + 2 * 60 * 60 * 1000;
  if (nowMs < open) return "before";
  if (nowMs < close) return "open";
  return "closed";
}

function stateTone(state: RaffleState) {
  if (state === "open") return { label: "응모 가능", dot: "#16a34a", bg: "#ecfdf5", text: "#15803d", border: "#bbf7d0" };
  if (state === "before") return { label: "오픈 예정", dot: "#0891b2", bg: "#ecfeff", text: "#0e7490", border: "#a5f3fc" };
  return { label: "마감됨", dot: "#64748b", bg: "#f1f5f9", text: "#64748b", border: "#e2e8f0" };
}

function entryLabel(entry: Entry | null | undefined) {
  if (!entry) return null;
  if (entry.status === "won") return { label: "당첨", bg: "#fef3c7", text: "#a16207", border: "#fde68a" };
  if (entry.status === "lost") return { label: "미당첨", bg: "#f1f5f9", text: "#64748b", border: "#e2e8f0" };
  if (entry.status === "used") return { label: "선예매 완료", bg: "#eef2ff", text: "#1e3a8a", border: "#c7d2fe" };
  return { label: "응모 완료", bg: "#eef2ff", text: "#1e3a8a", border: "#c7d2fe" };
}

function entryActionLabel(entry: Entry | null | undefined) {
  if (!entry) return null;
  if (entry.status === "won") return "선예매 시작하기";
  if (entry.status === "lost") return "미당첨";
  if (entry.status === "used") return "선예매 완료";
  if (entry.result_visible) return "결과 확인 중";
  return "응모 내역 확인";
}

function DateBlock({ game }: { game: Game }) {
  const date = new Date(game.game_date);
  const month = date.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  const day = date.getDate();
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  return (
    <div className="w-[58px] shrink-0 border-r pr-3 text-center" style={{ borderColor: "#e2e8f0" }}>
      <p className="text-[0.62rem] font-bold uppercase tracking-[0.12em]" style={{ color: "#94a3b8" }}>{month}</p>
      <p className="mt-0.5 text-[1.45rem] font-black leading-none" style={{ color: "#0f172a" }}>{day}</p>
      <p className="mt-1 text-[0.65rem] font-bold uppercase" style={{ color: "#94a3b8" }}>{weekday}</p>
    </div>
  );
}

function StatusChip({ state, urgent = false, entry }: { state: RaffleState; urgent?: boolean; entry?: Entry | null }) {
  const entryTone = entryLabel(entry);
  const tone = entryTone ?? (urgent && state === "open"
    ? { label: "마감 임박", bg: "#fff7ed", text: "#ea580c", border: "#fed7aa" }
    : stateTone(state));
  const dot = entryTone ? tone.text : urgent && state === "open" ? "#ea580c" : stateTone(state).dot;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.72rem] font-bold"
      style={{ background: tone.bg, borderColor: tone.border, color: tone.text }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
      {tone.label}
    </span>
  );
}

export function Raffle() {
  const navigate = useNavigate();
  const { walletAddress, walletConnected } = useAppSettings();
  const { isLoggedIn } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedGameId, setSelectedGameId] = useState("");
  const [raffleCount, setRaffleCount] = useState(0);
  const [tier, setTier] = useState<Tier>("베이직");
  const [ticketsUsed, setTicketsUsed] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [showMyEntries, setShowMyEntries] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const entryByGameId = useMemo(() => {
    const map = new Map<string, Entry>();
    entries.forEach((entry) => {
      if (!map.has(entry.game_id)) map.set(entry.game_id, entry);
    });
    return map;
  }, [entries]);

  const groups = useMemo(() => {
    const visible = games.filter((game) => game.status !== "ENDED");
    const sorted = [...visible].sort((a, b) => {
      const stateOrder: Record<RaffleState, number> = { open: 0, before: 1, closed: 2 };
      const aState = raffleState(a, nowMs);
      const bState = raffleState(b, nowMs);
      if (stateOrder[aState] !== stateOrder[bState]) return stateOrder[aState] - stateOrder[bState];
      return new Date(a.game_date).getTime() - new Date(b.game_date).getTime();
    });
    return {
      open: sorted.filter((game) => raffleState(game, nowMs) === "open"),
      before: sorted.filter((game) => raffleState(game, nowMs) === "before"),
      closed: sorted.filter((game) => raffleState(game, nowMs) === "closed"),
    };
  }, [games, nowMs]);

  const selected = useMemo(
    () => games.find((game) => game.id === selectedGameId)
      ?? groups.open[0]
      ?? groups.before[0]
      ?? groups.closed[0]
      ?? null,
    [games, groups, selectedGameId],
  );
  const currentEntry = selected ? entryByGameId.get(selected.id) ?? null : null;
  const retryableLostEntry = currentEntry?.status === "lost";
  const activeEntry = retryableLostEntry ? null : currentEntry;
  const maxTickets = TIER_MAX_TICKETS[tier] ?? 1;
  const state = selected ? raffleState(selected, nowMs) : "before";
  const closeAt = selected ? getRaffleCloseAt(selected) : null;
  const isUrgent = state === "open" && closeAt ? new Date(closeAt).getTime() - nowMs < 24 * 60 * 60 * 1000 : false;
  const selectedRequiredTickets = Math.min(maxTickets, ticketsUsed);
  const selectedDemoAlwaysOpen = isDemoAlwaysOpenGame(selected);
  const priorityBookingOpenAt = getPriorityBookingOpenAt(selected);
  const canStartPriorityBooking = Boolean(
    currentEntry?.status === "won"
    && (!priorityBookingOpenAt || nowMs >= new Date(priorityBookingOpenAt).getTime()),
  );

  function goLoginForRaffle() {
    setMessage({ type: "error", text: "로그인 후 응모권과 응모 내역을 이용할 수 있습니다." });
    navigate("/login");
  }

  async function loadData() {
    setLoading(true);
    try {
      const gameRes = await fetch(`${API_BASE}/api/tickets/games`).then((res) => res.json());
      if (gameRes.success) {
        const rows = (gameRes.data as Game[]).filter((game) => game.status !== "ENDED");
        setGames(rows);
        setSelectedGameId((prev) => prev || rows.find((game) => raffleState(game, Date.now()) === "open")?.id || rows[0]?.id || "");
      }

      if (!isLoggedIn) {
        setRaffleCount(0);
        setTier("베이직");
        setEntries([]);
        return;
      }

      const [countRes, entryRes] = await Promise.all([
        fetch(`${API_BASE}/api/auth/early-access-count`, { headers: authHeaders() }).then((res) => res.json()),
        fetch(`${API_BASE}/api/raffle/my-entries`, { headers: authHeaders() }).then((res) => res.json()),
      ]);
      if (countRes.success) {
        setRaffleCount(Number(countRes.count ?? 0));
        setTier((countRes.tier ?? "베이직") as Tier);
      }
      if (entryRes.success) setEntries(entryRes.data ?? []);
    } catch {
      setMessage({ type: "error", text: "응모 정보를 불러오지 못했습니다." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, [isLoggedIn]);

  useEffect(() => {
    if (!currentEntry || currentEntry.status !== "applied" || !currentEntry.raffle_close_at) return;
    const delay = Math.max(0, new Date(currentEntry.raffle_close_at).getTime() - Date.now() + 500);
    const id = window.setTimeout(() => {
      void loadData();
    }, delay);
    return () => window.clearTimeout(id);
  }, [currentEntry?.id, currentEntry?.status, currentEntry?.raffle_close_at]);

  useEffect(() => {
    const needsResultRefresh = entries.some((entry) => (
      entry.status === "applied"
      && entry.raffle_close_at
      && Date.now() >= new Date(entry.raffle_close_at).getTime()
    ));
    if (!needsResultRefresh) return;
    const id = window.setInterval(() => {
      void loadData();
    }, 3_000);
    return () => window.clearInterval(id);
  }, [entries]);

  async function applyRaffle() {
    if (!selected) return;
    if (!isLoggedIn) {
      goLoginForRaffle();
      return;
    }
    if (!walletConnected || !walletAddress) {
      setMessage({ type: "error", text: "지갑 연결 후 응모할 수 있습니다." });
      return;
    }
    if (raffleCount < ticketsUsed) {
      setMessage({ type: "error", text: "응모권이 부족해요. 교환소에서 응모권을 먼저 확보해 주세요." });
      return;
    }
    setApplying(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE}/api/raffle/apply`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ gameId: selected.id, ticketsUsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "응모 실패");
      setMessage({
        type: "success",
        text: data.raffle_close_at
          ? `응모 완료. 결과는 ${fmtDateTime(data.raffle_close_at)} 이후 공개됩니다.`
          : "응모 완료.",
      });
      await loadData();
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "응모 처리 중 오류가 발생했습니다." });
    } finally {
      setApplying(false);
    }
  }

  const renderEventCard = (game: Game) => {
    const active = selected?.id === game.id;
    const gameState = raffleState(game, nowMs);
    const gameCloseAt = getRaffleCloseAt(game);
    const latestEntry = entryByGameId.get(game.id) ?? null;
    const gameEntry = latestEntry?.status === "lost" ? null : latestEntry;
    const demoAlwaysOpen = isDemoAlwaysOpenGame(game);
    const urgent = gameState === "open" && gameCloseAt
      ? new Date(gameCloseAt).getTime() - nowMs < 24 * 60 * 60 * 1000
      : false;

    return (
      <button
        key={game.id}
        type="button"
        onClick={() => setSelectedGameId(game.id)}
        className="grid w-full grid-cols-[58px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] border px-4 py-3 text-left transition hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
        style={{
          background: active ? "#f8fbff" : "#ffffff",
          borderColor: active ? "#1e3a8a" : "#e2e8f0",
          boxShadow: active ? "0 0 0 2px #eef2ff" : "0 1px 3px rgba(15,23,42,0.05)",
          opacity: gameState === "closed" && !gameEntry ? 0.68 : 1,
        }}
      >
        <DateBlock game={game} />
        <div className="min-w-0">
          <p className="truncate text-[0.95rem] font-black" style={{ color: "#0f172a" }}>
            {game.home_team} vs {game.away_team}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[0.78rem]" style={{ color: "#64748b" }}>
            <span>{fmtTime(game.game_time)} {game.stadium_name}</span>
            <span>필요 응모권 1장</span>
          </p>
        </div>
        <div className="flex min-w-[118px] flex-col items-end gap-1">
          <StatusChip state={gameState} urgent={urgent} entry={gameEntry} />
          <span className="text-[0.72rem] font-bold" style={{ color: urgent ? "#ea580c" : "#64748b" }}>
            {demoAlwaysOpen ? "시연용 계속 오픈" : gameState === "open" && gameCloseAt ? `${remainingLabel(gameCloseAt, nowMs)} 후 마감` : dDayLabel(game.raffle_open_at, nowMs)}
          </span>
        </div>
      </button>
    );
  };

  const canApply = Boolean(selected && state === "open" && raffleCount >= ticketsUsed && !activeEntry && isLoggedIn && walletConnected && walletAddress);
  const primaryActionLabel = !isLoggedIn
    ? "로그인 후 응모"
    : !walletConnected || !walletAddress
    ? "지갑 연결 후 응모"
    : activeEntry
      ? entryActionLabel(activeEntry) ?? "응모 내역 확인"
      : state === "before"
        ? "오픈 알림 받기"
        : state === "closed"
          ? "응모 마감"
          : raffleCount < ticketsUsed
            ? "교환소로 이동"
            : retryableLostEntry
              ? "다시 응모하기"
              : "응모하기";

  const primaryActionDisabled = applying
    || (activeEntry?.status === "won" && !canStartPriorityBooking)
    || activeEntry?.status === "used"
    || (activeEntry?.status === "applied" && activeEntry.result_visible)
    || (state === "closed" && !activeEntry)
    || (state === "before" && !activeEntry);

  const primaryActionIcon = activeEntry?.status === "won"
    ? <Wallet className="mr-2 h-4 w-4" />
    : activeEntry
        ? <CalendarCheck className="mr-2 h-4 w-4" />
        : <Gift className="mr-2 h-4 w-4" />;

  function openMyEntries() {
    if (!isLoggedIn) {
      goLoginForRaffle();
      return;
    }
    setShowMyEntries(true);
    if (entries[0]?.game_id) setSelectedGameId(entries[0].game_id);
    window.setTimeout(() => {
      document.getElementById("raffle-entry-history")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function handlePrimaryAction() {
    if (!selected) return;
    if (activeEntry?.status === "won") {
      if (!canStartPriorityBooking) {
        setMessage({
          type: "error",
          text: priorityBookingOpenAt
            ? `선예매는 ${fmtDateTime(priorityBookingOpenAt)}부터 시작됩니다.`
            : "아직 선예매를 시작할 수 없습니다.",
        });
        return;
      }
      navigate(`/tickets/${activeEntry.game_id}/booking?mode=priority&entryId=${activeEntry.id}`);
      return;
    }
    if (activeEntry) {
      openMyEntries();
      return;
    }
    if (!isLoggedIn) {
      goLoginForRaffle();
      return;
    }
    if (!walletConnected || !walletAddress) {
      setMessage({ type: "error", text: "상단 지갑 버튼에서 지갑을 먼저 연결해 주세요." });
      return;
    }
    if (state === "open" && raffleCount < ticketsUsed) {
      navigate("/exchange?tab=raffle");
      return;
    }
    if (canApply) void applyRaffle();
  }

  if (loading) {
    return (
      <div className="page-shell">
        <div className="rounded-[24px] border px-6 py-16 text-center" style={{ background: "#ffffff", borderColor: "#e2e8f0" }}>
          <Loader2 className="mx-auto h-8 w-8 animate-spin" style={{ color: "#1e3a8a" }} />
          <p className="mt-3 text-[0.92rem] font-semibold" style={{ color: "#64748b" }}>응모 정보를 불러오는 중입니다</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell space-y-5">
      <header className="flex flex-col gap-2">
        <p className="text-[0.78rem] font-black uppercase tracking-[0.28em]" style={{ color: "#1e3a8a" }}>Priority Raffle</p>
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-end">
          <div>
            <h1 className="text-[2.3rem] font-black tracking-[-0.06em]" style={{ color: "#0f172a" }}>응모&선예매</h1>
            <p className="mt-2 text-[0.95rem]" style={{ color: "#64748b" }}>
              응모권 NFT로 추첨에 참여하고, 당첨되면 우선 예매를 바로 진행할 수 있어요.
            </p>
          </div>
          <button
            type="button"
            onClick={() => isLoggedIn ? navigate("/exchange?tab=raffle") : goLoginForRaffle()}
            className="inline-flex h-10 items-center justify-center rounded-full border px-4 text-[0.86rem] font-bold"
            style={{ background: "#ffffff", borderColor: "#cbd5e1", color: "#1e3a8a" }}
          >
            {isLoggedIn ? "응모권 받기" : "로그인 후 응모권 받기"}
          </button>
        </div>
      </header>

      <section
        className="grid gap-4 overflow-hidden rounded-[20px] p-5 text-white lg:grid-cols-[1.4fr_0.8fr_0.8fr_1fr]"
        style={{ background: "linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)", boxShadow: "0 12px 32px rgba(30,58,138,0.18)" }}
      >
        <div>
          <p className="text-[1.05rem] font-black">내 응모 상태</p>
          <p className="mt-1 text-[0.82rem] text-white/75">2026 시즌 정규경기 응모 진행 중</p>
          <span className="mt-3 inline-flex rounded-full bg-white/15 px-3 py-1 text-[0.72rem] font-black uppercase tracking-[0.1em]">
            {isLoggedIn ? tier : "로그인 필요"}
          </span>
        </div>
        <div>
          <p className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-white/65">보유 응모권</p>
          <p className="mt-2 text-[2rem] font-black leading-none">{isLoggedIn ? raffleCount : "-"}<span className="ml-1 text-[0.95rem] font-bold text-white/70">장</span></p>
        </div>
        <div>
          <p className="text-[0.72rem] font-bold uppercase tracking-[0.14em] text-white/65">응모 가능 경기</p>
          <p className="mt-2 text-[2rem] font-black leading-none">{groups.open.length}<span className="ml-1 text-[0.95rem] font-bold text-white/70">경기</span></p>
        </div>
        <div className="grid gap-2">
          <Button className="h-11 rounded-[10px] bg-white font-black text-[#1e3a8a] hover:bg-white/95" onClick={() => isLoggedIn ? navigate("/exchange?tab=raffle") : goLoginForRaffle()}>
            {isLoggedIn ? "응모권 받기" : "로그인 후 응모권 받기"}
          </Button>
          <Button className="h-10 rounded-[10px] border border-white/25 bg-white/10 font-bold text-white hover:bg-white/15" onClick={openMyEntries}>
            {isLoggedIn ? "내 응모 내역 보기" : "로그인 후 내역 보기"}
          </Button>
        </div>
      </section>

      {showMyEntries && (
        <section id="raffle-entry-history" className="overflow-hidden rounded-[18px] border bg-white" style={{ borderColor: "#e2e8f0", boxShadow: "0 8px 22px rgba(15,23,42,0.06)" }}>
          <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "#e2e8f0", background: "#f8fafc" }}>
            <div>
              <p className="text-[0.72rem] font-black uppercase tracking-[0.16em]" style={{ color: "#1e3a8a" }}>My Raffle</p>
              <h2 className="mt-1 text-[1.05rem] font-black" style={{ color: "#0f172a" }}>내 응모 내역</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowMyEntries(false)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border"
              style={{ borderColor: "#e2e8f0", color: "#64748b", background: "#ffffff" }}
              aria-label="내 응모 내역 닫기"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-5">
            {entries.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-2">
                {entries.map((entry) => {
                  const statusTone = entryLabel(entry);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setSelectedGameId(entry.game_id)}
                      className="rounded-[14px] border p-4 text-left transition hover:shadow-[0_8px_18px_rgba(15,23,42,0.06)]"
                      style={{
                        background: selectedGameId === entry.game_id ? "#f8fbff" : "#ffffff",
                        borderColor: selectedGameId === entry.game_id ? "#1e3a8a" : "#e2e8f0",
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[0.95rem] font-black" style={{ color: "#0f172a" }}>
                            {entry.home_team} vs {entry.away_team}
                          </p>
                          <p className="mt-1 text-[0.8rem] font-semibold" style={{ color: "#64748b" }}>
                            {fmtCompactDate(entry.game_date)} {fmtTime(entry.game_time)} · {entry.stadium_name}
                          </p>
                        </div>
                        {statusTone && (
                          <span
                            className="shrink-0 rounded-full border px-2.5 py-1 text-[0.72rem] font-black"
                            style={{ background: statusTone.bg, borderColor: statusTone.border, color: statusTone.text }}
                          >
                            {statusTone.label}
                          </span>
                        )}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[0.78rem] font-semibold" style={{ color: "#64748b" }}>
                        <span>사용 응모권 <b style={{ color: "#0f172a" }}>{entry.tickets_used}장</b></span>
                        <span className="text-right">
                          결과 {entry.result_visible ? "공개됨" : entry.raffle_close_at ? fmtDateTime(entry.raffle_close_at) : "대기 중"}
                        </span>
                      </div>
                      {entry.status === "won" && (
                        <span className="mt-3 inline-flex h-9 items-center justify-center rounded-[10px] px-3 text-[0.8rem] font-black text-white" style={{ background: "#16a34a" }}>
                          선예매 가능
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-[14px] border border-dashed px-5 py-8 text-center" style={{ borderColor: "#cbd5e1", background: "#f8fafc" }}>
                <Ticket className="mx-auto h-9 w-9" style={{ color: "#94a3b8" }} />
                <p className="mt-3 font-black" style={{ color: "#0f172a" }}>아직 응모한 내역이 없어요</p>
                <p className="mt-1 text-[0.86rem]" style={{ color: "#64748b" }}>
                  응모 가능한 경기가 열리면 이곳에 응모 상태와 결과가 표시됩니다.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button className="rounded-[10px] bg-[#1e3a8a] px-4 text-white" onClick={() => isLoggedIn ? navigate("/exchange?tab=raffle") : goLoginForRaffle()}>
                    {isLoggedIn ? "응모권 받기" : "로그인 후 응모권 받기"}
                  </Button>
                  <Button
                    className="rounded-[10px] border bg-white px-4"
                    style={{ borderColor: "#e2e8f0", color: "#334155" }}
                    onClick={() => {
                      setShowUpcoming(true);
                      window.setTimeout(() => {
                        document.getElementById("raffle-upcoming-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }, 0);
                    }}
                  >
                    오픈 예정 경기 보기
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 rounded-[14px] border bg-white px-4 py-3" style={{ borderColor: "#e2e8f0" }}>
        <div className="flex items-center gap-2 text-[0.86rem] font-bold" style={{ color: "#334155" }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#16a34a] text-white"><Check className="h-4 w-4" /></span>
          1. 응모권 준비
        </div>
        <span style={{ color: "#cbd5e1" }}>›</span>
        <div className="flex items-center gap-2 text-[0.86rem] font-black" style={{ color: "#0f172a" }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1e3a8a] text-white">2</span>
          2. 경기 응모
        </div>
        <span style={{ color: "#cbd5e1" }}>›</span>
        <div className="flex items-center gap-2 text-[0.86rem] font-bold" style={{ color: "#64748b" }}>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#eef2ff] text-[#64748b]">3</span>
          3. 결과 확인 & 선예매
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.9fr)]">
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <p className="flex items-center gap-2 text-[0.92rem] font-black" style={{ color: "#0f172a" }}>
              <span className="h-2.5 w-2.5 rounded-full bg-[#16a34a]" />
              응모 가능 <span className="font-semibold" style={{ color: "#64748b" }}>· {groups.open.length}경기</span>
            </p>
            <span className="text-[0.78rem] font-semibold" style={{ color: "#64748b" }}>마감 임박순</span>
          </div>

          {groups.open.length > 0 ? (
            <div className="space-y-2">{groups.open.map(renderEventCard)}</div>
          ) : (
            <div className="rounded-[14px] border bg-white p-6 text-center" style={{ borderColor: "#e2e8f0" }}>
              <p className="font-black" style={{ color: "#0f172a" }}>현재 응모 가능한 경기가 없어요</p>
              <p className="mt-1 text-[0.85rem]" style={{ color: "#64748b" }}>오픈 예정 경기를 확인하거나 알림을 받아보세요.</p>
            </div>
          )}

          <button
            id="raffle-upcoming-section"
            type="button"
            onClick={() => setShowUpcoming((value) => !value)}
            className="flex w-full items-center justify-between rounded-[14px] border border-dashed bg-white px-4 py-3 text-left"
            style={{ borderColor: "#cbd5e1", color: "#334155" }}
          >
            <span className="flex items-center gap-2 text-[0.86rem] font-bold">
              <StatusChip state="before" />
              {groups.before.length}경기 · 오픈 예정
            </span>
            <span className="inline-flex items-center gap-1 text-[0.78rem] font-bold" style={{ color: "#64748b" }}>
              {showUpcoming ? "접기" : "펼치기"} <ChevronDown className="h-4 w-4" />
            </span>
          </button>
          {showUpcoming && <div className="space-y-2">{groups.before.map(renderEventCard)}</div>}

          <button
            type="button"
            onClick={() => setShowClosed((value) => !value)}
            className="flex w-full items-center justify-between rounded-[14px] border border-dashed bg-white px-4 py-3 text-left"
            style={{ borderColor: "#cbd5e1", color: "#334155" }}
          >
            <span className="flex items-center gap-2 text-[0.86rem] font-bold">
              <StatusChip state="closed" />
              {groups.closed.length}경기 · 응모 마감
            </span>
            <span className="inline-flex items-center gap-1 text-[0.78rem] font-bold" style={{ color: "#64748b" }}>
              {showClosed ? "접기" : "펼치기"} <ChevronDown className="h-4 w-4" />
            </span>
          </button>
          {showClosed && <div className="space-y-2">{groups.closed.map(renderEventCard)}</div>}
        </section>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="overflow-hidden rounded-[18px] border bg-white" style={{ borderColor: "#e2e8f0", boxShadow: "0 8px 22px rgba(15,23,42,0.07)" }}>
            <div className="flex items-center justify-between border-b px-5 py-4" style={{ background: "#f8fafc", borderColor: "#e2e8f0" }}>
              <div>
                <p className="text-[0.72rem] font-black uppercase tracking-[0.16em]" style={{ color: "#64748b" }}>Selected Match</p>
                <h2 className="mt-1 text-[1.05rem] font-black" style={{ color: "#0f172a" }}>
                  {selected ? `${selected.home_team} vs ${selected.away_team}` : "경기 선택"}
                </h2>
              </div>
              {selected && <StatusChip state={state} urgent={isUrgent} entry={activeEntry} />}
            </div>

            {selected ? (
              <div className="p-5">
                {[
                  ["일시", `${fmtCompactDate(selected.game_date)} ${fmtTime(selected.game_time)}`],
                  ["구장", selected.stadium_name],
                  ["응모 마감", selectedDemoAlwaysOpen ? "시연용 계속 오픈" : state === "before" ? "오픈 후 2시간" : fmtDateTime(closeAt)],
                  ["필요 응모권", `${selectedRequiredTickets}장`],
                  ["결과 발표", activeEntry?.raffle_close_at ? fmtDateTime(activeEntry.raffle_close_at) : "응모 후 약 10초 뒤"],
                  ["선예매 시작", priorityBookingOpenAt ? fmtDateTime(priorityBookingOpenAt) : "당첨 후 가능"],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 border-b border-dashed py-2.5 text-[0.9rem]" style={{ borderColor: "#e2e8f0" }}>
                    <span className="font-semibold" style={{ color: "#64748b" }}>{label}</span>
                    <span className="text-right font-bold" style={{ color: "#0f172a" }}>{value}</span>
                  </div>
                ))}

                {!activeEntry && (
                  <div className="mt-4">
                    <p className="mb-2 text-[0.82rem] font-black" style={{ color: "#334155" }}>사용할 응모권</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[1, 2].map((count) => (
                        <button
                          key={count}
                          type="button"
                          disabled={count > maxTickets}
                          onClick={() => setTicketsUsed(count as 1 | 2)}
                          className="rounded-[12px] border py-2.5 text-[0.9rem] font-black"
                          style={{
                            background: ticketsUsed === count ? "#1e3a8a" : "#ffffff",
                            borderColor: ticketsUsed === count ? "#1e3a8a" : "#e2e8f0",
                            color: ticketsUsed === count ? "#ffffff" : count > maxTickets ? "#cbd5e1" : "#334155",
                          }}
                        >
                          {count}장
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div
                  className="mt-4 flex gap-2 rounded-[12px] border px-3 py-3 text-[0.85rem] font-semibold"
                  style={{
                    background: activeEntry
                      ? "#eef2ff"
                      : raffleCount >= ticketsUsed && state === "open"
                        ? "#ecfdf5"
                        : "#fff7ed",
                    borderColor: activeEntry
                      ? "#c7d2fe"
                      : raffleCount >= ticketsUsed && state === "open"
                        ? "#bbf7d0"
                        : "#fed7aa",
                    color: activeEntry
                      ? "#1e3a8a"
                      : raffleCount >= ticketsUsed && state === "open"
                        ? "#15803d"
                        : "#ea580c",
                  }}
                >
                  {activeEntry ? <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span>
                    {activeEntry
                      ? activeEntry.status === "won"
                        ? "당첨되었습니다. 우선 예매를 시작할 수 있어요."
                          : activeEntry.status === "used"
                            ? "이미 선예매를 완료한 응모입니다."
                            : activeEntry.result_visible
                              ? "결과를 확인 중입니다. 잠시 후 자동으로 갱신됩니다."
                          : "이미 응모한 경기입니다. 결과가 공개되면 이곳에서 확인할 수 있어요."
                      : !isLoggedIn
                        ? "로그인하면 응모권 보유 수와 내 응모 내역을 확인할 수 있어요."
                        : !walletConnected || !walletAddress
                        ? "지갑을 연결하면 응모를 진행할 수 있어요."
                        : state === "open" && raffleCount >= ticketsUsed
                          ? retryableLostEntry
                            ? `이전 응모는 미당첨 처리되었습니다. 보유 응모권 ${raffleCount}장으로 다시 응모할 수 있어요.`
                            : `보유 응모권 ${raffleCount}장 · 응모 가능합니다.`
                          : state === "open"
                            ? `응모권이 ${ticketsUsed - raffleCount}장 부족해요.`
                            : state === "before"
                              ? `아직 응모 기간이 아닙니다. ${fmtDateTime(selected.raffle_open_at)} 오픈.`
                              : "응모가 마감되었습니다."}
                  </span>
                </div>

                <div className="mt-4 grid gap-2">
                  <Button
                    className="h-12 rounded-[12px] font-black text-white"
                    disabled={primaryActionDisabled}
                    style={{
                      background: activeEntry?.status === "won"
                        ? "#16a34a"
                        : state === "open" || activeEntry ? "#1e3a8a" : "#cbd5e1",
                    }}
                    onClick={handlePrimaryAction}
                  >
                    {applying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : primaryActionIcon}
                    {primaryActionLabel}
                  </Button>
                </div>

                {message && (
                  <div
                    className="mt-4 flex gap-2 rounded-[12px] border px-3 py-3 text-[0.84rem] font-semibold"
                    style={{
                      background: message.type === "success" ? "#ecfdf5" : "#fff1f2",
                      borderColor: message.type === "success" ? "#a7f3d0" : "#fecdd3",
                      color: message.type === "success" ? "#047857" : "#be123c",
                    }}
                  >
                    {message.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
                    {message.text}
                  </div>
                )}

                <div className="mt-4 flex items-center gap-2 text-[0.78rem] font-semibold" style={{ color: "#64748b" }}>
                  <Bell className="h-4 w-4" />
                  결과 발표와 선예매 시작은 알림 영역에서도 확인할 수 있어요.
                </div>
              </div>
            ) : (
              <div className="p-8 text-center">
                <Ticket className="mx-auto h-9 w-9" style={{ color: "#94a3b8" }} />
                <p className="mt-3 font-black" style={{ color: "#0f172a" }}>선택할 경기가 없습니다</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
