import { useEffect, useMemo, useState, useCallback } from "react";
import { MapPin, Calendar, CheckCircle, Clock, RotateCcw, X, ChevronDown } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "../components/ui/button";
import { QRCodeSVG } from "qrcode.react";
import { useAppSettings } from "../context/AppSettingsContext";
import { useTicketQR } from "../hooks/useTicketQR";

// ─── 타입 ─────────────────────────────────────────────────

interface NormalizedTicket {
  ticketId:   string;
  matchName:  string;
  stadium:    string;
  matchTime:  string | null;
  seatInfo:   string;
  gate:       string;
  status:     "ACTIVE" | "USED";
  ticketCode: string;
  price:      number | null;
  // UI용 추가 필드
  color:      string;
  rawStatus:  string;
  statusLabel: string;
}

interface TicketGroup {
  key: string;
  date: string;
  monthKey: string;
  monthLabel: string;
  matchName: string;
  stadium: string;
  tickets: NormalizedTicket[];
}

type TicketSort = "latest" | "oldest";

// ─── API 응답 → UI 포맷 변환 ──────────────────────────────

function normalizeApiTicket(t: any): NormalizedTicket {
  const rawStatus = String(t.status ?? "").toUpperCase();
  const isUsed = rawStatus === "USED";
  const isExpired = rawStatus === "EXPIRED";
  const isActive = rawStatus === "ACTIVE" || rawStatus === "CONFIRMED";
  const status: NormalizedTicket["status"] = isActive && !isExpired ? "ACTIVE" : "USED";
  return {
    ticketId:   t.ticketId ?? t.id,
    matchName:  t.matchName ?? t.game_name ?? t.game_id,
    stadium:    t.stadium ?? "",
    matchTime:  t.matchTime ?? null,
    seatInfo:   t.seatInfo ?? `${t.block ?? ""}블록 ${t.row_num ?? ""}열 ${t.seat_number ?? ""}번`,
    gate:       t.gate ?? t.grade ?? "",
    status,
    ticketCode: t.ticketCode ?? `#${String(t.ticketId ?? t.id).slice(0, 8).toUpperCase()}`,
    price:      t.price ?? null,
    color:      status === "USED" ? "#5f7188" : "#1456a0",
    rawStatus,
    statusLabel: isExpired ? "기간 만료" : isUsed ? "관람 완료" : "사용 가능",
  };
}

function isDisplayableTicket(ticket: NormalizedTicket) {
  return ["ACTIVE", "CONFIRMED", "USED", "EXPIRED"].includes(ticket.rawStatus);
}

// ─── 날짜/시간 포맷 ───────────────────────────────────────

function formatMatchDate(matchTime: string | null) {
  if (!matchTime) return "—";
  return matchTime.slice(0, 10);
}

function getMonthKey(matchTime: string | null) {
  if (!matchTime) return "unknown";
  return matchTime.slice(0, 7);
}

function formatMonthLabel(monthKey: string) {
  if (monthKey === "unknown") return "날짜 미정";
  const [year, month] = monthKey.split("-");
  return `${year}년 ${Number(month)}월`;
}

