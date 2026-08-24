import { Link, useNavigate } from "react-router";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { motion, useInView } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { useAppSettings } from "../context/AppSettingsContext";
import { useTicketQR } from "../hooks/useTicketQR";
import { useBookingAccess, ACCESS_MESSAGES, type AccessStatus } from "../hooks/useBookingAccess";
import {
  Ticket, ShoppingBag, Sparkles,
  ArrowRight, MapPin, Calendar, Tag, ChevronRight, ChevronLeft,
  QrCode, Clock, BadgeCheck, ShieldCheck, Wallet, Lock, X,
} from "lucide-react";

// ─── DATA ────────────────────────────────────────────────────────────────────

const PLATFORM_SUBTITLE = "구단별 입장권, 선수 카드 NFT, 공식 재판매를 한곳에서 관리하는 야구 팬 플랫폼";
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");

// 경기 상태 → 표시용 변환 헬퍼
const STADIUM_IMAGES = [
  "https://images.unsplash.com/photo-1471295253337-3ceaaedca402?w=600&q=80",
  "https://images.unsplash.com/photo-1508344928928-7165b67de128?w=600&q=80",
  "https://images.unsplash.com/photo-1517927033932-b3d18e61fb3a?w=600&q=80",
  "https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?w=600&q=80",
];
function gameStatusLabel(status: string) {
  if (status === "OPEN")    return "예매중";
  if (status === "ALMOST")  return "매진임박";
  if (status === "SOLDOUT") return "매진";
  if (status === "ENDED")   return "지난 경기";
  return "오픈예정";
}
function gameStatusColor(status: string) {
  if (status === "OPEN")    return "#2dba73";
  if (status === "ALMOST")  return "#ff9d3b";
  if (status === "SOLDOUT") return "#ff4040";
  if (status === "ENDED")   return "#94a3b8";
  return "#7ec8ff";
}
function gameTag(status: string) {
  if (status === "OPEN")    return "OPEN";
  if (status === "ALMOST")  return "HOT";
  if (status === "SOLDOUT") return "SOLD";
  if (status === "ENDED")   return "CLOSED";
  return "SOON";
}

function getGameStartMs(game: Pick<GameData, "game_date" | "game_time">) {
  const date = String(game.game_date ?? "").slice(0, 10);
  const time = String(game.game_time ?? "18:30:00").slice(0, 8);
  if (!date) return NaN;
  return new Date(`${date}T${time || "18:30:00"}+09:00`).getTime();
}

function isBookingClosed(game: GameData, now = Date.now()) {
  const gameStartMs = getGameStartMs(game);
  return game.status === "ENDED" || (!Number.isNaN(gameStartMs) && now > gameStartMs + 60 * 60 * 1000);
}

function getDisplayStatus(game: GameData, now = Date.now()) {
  return isBookingClosed(game, now) ? "ENDED" : game.status;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div ref={ref} initial={{ opacity: 0, y: 32 }} animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }} className={className}>
      {children}
    </motion.div>
  );
}

function NeonBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className="text-xs px-2.5 py-1 rounded-full font-bold tracking-wide"
      style={{ background: `${color}22`, border: `1px solid ${color}`, color }}>
      {label}
    </span>
  );
}

// ─── NFT TICKET CARD ─────────────────────────────────────────────────────────

