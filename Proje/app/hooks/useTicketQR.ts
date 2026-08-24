import { useState, useEffect, useCallback, useRef } from "react";

export interface QRData {
  available: boolean;
  qrToken?: string;
  remainingSeconds?: number;
  demo?: boolean;
  message: string;
}

/**
 * 티켓 QR 훅
 * - 경기 시작 2시간 전부터 QR 활성화 (백엔드에서 판단)
 * - 서버가 내려주는 QR 만료 시간에 맞춰 자동 갱신
 * - QR 비활성 시 30초마다 폴링
 */
export function useTicketQR(
  ticketId: string | null,
  walletAddress: string | null,
  ticketStatus: string, // "ACTIVE" | "USED" | "사용 가능" | "사용 완료" 등
) {
  const [qrData, setQrData] = useState<QRData | null>(null);
  const [countdown, setCountdown] = useState(10);

  const isActive = ticketStatus === "ACTIVE" || ticketStatus === "사용 가능";

  const fetchQR = useCallback(async () => {
    if (!ticketId || !walletAddress) return;
    try {
      const res  = await fetch(
        `${import.meta.env.VITE_API_URL}/api/tickets/${ticketId}/qr?walletAddress=${walletAddress}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("auth_token") ?? ""}`,
          },
        },
      );
      const data: QRData = await res.json();
      setQrData(data);
      if (data.available && typeof data.remainingSeconds === "number") {
        setCountdown(data.remainingSeconds);
      }
    } catch (err) {
      console.error("QR 조회 실패:", err);
    }
  }, [ticketId, walletAddress]);

  // fetchQR을 ref로 유지 (interval 클로저 stale 방지)
  const fetchRef = useRef(fetchQR);
  useEffect(() => { fetchRef.current = fetchQR; }, [fetchQR]);

  // 초기 로드
  useEffect(() => {
    if (!isActive || !ticketId || !walletAddress) return;
    fetchRef.current();
  }, [isActive, ticketId, walletAddress]);

  // QR 활성화 상태: 1초 카운트다운, 0초 도달 시 재발급
  useEffect(() => {
    if (!qrData?.available) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchRef.current();
          return qrData.remainingSeconds ?? 10; // 서버 응답 오기 전 임시값
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [qrData?.available, qrData?.remainingSeconds]);

  // QR 비활성화 상태: 30초마다 폴링 (2시간 전 window 감지)
  useEffect(() => {
    if (qrData?.available || !isActive || !ticketId || !walletAddress) return;
    const poller = setInterval(() => fetchRef.current(), 30_000);
    return () => clearInterval(poller);
  }, [qrData?.available, isActive, ticketId, walletAddress]);

  const formattedCountdown = `${String(Math.floor(countdown / 60)).padStart(2, "0")}:${String(countdown % 60).padStart(2, "0")}`;

  return { qrData, countdown, formattedCountdown };
}
