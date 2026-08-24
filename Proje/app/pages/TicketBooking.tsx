import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  AlertCircle,
  Armchair,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Info,
  LayoutGrid,
  Loader2,
  MapPin,
  Receipt,
  ShieldCheck,
  Ticket,
  Wallet,
} from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Button } from "../components/ui/button";
import {
  buildEventFromApiGame,
  createStoredTickets,
  getTicketEvent,
  loadStoredTickets,
  seatTicketTypes,
  type SeatBlock,
  type SeatGrade,
  type SeatTicketTypeId,
  type StoredTicketRecord,
  type TicketEvent,
} from "../data/ticketing";
import { useAppSettings } from "../context/AppSettingsContext";
import { loadTossPayments, ANONYMOUS } from "@tosspayments/tosspayments-sdk";
import { useBookingAccess, ACCESS_MESSAGES } from "../hooks/useBookingAccess";

function formatPrice(value: number) {
  return `₩${Number(value).toLocaleString("ko-KR")}`;
}

function parseSeatKey(seatKey: string) {
  const [row, seatNumber] = seatKey.split("-").map(Number);
  return { row, seatNumber };
}

const steps = [
  { id: 0, label: "구역 선택", icon: LayoutGrid },
  { id: 1, label: "좌석 선택", icon: Armchair },
  { id: 2, label: "권종 확인", icon: Receipt },
  { id: 3, label: "결제", icon: Wallet },
] as const;

type TossState = "idle" | "loading" | "ready" | "error" | "paying" | "minting";

const mapBlockBadgePositions: Record<string, CSSProperties> = {
  "jamsil-blue": { left: "18%", top: "47%" },
  "jamsil-table": { left: "50%", top: "24%", transform: "translateX(-50%)" },
  "jamsil-red": { right: "18%", top: "47%" },
  "jamsil-outfield": { left: "50%", bottom: "29%", transform: "translateX(-50%)" },
  "sajik-central": { left: "50%", top: "24%", transform: "translateX(-50%)" },
  "sajik-outfield": { left: "50%", bottom: "29%", transform: "translateX(-50%)" },
  "incheon-red": { left: "18%", top: "47%" },
  "incheon-navy": { left: "50%", top: "24%", transform: "translateX(-50%)" },
};

const blockLocatorMeta: Record<
  string,
  { areaLabel: string; guide: string; viewHint: string; orientation: string }
> = {
  "jamsil-blue-116": {
    areaLabel: "1루 응원석 안쪽 상단",
    guide: "홈플레이트 기준 왼쪽 상단에서 응원단과 가까운 쪽입니다.",
    viewHint: "응원 분위기가 가장 빠르게 붙는 대표 블록",
    orientation: "1루 · 내야",
  },
  "jamsil-blue-115": {
    areaLabel: "1루 응원석 중앙",
    guide: "116블록보다 중앙 쪽으로 붙어 있어 시야와 응원 밸런스가 좋습니다.",
    viewHint: "응원과 시야 균형이 좋은 구간",
    orientation: "1루 · 내야",
  },
  "jamsil-blue-114": {
    areaLabel: "1루 응원석 중앙 하단",
    guide: "홈플레이트에 조금 더 가까워 선수 동선이 잘 보이는 편입니다.",
    viewHint: "시야가 상대적으로 안정적인 블록",
    orientation: "1루 · 내야",
  },
  "jamsil-blue-216": {
    areaLabel: "1루 응원석 외곽",
    guide: "1루 응원 구역의 바깥쪽 라인으로, 통로 접근이 빠른 편입니다.",
    viewHint: "출입 동선이 편한 바깥쪽 블록",
    orientation: "1루 · 내야",
  },
  "jamsil-table-t1": {
    areaLabel: "중앙 테이블석 왼쪽",
    guide: "포수 뒤 테이블 존에서 1루 쪽에 가까운 자리입니다.",
    viewHint: "먹거리 이동 동선이 편한 프리미엄 좌석",
    orientation: "중앙 · 테이블",
  },
  "jamsil-table-t2": {
    areaLabel: "중앙 테이블석 오른쪽",
    guide: "포수 뒤 테이블 존에서 3루 쪽에 가까운 자리입니다.",
    viewHint: "포수 뒤 시야가 안정적인 프리미엄 좌석",
    orientation: "중앙 · 테이블",
  },
  "jamsil-red-208": {
    areaLabel: "3루 레드석 안쪽",
    guide: "3루 레드 구역 중에서도 홈플레이트 쪽에 더 가까운 블록입니다.",
    viewHint: "내야 시야를 보기 편한 3루 블록",
    orientation: "3루 · 내야",
  },
  "jamsil-red-209": {
    areaLabel: "3루 레드석 바깥쪽",
    guide: "208블록보다 외야 쪽으로 한 칸 더 나간 위치입니다.",
    viewHint: "출입 동선이 빠른 3루 외곽 블록",
    orientation: "3루 · 내야",
  },
  "jamsil-outfield-401": {
    areaLabel: "외야 그린석 왼쪽",
    guide: "외야석 중 1루 쪽에 가까운 블록으로 홈런볼 구간에 가깝습니다.",
    viewHint: "응원보다 여유 있게 보기 좋은 외야 블록",
    orientation: "외야 · 1루 방향",
  },
  "jamsil-outfield-402": {
    areaLabel: "외야 그린석 오른쪽",
    guide: "외야석 중 3루 쪽에 가까운 블록으로 바람 영향을 조금 더 받는 편입니다.",
    viewHint: "외야 전경이 넓게 보이는 바깥 블록",
    orientation: "외야 · 3루 방향",
  },
};

const blockFlowMeta: Record<string, { startLabel: string; endLabel: string }> = {
  "jamsil-blue": { startLabel: "홈플레이트 쪽", endLabel: "1루 외곽 쪽" },
  "jamsil-table": { startLabel: "1루 방향", endLabel: "3루 방향" },
  "jamsil-red": { startLabel: "홈플레이트 쪽", endLabel: "3루 외곽 쪽" },
  "jamsil-outfield": { startLabel: "1루 쪽 외야", endLabel: "3루 쪽 외야" },
  "sajik-central": { startLabel: "중앙 왼쪽", endLabel: "중앙 오른쪽" },
  "sajik-outfield": { startLabel: "외야 왼쪽", endLabel: "외야 오른쪽" },
  "incheon-red": { startLabel: "내야 안쪽", endLabel: "내야 바깥쪽" },
  "incheon-navy": { startLabel: "중앙 왼쪽", endLabel: "중앙 오른쪽" },
};

const PRIORITY_GRADE_ID = "jamsil-table";
const PRIORITY_ROW = 5;
const PRIORITY_SEAT_NUMS = new Set([2, 3, 4, 5, 6]);