function NftTicketCard() {
  const { walletAddress } = useAppSettings();
  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [qrExpanded, setQrExpanded] = useState(false);
  const [isMobileView, setIsMobileView] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches
  );

  const fetchNearest = useCallback(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) { setLoading(false); return; }
    fetch(`${API_BASE}/api/my-tickets/nearest`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => { if (d.success) setTicket(d.data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // 초기 로드
  useEffect(() => { fetchNearest(); }, [fetchNearest]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const syncMobileView = () => setIsMobileView(mediaQuery.matches);
    syncMobileView();
    mediaQuery.addEventListener("change", syncMobileView);
    return () => mediaQuery.removeEventListener("change", syncMobileView);
  }, []);

  // 티켓이 있을 때 10초마다 폴링 (QR 스캔 후 사용완료 자동 반영)
  useEffect(() => {
    if (!ticket) return;
    const id = setInterval(fetchNearest, 10_000);
    return () => clearInterval(id);
  }, [!!ticket, fetchNearest]);

  const { qrData, formattedCountdown } = useTicketQR(
    ticket?.ticketId ?? null,
    walletAddress,
    ticket ? "ACTIVE" : "NONE",
  );
  const activeQrPayload = ticket && qrData?.available && qrData.qrToken
    ? JSON.stringify({ ticketId: ticket.ticketId, qrToken: qrData.qrToken })
    : null;

  useEffect(() => {
    if (!qrExpanded) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setQrExpanded(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [qrExpanded]);

  // 날짜/시간 포맷
  const matchDate = ticket?.matchTime ? ticket.matchTime.slice(0, 10).replace(/-/g, ".") : "—";
  const matchTime = ticket?.matchTime ? ticket.matchTime.slice(11, 16) + " KST" : "—";

  return (
    <motion.div
      initial={{ opacity: 0, rotateY: isMobileView ? 0 : -15, x: isMobileView ? 0 : 60 }}
      animate={{ opacity: 1, rotateY: 0, x: 0 }}
      transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
      style={{ perspective: "1000px" }}
      className="home-ticket-card-root relative w-full max-w-sm mx-auto"
    >
      {/* Glow */}
      <div className="absolute inset-0 rounded-3xl blur-3xl -z-10"
        style={{ background: "linear-gradient(135deg, rgba(20,86,160,0.28), rgba(45,186,115,0.22))" }} />

      {/* Card body */}
      <div className="relative rounded-3xl overflow-hidden"
        style={{
          background: "linear-gradient(145deg, rgba(10,31,56,0.96) 0%, rgba(7,21,39,0.98) 100%)",
          border: "1px solid rgba(45,186,115,0.34)",
          boxShadow: "0 0 40px rgba(20,86,160,0.18), 0 0 80px rgba(45,186,115,0.08), inset 0 1px 0 rgba(255,255,255,0.08)",
        }}>

        {/* Holographic top strip */}
        <div className="h-1.5 w-full"
          style={{ background: "linear-gradient(90deg, #1456a0, #2dba73, #7ec8ff, #1456a0)", backgroundSize: "200% 100%", animation: "shimmer 3s linear infinite" }} />

        <div className="p-6">
          {/* Header row */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-[10px] tracking-[0.3em] text-[#a393d1] uppercase mb-1">NFT · TICKET</p>
              <p className="text-xs font-bold" style={{ color: "#7ec8ff", textShadow: "0 0 8px rgba(126,200,255,0.7)" }}>
                {ticket?.ticketCode ?? "#PASS-2026"}
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #1456a0, #2dba73)", boxShadow: "0 0 16px rgba(20,86,160,0.4)" }}>
              <Ticket className="w-5 h-5 text-white" />
            </div>
          </div>

          {/* 지갑 미연결 / 티켓 없음 */}
          {!walletAddress ? (
            <div className="py-6 text-center">
              <p className="text-sm text-[#a393d1]">지갑을 연결하면</p>
              <p className="text-sm text-white mt-1">예매 티켓이 여기에 표시됩니다</p>
            </div>
          ) : loading ? (
            <div className="py-6 text-center">
              <p className="text-sm text-[#a393d1]">티켓 불러오는 중...</p>
            </div>
          ) : !ticket ? (
            <div className="py-6 text-center">
              <p className="text-sm text-[#a393d1]">예매된 티켓이 없습니다</p>
              <Link to="/tickets" className="text-xs mt-2 inline-block" style={{ color: "#7ec8ff" }}>
                경기 예매하러 가기 →
              </Link>
            </div>
          ) : (
            <>
              {/* 경기명 */}
              <div className="mb-5">
                <h3 className="text-lg font-bold text-white leading-tight">{ticket.matchName}</h3>
                <p className="text-xs mt-1" style={{ color: "#7ec8ff" }}>{ticket.stadium}</p>
              </div>

              {/* 구분선 */}
              <div className="relative flex items-center mb-5">
                <div className="w-5 h-5 rounded-full -ml-8" style={{ background: "rgba(7,21,39,1)", border: "1px solid rgba(126,200,255,0.26)" }} />
                <div className="flex-1 mx-1 border-t-2 border-dashed" style={{ borderColor: "rgba(126,200,255,0.25)" }} />
                <div className="w-5 h-5 rounded-full -mr-8" style={{ background: "rgba(7,21,39,1)", border: "1px solid rgba(126,200,255,0.26)" }} />
              </div>

              {/* 상세 정보 */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                {[
                  { label: "DATE",  value: matchDate },
                  { label: "TIME",  value: matchTime },
                  { label: "SEAT",  value: ticket.seatInfo },
                  { label: "GATE",  value: ticket.gate },
                ].map((item) => (
                  <div key={item.label}>
                    <p className="text-[9px] tracking-widest text-[#a393d1] uppercase mb-0.5">{item.label}</p>
                    <p className="text-xs text-white font-medium leading-snug">{item.value || "—"}</p>
                  </div>
                ))}
              </div>

              {/* QR 영역 */}
              <div className="p-3 rounded-2xl"
                style={{ background: "rgba(20,86,160,0.10)", border: "1px solid rgba(126,200,255,0.22)" }}>
                {activeQrPayload ? (
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setQrExpanded(true)}
                      className="rounded-xl overflow-hidden bg-white p-1.5 shrink-0 transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[#7ec8ff]"
                      aria-label="입장 QR 크게 보기"
                    >
                      <QRCodeSVG value={activeQrPayload} size={56} />
                    </button>
                    <div>
                      <p className="text-xs text-[#a393d1] mb-0.5">현장 입장 QR</p>
                      <p className="text-xs text-white font-bold" style={{ color: "#2dba73" }}>
                        {formattedCountdown} 후 갱신
                      </p>
                      <div className="flex items-center gap-1 mt-1">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#2dba73] animate-pulse" />
                        <p className="text-[10px] text-[#2dba73]">ACTIVE</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: "rgba(255,255,255,0.05)" }}>
                      <QrCode className="w-8 h-8" style={{ color: "#7ec8ff", opacity: 0.5 }} />
                    </div>
                    <div>
                      <p className="text-xs text-[#a393d1] mb-0.5">현장 입장 QR</p>
                      <p className="text-xs text-white">경기 시작 2시간 전 활성화</p>
                      <div className="flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3 text-[#a393d1]" />
                        <p className="text-[10px] text-[#a393d1]">STANDBY</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Bottom accent */}
        <div className="h-1 w-full opacity-60"
          style={{ background: "linear-gradient(90deg, transparent, #1456a0, #2dba73, transparent)" }} />
      </div>

      {activeQrPayload && qrExpanded && (
        <div
          className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center p-4"
          style={{ background: "rgba(2, 8, 23, 0.72)", backdropFilter: "blur(8px)" }}
          onClick={() => setQrExpanded(false)}
        >
          <div
            className="relative w-full max-w-[430px] cursor-pointer rounded-[28px] p-7 text-center"
            style={{
              background: "#ffffff",
              border: "1px solid rgba(126,200,255,0.28)",
              boxShadow: "0 28px 80px rgba(2,8,23,0.32)",
            }}
            onClick={() => setQrExpanded(false)}
          >
            <button
              type="button"
              onClick={() => setQrExpanded(false)}
              className="absolute right-4 top-4 rounded-full p-2 transition-colors hover:bg-slate-100"
              aria-label="QR 확대 닫기"
            >
              <X className="h-5 w-5 text-slate-500" />
            </button>

            <p className="mb-1 text-[0.75rem] font-bold tracking-[0.24em] uppercase" style={{ color: "#1456a0" }}>
              Entry QR
            </p>
            <h3 className="mb-2 text-xl font-black" style={{ color: "#14253f" }}>{ticket.matchName}</h3>
            <p className="mb-5 text-sm" style={{ color: "#64748b" }}>{ticket.seatInfo}</p>

            <div className="mx-auto mb-5 flex max-w-full justify-center rounded-[26px] bg-white p-4" style={{ border: "1px solid #dbe4ed" }}>
              <QRCodeSVG value={activeQrPayload} size={280} />
            </div>

            <div className="rounded-[16px] px-4 py-3" style={{ background: "#eef7f1", border: "1px solid #cdebd8" }}>
              <p className="text-sm font-bold" style={{ color: "#15803d" }}>
                {formattedCountdown} 후 자동 갱신
              </p>
              <p className="mt-1 text-xs" style={{ color: "#64748b" }}>
                현장 게이트에서 이 QR을 제시해 주세요.
              </p>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

type GameData = {
  id: string;
  home_team: string;
  away_team: string;
  game_date: string;
  game_time: string;
  stadium_name: string;
  location: string;
  day_of_week: string;
  status: string;
  base_price: number;
};

export function Home() {
  const navigate = useNavigate();
  const [hoveredEvent, setHoveredEvent] = useState<string | null>(null);
  const [availableGames, setAvailableGames] = useState<GameData[]>([]);
  const [allGames, setAllGames] = useState<GameData[]>([]);
  const [calYear, setCalYear] = useState(2026);
  const [calMonth, setCalMonth] = useState(3); // 0-indexed: 3 = 4월
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calReady, setCalReady] = useState(false);
  const [blockedStatus, setBlockedStatus] = useState<Exclude<AccessStatus, "checking" | "ok"> | null>(null);
  const accessStatus = useBookingAccess();

  function handleBooking(gameId: string) {
    if (accessStatus === "checking") return;
    if (accessStatus === "ok") {
      navigate(`/tickets/${gameId}/booking`);
    } else {
      setBlockedStatus(accessStatus);
    }
  }

  // 시스템 시간 기준 오늘 이후 가장 빠른 경기
  const heroGame = useMemo(() => {
    return allGames.find((game) => !isBookingClosed(game)) ?? allGames[allGames.length - 1] ?? null;
  }, [allGames]);

  const gamesByDate = useMemo(() => {
    const map: Record<string, GameData[]> = {};
    allGames.forEach(g => {
      if (!map[g.game_date]) map[g.game_date] = [];
      map[g.game_date].push(g);
    });
    return map;
  }, [allGames]);

  const calFirstDay  = new Date(calYear, calMonth, 1).getDay();     // 0=일
  const calDaysCount = new Date(calYear, calMonth + 1, 0).getDate();
  const todayStr     = new Date().toISOString().slice(0, 10);

  function prevMonth() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else setCalMonth(m => m - 1);
    setSelectedDate(null);
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else setCalMonth(m => m + 1);
    setSelectedDate(null);
  }

  useEffect(() => {
    fetch(`${API_BASE}/api/tickets/games`)
      .then((r) => r.json())
      .then((res: { success: boolean; data: GameData[] }) => {
        const data = res.data ?? [];
        const sorted = [...data].sort((a, b) => a.game_date.localeCompare(b.game_date));
        const available = sorted
          .filter((g) => !isBookingClosed(g) && (g.status === "OPEN" || g.status === "ALMOST"))
          .slice(0, 4);
        setAvailableGames(available);
        setAllGames(sorted);
        // 초기 선택: 오늘 이후 가장 빠른 경기, 없으면 마지막 경기
        if (sorted.length > 0) {
          const initialGame = sorted.find((game) => !isBookingClosed(game)) ?? sorted[sorted.length - 1];
          const d = new Date(initialGame.game_date);
          setCalYear(d.getFullYear());
          setCalMonth(d.getMonth());
          setSelectedDate(initialGame.game_date);
        }
        setCalReady(true);
      })
      .catch(() => {});
  }, []);

  const modalInfo = blockedStatus ? ACCESS_MESSAGES[blockedStatus] : null;
  const ModalIcon = blockedStatus === "need_login" ? Lock : blockedStatus === "need_wallet" ? Wallet : ShieldCheck;

  return (
    <div className="home-page w-full">
      {/* ── 접근 제한 모달 ── */}
      {blockedStatus && modalInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
          <div className="relative bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm mx-4 text-center">
            <button onClick={() => setBlockedStatus(null)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "rgba(20,86,160,0.1)" }}>
              <ModalIcon className="w-7 h-7" style={{ color: "#1456a0" }} />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">{modalInfo.title}</h3>
            <p className="text-sm text-gray-500 mb-6 leading-relaxed">{modalInfo.desc}</p>
            <div className="flex gap-3">
              <button onClick={() => setBlockedStatus(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                닫기
              </button>
              <Link to={modalInfo.href} onClick={() => setBlockedStatus(null)} className="flex-1">
                <button className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:brightness-110"
                  style={{ background: "linear-gradient(135deg, #1456a0, #1e7fd0)" }}>
                  {modalInfo.action}
                </button>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 1 · HERO BANNER
      ═══════════════════════════════════════════════════════════════════════ */}
      <section className="home-hero relative min-h-screen flex items-center overflow-hidden">
        {/* Background image */}
        <div className="absolute inset-0 z-0">
          <img
            src="https://images.unsplash.com/photo-1471295253337-3ceaaedca402?w=1920&q=80"
            alt="baseball stadium"
            className="home-hero-bg-image w-full h-full object-cover"
          />
          <div className="home-hero-side-overlay absolute inset-0" style={{ background: "linear-gradient(to right, rgba(5,0,16,0.97) 40%, rgba(5,0,16,0.75) 70%, rgba(5,0,16,0.5) 100%)" }} />
          <div className="home-hero-bottom-overlay absolute inset-0" style={{ background: "linear-gradient(to top, rgba(5,0,16,0.9) 0%, transparent 50%)" }} />
        </div>

        {/* Scan line effect */}
        <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.04]"
          style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,1) 2px, rgba(255,255,255,1) 4px)" }} />

        {/* Content */}
        <div className="home-hero-shell relative z-10 w-full max-w-[1600px] mx-auto px-6 pt-[70px]">
          <div className="home-hero-grid grid lg:grid-cols-2 gap-12 items-center min-h-[calc(100vh-70px)] py-16">

            {/* Left: Event info */}
            <div className="home-hero-copy space-y-6">
              <motion.div
                initial={{ opacity: 0, x: -40 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="home-hero-badges flex items-center gap-3 mb-6">
                  <div className="soft-badge"
                    style={{ background: "rgba(20,86,160,0.18)", border: "1px solid rgba(126,200,255,0.38)", color: "#7ec8ff" }}>
                    <div className="w-1.5 h-1.5 rounded-full bg-[#7ec8ff] animate-pulse" />
                    LIVE SERIES
                  </div>
                  <div className="soft-badge"
                    style={{ background: "rgba(45,186,115,0.12)", border: "1px solid rgba(45,186,115,0.4)", color: "#2dba73" }}>
                    <BadgeCheck className="w-3 h-3" />
                    공식 재판매 제한
                  </div>
                </div>

                <h1 className="home-hero-title mb-5" style={{ fontSize: "clamp(2.6rem, 5vw, 4.4rem)", fontWeight: 800, lineHeight: 1.02, letterSpacing: "-0.05em" }}>
                  <span className="block text-white">야구 팬을 위한</span>
                  <span className="block mt-2" style={{
                    background: "linear-gradient(90deg, #7ec8ff, #ffffff, #9fe1bf)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}>BASE CHAIN</span>
                </h1>

                <p className="home-hero-subtitle page-body max-w-xl">
                  {PLATFORM_SUBTITLE}
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className="space-y-3"
              >
                {/* Event highlight */}
                <div className="home-feature-game p-5 rounded-2xl"
                  style={{ background: "rgba(20,86,160,0.10)", border: "1px solid rgba(126,200,255,0.18)", backdropFilter: "blur(10px)" }}>
                  <p className="page-eyebrow text-[#c6d5ea] mb-3">다음 주요 경기</p>
                  {heroGame ? (
                    (() => {
                      const displayStatus = getDisplayStatus(heroGame);
                      return (
                    <>
                      <h2 className="section-title text-[1.65rem] text-white mb-3">
                        {heroGame.home_team} vs {heroGame.away_team}
                      </h2>
                      <div className="home-game-meta space-y-2">
                        <div className="flex items-center gap-2 text-[0.95rem] text-[#c8b9f0]">
                          <Calendar className="w-4 h-4 text-[#7ec8ff] shrink-0" />
                          {heroGame.game_date} ({heroGame.day_of_week}) {heroGame.game_time?.slice(0, 5)}
                        </div>
                        <div className="flex items-center gap-2 text-[0.95rem] text-[#c8b9f0]">
                          <MapPin className="w-4 h-4 text-[#2dba73] shrink-0" />
                          {heroGame.stadium_name}, {heroGame.location}
                        </div>
                        <div className="flex items-center gap-2 text-[0.95rem] text-[#c8b9f0]">
                          <Tag className="w-4 h-4 text-[#ffce67] shrink-0" />
                          from ₩{heroGame.base_price.toLocaleString()} &nbsp;·&nbsp;
                          <span style={{ color: gameStatusColor(displayStatus) }}>
                            {gameStatusLabel(displayStatus)}
                          </span>
                        </div>
                      </div>
                    </>
                      );
                    })()
                  ) : (
                    <p className="text-[#a393d1] text-sm">경기 정보를 불러오는 중...</p>
                  )}
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.35 }}
                className="home-hero-actions flex flex-wrap gap-3"
              >
                <Link to="/tickets">
                  <button className="home-primary-cta flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-bold text-white transition-all duration-200 hover:scale-105 hover:brightness-110"
                    style={{ background: "linear-gradient(135deg, #1456a0, #1e7fd0)", boxShadow: "0 0 24px rgba(20,86,160,0.35), 0 0 48px rgba(20,86,160,0.12)" }}>
                    <Ticket className="w-4 h-4" />
                    경기 예매하기
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </Link>
                <Link to="/my-tickets">
                  <button className="home-secondary-cta flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-bold transition-all duration-200 hover:scale-105"
                    style={{ background: "rgba(45,186,115,0.10)", border: "1px solid rgba(45,186,115,0.36)", color: "#8ff1bb", boxShadow: "0 0 16px rgba(45,186,115,0.12)" }}>
                    <QrCode className="w-4 h-4" />
                    내 입장권 보기
                  </button>
                </Link>
              </motion.div>

              {/* Stats row */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.5 }}
                className="home-hero-stats flex gap-6 pt-2"
              >
                {[
                  { value: "18,240+", label: "발급된 입장권 NFT", color: "#7ec8ff" },
                  { value: "92", label: "등록된 경기", color: "#ffffff" },
                  { value: "0건", label: "비공식 거래 신고", color: "#9fe1bf" },
                ].map(s => (
                  <div key={s.label}>
                    <p className="text-[1.35rem] font-bold tracking-[-0.04em]" style={{ color: s.color, textShadow: `0 0 10px ${s.color}40` }}>{s.value}</p>
                    <p className="page-stat-label mt-1">{s.label}</p>
                  </div>
                ))}
              </motion.div>
            </div>

            {/* Right: NFT Ticket Card */}
            <div className="home-ticket-preview flex justify-center lg:justify-end">
              <NftTicketCard />
            </div>
          </div>
        </div>

        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-32 z-10"
          style={{ background: "linear-gradient(to bottom, transparent, rgba(5,0,16,1))" }} />
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 2 · AVAILABLE EVENTS
      ═══════════════════════════════════════════════════════════════════════ */}
      <section className="relative py-24">
        <div className="max-w-[1600px] mx-auto px-6">
          <FadeIn className="mb-12">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-0.5" style={{ background: "linear-gradient(90deg, #ff10f0, transparent)" }} />
                  <span className="page-eyebrow text-[#1456a0]">Games</span>
                </div>
                <h2 className="section-title text-black">예매 가능한 경기</h2>
              </div>
              <Link to="/tickets">
                <button className="hidden md:inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-bold text-white transition-all hover:scale-105"
                  style={{ background: "linear-gradient(135deg, rgba(255,16,240,0.2), rgba(0,217,255,0.2))", border: "1px solid rgba(255,16,240,0.3)", backdropFilter: "blur(8px)" }}>
                  <Ticket className="w-4 h-4 text-[#7ec8ff]" />
                  전체 경기 보기
                  <ChevronRight className="w-4 h-4" />
                </button>
              </Link>
            </div>
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {availableGames.map((ev, i) => {
              const displayStatus = getDisplayStatus(ev);
              const closed = displayStatus === "ENDED";
              const color = gameStatusColor(displayStatus);
              const label = gameStatusLabel(displayStatus);
              const tag   = gameTag(displayStatus);
              const img   = STADIUM_IMAGES[i % STADIUM_IMAGES.length];
              return (
              <FadeIn key={ev.id} delay={i * 0.1}>
                <div
                  className="group relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-300"
                  style={{
                    border: hoveredEvent === ev.id ? `1px solid ${color}66` : "1px solid rgba(255,16,240,0.15)",
                    background: "rgba(15,8,35,0.8)",
                    boxShadow: hoveredEvent === ev.id ? `0 0 30px ${color}22` : "none",
                  }}
                  onMouseEnter={() => setHoveredEvent(ev.id)}
                  onMouseLeave={() => setHoveredEvent(null)}
                >
                  {/* Thumbnail */}
                  <div className="relative h-52 overflow-hidden">
                    <img src={img} alt={ev.home_team}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(5,0,16,0.9) 0%, rgba(5,0,16,0.2) 60%, transparent 100%)" }} />
                    <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-xs font-bold"
                      style={{ background: "rgba(5,0,16,0.7)", border: `1px solid ${color}`, color, backdropFilter: "blur(8px)" }}>
                      {tag}
                    </div>
                    <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full text-xs font-bold"
                      style={{ background: `${color}22`, border: `1px solid ${color}`, color, backdropFilter: "blur(8px)" }}>
                      {label}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-4">
                    <h3 className="text-white text-sm font-bold mb-2 truncate">{ev.home_team} vs {ev.away_team}</h3>
                    <div className="space-y-1.5 mb-4">
                      <div className="flex items-center gap-2 text-xs text-[#a393d1]">
                        <Calendar className="w-3.5 h-3.5 text-[#00d9ff]" />
                        {ev.game_date} ({ev.day_of_week}) {ev.game_time?.slice(0, 5)}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[#a393d1]">
                        <MapPin className="w-3.5 h-3.5 text-[#ff10f0]" />{ev.stadium_name}
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <Tag className="w-3.5 h-3.5 text-[#00ff88]" />
                        <span className="text-[#00ff88] font-bold">{ev.base_price.toLocaleString()}원~</span>
                      </div>
                    </div>
                    <button
                      disabled={closed}
                      onClick={() => { if (!closed) handleBooking(ev.id); }}
                      className="w-full py-2.5 rounded-xl text-xs font-bold text-white transition-all duration-200"
                      style={{
                        background: closed ? "rgba(148,163,184,0.16)" : hoveredEvent === ev.id ? `linear-gradient(135deg, #ff10f0, #bd00e8)` : "rgba(255,16,240,0.1)",
                        border: closed ? "1px solid rgba(148,163,184,0.35)" : "1px solid rgba(255,16,240,0.3)",
                        color: closed ? "#cbd5e1" : "#ffffff",
                        boxShadow: !closed && hoveredEvent === ev.id ? "0 0 16px rgba(255,16,240,0.4)" : "none",
                        cursor: closed ? "default" : "pointer",
                      }}>
                      {closed ? "예매 마감" : "예매하기"}
                    </button>
                  </div>
                </div>
              </FadeIn>
              );
            })}
          </div>
        </div>
      </section>


      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 5 · CALENDAR
      ═══════════════════════════════════════════════════════════════════════ */}
      <section className="relative py-24">
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "linear-gradient(180deg, transparent, rgba(255,16,240,0.03) 50%, transparent)" }} />

        <div className="max-w-[1600px] mx-auto px-6">
          <FadeIn className="mb-10">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-0.5" style={{ background: "linear-gradient(90deg, #ffaa00, transparent)" }} />
                <span className="page-eyebrow text-[#ffce67]">Season Games</span>
              </div>
              <h2 className="section-title text-black">전체 경기 일정</h2>
            </div>
          </FadeIn>

          {/* ── 달력 + 경기 상세 (좌우 분할) ── */}
          <FadeIn>
            <div className="grid lg:grid-cols-2 gap-6 items-start">

              {/* ── 왼쪽: 달력 ── */}
              <div className="rounded-2xl overflow-hidden shadow-lg"
                style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.08)" }}>

                {/* 월 네비게이션 */}
                <div className="flex items-center justify-between px-5 py-3.5"
                  style={{ borderBottom: "1px solid #e5e7eb", background: "#f9fafb" }}>
                  <button onClick={prevMonth}
                    className="w-8 h-8 flex items-center justify-center rounded-lg transition-all hover:bg-gray-200"
                    style={{ color: "#6b7280" }}>
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="font-bold text-base tracking-wide" style={{ color: "#111827" }}>
                    {calYear}년 {calMonth + 1}월
                  </span>
                  <button onClick={nextMonth}
                    className="w-8 h-8 flex items-center justify-center rounded-lg transition-all hover:bg-gray-200"
                    style={{ color: "#6b7280" }}>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* 요일 헤더 */}
                <div className="grid grid-cols-7"
                  style={{ borderBottom: "1px solid #e5e7eb" }}>
                  {['일','월','화','수','목','금','토'].map((d, i) => (
                    <div key={d} className="py-2 text-center text-[11px] font-bold tracking-widest"
                      style={{ color: i === 0 ? '#ef4444' : i === 6 ? '#3b82f6' : '#9ca3af' }}>
                      {d}
                    </div>
                  ))}
                </div>

                {/* 날짜 그리드 */}
                <div className="grid grid-cols-7">
                  {/* 앞 빈칸 */}
                  {Array.from({ length: calFirstDay }).map((_, i) => (
                    <div key={`e${i}`} className="aspect-square"
                      style={{ borderRight: "1px solid #f3f4f6", borderBottom: "1px solid #f3f4f6" }} />
                  ))}

                  {/* 날짜 셀 */}
                  {Array.from({ length: calDaysCount }).map((_, i) => {
                    const day     = i + 1;
                    const dateStr = `${calYear}-${String(calMonth + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                    const games   = gamesByDate[dateStr] ?? [];
                    const hasGame = games.length > 0;
                    const isSel   = selectedDate === dateStr;
                    const isToday = dateStr === todayStr;
                    const col     = (calFirstDay + i) % 7;

                    return (
                      <div
                        key={day}
                        onClick={() => hasGame && setSelectedDate(isSel ? null : dateStr)}
                        className="aspect-square flex flex-col p-1.5 transition-all duration-150 relative overflow-hidden"
                        style={{
                          borderRight: "1px solid #f3f4f6",
                          borderBottom: "1px solid #f3f4f6",
                          background: isSel
                            ? "#eff6ff"
                            : hasGame ? "#fafafa" : "#ffffff",
                          cursor: hasGame ? "pointer" : "default",
                          boxShadow: isSel ? "inset 0 0 0 2px #3b82f6" : "none",
                        }}
                      >
                        {/* 날짜 숫자 */}
                        <span className="w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold shrink-0"
                          style={{
                            background: isToday ? "#1d4ed8" : "transparent",
                            color: isToday ? "#fff"
                              : isSel ? "#1d4ed8"
                              : col === 0 ? "#ef4444"
                              : col === 6 ? "#3b82f6"
                              : hasGame ? "#111827"
                              : "#9ca3af",
                          }}>
                          {day}
                        </span>

                        {/* 경기 뱃지 */}
                        {games.map(g => {
                          const displayStatus = getDisplayStatus(g);
                          const c = gameStatusColor(displayStatus);
                          return (
                            <div key={g.id} className="mt-0.5 px-1 py-px rounded text-[8px] font-semibold leading-tight truncate"
                              style={{ background: `${c}18`, border: `1px solid ${c}55`, color: c }}>
                              {g.home_team}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>

                {/* 범례 */}
                <div className="flex items-center gap-4 px-4 py-3"
                  style={{ borderTop: "1px solid #e5e7eb", background: "#f9fafb" }}>
                  {[
                    { status: "OPEN",    label: "예매중" },
                    { status: "ALMOST",  label: "매진임박" },
                    { status: "SOLDOUT", label: "매진" },
                    { status: "UPCOMING",label: "오픈예정" },
                    { status: "ENDED",   label: "지난 경기" },
                  ].map(({ status, label }) => (
                    <div key={status} className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: gameStatusColor(status) }} />
                      <span className="text-[11px]" style={{ color: "#6b7280" }}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── 오른쪽: 경기 상세 ── */}
              <div className="flex flex-col gap-3 min-h-[400px]">
                {selectedDate && gamesByDate[selectedDate] ? (
                  <>
                    <p className="text-sm font-semibold" style={{ color: "#a393d1" }}>
                      {selectedDate} 경기 정보
                    </p>
                    {gamesByDate[selectedDate].map(ev => {
                      const displayStatus = getDisplayStatus(ev);
                      const closed = displayStatus === "ENDED";
                      const color = gameStatusColor(displayStatus);
                      const label = gameStatusLabel(displayStatus);
                      return (
                        <div key={ev.id} className="relative rounded-2xl overflow-hidden transition-all"
                          style={{ background: "rgba(15,8,35,0.80)", border: `1px solid ${color}44`, backdropFilter: "blur(12px)" }}>
                          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl" style={{ background: color }} />
                          <div className="flex flex-col gap-4 px-6 py-5 pl-7">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2 mb-2">
                                  <h3 className="text-white font-bold text-base">{ev.home_team} vs {ev.away_team}</h3>
                                  <NeonBadge label={label} color={color} />
                                </div>
                                <div className="flex flex-col gap-1.5 text-xs" style={{ color: "#a393d1" }}>
                                  <span className="flex items-center gap-1.5">
                                    <Calendar className="w-3.5 h-3.5 text-[#00d9ff]" />
                                    {ev.game_date} ({ev.day_of_week}) {ev.game_time?.slice(0, 5)}
                                  </span>
                                  <span className="flex items-center gap-1.5">
                                    <MapPin className="w-3.5 h-3.5 text-[#ff10f0]" />
                                    {ev.stadium_name} · {ev.location}
                                  </span>
                                  <span className="flex items-center gap-1.5 font-bold" style={{ color: "#00ff88" }}>
                                    <Tag className="w-3.5 h-3.5" />
                                    {ev.base_price.toLocaleString()}원~
                                  </span>
                                </div>
                              </div>
                            </div>
                            <button
                              disabled={closed || ev.status === "UPCOMING" || ev.status === "SOLDOUT"}
                              onClick={() => { if (!closed && ev.status !== "UPCOMING" && ev.status !== "SOLDOUT") handleBooking(ev.id); }}
                              className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:scale-[1.02]"
                              style={{
                                background: closed ? "rgba(148,163,184,0.16)" : ev.status === "UPCOMING" ? "rgba(255,170,0,0.15)" : ev.status === "SOLDOUT" ? "rgba(100,100,100,0.2)" : "linear-gradient(135deg, #ff10f0, #bd00e8)",
                                border: closed ? "1px solid rgba(148,163,184,0.35)" : ev.status === "UPCOMING" ? "1px solid rgba(255,170,0,0.4)" : ev.status === "SOLDOUT" ? "1px solid rgba(100,100,100,0.4)" : "none",
                                color: closed ? "#cbd5e1" : ev.status === "UPCOMING" ? "#ffaa00" : ev.status === "SOLDOUT" ? "#888" : "white",
                                boxShadow: !closed && ev.status !== "UPCOMING" && ev.status !== "SOLDOUT" ? "0 0 12px rgba(255,16,240,0.4)" : "none",
                                cursor: closed || ev.status === "UPCOMING" || ev.status === "SOLDOUT" ? "default" : "pointer",
                              }}>
                              {closed ? "예매 마감" : ev.status === "UPCOMING" ? "오픈예정" : ev.status === "SOLDOUT" ? "매진" : "예매하기"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </>
                ) : calReady ? (
                  <div className="flex-1 flex items-center justify-center rounded-2xl"
                    style={{ background: "rgba(15,8,35,0.4)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <p className="text-sm" style={{ color: "#6b5f8a" }}>날짜를 선택하면 경기 정보가 표시됩니다</p>
                  </div>
                ) : null}
              </div>
            </div>
          </FadeIn>

        </div>
      </section>

      {/* CTA Banner */}
      <section className="relative py-20 overflow-hidden">
        <div className="absolute inset-0">
          <img src="https://images.unsplash.com/photo-1508344928928-7165b67de128?w=1920&q=80" alt="" className="w-full h-full object-cover opacity-20" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(8,24,44,0.92), rgba(13,39,67,0.88))" }} />
        </div>
        <div className="relative z-10 max-w-[1600px] mx-auto px-6 text-center">
          <FadeIn>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold mb-6"
              style={{ background: "rgba(45,186,115,0.16)", border: "1px solid rgba(45,186,115,0.34)", color: "#9fe1bf" }}>
              <Sparkles className="w-3 h-3" />
              야구 팬을 위한 공식 블록체인 티켓팅
            </div>
            <h2 className="text-white mb-4" style={{ fontSize: "clamp(1.9rem, 4vw, 3rem)", fontWeight: 800, lineHeight: 1.14, letterSpacing: "-0.05em" }}>
              지금 바로 시작하세요
            </h2>
            <p className="page-subtitle mb-8 max-w-xl mx-auto">
              블록체인 입장권으로 경기를 예매하고, 선수 카드와 직관 굿즈를 수집하고, 공식 장터에서 안전하게 거래하세요.
            </p>
            <div className="flex flex-wrap gap-3 justify-center">
              <Link to="/tickets">
                <button className="flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-bold text-white hover:scale-105 transition-all"
                  style={{ background: "linear-gradient(135deg, #ff10f0, #bd00e8)", boxShadow: "0 0 28px rgba(255,16,240,0.5)" }}>
                  <Ticket className="w-4 h-4" />
                  지금 경기 보기
                </button>
              </Link>
              <Link to="/market">
                <button className="flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-bold hover:scale-105 transition-all"
                  style={{ background: "rgba(126,200,255,0.10)", border: "1px solid rgba(126,200,255,0.34)", color: "#b9e5ff" }}>
                  <ShoppingBag className="w-4 h-4" />
                  장터 둘러보기
                </button>
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>
    </div>
  );
}