function groupTicketsByGame(tickets: NormalizedTicket[], sort: TicketSort): TicketGroup[] {
  const groupMap = new Map<string, TicketGroup>();

  tickets.forEach((ticket) => {
    const date = formatMatchDate(ticket.matchTime);
    const monthKey = getMonthKey(ticket.matchTime);
    const key = `${date}|${ticket.matchName}|${ticket.stadium}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        date,
        monthKey,
        monthLabel: formatMonthLabel(monthKey),
        matchName: ticket.matchName,
        stadium: ticket.stadium,
        tickets: [],
      });
    }

    groupMap.get(key)?.tickets.push(ticket);
  });

  return Array.from(groupMap.values()).sort((left, right) => {
    const leftTime = left.tickets[0]?.matchTime;
    const rightTime = right.tickets[0]?.matchTime;

    if (!leftTime && !rightTime) return left.matchName.localeCompare(right.matchName);
    if (!leftTime) return 1;
    if (!rightTime) return -1;

    return sort === "latest"
      ? leftTime.localeCompare(rightTime)
      : rightTime.localeCompare(leftTime);
  });
}

// ─── QR 패널 (훅 사용을 위해 별도 컴포넌트) ──────────────

function TicketQRPanel({
  ticketId,
  walletAddress,
  status,
  color,
}: {
  ticketId:      string;
  walletAddress: string;
  status:        "ACTIVE" | "USED";
  color:         string;
}) {
  const { qrData, formattedCountdown } = useTicketQR(
    ticketId,
    walletAddress,
    status,
  );

  if (status === "USED") {
    return (
      <p className="text-center text-[0.82rem] py-3" style={{ color: "#9ca3af" }}>
        이미 사용된 티켓입니다
      </p>
    );
  }

  if (!qrData) {
    return (
      <p className="text-center text-[0.82rem] py-3" style={{ color: "#9ca3af" }}>
        QR 불러오는 중...
      </p>
    );
  }

  if (!qrData.available) {
    return (
      <div className="flex flex-col items-center gap-2 py-4">
        <Clock className="w-8 h-8" style={{ color, opacity: 0.4 }} />
        <p className="text-[0.82rem] font-semibold" style={{ color }}>현장 입장 QR</p>
        <p className="text-[0.78rem]" style={{ color: "#9ca3af" }}>
          {qrData.message ?? "경기 시작 2시간 전 활성화"}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 pt-4"
      style={{ borderTop: `1px dashed ${color}33` }}>
      <div className="rounded-2xl overflow-hidden bg-white p-3 shadow"
        style={{ border: `1px solid ${color}22` }}>
        <QRCodeSVG value={JSON.stringify({ ticketId, qrToken: qrData.qrToken })} size={112} />
      </div>
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#2dba73" }} />
        <p className="text-[0.82rem] font-bold tabular-nums" style={{ color: "#2dba73" }}>
          {qrData.demo ? `QR 시연용 · ${formattedCountdown} 후 자동 갱신` : `${formattedCountdown} 후 자동 갱신`}
        </p>
      </div>
      <p className="page-stat-label">현장 게이트에서 QR을 제시해 주세요</p>
    </div>
  );
}

// ─── 환불 모달 ────────────────────────────────────────────

interface RefundPreview {
  originalPrice: number;
  refundRate:    number;
  refundAmount:  number;
  refundable:    boolean;
  purchaseType:  string;
}

function RefundModal({
  ticket,
  walletAddress,
  onClose,
  onSuccess,
}: {
  ticket:        NormalizedTicket;
  walletAddress: string;
  onClose:       () => void;
  onSuccess:     (ticketId: string) => void;
}) {
  const [preview,    setPreview]    = useState<RefundPreview | null>(null);
  const [reason,     setReason]     = useState("");
  const [loading,    setLoading]    = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const apiUrl = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");
  const token  = localStorage.getItem("auth_token");

  useEffect(() => {
    setLoading(true);
    fetch(`${apiUrl}/api/refunds/preview?ticketId=${ticket.ticketId}&walletAddress=${walletAddress}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setPreview(d);
      })
      .catch(() => setError("환불 정보를 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, []);

  const handleConfirm = async () => {
    if (!preview?.refundable) return;
    setSubmitting(true);
    setError(null);
    try {
      const res  = await fetch(`${apiUrl}/api/refunds`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ ticketId: ticket.ticketId, walletAddress, reason: reason || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "환불 처리에 실패했습니다."); return; }
      onSuccess(ticket.ticketId);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl p-6"
        style={{ background: "#fff", boxShadow: "0 24px 56px rgba(17,40,73,0.18)" }}
        onClick={e => e.stopPropagation()}>

        {/* 헤더 */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-[1.1rem]" style={{ color: "#14253f" }}>환불 신청</h3>
          <button onClick={onClose}><X className="w-5 h-5" style={{ color: "#9ca3af" }} /></button>
        </div>

        {loading && (
          <p className="text-center text-sm py-6" style={{ color: "#6d7d90" }}>환불 정보 조회 중...</p>
        )}

        {!loading && error && (
          <p className="text-center text-sm py-4" style={{ color: "#e53e3e" }}>{error}</p>
        )}

        {!loading && preview && (
          <>
            <div className="rounded-xl p-4 mb-4" style={{ background: "#f5f8fb", border: "1px solid #dbe4ed" }}>
              <div className="flex justify-between text-sm mb-2">
                <span style={{ color: "#6d7d90" }}>티켓 금액</span>
                <span style={{ color: "#14253f" }}>₩{Number(preview.originalPrice).toLocaleString("ko-KR")}</span>
              </div>
              <div className="flex justify-between text-sm mb-2">
                <span style={{ color: "#6d7d90" }}>구매 유형</span>
                <span style={{ color: "#14253f" }}>
                  {preview.purchaseType === "TRANSFERRED" ? "양도 구매" : "직접 구매"}
                </span>
              </div>
              <div className="flex justify-between text-sm mb-2">
                <span style={{ color: "#6d7d90" }}>환불 비율</span>
                <span style={{ color: preview.refundRate === 100 ? "#2dba73" : "#f59e0b" }}>
                  {preview.refundRate}%
                </span>
              </div>
              <div className="border-t mt-2 pt-2 flex justify-between font-bold">
                <span style={{ color: "#14253f" }}>환불 예상 금액</span>
                <span style={{ color: "#1456a0" }}>₩{Number(preview.refundAmount).toLocaleString("ko-KR")}</span>
              </div>
            </div>

            {preview.refundRate < 100 && (
              <p className="text-xs mb-3" style={{ color: "#f59e0b" }}>
                * 경기 3일 미만 잔여 시 10% 수수료가 부과됩니다.
              </p>
            )}

            {preview.refundable ? (
              <>
                <textarea
                  className="w-full rounded-xl p-3 text-sm mb-4 resize-none"
                  style={{ border: "1px solid #dbe4ed", background: "#f9fbfc", color: "#14253f", outline: "none" }}
                  placeholder="환불 사유 (선택)"
                  rows={2}
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                />
                {error && <p className="text-xs mb-3" style={{ color: "#e53e3e" }}>{error}</p>}
                <Button
                  className="w-full h-11 font-bold text-white rounded-xl"
                  style={{ background: "linear-gradient(135deg, #e53e3e, #c53030)" }}
                  disabled={submitting}
                  onClick={handleConfirm}
                >
                  {submitting ? "처리 중..." : "환불 확인"}
                </Button>
              </>
            ) : (
              <p className="text-center text-sm py-2" style={{ color: "#e53e3e" }}>
                현재 환불이 불가능한 상태입니다.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── 티켓 카드 ────────────────────────────────────────────

function TicketCard({
  ticket,
  walletAddress,
  index,
  onRefunded,
}: {
  ticket:        NormalizedTicket;
  walletAddress: string;
  index:         number;
  onRefunded:    (ticketId: string) => void;
}) {
  const [open,         setOpen]         = useState(false);
  const [showRefund,   setShowRefund]   = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 6) * 0.05 }}
    >
      <div
        className="relative cursor-pointer group"
        style={{ filter: ticket.status === "USED" ? "grayscale(0.6)" : "none" }}
        onClick={() => { if (ticket.status === "ACTIVE") setOpen((o) => !o); }}
      >
        <div className="relative rounded-2xl overflow-hidden"
          style={{
            border: `1px solid ${ticket.color}22`,
            background: "#ffffff",
            backdropFilter: "blur(20px)",
            boxShadow: "0 18px 48px rgba(17,40,73,0.08)",
          }}>

          {/* 홀로그램 스트립 */}
          <div className="h-2 w-full"
            style={{ background: `linear-gradient(90deg, ${ticket.color}, #7ec8ff, #2dba73, ${ticket.color})`, opacity: 0.9 }} />

          <div className="p-4">
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="soft-badge"
                    style={{ background: `${ticket.color}1f`, border: `1px solid ${ticket.color}`, color: ticket.color }}>
                    GAME PASS {ticket.ticketCode}
                  </span>
                </div>
                <h3 className="section-title truncate text-[1.06rem]" style={{ color: "#14253f" }}>
                  {ticket.matchName}
                </h3>
              </div>
              <div className="flex shrink-0 items-center gap-1 text-[0.76rem] font-semibold"
                style={{ color: ticket.status === "ACTIVE" ? "#00ff88" : "#a393d1" }}>
                {ticket.status === "ACTIVE"
                  ? <CheckCircle className="w-4 h-4" />
                  : <Clock className="w-4 h-4" />}
                {ticket.statusLabel}
              </div>
            </div>

            {/* 구분선 */}
            <div className="relative flex items-center my-3">
              <div className="w-4 h-4 rounded-full absolute -left-4 bg-[#f3f7fb]" />
              <div className="flex-1 border-t border-dashed" style={{ borderColor: `${ticket.color}33` }} />
              <div className="w-4 h-4 rounded-full absolute -right-4 bg-[#f3f7fb]" />
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div>
                <p className="page-stat-label mb-1">날짜</p>
                <div className="flex items-center gap-1 text-[0.92rem]" style={{ color: "#34465c" }}>
                  <Calendar className="w-3.5 h-3.5" style={{ color: ticket.color }} />
                  {formatMatchDate(ticket.matchTime)}
                </div>
              </div>
              <div>
                <p className="page-stat-label mb-1">구장</p>
                <div className="flex items-center gap-1 text-[0.9rem]" style={{ color: "#34465c" }}>
                  <MapPin className="w-3.5 h-3.5" style={{ color: ticket.color }} />
                  <span className="truncate">{ticket.stadium || "—"}</span>
                </div>
              </div>
              <div>
                <p className="page-stat-label mb-1">좌석</p>
                <p className="truncate text-[0.9rem]" style={{ color: "#34465c" }}>{ticket.seatInfo}</p>
              </div>
              <div>
                <p className="page-stat-label mb-1">등급</p>
                <p className="truncate text-[0.9rem]" style={{ color: "#34465c" }}>{ticket.gate}</p>
              </div>
              {ticket.price != null && (
                <div>
                  <p className="page-stat-label mb-1">금액</p>
                  <p className="text-[0.92rem] font-bold" style={{ color: ticket.color }}>
                    ₩{Number(ticket.price).toLocaleString("ko-KR")}
                  </p>
                </div>
              )}
            </div>

            {/* QR 패널 */}
            {open && ticket.status === "ACTIVE" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
              >
                <TicketQRPanel
                  ticketId={ticket.ticketId}
                  walletAddress={walletAddress}
                  status={ticket.status}
                  color={ticket.color}
                />
              </motion.div>
            )}

            {ticket.status === "ACTIVE" && (
              <div className="flex gap-2 mt-3">
                <Button
                  className="h-10 flex-1 rounded-xl font-bold text-white"
                  style={{
                    background: `linear-gradient(135deg, ${ticket.color}, #1e7fd0)`,
                    boxShadow: `0 10px 18px ${ticket.color}22`,
                  }}
                  onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
                >
                  {open ? "QR 닫기" : "QR 코드 보기"}
                </Button>
                <Button
                  className="h-10 px-4 rounded-xl font-bold"
                  style={{ background: "#fff5f5", border: "1px solid #feb2b2", color: "#c53030" }}
                  onClick={(e) => { e.stopPropagation(); setShowRefund(true); }}
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {showRefund && (
        <RefundModal
          ticket={ticket}
          walletAddress={walletAddress}
          onClose={() => setShowRefund(false)}
          onSuccess={(id) => { setShowRefund(false); onRefunded(id); }}
        />
      )}
    </motion.div>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────

export function MyTickets() {
  const { walletAddress } = useAppSettings();
  const [ticketView, setTicketView] = useState<"active" | "completed">("active");
  const [apiTickets, setApiTickets] = useState<NormalizedTicket[]>([]);
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [ticketSort, setTicketSort] = useState<TicketSort>("latest");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const fetchTickets = useCallback(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) return;
    const apiBase = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");
    fetch(`${apiBase}/api/my-tickets`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setApiTickets(data.data.map(normalizeApiTicket).filter(isDisplayableTicket));
      })
      .catch((err) => console.error("내 티켓 조회 실패:", err));
  }, []);

  // 초기 로드
  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  // ACTIVE 티켓이 있을 때 10초마다 폴링 (QR 스캔 후 자동 갱신)
  const hasActive = apiTickets.some((t) => t.status === "ACTIVE");
  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(fetchTickets, 10_000);
    return () => clearInterval(id);
  }, [hasActive, fetchTickets]);

  const handleRefunded = useCallback((ticketId: string) => {
    setApiTickets(prev => prev.filter(t => t.ticketId !== ticketId));
  }, []);

  const visibleTickets = useMemo(
    () => apiTickets.filter((t) =>
      ticketView === "active" ? t.status === "ACTIVE" : t.status === "USED",
    ),
    [ticketView, apiTickets],
  );

  const monthOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    visibleTickets.forEach((ticket) => {
      const monthKey = getMonthKey(ticket.matchTime);
      optionMap.set(monthKey, formatMonthLabel(monthKey));
    });

    return Array.from(optionMap.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((left, right) => right.key.localeCompare(left.key));
  }, [visibleTickets]);

  useEffect(() => {
    if (selectedMonth !== "all" && !monthOptions.some((option) => option.key === selectedMonth)) {
      setSelectedMonth("all");
    }
  }, [monthOptions, selectedMonth]);

  useEffect(() => {
    setExpandedGroups({});
  }, [ticketView, selectedMonth, ticketSort]);

  const monthFilteredTickets = useMemo(
    () =>
      selectedMonth === "all"
        ? visibleTickets
        : visibleTickets.filter((ticket) => getMonthKey(ticket.matchTime) === selectedMonth),
    [selectedMonth, visibleTickets],
  );

  const ticketGroups = useMemo(
    () => groupTicketsByGame(monthFilteredTickets, ticketSort),
    [monthFilteredTickets, ticketSort],
  );

  const activeCount    = apiTickets.filter((t) => t.status === "ACTIVE").length;
  const completedCount = apiTickets.filter((t) => t.status === "USED").length;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="page-eyebrow text-[#1456a0] mb-3">Pass</p>
          <h1 className="page-title mb-3" style={{ color: "#14253f" }}>내 입장권</h1>
          <p className="page-subtitle" style={{ color: "#55657d" }}>QR 입장권을 빠르게 찾고, 필요한 티켓만 펼쳐서 확인할 수 있어요.</p>
        </div>
      </div>

      {/* 탭 */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {[
            { key: "active"    as const, label: `사용 가능 (${activeCount})` },
            { key: "completed" as const, label: `관람 완료 (${completedCount})` },
          ].map((item) => {
            const active = ticketView === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTicketView(item.key)}
                className="rounded-[14px] px-4 py-2.5 text-sm font-semibold transition-all"
                style={{
                  background:   active ? "#e8eef6" : "#f5f8fb",
                  border:       active ? "1px solid #bfd0e2" : "1px solid #dbe4ed",
                  color:        active ? "#23425f" : "#6d7d90",
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        <p className="text-[0.84rem]" style={{ color: "#6d7d90" }}>
          {ticketView === "active"
            ? "환불된 입장권은 목록에서 제외하고, 사용할 수 있는 티켓만 보여줍니다."
            : "입장 처리되었거나 사용 시간이 지난 티켓을 따로 모아 봅니다."}
        </p>
      </div>

      {visibleTickets.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedMonth("all")}
              className="rounded-full px-4 py-2 text-sm font-semibold transition-all"
              style={{
                background: selectedMonth === "all" ? "#23425f" : "#f5f8fb",
                border: "1px solid #dbe4ed",
                color: selectedMonth === "all" ? "#ffffff" : "#6d7d90",
              }}
            >
              전체
            </button>
            {monthOptions.map((option) => (
              <button
                key={option.key}
                onClick={() => setSelectedMonth(option.key)}
                className="rounded-full px-4 py-2 text-sm font-semibold transition-all"
                style={{
                  background: selectedMonth === option.key ? "#23425f" : "#f5f8fb",
                  border: "1px solid #dbe4ed",
                  color: selectedMonth === option.key ? "#ffffff" : "#6d7d90",
                }}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="flex items-center rounded-[14px] p-1" style={{ background: "#eef3f8", border: "1px solid #dbe4ed" }}>
            {[
              { key: "latest" as const, label: "최신순" },
              { key: "oldest" as const, label: "오래된 순" },
            ].map((option) => (
              <button
                key={option.key}
                onClick={() => setTicketSort(option.key)}
                className="rounded-[10px] px-3.5 py-1.5 text-sm font-semibold transition-all"
                style={{
                  background: ticketSort === option.key ? "#ffffff" : "transparent",
                  color: ticketSort === option.key ? "#23425f" : "#6d7d90",
                  boxShadow: ticketSort === option.key ? "0 8px 18px rgba(17,40,73,0.08)" : "none",
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 빈 상태 */}
      {monthFilteredTickets.length === 0 && (
        <div className="rounded-[24px] px-6 py-10 text-center mb-6"
          style={{ background: "#f8fbfd", border: "1px solid #d8e3ec", boxShadow: "0 12px 28px rgba(17,40,73,0.05)" }}>
          <p className="text-[1rem] font-semibold" style={{ color: "#21354b" }}>
            {ticketView === "active" ? "현재 사용 가능한 입장권이 없어요." : "아직 관람 완료된 입장권이 없어요."}
          </p>
        </div>
      )}

      {/* 티켓 목록 */}
      <div className="space-y-4">
        {ticketGroups.map((group) => {
          const expanded = expandedGroups[group.key] ?? false;
          const shownTickets = expanded ? group.tickets : group.tickets.slice(0, 3);
          const hiddenCount = group.tickets.length - shownTickets.length;

          return (
            <section
              key={group.key}
              className="rounded-[24px] p-4"
              style={{ background: "rgba(248,251,253,0.86)", border: "1px solid #d8e3ec", boxShadow: "0 12px 28px rgba(17,40,73,0.05)" }}
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="page-stat-label mb-1">{group.monthLabel}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[1.05rem] font-bold" style={{ color: "#14253f" }}>{group.matchName}</h2>
                    <span className="rounded-full px-2.5 py-1 text-xs font-bold"
                      style={{ background: "#e8eef6", color: "#23425f" }}>
                      {group.tickets.length}장
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm" style={{ color: "#6d7d90" }}>
                    {group.date} · {group.stadium || "구장 정보 없음"}
                  </p>
                </div>

                {group.tickets.length > 3 && (
                  <button
                    className="flex items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold transition-all"
                    style={{ background: "#ffffff", border: "1px solid #dbe4ed", color: "#23425f" }}
                    onClick={() =>
                      setExpandedGroups((current) => ({
                        ...current,
                        [group.key]: !expanded,
                      }))
                    }
                  >
                    {expanded ? "접기" : `${hiddenCount}장 더 보기`}
                    <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </button>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {shownTickets.map((ticket, i) => (
                  <TicketCard
                    key={ticket.ticketId}
                    ticket={ticket}
                    walletAddress={walletAddress ?? ""}
                    index={i}
                    onRefunded={handleRefunded}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
