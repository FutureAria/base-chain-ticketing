import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  Calendar,
  ChevronDown,
  Clock,
  Lock,
  MapPin,
  RotateCcw,
  Search,
  ShieldCheck,
  Tag,
  Ticket,
  Wallet,
} from "lucide-react";
import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { loadStoredTickets } from "../data/ticketing";
import { useBookingAccess, ACCESS_MESSAGES, type AccessStatus } from "../hooks/useBookingAccess";

type TicketStatus = "OPEN" | "ALMOST" | "SOLDOUT" | "UPCOMING" | "ENDED";
type StatusFilter = "all" | "open" | "today" | "upcoming" | "priority" | "ended";

type ApiTicketGame = {
  id: string;
  home_team: string;
  away_team: string;
  game_date: string;
  game_time?: string;
  stadium_name?: string;
  location?: string;
  base_price?: number;
  booking_open_at?: string;
  status: TicketStatus | string;
  day_of_week?: string;
  remaining_rate?: number;
  remaining_percent?: number;
  remaining_seats?: number;
};

const statusFilterLabels: Record<StatusFilter, string> = {
  all: "전체",
  open: "예매 가능",
  today: "오늘",
  upcoming: "오픈 예정",
  priority: "응모",
  ended: "마감",
};

const TICKET_GAMES_CACHE_KEY = "basechain.ticketGames.cache.v1";
const TICKET_GAMES_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

function readCachedGames(): ApiTicketGame[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(TICKET_GAMES_CACHE_KEY);
    if (!raw) return [];
    const cached = JSON.parse(raw) as { savedAt?: number; data?: ApiTicketGame[] };
    if (!Array.isArray(cached.data)) return [];
    if (!cached.savedAt || Date.now() - cached.savedAt > TICKET_GAMES_CACHE_MAX_AGE_MS) return [];
    return cached.data;
  } catch {
    return [];
  }
}

