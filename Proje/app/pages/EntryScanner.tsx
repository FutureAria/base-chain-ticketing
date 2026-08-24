import { useState, useCallback, useRef } from "react";
import { CheckCircle, XCircle, ScanLine, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { QRScanner } from "../components/QRScanner";
import { Button } from "../components/ui/button";
import { authHeaders } from "../lib/authHeaders";

// ─── 타입 ─────────────────────────────────────────────────
type ScanState = "idle" | "scanning" | "loading" | "success" | "fail";

interface EntryResult {
  allowed:         boolean;
  reason?:         string;
  ticketId?:       string;
  earnedPoint?:    number;
  membershipGrade?: string;
}

// ─── 실패 사유 한국어 변환 ────────────────────────────────
const REASON_LABEL: Record<string, string> = {
  INVALID_QR_TOKEN:   "QR 코드가 만료되었거나 올바르지 않습니다",
  TICKET_NOT_FOUND:   "등록된 티켓을 찾을 수 없습니다",
  ALREADY_USED:       "이미 입장 처리된 티켓입니다",
  REFUNDED:           "환불된 티켓입니다",
  NOT_NFT_OWNER:      "NFT 소유자가 아닙니다",
  MISSING_PARAMS:     "QR 데이터가 올바르지 않습니다",
  SERVER_ERROR:       "서버 오류가 발생했습니다",
};

// ─── 메인 컴포넌트 ────────────────────────────────────────
export function EntryScanner() {
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [result,    setResult]    = useState<EntryResult | null>(null);
  const [gateId,    setGateId]    = useState("GATE_A");
  const processingRef = useRef(false);

  const handleScan = useCallback(async (raw: string) => {
    // ref로 중복 호출 완전 차단 (stale closure 문제 우회)
    if (processingRef.current) return;
    processingRef.current = true;

    // QR 페이로드 파싱: { ticketId, qrToken }
    let ticketId: string;
    let qrToken: string;
    try {
      const parsed = JSON.parse(raw);
      ticketId = parsed.ticketId;
      qrToken  = parsed.qrToken;
      if (!ticketId || !qrToken) throw new Error("필드 누락");
    } catch {
      setResult({ allowed: false, reason: "MISSING_PARAMS" });
      setScanState("fail");
      processingRef.current = false;
      return;
    }

    setScanState("loading");

    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL}/api/entry/verify`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body:    JSON.stringify({ ticketId, qrToken, gateId }),
        }
      );
      const data: EntryResult = await res.json();
      setResult(data);
      setScanState(data.allowed ? "success" : "fail");
    } catch {
      setResult({ allowed: false, reason: "SERVER_ERROR" });
      setScanState("fail");
    }
    // processingRef는 reset()에서 해제
  }, [gateId]);

  const reset = () => {
    processingRef.current = false;
    setResult(null);
    setScanState("scanning");
  };

  return (
    <div className="page-shell max-w-lg mx-auto">
      <div className="page-header">
        <div className="page-header-main">
        <p className="page-eyebrow text-[#1456a0] mb-3">Gate</p>
        <h1 className="page-title mb-3" style={{ color: "#14253f" }}>입장 QR 스캐너</h1>
        <p className="page-subtitle" style={{ color: "#55657d" }}>티켓 QR을 카메라로 스캔할 수 있어요.</p>
        </div>
      </div>

      {/* 게이트 선택 */}
      <div className="mb-6 flex items-center gap-3">
        <label className="text-sm font-medium" style={{ color: "#34465c" }}>게이트</label>
        <select
          value={gateId}
          onChange={(e) => setGateId(e.target.value)}
          className="rounded-xl px-3 py-2 text-sm"
          style={{ border: "1px solid #bfd0e2", background: "#f8fbfd", color: "#21354b" }}
        >
          {["GATE_A", "GATE_B", "GATE_C", "GATE_D"].map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

      {/* 스캐너 or 결과 */}
      <AnimatePresence mode="wait">
        {(scanState === "idle" || scanState === "scanning") && (
          <motion.div
            key="scanner"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="rounded-2xl overflow-hidden"
            style={{ border: "1px solid #d8e3ec", background: "#f8fbfd" }}
          >
            {scanState === "idle" ? (
              <div className="flex flex-col items-center gap-4 py-12 px-6">
                <ScanLine className="w-14 h-14" style={{ color: "#1456a0", opacity: 0.5 }} />
                <p className="text-sm font-medium" style={{ color: "#55657d" }}>카메라를 활성화하여 스캔을 시작하세요</p>
                <Button
                  onClick={() => setScanState("scanning")}
                  className="h-11 px-6 font-bold text-white rounded-xl"
                  style={{ background: "linear-gradient(135deg, #1456a0, #1e7fd0)" }}
                >
                  스캔 시작
                </Button>
              </div>
            ) : (
              <div className="p-4">
                <QRScanner onScan={handleScan} />
                <p className="text-center text-sm mt-3" style={{ color: "#55657d" }}>
                  카메라를 QR 코드에 가까이 대세요
                </p>
              </div>
            )}
          </motion.div>
        )}

        {scanState === "loading" && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4 py-16"
          >
            <div className="w-12 h-12 rounded-full border-4 border-[#1456a0] border-t-transparent animate-spin" />
            <p className="text-sm font-medium" style={{ color: "#55657d" }}>입장 처리 중...</p>
          </motion.div>
        )}

        {scanState === "success" && result && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="rounded-2xl p-8 text-center"
            style={{ background: "#f0fff8", border: "1px solid #2dba73" }}
          >
            <CheckCircle className="w-16 h-16 mx-auto mb-4" style={{ color: "#2dba73" }} />
            <h2 className="text-2xl font-bold mb-2" style={{ color: "#1a5c3a" }}>입장 허가</h2>
            <p className="text-sm mb-6" style={{ color: "#2d6e4a" }}>
              {result.ticketId && `티켓 #${result.ticketId.slice(0, 8).toUpperCase()}`}
            </p>

            {(result.earnedPoint != null || result.membershipGrade) && (
              <div className="rounded-xl p-4 mb-6 text-sm"
                style={{ background: "#d4f7e7", border: "1px solid #2dba7366" }}>
                {result.earnedPoint != null && (
                  <p className="font-semibold" style={{ color: "#1a5c3a" }}>
                    +{result.earnedPoint.toLocaleString()}P 적립
                  </p>
                )}
                {result.membershipGrade && (
                  <p style={{ color: "#2d6e4a" }}>멤버십 등급: {result.membershipGrade}</p>
                )}
              </div>
            )}

            <Button onClick={reset} className="w-full h-11 font-bold text-white rounded-xl"
              style={{ background: "linear-gradient(135deg, #2dba73, #1a9e5f)" }}>
              <RotateCcw className="w-4 h-4 mr-2" /> 다음 스캔
            </Button>
          </motion.div>
        )}

        {scanState === "fail" && result && (
          <motion.div
            key="fail"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="rounded-2xl p-8 text-center"
            style={{ background: "#fff5f5", border: "1px solid #f87171" }}
          >
            <XCircle className="w-16 h-16 mx-auto mb-4" style={{ color: "#ef4444" }} />
            <h2 className="text-2xl font-bold mb-2" style={{ color: "#7f1d1d" }}>입장 거부</h2>
            <p className="text-sm mb-6" style={{ color: "#991b1b" }}>
              {result.reason
                ? REASON_LABEL[result.reason] ?? result.reason
                : "알 수 없는 오류"}
            </p>

            <Button onClick={reset} className="w-full h-11 font-bold text-white rounded-xl"
              style={{ background: "linear-gradient(135deg, #ef4444, #b91c1c)" }}>
              <RotateCcw className="w-4 h-4 mr-2" /> 다시 스캔
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
