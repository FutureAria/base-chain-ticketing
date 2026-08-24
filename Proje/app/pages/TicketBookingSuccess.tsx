import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";

interface SeatInfo {
  row: number;
  seatNumber: number;
  price: number;
  ticketTypeLabel: string;
}

interface OrderInfo {
  walletAddress: string;
  gameId:        string;
  eventName:     string;
  stadium:       string;
  grade:         string;
  block:         string;
  gate:          string;
  seats:         SeatInfo[];
  pointDiscount: number;
  finalTotal:    number;
  bookingMode?:  "normal" | "priority";
  priorityEntryId?: string;
}

interface ConfirmedTicket {
  ticketId: string;
  tokenId?: number;
  txHash?: string;
}

function formatPrice(value: number) {
  return `₩${value.toLocaleString("ko-KR")}`;
}

const PROCESSING_STEPS = [
  "토스 결제 확인",
  "좌석 예약 저장",
  "NFT 입장권 발급",
  "포인트/응모권 반영",
  "예매 완료 화면 준비",
];

export function TicketBookingSuccess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const paymentKey = searchParams.get("paymentKey") ?? "";
  const orderId    = searchParams.get("orderId") ?? "";
  const amount     = Number(searchParams.get("amount") ?? "0");

  const [status, setStatus]   = useState<"loading" | "done" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [orderInfo, setOrderInfo] = useState<OrderInfo | null>(null);
  const [confirmedTickets, setConfirmedTickets] = useState<ConfirmedTicket[]>([]);
  const [progress, setProgress] = useState(8);
  const [processingStep, setProcessingStep] = useState(0);
  const confirmedRef = useRef(false);

  useEffect(() => {
    if (status !== "loading") return;

    const interval = window.setInterval(() => {
      setProgress((current) => {
        const next = Math.min(current + (current < 65 ? 7 : current < 88 ? 3 : 1), 94);
        setProcessingStep(
          Math.min(PROCESSING_STEPS.length - 1, Math.floor((next / 100) * PROCESSING_STEPS.length)),
        );
        return next;
      });
    }, 650);

    return () => window.clearInterval(interval);
  }, [status]);

  useEffect(() => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;
    if (!paymentKey || !orderId || !amount) {
      setErrorMsg("결제 정보가 올바르지 않습니다.");
      setStatus("error");
      return;
    }

    const raw = sessionStorage.getItem(`toss_order_${orderId}`);
    if (!raw) {
      setErrorMsg("주문 정보를 찾을 수 없습니다. 결제는 완료됐을 수 있으니 내 입장권을 확인해 주세요.");
      setStatus("error");
      return;
    }

    const info: OrderInfo = JSON.parse(raw);
    setOrderInfo(info);

    const token = localStorage.getItem("auth_token") ?? "";

    // 서버에 결제 승인 + NFT 민팅 요청
    const apiBase = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");
    fetch(`${apiBase}/api/tickets/toss/confirm`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        Authorization:   `Bearer ${token}`,
      },
      body: JSON.stringify({
        paymentKey,
        orderId,
        amount,
        walletAddress: info.walletAddress,
        gameId:        info.gameId,
        stadium:       info.stadium,
        grade:         info.grade,
        block:         info.block,
        seats: info.seats.map((s) => ({
          row:        s.row,
          seatNumber: s.seatNumber,
          price:      s.price,
        })),
        pointDiscount: info.pointDiscount,
        bookingMode:   info.bookingMode ?? "normal",
        priorityEntryId: info.priorityEntryId ?? "",
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          const tickets = Array.isArray(data.data?.tickets) ? data.data.tickets : [];
          setConfirmedTickets(tickets);
          sessionStorage.removeItem(`toss_order_${orderId}`);
          setProgress(100);
          setProcessingStep(PROCESSING_STEPS.length - 1);
          window.setTimeout(() => setStatus("done"), 120);
        } else {
          setErrorMsg(data.message ?? data.error ?? "결제 승인 처리 중 오류가 발생했습니다.");
          setStatus("error");
        }
      })
      .catch(() => {
        setErrorMsg("서버 통신 오류가 발생했습니다. 내 입장권 페이지에서 결과를 확인해 주세요.");
        setStatus("error");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "loading") {
    return (
      <div className="page-shell flex items-center justify-center min-h-[50vh]">
        <div
          className="w-full max-w-[560px] rounded-[30px] border p-7"
          style={{ background: "#f8fafc", borderColor: "#d9e1e8", boxShadow: "0 26px 60px rgba(17,40,73,0.16)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: "#e8f1fb", color: "#1456a0" }}
            >
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
            <div>
              <p className="text-[0.8rem] font-semibold uppercase tracking-[0.22em]" style={{ color: "#8a9ab0" }}>
                Booking Processing
              </p>
              <h2 className="mt-1 text-[1.2rem] font-bold tracking-[-0.04em]" style={{ color: "#162840" }}>
                예매 처리 중입니다
              </h2>
            </div>
          </div>

          <p className="mt-4 text-[0.92rem] leading-6" style={{ color: "#55657d" }}>
            결제 확인과 티켓 발급을 진행하고 있어요. 창을 닫지 말고 잠시만 기다려주세요.
          </p>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-[0.82rem] font-semibold">
              <span style={{ color: "#1456a0" }}>{PROCESSING_STEPS[processingStep]}</span>
              <span style={{ color: "#53667d" }}>{progress}%</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full border" style={{ background: "#e8eff5", borderColor: "#d7e1eb" }}>
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${progress}%`,
                  background: "linear-gradient(90deg, #1456a0 0%, #4aa3ff 100%)",
                }}
              />
            </div>
          </div>

          <div className="mt-5 rounded-[22px] border p-4" style={{ background: "#ffffff", borderColor: "#dde5ec" }}>
            <div className="space-y-3">
              {PROCESSING_STEPS.map((step, index) => {
                const isDone = index < processingStep;
                const isCurrent = index === processingStep;

                return (
                  <div key={step} className="flex items-center gap-3 text-[0.9rem]">
                    <div
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                      style={{
                        background: isDone ? "#e2f3ea" : isCurrent ? "#e8f1fb" : "#eef3f7",
                        color: isDone ? "#2d8b57" : isCurrent ? "#1456a0" : "#9aa8b7",
                      }}
                    >
                      {isDone ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : isCurrent ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <span className="h-2 w-2 rounded-full" style={{ background: "currentColor" }} />
                      )}
                    </div>
                    <span
                      className={isCurrent ? "font-semibold" : "font-medium"}
                      style={{ color: isCurrent ? "#162840" : "#6b7d92" }}
                    >
                      {step}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="mt-4 text-[0.78rem] leading-5" style={{ color: "#8190a3" }}>
            현재 실험용 환경에서는 토스 테스트 결제를 로컬 mock 승인으로 처리하며 실제 금액이 청구되지 않습니다.
          </p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="page-shell flex items-center justify-center min-h-[50vh]">
        <div
          className="rounded-[28px] border p-8 max-w-md w-full text-center"
          style={{ background: "#fff5f5", borderColor: "#fca5a5" }}
        >
          <AlertCircle className="h-10 w-10 mx-auto mb-4" style={{ color: "#ef4444" }} />
          <h2 className="text-[1.1rem] font-bold mb-2" style={{ color: "#14253f" }}>처리 중 오류가 발생했습니다</h2>
          <p className="text-[0.9rem] leading-6 mb-6" style={{ color: "#55657d" }}>{errorMsg}</p>
          <Button className="rounded-2xl bg-[#1456a0] text-white" onClick={() => navigate("/my-tickets")}>
            내 입장권 확인
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell flex items-center justify-center min-h-[50vh]">
      <div
        className="w-full max-w-[560px] rounded-[30px] border p-7"
        style={{ background: "#f8fafc", borderColor: "#d9e1e8", boxShadow: "0 26px 60px rgba(17,40,73,0.18)" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: "#e2f3ea", color: "#2d8b57" }}>
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[0.8rem] font-semibold uppercase tracking-[0.22em]" style={{ color: "#8a9ab0" }}>
              Booking Complete
            </p>
            <h3 className="mt-1 text-[1.2rem] font-bold tracking-[-0.04em]" style={{ color: "#162840" }}>
              예매가 완료되었습니다
            </h3>
          </div>
        </div>

        {orderInfo && (
          <>
            <div className="mt-5 rounded-[22px] border p-4" style={{ background: "#ffffff", borderColor: "#dde5ec" }}>
              <p className="text-[0.8rem] font-semibold uppercase tracking-[0.2em] mb-3" style={{ color: "#8a9ab0" }}>
                예매 내역
              </p>
              <div className="space-y-3 text-[0.93rem]" style={{ color: "#4f6279" }}>
                {orderInfo.seats.map((s, i) => (
                  <div key={i} className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold" style={{ color: "#162840" }}>
                        {orderInfo.grade} {orderInfo.block}블록 {s.row}열 {s.seatNumber}번
                      </p>
                      <p className="mt-1 text-[0.86rem]">{s.ticketTypeLabel} · 입장 {orderInfo.gate}</p>
                    </div>
                    <div className="text-right font-semibold" style={{ color: "#1456a0" }}>
                      {formatPrice(s.price)}
                    </div>
                  </div>
                ))}
              </div>
              {orderInfo.pointDiscount > 0 && (
                <div className="mt-3 pt-3 border-t flex justify-between text-[0.88rem]" style={{ borderColor: "#e8eff5" }}>
                  <span style={{ color: "#059669" }}>포인트 할인</span>
                  <strong style={{ color: "#059669" }}>-{formatPrice(orderInfo.pointDiscount)}</strong>
                </div>
              )}
              <div className="mt-2 pt-2 border-t flex justify-between font-bold" style={{ borderColor: "#e8eff5" }}>
                <span style={{ color: "#162840" }}>총 결제금액</span>
                <span style={{ color: "#1456a0" }}>{formatPrice(amount)}</span>
              </div>
            </div>

            <div
              className="mt-4 rounded-[20px] border p-4"
              style={{ background: "#eefbf4", borderColor: "#bbf7d0" }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: "#dcfce7", color: "#16a34a" }}
                >
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.9rem] font-bold" style={{ color: "#162840" }}>
                    NFT 입장권 발급 완료
                  </p>
                  <p className="mt-1 text-[0.82rem] leading-5" style={{ color: "#64748b" }}>
                    토스 결제 확인 후 입장권 발급까지 완료되었습니다. MetaMask 승인은 요청하지 않습니다.
                  </p>
                  {confirmedTickets.some((ticket) => ticket.txHash) && (
                    <div className="mt-2 space-y-1 text-[0.76rem]" style={{ color: "#64748b" }}>
                      {confirmedTickets.filter((ticket) => ticket.txHash).map((ticket, index) => (
                        <p key={ticket.ticketId}>
                          NFT {index + 1}: token #{ticket.tokenId} · {ticket.txHash?.slice(0, 10)}...{ticket.txHash?.slice(-6)}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

          </>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button
            variant="outline"
            className="rounded-2xl border-[#d5dde6] bg-white text-[#53667d]"
            onClick={() => navigate("/tickets")}
          >
            경기 목록으로
          </Button>
          <Button
            className="rounded-2xl bg-[#1456a0] text-white"
            onClick={() => navigate("/my-tickets")}
          >
            내 입장권 보기
          </Button>
        </div>
      </div>
    </div>
  );
}