function hasFreshCachedGames() {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.sessionStorage.getItem(TICKET_GAMES_CACHE_KEY);
    if (!raw) return false;
    const cached = JSON.parse(raw) as { savedAt?: number; data?: ApiTicketGame[] };
    return Array.isArray(cached.data) && Boolean(cached.savedAt) && Date.now() - cached.savedAt <= TICKET_GAMES_CACHE_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function writeCachedGames(data: ApiTicketGame[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(TICKET_GAMES_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // 세션 캐시 실패는 화면 표시를 막지 않는다.
  }
}

function formatPrice(value?: number) {
  if (value == null) return null;
  return `₩${Number(value).toLocaleString("ko-KR")}부터`;
}

function formatGameTime(event: ApiTicketGame) {
  const date = String(event.game_date ?? "").slice(0, 10);
  const time = String(event.game_time ?? "").slice(0, 5);
  if (!date) return time;
  return `${date}${time ? ` ${time}` : ""}`;
}

function formatBookingOpen(dateStr?: string) {
  if (!dateStr) return "오픈 일정 확인 중";
  const d = new Date(dateStr);
  return `${d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", weekday: "short" })} ${d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })} 오픈`;
}

function remainingToOpen(dateStr?: string, now = Date.now()) {
  if (!dateStr) return "오픈 예정";
  const diff = Math.max(0, new Date(dateStr).getTime() - now);
  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (diff <= 0) return "곧 오픈";
  if (days > 0) return `D-${days}`;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function isToday(event: ApiTicketGame) {
  const today = new Date().toISOString().slice(0, 10);
  return String(event.game_date ?? "").slice(0, 10) === today;
}

function getGameStartMs(event: ApiTicketGame) {
  const date = String(event.game_date ?? "").slice(0, 10);
  const time = String(event.game_time ?? "18:30:00").slice(0, 8);
  if (!date) return NaN;
  return new Date(`${date}T${time || "18:30:00"}+09:00`).getTime();
}

function isBookingClosed(event: ApiTicketGame, now: number) {
  const status = normalizedStatus(event.status);
  const gameStartMs = getGameStartMs(event);
  return status === "ENDED" || (!Number.isNaN(gameStartMs) && now > gameStartMs + 60 * 60 * 1000);
}

function normalizedStatus(status: string): TicketStatus {
  if (["OPEN", "ALMOST", "SOLDOUT", "UPCOMING", "ENDED"].includes(status)) return status as TicketStatus;
  return "OPEN";
}

function getStatusMeta(event: ApiTicketGame, now: number) {
  const status = normalizedStatus(event.status);
  if (isBookingClosed(event, now)) {
    return {
      label: "지난 경기",
      chip: "#64748B",
      chipBg: "#F1F5F9",
      cta: "예매 마감",
      ctaDisabled: true,
      variant: "muted",
    };
  }

  const openDiff = event.booking_open_at ? new Date(event.booking_open_at).getTime() - now : Infinity;
  const opensWithin24h = status === "UPCOMING" && openDiff > 0 && openDiff <= 24 * 60 * 60 * 1000;

  if (status === "ALMOST") {
    return {
      label: "매진 임박",
      chip: "#EA580C",
      chipBg: "#FFF7ED",
      cta: "서둘러 예매",
      ctaDisabled: false,
      variant: "warn",
    };
  }
  if (status === "SOLDOUT") {
    return {
      label: "매진",
      chip: "#DC2626",
      chipBg: "#FEF2F2",
      cta: "매진",
      ctaDisabled: true,
      variant: "muted",
    };
  }
  if (status === "UPCOMING") {
    return {
      label: opensWithin24h ? "곧 오픈" : "오픈 예정",
      chip: opensWithin24h ? "#EA580C" : "#2563EB",
      chipBg: opensWithin24h ? "#FFF7ED" : "#EFF6FF",
      cta: opensWithin24h ? "곧 오픈" : "알림 받기",
      ctaDisabled: false,
      variant: opensWithin24h ? "soon" : "outline",
    };
  }
  if (status === "ENDED") {
    return {
      label: "경기 종료",
      chip: "#64748B",
      chipBg: "#F1F5F9",
      cta: "경기 종료",
      ctaDisabled: true,
      variant: "muted",
    };
  }
  return {
    label: "예매중",
    chip: "#16A34A",
    chipBg: "#ECFDF3",
    cta: "예매하기",
    ctaDisabled: false,
    variant: "primary",
  };
}

function statusWeight(event: ApiTicketGame) {
  if (isBookingClosed(event, Date.now())) return 4;
  const status = normalizedStatus(event.status);
  if (status === "OPEN") return 0;
  if (status === "ALMOST") return 1;
  if (status === "SOLDOUT") return 2;
  if (status === "UPCOMING") return 3;
  return 4;
}

function sortGames(left: ApiTicketGame, right: ApiTicketGame) {
  const statusDiff = statusWeight(left) - statusWeight(right);
  if (statusDiff !== 0) return statusDiff;
  const leftDate = `${left.game_date ?? ""} ${left.game_time ?? ""}`;
  const rightDate = `${right.game_date ?? ""} ${right.game_time ?? ""}`;
  return leftDate.localeCompare(rightDate);
}

function remainingRate(event: ApiTicketGame) {
  const raw = event.remaining_rate ?? event.remaining_percent;
  if (raw == null) return null;
  return Math.max(0, Math.min(100, Number(raw)));
}

export function Tickets() {
  const [events, setEvents] = useState<ApiTicketGame[]>(() => readCachedGames());
  const [loadingEvents, setLoadingEvents] = useState(() => readCachedGames().length === 0);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [teamFilter, setTeamFilter] = useState("");
  const [stadiumFilter, setStadiumFilter] = useState("");
  const [blockedStatus, setBlockedStatus] = useState<AccessStatus | null>(null);
  const [notifyText, setNotifyText] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [endedExpanded, setEndedExpanded] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem("tickets.endedExpanded") === "true";
  });
  const navigate = useNavigate();
  const accessStatus = useBookingAccess();

  const fetchGames = useCallback(() => {
    setLoadingEvents((current) => current);
    setEventsError(null);
    fetch(`${import.meta.env.VITE_API_URL}/api/tickets/games`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!data.success) throw new Error(data.error ?? "경기 목록 조회 실패");
        const nextEvents = Array.isArray(data.data) ? data.data : [];
        setEvents(nextEvents);
        writeCachedGames(nextEvents);
      })
      .catch((err) => {
        console.error("경기 목록 조회 실패:", err);
        setEventsError("경기 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
        setEvents([]);
      })
      .finally(() => setLoadingEvents(false));
  }, []);

  useEffect(() => {
    if (hasFreshCachedGames()) {
      setLoadingEvents(false);
      return;
    }
    fetchGames();
  }, [fetchGames]);

  useEffect(() => {
    const hasSoonUpcoming = events.some((event) => {
      if (normalizedStatus(event.status) !== "UPCOMING" || !event.booking_open_at) return false;
      const diff = new Date(event.booking_open_at).getTime() - Date.now();
      return diff > 0 && diff <= 24 * 60 * 60 * 1000;
    });
    const id = window.setInterval(() => setNow(Date.now()), hasSoonUpcoming ? 1000 : 60_000);
    return () => window.clearInterval(id);
  }, [events]);

  useEffect(() => {
    window.sessionStorage.setItem("tickets.endedExpanded", String(endedExpanded));
  }, [endedExpanded]);

  useEffect(() => {
    if (!notifyText) return;
    const id = window.setTimeout(() => setNotifyText(null), 2600);
    return () => window.clearTimeout(id);
  }, [notifyText]);

  const teams = useMemo(
    () => Array.from(new Set(events.flatMap((event) => [event.home_team, event.away_team]).filter(Boolean))).sort(),
    [events],
  );

  const stadiums = useMemo(
    () => Array.from(new Set(events.map((event) => event.stadium_name ?? event.location).filter(Boolean))).sort(),
    [events],
  );

  const counts = useMemo(() => {
    const open = events.filter((event) => !isBookingClosed(event, now) && ["OPEN", "ALMOST"].includes(normalizedStatus(event.status))).length;
    const today = events.filter((event) => !isBookingClosed(event, now) && ["OPEN", "ALMOST"].includes(normalizedStatus(event.status)) && isToday(event)).length;
    const upcoming = events.filter((event) => !isBookingClosed(event, now) && normalizedStatus(event.status) === "UPCOMING").length;
    return {
      all: events.length,
      open,
      today,
      upcoming,
      priority: 0,
      ended: events.filter((event) => isBookingClosed(event, now) || ["ENDED", "SOLDOUT"].includes(normalizedStatus(event.status))).length,
      owned: loadStoredTickets().length,
    };
  }, [events, now]);

  const filteredEvents = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return events
      .filter((event) => {
        const status = normalizedStatus(event.status);
        const values = [event.home_team, event.away_team, event.stadium_name, event.location].filter(Boolean);
        const queryOk = !keyword || values.some((value) => String(value).toLowerCase().includes(keyword));
        const teamOk = !teamFilter || event.home_team === teamFilter || event.away_team === teamFilter;
        const stadiumOk = !stadiumFilter || event.stadium_name === stadiumFilter || event.location === stadiumFilter;
        const statusOk =
          statusFilter === "all" ||
          (statusFilter === "open" && !isBookingClosed(event, now) && ["OPEN", "ALMOST", "SOLDOUT"].includes(status)) ||
          (statusFilter === "today" && !isBookingClosed(event, now) && ["OPEN", "ALMOST"].includes(status) && isToday(event)) ||
          (statusFilter === "upcoming" && !isBookingClosed(event, now) && status === "UPCOMING") ||
          (statusFilter === "ended" && (isBookingClosed(event, now) || ["ENDED", "SOLDOUT"].includes(status))) ||
          (statusFilter === "priority" && false);
        return queryOk && teamOk && stadiumOk && statusOk;
      })
      .sort(sortGames);
  }, [events, now, search, stadiumFilter, statusFilter, teamFilter]);

  const groupedEvents = useMemo(() => {
    const source = statusFilter === "all" ? filteredEvents : filteredEvents;
    return {
      open: source.filter((event) => !isBookingClosed(event, now) && ["OPEN", "ALMOST", "SOLDOUT"].includes(normalizedStatus(event.status))).sort(sortGames),
      today: source.filter((event) => !isBookingClosed(event, now) && ["OPEN", "ALMOST"].includes(normalizedStatus(event.status)) && isToday(event)).sort(sortGames),
      upcoming: source.filter((event) => !isBookingClosed(event, now) && normalizedStatus(event.status) === "UPCOMING").sort(sortGames),
      ended: source.filter((event) => isBookingClosed(event, now) || ["ENDED"].includes(normalizedStatus(event.status))).sort(sortGames),
    };
  }, [filteredEvents, now, statusFilter]);

  const resetFilters = () => {
    setStatusFilter("all");
    setTeamFilter("");
    setStadiumFilter("");
    setSearch("");
  };

  const handlePrimaryAction = (event: ApiTicketGame) => {
    const status = normalizedStatus(event.status);
    if (status === "UPCOMING") {
      setNotifyText(`${event.home_team} vs ${event.away_team} 오픈 알림을 신청했어요.`);
      return;
    }
    if (isBookingClosed(event, now) || status === "SOLDOUT" || status === "ENDED") return;
    if (accessStatus !== "ok" && accessStatus !== "checking") {
      setBlockedStatus(accessStatus);
      return;
    }
    navigate(`/tickets/${event.id}/booking`);
  };

  const renderGameCard = (event: ApiTicketGame, index: number) => {
    const status = normalizedStatus(event.status);
    const meta = getStatusMeta(event, now);
    const price = formatPrice(event.base_price);
    const rate = remainingRate(event);
    const isDisabled = meta.ctaDisabled;
    const ctaBg = meta.variant === "muted" ? "#CBD5E1" : meta.variant === "outline" || meta.variant === "soon" ? "#FFFFFF" : "#1E3A8A";
    const ctaColor = meta.variant === "muted" ? "#FFFFFF" : meta.variant === "outline" ? "#2563EB" : meta.variant === "soon" ? "#EA580C" : "#FFFFFF";

    return (
      <motion.article
        key={event.id}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: Math.min(index, 6) * 0.04 }}
        className="rounded-[16px] border bg-white p-5 shadow-[0_4px_14px_rgba(17,40,73,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(20,86,160,0.12)]"
        style={{ borderColor: "#E2E8F0" }}
      >
        <div className="flex items-start justify-between gap-3">
          <span
            className="inline-flex items-center rounded-full border px-3 py-1 text-[0.76rem] font-bold"
            style={{ background: meta.chipBg, borderColor: `${meta.chip}35`, color: meta.chip }}
          >
            {meta.label}
          </span>
          <span className="text-[0.82rem] font-semibold" style={{ color: "#64748B" }}>
            {event.day_of_week ? `${event.day_of_week}요일` : String(event.game_date ?? "").slice(5, 10)}
          </span>
        </div>

        <h3 className="mt-4 line-clamp-2 text-[1.08rem] font-black tracking-[-0.04em]" style={{ color: "#14253F" }}>
          {event.home_team} vs {event.away_team}
        </h3>

        <div className="mt-4 space-y-2.5 text-[0.9rem]" style={{ color: "#64748B" }}>
          <p className="flex items-center gap-2">
            <Calendar className="h-4 w-4 shrink-0 text-[#1E3A8A]" />
            <span>{formatGameTime(event)}</span>
          </p>
          <p className="flex items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-[#16A34A]" />
            <span>{event.stadium_name ?? event.location ?? "구장 확인 중"}</span>
          </p>
          {price && (
            <p className="flex items-center gap-2 font-extrabold" style={{ color: "#1E3A8A" }}>
              <Tag className="h-4 w-4 shrink-0 text-[#EA580C]" />
              <span>{price}</span>
            </p>
          )}
          {status === "UPCOMING" && (
            <p
              className="flex items-center gap-2 rounded-[12px] border px-3 py-2 text-[0.82rem] font-bold"
              style={{
                background: meta.variant === "soon" ? "#FFF7ED" : "#EFF6FF",
                borderColor: meta.variant === "soon" ? "#FED7AA" : "#BFDBFE",
                color: meta.variant === "soon" ? "#EA580C" : "#2563EB",
              }}
            >
              <Clock className="h-4 w-4 shrink-0" />
              {remainingToOpen(event.booking_open_at, now)}
              <span className="font-medium opacity-75">{formatBookingOpen(event.booking_open_at)}</span>
            </p>
          )}
        </div>

        {rate != null && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[0.76rem] font-semibold" style={{ color: "#64748B" }}>
              <span>잔여 좌석</span>
              <span style={{ color: rate < 15 ? "#EA580C" : rate < 30 ? "#EA580C" : "#16A34A" }}>
                {Math.round(rate)}%
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#E2E8F0]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${rate}%`,
                  background: rate < 15 ? "#EA580C" : rate < 30 ? "#F59E0B" : "#16A34A",
                }}
              />
            </div>
          </div>
        )}

        <Button
          className="mt-5 min-h-11 w-full rounded-[12px] font-black"
          disabled={isDisabled}
          aria-disabled={isDisabled}
          style={{
            background: ctaBg,
            border: meta.variant === "outline" || meta.variant === "soon" ? `1px solid ${meta.chip}55` : "1px solid transparent",
            color: ctaColor,
            boxShadow: meta.variant === "primary" || meta.variant === "warn" ? "0 10px 20px rgba(30,58,138,0.18)" : "none",
          }}
          onClick={() => handlePrimaryAction(event)}
        >
          {status === "UPCOMING" ? <Bell className="mr-2 h-4 w-4" /> : <Ticket className="mr-2 h-4 w-4" />}
          {meta.cta}
        </Button>
      </motion.article>
    );
  };

  const renderGroup = (
    key: "open" | "today" | "upcoming" | "ended",
    title: string,
    items: ApiTicketGame[],
    options?: { collapsible?: boolean; collapsed?: boolean; onToggle?: () => void; tone?: string },
  ) => {
    if (items.length === 0) return null;
    const collapsed = Boolean(options?.collapsible && options.collapsed);
    return (
      <section className="mt-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[1.05rem] font-black" style={{ color: options?.tone ?? "#14253F" }}>
            {title} · {items.length}경기
          </h2>
          {options?.collapsible && (
            <button
              type="button"
              onClick={options.onToggle}
              className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[0.82rem] font-bold"
              style={{ borderColor: "#CBD5E1", background: "#FFFFFF", color: "#64748B" }}
            >
              {collapsed ? "펼치기" : "접기"}
              <ChevronDown className={`h-4 w-4 transition ${collapsed ? "" : "rotate-180"}`} />
            </button>
          )}
        </div>
        {!collapsed && (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {items.map((event, index) => renderGameCard(event, index))}
          </div>
        )}
      </section>
    );
  };

  const noResult = filteredEvents.length === 0;

  return (
    <div className="page-shell">
      {notifyText && (
        <div
          className="fixed right-5 top-24 z-50 rounded-[16px] border px-4 py-3 text-[0.9rem] font-bold shadow-[0_12px_32px_rgba(17,40,73,0.12)]"
          style={{ background: "#ECFDF3", borderColor: "#BBF7D0", color: "#166534" }}
        >
          {notifyText}
        </div>
      )}

      <div className="page-header gap-4">
        <div>
          <p className="page-eyebrow mb-3 text-[#1E3A8A]">Schedule</p>
          <h1 className="page-title mb-3" style={{ color: "#14253F" }}>
            경기 예매
          </h1>
          <p className="page-subtitle max-w-2xl" style={{ color: "#64748B" }}>
            지금 예매할 수 있는 경기부터 빠르게 확인하고 NFT 입장권을 예매할 수 있어요.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate("/my-tickets")}
          className="rounded-[12px] border px-4 py-2.5 text-[0.9rem] font-black"
          style={{ background: "#FFFFFF", borderColor: "#E2E8F0", color: "#1E3A8A" }}
        >
          내 입장권 →
        </button>
      </div>

      <section
        className="grid gap-3 rounded-[20px] border bg-white p-4 shadow-[0_4px_14px_rgba(17,40,73,0.06)] sm:grid-cols-2 lg:grid-cols-4"
        style={{ borderColor: "#E2E8F0" }}
      >
        {[
          { label: "예매 가능", value: counts.open, color: "#16A34A" },
          { label: "오늘 경기", value: counts.today, color: "#1E3A8A" },
          { label: "오픈 예정", value: counts.upcoming, color: "#2563EB" },
          { label: "보유 입장권", value: counts.owned, color: "#EA580C" },
        ].map((item) => (
          <div key={item.label} className="rounded-[16px] border px-4 py-3" style={{ borderColor: "#E2E8F0", background: "#FAFBFD" }}>
            <p className="text-[1.35rem] font-black leading-none" style={{ color: item.color }}>
              {item.value}
            </p>
            <p className="mt-1 text-[0.82rem] font-bold" style={{ color: "#64748B" }}>
              {item.label}
            </p>
          </div>
        ))}
      </section>

      <section
        className="sticky top-0 z-20 mt-5 rounded-[16px] border bg-white/95 p-3 shadow-[0_4px_14px_rgba(17,40,73,0.05)] backdrop-blur"
        style={{ borderColor: "#E2E8F0" }}
      >
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(["all", "open", "today", "upcoming", "priority", "ended"] as StatusFilter[]).map((filter) => {
            const active = statusFilter === filter;
            const count = filter === "all" ? counts.all : counts[filter];
            return (
              <button
                key={filter}
                type="button"
                onClick={() => setStatusFilter(filter)}
                className="whitespace-nowrap rounded-full border px-3.5 py-2 text-[0.84rem] font-black transition"
                style={{
                  background: active ? "#1E3A8A" : "#FFFFFF",
                  borderColor: active ? "#1E3A8A" : "#E2E8F0",
                  color: active ? "#FFFFFF" : "#64748B",
                }}
              >
                {statusFilterLabels[filter]} · {count}
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid gap-2 lg:grid-cols-[160px_180px_minmax(0,1fr)_auto]">
          <select
            value={teamFilter}
            onChange={(event) => setTeamFilter(event.target.value)}
            className="rounded-[12px] border bg-white px-3 py-2.5 text-[0.88rem] font-semibold outline-none"
            style={{ borderColor: "#E2E8F0", color: "#14253F" }}
          >
            <option value="">구단 전체</option>
            {teams.map((team) => <option key={team} value={team}>{team}</option>)}
          </select>
          <select
            value={stadiumFilter}
            onChange={(event) => setStadiumFilter(event.target.value)}
            className="rounded-[12px] border bg-white px-3 py-2.5 text-[0.88rem] font-semibold outline-none"
            style={{ borderColor: "#E2E8F0", color: "#14253F" }}
          >
            <option value="">구장 전체</option>
            {stadiums.map((stadium) => <option key={stadium} value={stadium}>{stadium}</option>)}
          </select>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#94A3B8]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="팀·구장 검색"
              className="w-full rounded-[12px] border bg-white py-2.5 pl-10 pr-3 text-[0.88rem] font-semibold outline-none"
              style={{ borderColor: "#E2E8F0", color: "#14253F" }}
            />
          </div>
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center justify-center gap-2 rounded-[12px] border px-3 py-2.5 text-[0.86rem] font-black"
            style={{ borderColor: "#E2E8F0", color: "#64748B", background: "#FFFFFF" }}
          >
            <RotateCcw className="h-4 w-4" />
            초기화
          </button>
        </div>
      </section>

      {loadingEvents && (
        <section className="mt-8 rounded-[20px] border border-dashed px-6 py-12 text-center" style={{ background: "#FAFBFD", borderColor: "#CBD5E1" }}>
          <p className="text-[1rem] font-black" style={{ color: "#14253F" }}>경기 목록을 불러오는 중입니다.</p>
          <p className="mt-2 text-[0.9rem]" style={{ color: "#64748B" }}>잠시만 기다려주세요.</p>
        </section>
      )}

      {!loadingEvents && eventsError && (
        <section className="mt-8 rounded-[20px] border border-dashed px-6 py-12 text-center" style={{ background: "#FFF7ED", borderColor: "#FED7AA" }}>
          <p className="text-[1rem] font-black" style={{ color: "#9A3412" }}>{eventsError}</p>
          <Button variant="outline" className="mt-5 rounded-[12px]" onClick={fetchGames}>
            다시 불러오기
          </Button>
        </section>
      )}

      {!loadingEvents && !eventsError && (statusFilter === "all" ? (
        <>
          {renderGroup("open", "🟢 예매 가능", groupedEvents.open)}
          {renderGroup("upcoming", "🟠 오픈 예정", groupedEvents.upcoming, { tone: "#EA580C" })}
          {renderGroup("ended", "⚪ 지난/마감 경기", groupedEvents.ended, {
            collapsible: true,
            collapsed: !endedExpanded,
            onToggle: () => setEndedExpanded((value) => !value),
            tone: "#64748B",
          })}
        </>
      ) : statusFilter === "today" ? (
        renderGroup("today", "🔵 오늘 예매 가능", groupedEvents.today)
      ) : statusFilter === "open" ? (
        renderGroup("open", "🟢 예매 가능", groupedEvents.open)
      ) : statusFilter === "upcoming" ? (
        renderGroup("upcoming", "🟠 오픈 예정", groupedEvents.upcoming, { tone: "#EA580C" })
      ) : statusFilter === "ended" ? (
        renderGroup("ended", "⚪ 지난/마감 경기", groupedEvents.ended, { tone: "#64748B" })
      ) : (
        <section className="mt-8 rounded-[20px] border border-dashed px-6 py-12 text-center" style={{ background: "#FAFBFD", borderColor: "#CBD5E1" }}>
          <p className="text-[1rem] font-black" style={{ color: "#14253F" }}>응모/선예매 대상 경기는 아직 연결되지 않았어요.</p>
          <p className="mt-2 text-[0.9rem]" style={{ color: "#64748B" }}>응모권이 필요한 경기는 응모&선예매 메뉴에서 확인할 수 있어요.</p>
          <Button className="mt-5 rounded-[12px] bg-[#1E3A8A] text-white" onClick={() => navigate("/raffle")}>
            응모&선예매로 이동
          </Button>
        </section>
      ))}

      {!loadingEvents && !eventsError && noResult && statusFilter !== "priority" && (
        <section className="mt-8 rounded-[20px] border border-dashed px-6 py-12 text-center" style={{ background: "#FAFBFD", borderColor: "#CBD5E1" }}>
          <p className="text-[1rem] font-black" style={{ color: "#14253F" }}>
            현재 조건에 해당하는 경기가 없어요.
          </p>
          <p className="mt-2 text-[0.9rem]" style={{ color: "#64748B" }}>
            필터를 초기화하거나 다른 구단, 구장을 선택해 보세요.
          </p>
          <Button variant="outline" className="mt-5 rounded-[12px]" onClick={resetFilters}>
            필터 초기화
          </Button>
        </section>
      )}

      {blockedStatus && blockedStatus !== "checking" && blockedStatus !== "ok" && (() => {
        const msg = ACCESS_MESSAGES[blockedStatus];
        const ModalIcon = blockedStatus === "need_login" ? Lock : blockedStatus === "need_wallet" ? Wallet : ShieldCheck;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(10,20,40,0.45)", backdropFilter: "blur(4px)" }}
            onClick={() => setBlockedStatus(null)}
          >
            <div
              className="w-full max-w-md rounded-[24px] border bg-white p-7 text-center shadow-[0_20px_48px_rgba(17,40,73,0.18)]"
              style={{ borderColor: "#E2E8F0" }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#EEF2FB]">
                <ModalIcon className="h-7 w-7 text-[#1E3A8A]" />
              </div>
              <div className="mb-3 inline-flex rounded-full border px-3 py-1 text-[0.76rem] font-bold" style={{ background: "#F8FAFC", borderColor: "#E2E8F0", color: "#64748B" }}>
                예매 준비: {msg.stepLabel}
              </div>
              <h2 className="text-[1.15rem] font-black" style={{ color: "#14253F" }}>{msg.title}</h2>
              <p className="mt-2 text-[0.92rem] leading-7" style={{ color: "#64748B" }}>{msg.desc}</p>
              <div className="mt-6 flex justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setBlockedStatus(null)}
                  className="rounded-[12px] border px-5 py-2.5 text-[0.9rem] font-bold"
                  style={{ borderColor: "#E2E8F0", color: "#64748B", background: "#FFFFFF" }}
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={() => navigate(msg.href)}
                  className="rounded-[12px] px-5 py-2.5 text-[0.9rem] font-bold text-white"
                  style={{ background: "#1E3A8A" }}
                >
                  {msg.action}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
