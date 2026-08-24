import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";

interface ResaleOrderInfo {
  listingId:   string;
  homeTeam:    string;
  awayTeam:    string;
  gameDate:    string;
  seatSection: string;
  listedPrice: number;
  sellerName:  string;
}

function formatPrice(value: number) {
  return `₩${value.toLocaleString("ko-KR")}`;
}

export function TicketResaleSuccess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const paymentKey = searchParams.get("paymentKey") ?? "";
  const orderId    = searchParams.get("orderId") ?? "";
  const amount     = Number(searchParams.get("amount") ?? "0");

  const [status, setStatus]     = useState<"loading" | "done" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [orderInfo, setOrderInfo] = useState<ResaleOrderInfo | null>(null);
  const confirmedRef = useRef(false);

  useEffect(() => {
    if (confirmedRef.current) return;
    confirmedRef.current = true;

    if (!paymentKey || !orderId || !amount) {
      setErrorMsg("결제 정보가 올바르지 않습니다.");
      setStatus("error");
      return;
    }

    const raw = sessionStorage.getItem(`toss_resale_${orderId}`);
    if (!raw) {
      setErrorMsg("주문 정보를 찾을 수 없습니다. 결제는 완료됐을 수 있으니 내 입장권을 확인해 주세요.");
      setStatus("error");
      return;
    }

    const info: ResaleOrderInfo = JSON.parse(raw);
    setOrderInfo(info);

    const token = localStorage.getItem("auth_token") ?? "";

    fetch(`${import.meta.env.VITE_API_URL}/api/ticket-resale/toss-confirm/${info.listingId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${token}`,
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          sessionStorage.removeItem(`toss_resale_${orderId}`);
          setStatus("done");
        } else {
          setErrorMsg(data.error ?? "결제 승인 처리 중 오류가 발생했습니다.");
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
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin mx-auto" style={{ color: "#1456a0" }} />
          <p className="text-[0.95rem] font-medium" style={{ color: "#55657d" }}>
            결제를 확인하고 티켓을 이전하는 중입니다...
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
        className="w-full max-w-[520px] rounded-[30px] border p-7"
        style={{ background: "#f8fafc", borderColor: "#d9e1e8", boxShadow: "0 26px 60px rgba(17,40,73,0.18)" }}
      >
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: "#e2f3ea", color: "#2d8b57" }}>
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[0.8rem] font-semibold uppercase tracking-[0.22em]" style={{ color: "#8a9ab0" }}>
              Transfer Complete
            </p>
            <h3 className="mt-1 text-[1.2rem] font-bold tracking-[-0.04em]" style={{ color: "#162840" }}>
              티켓 구매가 완료되었습니다
            </h3>
          </div>
        </div>

        {orderInfo && (
          <div className="rounded-[22px] border p-4" style={{ background: "#ffffff", borderColor: "#dde5ec" }}>
            <p className="text-[0.8rem] font-semibold uppercase tracking-[0.2em] mb-3" style={{ color: "#8a9ab0" }}>
              구매 내역
            </p>
            <div className="space-y-2.5 text-[0.93rem]" style={{ color: "#4f6279" }}>
              {[
                ["경기", `${orderInfo.homeTeam} vs ${orderInfo.awayTeam}`],
                ["날짜", orderInfo.gameDate],
                ["좌석", orderInfo.seatSection],
                ["판매자", orderInfo.sellerName],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span style={{ color: "#8a9ab0" }}>{k}</span>
                  <span className="font-semibold" style={{ color: "#162840" }}>{v}</span>
                </div>
              ))}
              <div className="pt-2 border-t flex justify-between font-bold" style={{ borderColor: "#e8eff5" }}>
                <span style={{ color: "#162840" }}>결제 금액</span>
                <span style={{ color: "#1456a0" }}>{formatPrice(amount)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button
            variant="outline"
            className="rounded-2xl border-[#d5dde6] bg-white text-[#53667d]"
            onClick={() => navigate("/ticket-resale")}
          >
            거래소로
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