export function TicketBooking() {
  const { eventId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { walletAddress, connectWallet } = useAppSettings();
  const accessStatus = useBookingAccess();
  const isPriorityMode = searchParams.get("mode") === "priority";
  const priorityEntryId = searchParams.get("entryId") ?? "";

  // 로컬 이벤트 먼저 시도, 없으면 API에서 게임 정보 가져와서 템플릿으로 변환
  const [event, setEvent] = useState<TicketEvent | undefined>(() => getTicketEvent(eventId));
  const [eventLoading, setEventLoading] = useState(!getTicketEvent(eventId));
  const [bookingOpenAt, setBookingOpenAt] = useState<Date | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL}/api/tickets/games/${eventId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          if (data.data.booking_open_at) setBookingOpenAt(new Date(data.data.booking_open_at));
          if (!getTicketEvent(eventId)) setEvent(buildEventFromApiGame(data.data));
        }
      })
      .catch((err) => console.error("[TicketBooking] 경기 조회 실패:", err))
      .finally(() => setEventLoading(false));
  }, [eventId]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const [currentStep, setCurrentStep] = useState(0);
  const [selectedGradeId, setSelectedGradeId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedSeatKeys, setSelectedSeatKeys] = useState<string[]>([]);
  const [ticketTypesBySeat, setTicketTypesBySeat] = useState<Record<string, SeatTicketTypeId>>({});
  const [storedTickets, setStoredTickets] = useState<StoredTicketRecord[]>(() => loadStoredTickets());
  const [serverTakenSeats, setServerTakenSeats] = useState<Set<string>>(new Set());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [paymentWidgets, setPaymentWidgets] = useState<any>(null);
  const [widgetReady, setWidgetReady] = useState(false);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const [widgetRetryKey, setWidgetRetryKey] = useState(0);
  const [paymentLoading, setPaymentLoading] = useState(false);

  // ─── 포인트 할인 ─────────────────────────────────────────
  const [pointBalance, setPointBalance]   = useState<number | null>(null);
  const [pointInput, setPointInput]       = useState("");
  const [pointDiscount, setPointDiscount] = useState(0);
  const [pointApplied, setPointApplied]   = useState(false);
  const [pointError, setPointError]       = useState<string | null>(null);

  const base      = import.meta.env.VITE_API_URL;
  const authToken = () => localStorage.getItem("auth_token") || "";

  useEffect(() => {
    setStoredTickets(loadStoredTickets());
  }, []);

  // 백엔드에서 예약된 좌석 조회
  useEffect(() => {
    if (!eventId) return;
    fetch(`${import.meta.env.VITE_API_URL}/api/tickets/seats/${eventId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setServerTakenSeats(new Set(data.data));
      })
      .catch(() => {});
  }, [eventId]);

  useEffect(() => {
    setTicketTypesBySeat((previous) => {
      const next: Record<string, SeatTicketTypeId> = {};
      selectedSeatKeys.forEach((seatKey) => {
        next[seatKey] = previous[seatKey] ?? "adult";
      });
      return next;
    });
  }, [selectedSeatKeys]);

  useEffect(() => {
    if (!isPriorityMode || !event) return;
    const tableGrade = event.seatGrades.find((grade) => grade.id === PRIORITY_GRADE_ID);
    if (!tableGrade) return;
    setSelectedGradeId(PRIORITY_GRADE_ID);
    setSelectedBlockId(tableGrade.blocks[0]?.id ?? null);
    setSelectedSeatKeys([]);
  }, [isPriorityMode, event]);

  const selectedGrade = useMemo(
    () => event?.seatGrades.find((grade) => grade.id === selectedGradeId) ?? null,
    [event, selectedGradeId],
  );

  const selectedBlock = useMemo(
    () => selectedGrade?.blocks.find((block) => block.id === selectedBlockId) ?? null,
    [selectedGrade, selectedBlockId],
  );

  const selectedBlockLocator = useMemo(
    () => (selectedBlock ? blockLocatorMeta[selectedBlock.id] ?? null : null),
    [selectedBlock],
  );

  const takenSeatKeys = useMemo(() => {
    if (!event) return new Set<string>();

    const taken = [
      ...storedTickets
        .filter((ticket) => ticket.eventId === event.id)
        .map((ticket) => `${ticket.blockLabel}:${ticket.row}-${ticket.seatNumber}`),
      ...serverTakenSeats,
    ];

    selectedGrade?.blocks.forEach((block) => {
      block.disabledSeats?.forEach((seatKey) => {
        taken.push(`${block.label}:${seatKey}`);
      });
    });

    return new Set(taken);
  }, [event, storedTickets, selectedGrade, serverTakenSeats]);

  const selectedTickets = useMemo(() => {
    if (!selectedBlock || !selectedGrade) return [];

    return selectedSeatKeys.map((seatKey) => {
      const parsed = parseSeatKey(seatKey);
      const ticketType =
        seatTicketTypes.find((item) => item.id === ticketTypesBySeat[seatKey]) ?? seatTicketTypes[0];

      return {
        key: seatKey,
        row: parsed.row,
        seatNumber: parsed.seatNumber,
        ticketType,
        blockLabel: selectedBlock.label,
        price: Math.round(selectedGrade.price * ticketType.multiplier),
      };
    });
  }, [selectedBlock, selectedGrade, selectedSeatKeys, ticketTypesBySeat]);

  // 권종/결제 단계 진입 시 포인트 잔액 조회
  useEffect(() => {
    if (currentStep < 2 || !walletAddress) return;
    fetch(`${base}/api/points?walletAddress=${walletAddress}`, {
      headers: { Authorization: `Bearer ${authToken()}` },
    })
      .then((r) => r.json())
      .then((d) => { if (d.data?.balance !== undefined) setPointBalance(d.data.balance); })
      .catch(() => {});
  }, [currentStep, walletAddress, base]);

  const applyPoint = () => {
    setPointError(null);
    const amount = parseInt(pointInput.replace(/,/g, ""), 10);
    if (isNaN(amount) || amount <= 0) { setPointError("올바른 포인트를 입력하세요"); return; }
    if (amount < 1000) { setPointError("최소 1,000P 이상 사용 가능합니다"); return; }
    if (pointBalance !== null && amount > pointBalance) {
      setPointError(`보유 포인트가 부족합니다 (잔액: ${pointBalance.toLocaleString()}P)`); return;
    }
    const maxDiscount = ticketTotal + Math.round(ticketTotal * 0.03);
    if (amount > maxDiscount) { setPointError("총 결제금액을 초과할 수 없습니다"); return; }
    setPointDiscount(amount);
    setPointApplied(true);
  };

  const cancelPoint = () => {
    setPointDiscount(0);
    setPointApplied(false);
    setPointInput("");
    setPointError(null);
  };

  const ticketTotal = selectedTickets.reduce((sum, ticket) => sum + ticket.price, 0);
  const serviceFee = Math.round(ticketTotal * 0.03); // 3% 서비스 이용료
  const finalTotal = Math.max(0, ticketTotal + serviceFee - pointDiscount);
  const tossAmount = Math.max(0, Math.round(finalTotal));
  const paymentReady = selectedTickets.length > 0;
  const maxSelectableTickets = isPriorityMode ? 1 : (event?.maxTickets ?? 4);
  const bookingDeadlinePassed = event
    ? nowMs > new Date(event.dateTime).getTime() + 60 * 60 * 1000
    : false;
  const bookingStatusLabel = bookingDeadlinePassed ? "지난 경기" : event?.status ?? "";
  const bookingStatusColor = bookingDeadlinePassed ? "#64748b" : event?.statusColor ?? "#1456a0";
  const canPickSeats = Boolean(selectedGrade && selectedBlock) && !bookingDeadlinePassed;
  const canConfirmTypes = selectedSeatKeys.length > 0 && !bookingDeadlinePassed;
  const canEnterPayment = paymentReady && !bookingDeadlinePassed;
  const tossState: TossState =
    currentStep !== 3
      ? "idle"
      : paymentLoading
      ? "paying"
      : widgetError
      ? "error"
      : widgetReady
      ? "ready"
      : "loading";

  const summaryCta = (() => {
    if (currentStep === 0) {
      return {
        label: bookingDeadlinePassed ? "예매 마감" : canPickSeats ? "좌석 선택으로" : "구역을 선택하세요",
        disabled: !canPickSeats,
        onClick: () => updateStep(1),
      };
    }
    if (currentStep === 1) {
      return {
        label: bookingDeadlinePassed ? "예매 마감" : canConfirmTypes ? "권종 확인으로" : "좌석을 선택하세요",
        disabled: !canConfirmTypes,
        onClick: () => updateStep(2),
      };
    }
    if (currentStep === 2) {
      return {
        label: canEnterPayment ? "결제로 이동" : bookingDeadlinePassed ? "예매 마감" : "좌석을 선택하세요",
        disabled: !canEnterPayment,
        onClick: () => updateStep(3),
      };
    }
    return {
      label:
        tossState === "paying"
          ? "승인 중..."
          : tossState === "error"
          ? "다시 시도"
          : tossState !== "ready"
          ? "결제 수단 로딩 중..."
          : `${formatPrice(finalTotal)} 결제하기`,
      disabled: (tossState !== "ready" && tossState !== "error") || bookingDeadlinePassed,
      onClick: () => {
        if (tossState === "error") setWidgetRetryKey((key) => key + 1);
        else void handleCompleteBooking();
      },
    };
  })();

  const updateStep = (nextStep: number) => {
    setCurrentStep(Math.max(0, Math.min(nextStep, steps.length - 1)));
  };

  const handleSelectGrade = (grade: SeatGrade) => {
    if (bookingDeadlinePassed) return;
    if (isPriorityMode && grade.id !== PRIORITY_GRADE_ID) return;
    setSelectedGradeId(grade.id);
    setSelectedBlockId(grade.blocks[0]?.id ?? null);
    setSelectedSeatKeys([]);
  };

  const handleSelectBlock = (block: SeatBlock) => {
    if (bookingDeadlinePassed) return;
    setSelectedBlockId(block.id);
    setSelectedSeatKeys([]);
  };

  const toggleSeat = (seatKey: string) => {
    if (bookingDeadlinePassed) return;
    if (!selectedBlock) return;

    const compoundKey = `${selectedBlock.label}:${seatKey}`;
    if (takenSeatKeys.has(compoundKey)) return;
    if (isPriorityMode) {
      const { row, seatNumber } = parseSeatKey(seatKey);
      if (!(row === PRIORITY_ROW && PRIORITY_SEAT_NUMS.has(seatNumber))) return;
    }

    setSelectedSeatKeys((previous) => {
      if (previous.includes(seatKey)) {
        return previous.filter((item) => item !== seatKey);
      }

      if (isPriorityMode) {
        return [seatKey];
      }

      if (previous.length >= maxSelectableTickets) {
        return previous;
      }

      return [...previous, seatKey].sort((left, right) => {
        const leftSeat = parseSeatKey(left);
        const rightSeat = parseSeatKey(right);
        if (leftSeat.row !== rightSeat.row) return leftSeat.row - rightSeat.row;
        return leftSeat.seatNumber - rightSeat.seatNumber;
      });
    });
  };

  // ─── Toss 위젯 초기화 (결제 단계 진입 시 한 번만 렌더링) ───────
  useEffect(() => {
    if (currentStep !== 3 || !paymentReady || tossAmount <= 0) return;
    let cancelled = false;
    setWidgetReady(false);
    setPaymentWidgets(null);
    setWidgetError(null);

    (async () => {
      try {
        const paymentWidgetElement = document.querySelector("#toss-payment-widget");
        const agreementWidgetElement = document.querySelector("#toss-agreement-widget");
        if (paymentWidgetElement) paymentWidgetElement.innerHTML = "";
        if (agreementWidgetElement) agreementWidgetElement.innerHTML = "";

        const clientKey = (import.meta.env.VITE_TOSS_CLIENT_KEY as string | undefined)?.trim();
        if (!clientKey) {
          throw new Error("VITE_TOSS_CLIENT_KEY가 설정되어 있지 않습니다.");
        }
        const tossPayments = await loadTossPayments(clientKey);
        if (cancelled) return;
        const widgets = tossPayments.widgets({ customerKey: ANONYMOUS });
        await widgets.setAmount({ value: tossAmount, currency: "KRW" });
        if (cancelled) return;
        await widgets.renderPaymentMethods({ selector: "#toss-payment-widget", variantKey: "DEFAULT" });
        await widgets.renderAgreement({ selector: "#toss-agreement-widget", variantKey: "AGREEMENT" });
        if (!cancelled) {
          setPaymentWidgets(widgets);
          setWidgetReady(true);
        }
      } catch (err) {
        console.error("[TossPayment] 위젯 초기화 실패:", err);
        if (!cancelled) {
          setWidgetError(err instanceof Error ? err.message : "결제 위젯 초기화에 실패했습니다.");
        }
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, paymentReady, widgetRetryKey]);

  // 권종/포인트 변경 시 렌더링된 위젯의 금액만 갱신
  useEffect(() => {
    if (!paymentWidgets || !widgetReady || tossAmount <= 0) return;
    paymentWidgets
      .setAmount({ value: tossAmount, currency: "KRW" })
      .then(() => setWidgetError(null))
      .catch((err: unknown) => {
        console.error("[TossPayment] 위젯 금액 변경 실패:", err);
        setWidgetError(err instanceof Error ? err.message : "결제 금액 변경 중 위젯 오류가 발생했습니다.");
      });
  }, [paymentWidgets, widgetReady, tossAmount]);

  const handleCompleteBooking = async () => {
    if (!selectedGrade || !selectedBlock || !paymentReady || !paymentWidgets) return;
    setPaymentLoading(true);
    try {
      // 지갑 주소 확보 (MetaMask — NFT 민팅 대상 주소)
      if (!walletAddress) {
        const ok = await connectWallet();
        if (!ok) throw new Error("지갑 연결이 필요합니다.");
      }
      const accounts = (await window.ethereum!.request({ method: "eth_accounts" })) as string[];
      const address = accounts[0];
      if (!address) throw new Error("지갑 주소를 가져올 수 없습니다.");

      // 주문 정보 저장 (성공 페이지에서 서버 컨펌 시 사용)
      const orderId = crypto.randomUUID();
      sessionStorage.setItem(
        `toss_order_${orderId}`,
        JSON.stringify({
          walletAddress: address,
          gameId:        event.id,
          eventName:     event.name,
          stadium:       event.stadium,
          grade:         selectedGrade.name,
          block:         selectedBlock.label,
          gate:          selectedBlock.gate,
          seats: selectedTickets.map((t) => ({
            row:            t.row,
            seatNumber:     t.seatNumber,
            price:          t.price,
            ticketTypeLabel: t.ticketType.label,
          })),
          pointDiscount,
          finalTotal,
          bookingMode: isPriorityMode ? "priority" : "normal",
          priorityEntryId,
        }),
      );

      await paymentWidgets.requestPayment({
        orderId,
        orderName:
          selectedTickets.length > 1
            ? `${event.name} 외 ${selectedTickets.length - 1}매`
            : event.name,
        successUrl: `${window.location.origin}/tickets/booking/success`,
        failUrl:    `${window.location.origin}/tickets/booking/fail`,
      });
      // requestPayment는 브라우저를 토스 결제 페이지로 리다이렉트함
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "결제 요청 중 오류가 발생했습니다.";
      alert(msg);
    } finally {
      setPaymentLoading(false);
    }
  };

  const seatRows = selectedBlock
    ? Array.from({ length: selectedBlock.rows }, (_, rowIndex) => rowIndex + 1)
    : [];
  const seatColumns = selectedBlock
    ? Array.from({ length: selectedBlock.seatsPerRow }, (_, seatIndex) => seatIndex + 1)
    : [];

  // 접근 권한 체크
  if (accessStatus === "checking") {
    return (
      <div className="page-shell flex items-center justify-center min-h-[40vh]">
        <p className="text-[0.95rem]" style={{ color: "#8a9ab0" }}>인증 상태 확인 중...</p>
      </div>
    );
  }

  if (eventLoading) {
    return (
      <div className="page-shell flex items-center justify-center min-h-[40vh]">
        <p className="text-[0.95rem]" style={{ color: "#8a9ab0" }}>경기 정보를 불러오는 중...</p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="page-shell flex items-center justify-center min-h-[40vh]">
        <p className="text-[0.95rem]" style={{ color: "#8a9ab0" }}>예매할 경기를 찾지 못했습니다.</p>
      </div>
    );
  }

  if (bookingOpenAt && bookingOpenAt.getTime() > nowMs && !isPriorityMode) {
    const diff = Math.max(0, bookingOpenAt.getTime() - nowMs);
    const totalMin = Math.floor(diff / 60000);
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor(totalMin / 60) % 24;
    const mins = totalMin % 60;
    const openLabel = bookingOpenAt.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })
      + " "
      + bookingOpenAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

    return (
      <div className="page-shell flex items-center justify-center min-h-[55vh]">
        <div className="w-full max-w-md rounded-[28px] border px-8 py-10 text-center" style={{ background: "#fff", borderColor: "#d7e0e8", boxShadow: "0 20px 48px rgba(17,40,73,0.08)" }}>
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "#eef4ff" }}>
            <Clock3 className="h-8 w-8" style={{ color: "#1456a0" }} />
          </div>
          <h2 className="mb-2 text-[1.25rem] font-black" style={{ color: "#14253f" }}>예매 오픈 전입니다</h2>
          <p className="mb-6 text-[0.9rem]" style={{ color: "#55657d" }}>
            일반 예매 오픈: <strong style={{ color: "#1456a0" }}>{openLabel}</strong>
          </p>
          <div className="mb-6 grid grid-cols-3 gap-3">
            {[
              { label: "일", value: days },
              { label: "시간", value: hours },
              { label: "분", value: mins },
            ].map((item) => (
              <div key={item.label} className="rounded-[16px] px-4 py-4" style={{ background: "#eef4ff", border: "1px solid #bfdbfe" }}>
                <p className="text-[1.6rem] font-black leading-none" style={{ color: "#1456a0" }}>{String(item.value).padStart(2, "0")}</p>
                <p className="mt-1 text-[0.72rem] font-semibold" style={{ color: "#6d8aaa" }}>{item.label}</p>
              </div>
            ))}
          </div>
          <Button className="rounded-[14px] bg-[#1456a0] px-6 text-white" onClick={() => navigate("/tickets")}>
            경기 목록으로 돌아가기
          </Button>
        </div>
      </div>
    );
  }

  if (accessStatus !== "ok") {
    const msg = ACCESS_MESSAGES[accessStatus];
    return (
      <div className="page-shell flex items-center justify-center min-h-[50vh]">
        <div
          className="rounded-[28px] border p-8 max-w-md w-full text-center"
          style={{ background: "#f5f8fb", borderColor: "#d7e0e8", boxShadow: "0 12px 32px rgba(17,40,73,0.07)" }}
        >
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5"
            style={{ background: "#e8eef6" }}
          >
            <ShieldCheck className="w-7 h-7" style={{ color: "#1456a0" }} />
          </div>
          <h2 className="text-[1.15rem] font-bold mb-2" style={{ color: "#14253f" }}>{msg.title}</h2>
          <p className="text-[0.92rem] leading-7 mb-6" style={{ color: "#55657d" }}>{msg.desc}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => navigate(-1)}
              className="rounded-xl px-5 py-2.5 text-[0.9rem] font-semibold border"
              style={{ borderColor: "#d7e0e8", color: "#55657d", background: "#fff" }}
            >
              돌아가기
            </button>
            <button
              onClick={() => navigate(msg.href)}
              className="rounded-xl px-5 py-2.5 text-[0.9rem] font-semibold text-white"
              style={{ background: "linear-gradient(135deg, #1456a0, #1e7fd0)" }}
            >
              {msg.action}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/tickets")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border"
            style={{ borderColor: "#d3dde6", background: "#f5f7fa", color: "#4d6179" }}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <p className="page-eyebrow mb-2 text-[#1456a0]">Ticketing Flow</p>
            <h1 className="page-title mb-2" style={{ color: "#14253f" }}>
              좌석 선택
            </h1>
            <p className="page-subtitle" style={{ color: "#586981" }}>
              {event.stadium} 좌석도, 블록, 좌석번호, 가격 확인까지 한 번에 이어집니다.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6">
          <section
            className="rounded-[30px] border p-6"
            style={{ background: "#eef3f7", borderColor: "#d5dee7", boxShadow: "0 18px 42px rgba(17,40,73,0.06)" }}
          >
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[0.76rem] font-semibold"
                  style={{ borderColor: `${bookingStatusColor}55`, background: `${bookingStatusColor}14`, color: bookingStatusColor }}>
                  <Clock3 className="h-3.5 w-3.5" />
                  {bookingStatusLabel}
                </div>
                <div>
                  <h2 className="text-[1.55rem] font-bold tracking-[-0.04em]" style={{ color: "#122239" }}>
                    {event.name}
                  </h2>
                  <div className="mt-3 flex flex-wrap gap-4 text-[0.93rem]" style={{ color: "#5d6f86" }}>
                    <span className="inline-flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-[#1456a0]" />
                      {event.date}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-[#2dba73]" />
                      {event.venue}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <Ticket className="h-4 w-4 text-[#d99d4d]" />
                      최저 {formatPrice(event.price)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border px-5 py-4 text-right"
                style={{ background: "rgba(255,255,255,0.72)", borderColor: "#d6e0e8" }}>
                <p className="text-[0.78rem] font-semibold uppercase tracking-[0.24em]" style={{ color: "#7f90a5" }}>
                  {bookingDeadlinePassed ? "예매 상태" : "예매 규칙"}
                </p>
                <p className="mt-2 text-[0.95rem] font-semibold" style={{ color: "#162840" }}>
                  {bookingDeadlinePassed ? "예매가 마감된 경기입니다" : `회차당 최대 ${maxSelectableTickets}매`}
                </p>
                <p className="mt-1 text-[0.86rem]" style={{ color: "#5e7088" }}>
                  {bookingDeadlinePassed
                    ? "경기 시작 1시간 이후에는 좌석 선택과 결제를 진행할 수 없습니다."
                    : "공식 재판매 마켓만 연동되고 좌석 선택 후 5분 안에 결제를 완료해야 합니다."}
                </p>
              </div>
            </div>
          </section>

          <section className="grid gap-3 md:grid-cols-4">
            {steps.map((step) => {
              const Icon = step.icon;
              const active = currentStep === step.id;
              const completed = currentStep > step.id;

              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => {
                    if (step.id === 0) updateStep(step.id);
                    if (step.id === 1 && canPickSeats) updateStep(step.id);
                    if (step.id === 2 && selectedSeatKeys.length > 0) updateStep(step.id);
                    if (step.id === 3 && canEnterPayment) updateStep(step.id);
                  }}
                  className="rounded-[22px] border px-4 py-4 text-left transition"
                  style={{
                    background: active ? "#ffffff" : "#eef3f7",
                    borderColor: active ? "#8ab0d6" : completed ? "#9cd3b3" : "#d4dde6",
                    boxShadow: active ? "0 12px 24px rgba(17,40,73,0.08)" : "none",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-full"
                      style={{
                        background: completed ? "#def5e8" : active ? "#e9f1fa" : "#f6f8fa",
                        color: completed ? "#2d8b57" : active ? "#1456a0" : "#7d8da1",
                      }}
                    >
                      {completed ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                    </div>
                    <div>
                      <p className="text-[0.76rem] font-semibold uppercase tracking-[0.24em]" style={{ color: "#8a9bb0" }}>
                        STEP {step.id + 1}
                      </p>
                      <p className="mt-1 text-[0.96rem] font-semibold" style={{ color: "#162840" }}>
                        {step.label}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </section>
      </div>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1.65fr)_360px]">
        <div className="space-y-6">
          {currentStep === 0 && (
            <section className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
              <div
                className="rounded-[30px] border p-6"
                style={{ background: "#f4f7fa", borderColor: "#d8e0e8" }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[0.78rem] font-semibold uppercase tracking-[0.24em]" style={{ color: "#8a9ab0" }}>
                      Stadium View
                    </p>
                    <h3 className="mt-2 text-[1.15rem] font-bold tracking-[-0.04em]" style={{ color: "#14253f" }}>
                      {event.stadium} 좌석도
                    </h3>
                  </div>
                  <div className="rounded-full border px-3 py-1 text-[0.82rem] font-medium"
                    style={{ borderColor: "#d3dde6", color: "#576a82" }}>
                    좌석 잔여 {event.remaining}석
                  </div>
                </div>

                <div
                  className="relative mt-6 h-[390px] overflow-hidden rounded-[30px] border"
                  style={{ background: "radial-gradient(circle at 50% 40%, #fbfcfd 0%, #edf2f6 72%, #e4ebf1 100%)", borderColor: "#dbe3ea" }}
                >
                  <svg viewBox="0 0 560 390" className="h-full w-full" style={{ padding: "54px 18px 88px" }}>
                    <defs>
                      <linearGradient id="fieldFill" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#83a85d" />
                        <stop offset="100%" stopColor="#5f8442" />
                      </linearGradient>
                    </defs>

                    <g opacity={selectedGradeId === event.seatGrades[1]?.id ? 1 : 0.82}>
                      <path
                        d="M170 88 Q280 24 390 88 L358 138 Q280 102 202 138 Z"
                        fill={event.seatGrades[1] ? `${event.seatGrades[1].color}40` : "#d9e3eb"}
                        stroke={event.seatGrades[1] ? event.seatGrades[1].color : "#d9e3eb"}
                        strokeWidth="2"
                      />
                    </g>

                    <g opacity={selectedGradeId === event.seatGrades[0]?.id ? 1 : 0.82}>
                      <path
                        d="M121 130 Q84 182 95 254 L155 232 Q148 185 176 146 Z"
                        fill={event.seatGrades[0] ? `${event.seatGrades[0].color}40` : "#d7e2e9"}
                        stroke={event.seatGrades[0] ? event.seatGrades[0].color : "#d7e2e9"}
                        strokeWidth="2"
                      />
                    </g>

                    <g opacity={selectedGradeId === event.seatGrades[2]?.id ? 1 : 0.82}>
                      <path
                        d="M439 130 Q476 182 465 254 L405 232 Q412 185 384 146 Z"
                        fill={event.seatGrades[2] ? `${event.seatGrades[2].color}40` : "#d7e2e9"}
                        stroke={event.seatGrades[2] ? event.seatGrades[2].color : "#d7e2e9"}
                        strokeWidth="2"
                      />
                    </g>

                    <g opacity={selectedGradeId === event.seatGrades[3]?.id ? 1 : 0.82}>
                      <path
                        d="M158 246 Q280 304 402 246 L426 288 Q280 336 134 288 Z"
                        fill={event.seatGrades[3] ? `${event.seatGrades[3].color}40` : "#d7e2e9"}
                        stroke={event.seatGrades[3] ? event.seatGrades[3].color : "#d7e2e9"}
                        strokeWidth="2"
                      />
                    </g>

                    <path d="M280 136 L334 190 L280 244 L226 190 Z" fill="url(#fieldFill)" stroke="#f6fbf0" strokeWidth="10" />
                    <path d="M280 158 L310 188 L280 218 L250 188 Z" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" />
                    <path d="M202 138 Q280 102 358 138" fill="none" stroke="#c7d2dc" strokeWidth="14" strokeLinecap="round" />
                    <path d="M176 146 Q148 185 155 232" fill="none" stroke="#c7d2dc" strokeWidth="14" strokeLinecap="round" />
                    <path d="M384 146 Q412 185 405 232" fill="none" stroke="#c7d2dc" strokeWidth="14" strokeLinecap="round" />
                    <path d="M134 288 Q280 336 426 288" fill="none" stroke="#c7d2dc" strokeWidth="14" strokeLinecap="round" />

                    <text x="280" y="74" textAnchor="middle" fill="#67788f" fontSize="12" fontWeight="700">중앙 테이블석</text>
                    <text x="120" y="184" textAnchor="middle" fill="#67788f" fontSize="12" fontWeight="700">1루 응원</text>
                    <text x="440" y="184" textAnchor="middle" fill="#67788f" fontSize="12" fontWeight="700">3루 레드</text>
                    <text x="280" y="318" textAnchor="middle" fill="#67788f" fontSize="12" fontWeight="700">외야 그린</text>
                    <text x="280" y="197" textAnchor="middle" fill="#f7fbf2" fontSize="14" fontWeight="800">GROUND</text>
                  </svg>

                  <div className="absolute inset-x-0 top-4 px-5">
                    <div className="flex flex-wrap justify-center gap-2">
                      {event.seatGrades.map((grade) => {
                        const active = selectedGradeId === grade.id;

                        return (
                          <button
                            key={grade.id}
                            type="button"
                            onClick={() => handleSelectGrade(grade)}
                            className="rounded-full border px-3 py-1.5 text-[0.76rem] font-semibold transition"
                            style={{
                              background: active ? "#ffffff" : "rgba(255,255,255,0.72)",
                              borderColor: active ? grade.color : "#d4dde6",
                              color: active ? grade.color : "#5c6e85",
                              boxShadow: active ? "0 8px 16px rgba(17,40,73,0.08)" : "none",
                            }}
                          >
                            <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: grade.color }} />
                            {grade.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {selectedGrade && selectedBlock && (
                    <div
                      className="absolute rounded-full border px-3 py-1.5 text-[0.78rem] font-semibold shadow-[0_10px_20px_rgba(17,40,73,0.12)]"
                      style={{
                        ...(mapBlockBadgePositions[selectedGrade.id] ?? { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }),
                        background: "#ffffff",
                        borderColor: selectedGrade.color,
                        color: selectedGrade.color,
                      }}
                    >
                      {selectedBlock.label}블록 선택됨
                    </div>
                  )}

                  <div className="absolute inset-x-0 bottom-5 px-5">
                    <div className="rounded-[20px] border px-4 py-3"
                      style={{ background: "rgba(255,255,255,0.72)", borderColor: "#d5dfe8", backdropFilter: "blur(12px)" }}>
                      <p className="text-[0.76rem] font-semibold uppercase tracking-[0.22em]" style={{ color: "#7e8ea3" }}>
                        선택 안내
                      </p>
                      <p className="mt-2 text-[0.88rem] leading-6" style={{ color: "#5f7188" }}>
                        {selectedGrade && selectedBlock
                          ? `현재 ${selectedGrade.name} ${selectedBlock.label}블록을 보고 있습니다. 다음 단계에서 해당 블록의 열/좌석번호를 선택할 수 있어요.`
                          : "좌석도는 구역 위치를 보여주고, 실제 선택은 아래 구역 버튼 또는 오른쪽 리스트에서 진행합니다."}
                      </p>
                    </div>
                  </div>
                </div>

                {selectedGrade && selectedBlock && (
                  <div
                    className="mt-5 rounded-[24px] border p-5"
                    style={{ background: "#f8fafc", borderColor: "#dbe3ea" }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[0.76rem] font-semibold uppercase tracking-[0.22em]" style={{ color: "#8a9ab0" }}>
                          Block Locator
                        </p>
                        <h4 className="mt-2 text-[1rem] font-bold" style={{ color: "#182a41" }}>
                          {selectedBlock.label}블록 위치 미리보기
                        </h4>
                        <p className="mt-1 text-[0.86rem]" style={{ color: "#62748b" }}>
                          {selectedBlockLocator?.areaLabel ?? `${selectedGrade.name} 내부 위치`}
                        </p>
                      </div>
                      <div
                        className="rounded-full border px-3 py-1.5 text-[0.76rem] font-semibold"
                        style={{ background: "#ffffff", borderColor: `${selectedGrade.color}55`, color: selectedGrade.color }}
                      >
                        {selectedBlockLocator?.orientation ?? selectedGrade.name}
                      </div>
                    </div>

                    <div className="mt-4 rounded-[20px] border p-4" style={{ background: "#ffffff", borderColor: "#dfe6ed" }}>
                      <div className="flex items-center justify-between text-[0.76rem] font-semibold" style={{ color: "#7a8ca2" }}>
                        <span>{blockFlowMeta[selectedGrade.id]?.startLabel ?? "안쪽"}</span>
                        <span>{blockFlowMeta[selectedGrade.id]?.endLabel ?? "바깥쪽"}</span>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {selectedGrade.blocks.map((block, index) => {
                          const active = selectedBlock.id === block.id;

                          return (
                            <div key={block.id} className="flex items-center gap-2">
                              <div
                                className="rounded-[14px] border px-3 py-2 text-[0.82rem] font-semibold"
                                style={{
                                  minWidth: 74,
                                  textAlign: "center",
                                  background: active ? `${selectedGrade.color}14` : "#f4f7fa",
                                  borderColor: active ? selectedGrade.color : "#d8e1ea",
                                  color: active ? selectedGrade.color : "#5f7087",
                                  boxShadow: active ? "0 8px 16px rgba(17,40,73,0.08)" : "none",
                                }}
                              >
                                {block.label}
                              </div>
                              {index < selectedGrade.blocks.length - 1 && (
                                <div className="h-[2px] w-5 rounded-full" style={{ background: "#d3dce5" }} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-[18px] border p-4" style={{ background: "#ffffff", borderColor: "#dfe6ed" }}>
                        <p className="text-[0.76rem] font-semibold uppercase tracking-[0.2em]" style={{ color: "#8a9ab0" }}>
                          위치 설명
                        </p>
                        <p className="mt-2 text-[0.86rem] leading-6" style={{ color: "#5f7188" }}>
                          {selectedBlockLocator?.guide ?? "선택한 블록의 위치 설명이 여기에 표시됩니다."}
                        </p>
                      </div>
                      <div className="rounded-[18px] border p-4" style={{ background: "#ffffff", borderColor: "#dfe6ed" }}>
                        <p className="text-[0.76rem] font-semibold uppercase tracking-[0.2em]" style={{ color: "#8a9ab0" }}>
                          관람 포인트
                        </p>
                        <p className="mt-2 text-[0.86rem] leading-6" style={{ color: "#5f7188" }}>
                          {selectedBlockLocator?.viewHint ?? "선택 블록의 시야와 분위기 포인트를 안내합니다."}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

              </div>

              <div
                className="rounded-[30px] border p-6"
                style={{ background: "#f7f9fb", borderColor: "#d8e0e8" }}
              >
                <div>
                  <p className="text-[0.78rem] font-semibold uppercase tracking-[0.24em]" style={{ color: "#8a9ab0" }}>
                    Zone Picker
                  </p>
                  <h3 className="mt-2 text-[1.15rem] font-bold tracking-[-0.04em]" style={{ color: "#14253f" }}>
                    구역과 블록을 고르세요
                  </h3>
                </div>

                <div className="mt-5 grid gap-3">
                  {event.seatGrades.map((grade) => {
                    const active = selectedGradeId === grade.id;
                    return (
                      <div
                        key={grade.id}
                        className="rounded-[22px] border px-4 py-4 text-left transition"
                        style={{
                          background: active ? "#ffffff" : "#f1f5f8",
                          borderColor: active ? grade.color : "#dde4eb",
                          boxShadow: active ? "0 12px 24px rgba(17,40,73,0.07)" : "none",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectGrade(grade)}
                          className="w-full text-left"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[0.75rem] font-semibold"
                                style={{ background: `${grade.color}12`, color: grade.color }}>
                                {grade.name}
                              </div>
                              <p className="mt-2 text-[0.92rem] leading-6" style={{ color: "#53667d" }}>
                                {grade.description}
                              </p>
                            </div>
                            <div className="text-right">
                              <div className="text-[1rem] font-bold" style={{ color: "#162840" }}>
                                {formatPrice(grade.price)}
                              </div>
                              <div className="mt-1 text-[0.84rem]" style={{ color: "#7a8ca2" }}>
                                {grade.gate}
                              </div>
                            </div>
                          </div>
                        </button>

                        {active && (
                          <div className="mt-4 rounded-[18px] border p-4"
                            style={{ background: "#f8fafc", borderColor: "#dde5ec" }}>
                            <p className="text-[0.78rem] font-semibold uppercase tracking-[0.2em]" style={{ color: "#8a9ab0" }}>
                              Block
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {grade.blocks.map((block) => (
                                <button
                                  key={block.id}
                                  type="button"
                                  onClick={() => handleSelectBlock(block)}
                                  className="rounded-full border px-3 py-1.5 text-[0.84rem] font-medium transition"
                                  style={{
                                    background: selectedBlockId === block.id ? "#eaf1f8" : "#ffffff",
                                    borderColor: selectedBlockId === block.id ? grade.color : "#d5dde6",
                                    color: "#30465f",
                                  }}
                                >
                                  {block.label}블록
                                </button>
                              ))}
                            </div>
                            <p className="mt-3 text-[0.82rem]" style={{ color: "#657790" }}>
                              블록을 먼저 고르면 다음 단계에서 해당 블록의 열/좌석번호를 바로 선택할 수 있습니다.
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {selectedGrade && (
                  <div className="mt-5 rounded-[22px] border p-4"
                    style={{ background: "#ffffff", borderColor: "#dde5ec" }}>
                    <div className="flex items-center gap-2 text-[0.86rem] font-semibold" style={{ color: "#1456a0" }}>
                      <Info className="h-4 w-4" />
                      선택 구역 안내
                    </div>
                    <div className="mt-3 space-y-2 text-[0.9rem]" style={{ color: "#596b82" }}>
                      {selectedGrade.notes?.map((note) => <p key={note}>• {note}</p>)}
                    </div>
                  </div>
                )}

                <div className="mt-6 flex justify-end">
                  <Button
                    className="rounded-2xl px-5 text-white"
                    style={{ background: selectedGrade && selectedBlock ? "#1456a0" : "#97afcc" }}
                    disabled={!selectedGrade || !selectedBlock}
                    onClick={() => updateStep(1)}
                  >
                    좌석번호 보기
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </section>
          )}

          {currentStep === 1 && selectedGrade && selectedBlock && (
            <section
              className="rounded-[30px] border p-6"
              style={{ background: "#f6f9fb", borderColor: "#d8e0e8" }}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[0.78rem] font-semibold uppercase tracking-[0.24em]" style={{ color: "#8a9ab0" }}>
                    Seat Picker
                  </p>
                  <h3 className="mt-2 text-[1.15rem] font-bold tracking-[-0.04em]" style={{ color: "#14253f" }}>
                    {selectedGrade.name} · {selectedBlock.label}블록 좌석번호 선택
                  </h3>
                  <p className="mt-2 text-[0.93rem]" style={{ color: "#5c6f87" }}>
                    선택 좌석은 최대 {maxSelectableTickets}매까지 가능하며, 예매 완료 시 좌석번호가 NFT 티켓에 저장됩니다.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 text-[0.82rem]">
                  <span className="rounded-full border px-3 py-1.5" style={{ background: "#ffffff", borderColor: "#d4dde6", color: "#4f637b" }}>
                    {selectedBlock.gate}
                  </span>
                  {selectedBlock.note && (
                    <span className="rounded-full border px-3 py-1.5" style={{ background: "#fff8ee", borderColor: "#f0d5ab", color: "#a16f27" }}>
                      {selectedBlock.note}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3 text-[0.82rem]" style={{ color: "#64758c" }}>
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-[#1456a0]" />
                  선택 좌석
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-[#dfe6ec]" />
                  선택 가능
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-[#b7c3cf]" />
                  판매 완료
                </span>
                {isPriorityMode && (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: "#fef3c7", border: "1px solid #fde68a" }} />
                    우선 예매 외 좌석
                  </span>
                )}
              </div>

              <div className="mt-6 overflow-x-auto rounded-[24px] border bg-white p-4" style={{ borderColor: "#dbe3ea" }}>
                <div className="min-w-[860px]">
                  <div className="mb-4 rounded-[18px] py-3 text-center text-[0.92rem] font-semibold tracking-[0.18em]"
                    style={{ background: "#6f8e45", color: "#f8fbff" }}>
                    GROUND
                  </div>

                  <div className="space-y-2">
                    {seatRows.map((row) => (
                      <div key={row} className="flex items-center gap-2">
                        <div
                          className="flex h-8 w-10 items-center justify-center rounded-lg text-[0.78rem] font-semibold"
                          style={{ background: "#eef3f7", color: "#50657e" }}
                        >
                          {row}
                        </div>
                        <div
                          className="grid gap-1"
                          style={{ gridTemplateColumns: `repeat(${seatColumns.length}, minmax(0, 1fr))`, flex: 1 }}
                        >
                          {seatColumns.map((seatNumber) => {
                            const seatKey = `${row}-${seatNumber}`;
                            const compoundKey = `${selectedBlock.label}:${seatKey}`;
                            const sold = takenSeatKeys.has(compoundKey);
                            const priorityRestricted = isPriorityMode && !(row === PRIORITY_ROW && PRIORITY_SEAT_NUMS.has(seatNumber));
                            const disabled = sold || priorityRestricted;
                            const selected = selectedSeatKeys.includes(seatKey);

                            return (
                              <button
                                key={seatKey}
                                type="button"
                                onClick={() => toggleSeat(seatKey)}
                                disabled={disabled}
                                className="h-8 rounded-md text-[0.72rem] font-semibold transition"
                                style={{
                                  background: sold ? "#b8c3ce" : priorityRestricted ? "#fef3c7" : selected ? "#1456a0" : "#eef3f7",
                                  color: sold ? "#f7fafc" : priorityRestricted ? "#b45309" : selected ? "#ffffff" : "#4e6178",
                                  border: sold ? "1px solid #b8c3ce" : priorityRestricted ? "1px solid #fde68a" : selected ? "1px solid #1456a0" : "1px solid #d7dfe7",
                                  opacity: sold ? 0.9 : priorityRestricted ? 0.65 : 1,
                                }}
                              >
                                {seatNumber}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-between">
                <Button
                  variant="outline"
                  className="rounded-2xl border-[#d5dde6] bg-white text-[#53667d]"
                  onClick={() => updateStep(0)}
                >
                  <ChevronLeft className="h-4 w-4" />
                  구역 다시 선택
                </Button>
	                <Button
	                  className="rounded-2xl px-5 text-white"
	                  style={{ background: selectedSeatKeys.length > 0 ? "#1456a0" : "#97afcc" }}
	                  disabled={selectedSeatKeys.length === 0}
	                  onClick={() => updateStep(2)}
	                >
	                  권종 확인하기
	                  <ChevronRight className="h-4 w-4" />
	                </Button>
              </div>
            </section>
          )}

          {currentStep === 2 && selectedGrade && selectedBlock && (
            <section
              className="rounded-[30px] border p-6"
              style={{ background: "#f7f9fb", borderColor: "#d8e0e8" }}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[0.78rem] font-semibold uppercase tracking-[0.24em]" style={{ color: "#8a9ab0" }}>
                    Price & Confirm
                  </p>
                  <h3 className="mt-2 text-[1.15rem] font-bold tracking-[-0.04em]" style={{ color: "#14253f" }}>
                    가격과 할인 유형을 확인하세요
                  </h3>
                  <p className="mt-2 text-[0.93rem]" style={{ color: "#5d6f86" }}>
                    좌석별로 권종을 고르면 총액과 수수료가 오른쪽 요약에 바로 반영됩니다.
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {selectedTickets.map((ticket) => (
                  <div
                    key={ticket.key}
                    className="grid gap-3 rounded-[22px] border p-4 md:grid-cols-[1.1fr_0.9fr_0.6fr]"
                    style={{ background: "#ffffff", borderColor: "#dbe3ea" }}
                  >
                    <div>
                      <p className="text-[0.8rem] font-semibold uppercase tracking-[0.22em]" style={{ color: "#8a9ab0" }}>
                        Seat
                      </p>
                      <p className="mt-2 text-[1rem] font-semibold" style={{ color: "#162840" }}>
                        {selectedGrade.name} {selectedBlock.label}블록 {ticket.row}열 {ticket.seatNumber}번
                      </p>
                      <p className="mt-1 text-[0.88rem]" style={{ color: "#6a7b91" }}>
                        입장 게이트 {selectedBlock.gate}
                      </p>
                    </div>

                    <div>
                      <p className="text-[0.8rem] font-semibold uppercase tracking-[0.22em]" style={{ color: "#8a9ab0" }}>
                        권종 선택
                      </p>
                      <select
                        value={ticketTypesBySeat[ticket.key] ?? "adult"}
                        onChange={(event) =>
                          setTicketTypesBySeat((previous) => ({
                            ...previous,
                            [ticket.key]: event.target.value as SeatTicketTypeId,
                          }))
                        }
                        className="mt-2 w-full rounded-2xl border px-4 py-3 text-[0.92rem] outline-none"
                        style={{ borderColor: "#d5dde6", background: "#f9fbfc", color: "#1b2c44" }}
                      >
                        {seatTicketTypes.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label} · {option.description}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:text-right">
                      <p className="text-[0.8rem] font-semibold uppercase tracking-[0.22em]" style={{ color: "#8a9ab0" }}>
                        금액
                      </p>
                      <p className="mt-2 text-[1rem] font-bold" style={{ color: "#162840" }}>
                        {formatPrice(ticket.price)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex justify-between">
                <Button
                  variant="outline"
                  className="rounded-2xl border-[#d5dde6] bg-white text-[#53667d]"
                  onClick={() => updateStep(1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                  좌석 다시 보기
                </Button>
                {bookingDeadlinePassed && (
                  <div className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl text-[0.84rem] font-semibold mb-2"
                    style={{ background: "#fff3f3", color: "#b94040", border: "1px solid #f0c4c4" }}>
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    예매 마감 (경기 시작 1시간 이후 예매 불가)
                  </div>
                )}
	                <Button
	                  className="rounded-2xl px-5 text-white"
	                  style={{ background: canEnterPayment ? "#1456a0" : "#97afcc" }}
	                  disabled={!canEnterPayment}
	                  onClick={() => updateStep(3)}
	                >
	                  {bookingDeadlinePassed ? <>예매 마감</> : <>결제로 이동<ChevronRight className="h-4 w-4" /></>}
	                </Button>
	              </div>
	            </section>
	          )}

	          {currentStep === 3 && selectedGrade && selectedBlock && (
	            <section
	              className="rounded-[30px] border p-6"
	              style={{ background: "#f7f9fb", borderColor: "#d8e0e8" }}
	            >
	              <div className="flex flex-wrap items-start justify-between gap-4">
	                <div>
	                  <p className="text-[0.78rem] font-semibold uppercase tracking-[0.24em]" style={{ color: "#8a9ab0" }}>
	                    Payment
	                  </p>
	                  <h3 className="mt-2 text-[1.15rem] font-bold tracking-[-0.04em]" style={{ color: "#14253f" }}>
	                    결제 수단을 선택하고 예매를 완료하세요
	                  </h3>
	                  <p className="mt-2 text-[0.93rem]" style={{ color: "#5d6f86" }}>
	                    Toss 테스트 위젯으로 진행되며, 현재 환경에서는 실제 결제가 발생하지 않습니다.
	                  </p>
	                </div>
	                <Button
	                  variant="outline"
	                  className="rounded-2xl border-[#d5dde6] bg-white text-[#53667d]"
	                  onClick={() => updateStep(2)}
	                >
	                  <ChevronLeft className="h-4 w-4" />
	                  권종 다시 보기
	                </Button>
	              </div>

	              <div
	                className="mt-5 flex items-center gap-2 rounded-[14px] border px-4 py-3 text-[0.88rem] font-bold"
	                style={{ background: "#FFF7ED", borderColor: "#FED7AA", color: "#EA580C" }}
	              >
	                <Info className="h-4 w-4 shrink-0" />
	                테스트 환경입니다. 실제 결제되지 않습니다.
	              </div>

	              <div className="mt-5 rounded-[24px] border p-4" style={{ background: "#ffffff", borderColor: "#dbe3ea" }}>
	                <div id="toss-payment-widget" />
	                <div id="toss-agreement-widget" className="mt-4" />

	                {tossState === "error" ? (
	                  <div className="flex flex-col items-center justify-center gap-3 py-8 text-center" style={{ color: "#b94040" }}>
	                    <AlertCircle className="h-6 w-6" />
	                    <span className="text-[0.94rem] font-bold">결제 수단을 불러오지 못했습니다.</span>
	                    <span className="max-w-lg text-[0.8rem] leading-6" style={{ color: "#8a5860" }}>
	                      {widgetError ?? "문제가 계속되면 새로고침 후 다시 시도해 주세요."}
	                    </span>
	                    <button
	                      type="button"
	                      className="mt-1 rounded-xl border px-4 py-2 text-[0.82rem] font-bold"
	                      style={{ borderColor: "#f0c4c4", color: "#b94040", background: "#fff7f7" }}
	                      onClick={() => setWidgetRetryKey((key) => key + 1)}
	                    >
	                      다시 시도
	                    </button>
	                  </div>
	                ) : tossState === "loading" || tossState === "idle" ? (
	                  <div className="flex flex-col items-center justify-center gap-3 py-9 text-center" style={{ color: "#64748B" }}>
	                    <Loader2 className="h-6 w-6 animate-spin" />
	                    <span className="text-[0.94rem] font-bold">결제 수단을 불러오는 중입니다...</span>
	                    <div className="flex flex-wrap justify-center gap-2 text-[0.78rem] font-semibold">
	                      {["Toss SDK 로드", "위젯 초기화", "결제수단 렌더"].map((item) => (
	                        <span key={item} className="rounded-full border px-3 py-1.5" style={{ borderColor: "#E2E8F0", background: "#F8FAFC" }}>
	                          {item}
	                        </span>
	                      ))}
	                    </div>
	                  </div>
	                ) : tossState === "paying" ? (
	                  <div className="flex flex-col items-center justify-center gap-3 py-8 text-center" style={{ color: "#1E3A8A" }}>
	                    <Loader2 className="h-6 w-6 animate-spin" />
	                    <span className="text-[0.94rem] font-bold">결제 승인 중입니다. 창을 닫지 마세요.</span>
	                  </div>
	                ) : null}
	              </div>

	              <Button
	                className="mt-5 min-h-12 w-full rounded-[14px] text-white"
	                style={{ background: tossState === "ready" && !bookingDeadlinePassed ? "#1456a0" : "#97afcc" }}
	                disabled={tossState !== "ready" || bookingDeadlinePassed}
	                onClick={() => void handleCompleteBooking()}
	              >
	                {tossState === "paying" ? (
	                  <><Loader2 className="h-4 w-4 animate-spin" />승인 중...</>
	                ) : tossState === "error" ? (
	                  <>결제 위젯 오류</>
	                ) : tossState !== "ready" ? (
	                  <><Loader2 className="h-4 w-4 animate-spin" />결제 준비 중...</>
	                ) : bookingDeadlinePassed ? (
	                  <>예매 마감</>
	                ) : (
	                  <>토스페이로 결제하기 {formatPrice(finalTotal)}<CheckCircle2 className="h-4 w-4" /></>
	                )}
	              </Button>
	            </section>
	          )}
	        </div>

        <aside
          className="h-fit rounded-[30px] border p-6 xl:sticky xl:top-24"
          style={{ background: "#f4f7fa", borderColor: "#d8e0e8", boxShadow: "0 16px 36px rgba(17,40,73,0.05)" }}
        >
          <div>
            <p className="text-[0.78rem] font-semibold uppercase tracking-[0.24em]" style={{ color: "#8a9ab0" }}>
              Booking Summary
            </p>
            <h3 className="mt-2 text-[1.15rem] font-bold tracking-[-0.04em]" style={{ color: "#15263d" }}>
              예매 요약
            </h3>
          </div>

          <div className="mt-5 rounded-[22px] border p-4" style={{ background: "#ffffff", borderColor: "#dbe3ea" }}>
            <p className="text-[0.78rem] font-semibold uppercase tracking-[0.2em]" style={{ color: "#8a9ab0" }}>
              경기 정보
            </p>
            <div className="mt-3 space-y-2 text-[0.92rem]" style={{ color: "#4c6078" }}>
              <p className="font-semibold" style={{ color: "#162840" }}>{event.name}</p>
              <p>{event.date}</p>
              <p>{event.venue}</p>
            </div>
          </div>

          <div className="mt-4 rounded-[22px] border p-4" style={{ background: "#ffffff", borderColor: "#dbe3ea" }}>
            <p className="text-[0.78rem] font-semibold uppercase tracking-[0.2em]" style={{ color: "#8a9ab0" }}>
              현재 선택
            </p>
            <div className="mt-3 space-y-2 text-[0.92rem]" style={{ color: "#4f6279" }}>
              <p>
                구역: <strong style={{ color: "#162840" }}>{selectedGrade?.name ?? "선택 전"}</strong>
              </p>
              <p>
                블록: <strong style={{ color: "#162840" }}>{selectedBlock ? `${selectedBlock.label}블록` : "선택 전"}</strong>
              </p>
              <p>
                좌석:
                <strong style={{ color: "#162840" }}>
                  {" "}
                  {selectedTickets.length > 0
                    ? selectedTickets.map((ticket) => `${ticket.row}열 ${ticket.seatNumber}번`).join(", ")
                    : "선택 전"}
                </strong>
              </p>
            </div>
          </div>

          {/* 포인트 할인 */}
          <div className="mt-4 rounded-[22px] border p-4" style={{ background: "#ffffff", borderColor: "#dbe3ea" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[0.78rem] font-semibold uppercase tracking-[0.2em]" style={{ color: "#8a9ab0" }}>
                포인트 할인
              </p>
              {pointBalance !== null && (
                <span className="text-[0.78rem] font-semibold" style={{ color: "#1456a0" }}>
                  보유 {pointBalance.toLocaleString()}P
                </span>
              )}
            </div>
            {pointApplied ? (
              <div className="flex items-center justify-between rounded-xl px-3 py-2.5"
                style={{ background: "#f0fbf5", border: "1px solid #c6ebd8" }}>
                <span className="text-sm font-semibold" style={{ color: "#059669" }}>
                  -{pointDiscount.toLocaleString()}P 적용됨
                </span>
                <button onClick={cancelPoint}
                  className="text-xs font-semibold px-2.5 py-1 rounded-lg"
                  style={{ background: "#fee2e2", color: "#dc2626" }}>
                  취소
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1000}
                    step={100}
                    value={pointInput}
                    onChange={(e) => { setPointInput(e.target.value); setPointError(null); }}
                    placeholder="사용할 포인트 (최소 1,000P)"
                    className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none"
                    style={{ borderColor: pointError ? "#f87171" : "#d0d8e4", color: "#14253f" }}
                  />
                  <button
                    onClick={applyPoint}
                    disabled={!pointInput || !walletAddress}
                    className="min-h-11 min-w-[62px] shrink-0 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold leading-none text-white"
                    style={{
                      background: pointInput && walletAddress ? "#1456a0" : "#94a3b8",
                      wordBreak: "keep-all",
                    }}
                  >
                    적용
                  </button>
                </div>
                {pointError && (
                  <p className="text-xs" style={{ color: "#ef4444" }}>{pointError}</p>
                )}
                <p className="text-xs" style={{ color: "#9ca3af" }}>
                  1P = 1원 · 최소 1,000P 이상 · 총 결제금액 이하
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 rounded-[22px] border p-4" style={{ background: "#ffffff", borderColor: "#dbe3ea" }}>
            <p className="text-[0.78rem] font-semibold uppercase tracking-[0.2em]" style={{ color: "#8a9ab0" }}>
              결제 금액
            </p>
            <div className="mt-4 space-y-3 text-[0.92rem]" style={{ color: "#53677f" }}>
              <div className="flex items-center justify-between">
                <span>티켓 금액</span>
                <strong style={{ color: "#162840" }}>{formatPrice(ticketTotal)}</strong>
              </div>
              <div className="flex items-center justify-between">
                <span>예매 수수료</span>
                <strong style={{ color: "#162840" }}>{formatPrice(serviceFee)}</strong>
              </div>
              {pointDiscount > 0 && (
                <div className="flex items-center justify-between">
                  <span style={{ color: "#059669" }}>포인트 할인</span>
                  <strong style={{ color: "#059669" }}>-{formatPrice(pointDiscount)}</strong>
                </div>
              )}
              <div className="border-t pt-3 flex items-center justify-between" style={{ borderColor: "#e3e9ef" }}>
                <span className="font-semibold" style={{ color: "#162840" }}>총 결제금액</span>
                <strong className="text-[1.12rem]" style={{ color: "#1456a0" }}>
                  {formatPrice(finalTotal)}
                </strong>
              </div>
            </div>
          </div>

          {/* 지갑 연결 상태 */}
	          <div className="mt-4 rounded-[22px] border p-4" style={{ background: "#ffffff", borderColor: "#dbe3ea" }}>
	            <div className="flex items-center justify-between gap-2">
	              <div className="flex items-center gap-2 text-[0.86rem] font-semibold" style={{ color: "#1456a0" }}>
	                <Wallet className="h-4 w-4" />
                지갑
              </div>
              <span className="text-[0.82rem] font-semibold" style={{ color: walletAddress ? "#2dba73" : "#e5824a" }}>
                {walletAddress
                  ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
                  : "미연결 — 예매 시 자동 연결"}
	              </span>
	            </div>
	          </div>

	          <Button
	            className="mt-4 min-h-12 w-full rounded-[14px] text-white"
	            disabled={summaryCta.disabled}
	            aria-disabled={summaryCta.disabled}
	            onClick={summaryCta.onClick}
	            style={{
	              background: summaryCta.disabled ? "#CBD5E1" : "#1456a0",
	              boxShadow: summaryCta.disabled ? "none" : "0 12px 24px rgba(20,86,160,0.18)",
	            }}
	          >
	            {currentStep === 3 && tossState === "paying" && <Loader2 className="h-4 w-4 animate-spin" />}
	            {summaryCta.label}
	            {!summaryCta.disabled && currentStep < 3 && <ChevronRight className="h-4 w-4" />}
	          </Button>
	
	          <div className="mt-4 rounded-[22px] border p-4" style={{ background: "#ffffff", borderColor: "#dbe3ea" }}>
            <div className="flex items-center gap-2 text-[0.86rem] font-semibold" style={{ color: "#1456a0" }}>
              <AlertCircle className="h-4 w-4" />
              예매 팁
            </div>
            <div className="mt-3 space-y-2 text-[0.9rem] leading-6" style={{ color: "#5b6d84" }}>
              <p>• 좌석은 선택 즉시 장바구니처럼 고정되지 않으니 결제를 바로 이어가는 편이 좋습니다.</p>
              <p>• 잠실은 블록별 게이트가 달라 입장 전 게이트를 함께 확인하는 것이 편합니다.</p>
              <p>• 예매 후에는 내 입장권에서 QR과 좌석번호를 다시 확인할 수 있습니다.</p>
            </div>
          </div>
	        </aside>
	      </div>

	      <div
	        className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 px-4 py-3 shadow-[0_-12px_28px_rgba(17,40,73,0.10)] backdrop-blur xl:hidden"
	        style={{ borderColor: "#E2E8F0", paddingBottom: "calc(12px + env(safe-area-inset-bottom))" }}
	      >
	        <div className="mx-auto flex max-w-3xl items-center gap-3">
	          <div className="min-w-0 flex-1">
	            <p className="truncate text-[0.82rem] font-bold" style={{ color: "#64748B" }}>
	              {selectedTickets.length > 0 ? `${selectedTickets.length}석 선택` : selectedBlock ? `${selectedGrade?.name} ${selectedBlock.label}블록` : "아직 선택 전"}
	            </p>
	            <p className="text-[1rem] font-black" style={{ color: "#1456a0" }}>
	              {formatPrice(finalTotal)}
	            </p>
	          </div>
	          <Button
	            className="min-h-11 rounded-[12px] px-4 text-white"
	            disabled={summaryCta.disabled}
	            onClick={summaryCta.onClick}
	            style={{ background: summaryCta.disabled ? "#CBD5E1" : "#1456a0" }}
	          >
	            {summaryCta.label}
	          </Button>
	        </div>
	      </div>
	
	    </div>
	  );
	}
