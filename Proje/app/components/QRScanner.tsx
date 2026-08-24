import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

interface QRScannerProps {
  onScan: (result: string) => void;
  onError?: (error: string) => void;
}

export function QRScanner({ onScan, onError }: QRScannerProps) {
  const onScanRef  = useRef(onScan);
  const onErrorRef = useRef(onError);
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  // 항상 최신 콜백을 ref에 유지 (stale closure 방지)
  useEffect(() => { onScanRef.current  = onScan;  }, [onScan]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    if (!window.isSecureContext && !isLocalhost) {
      const message = "카메라 스캔은 HTTPS 주소에서만 사용할 수 있습니다. Oracle 배포 시 HTTPS 도메인으로 접속해주세요.";
      setBlockedReason(message);
      onErrorRef.current?.(message);
      return;
    }

    const id = "qr-scanner-container";
    const scanner = new Html5Qrcode(id);

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => onScanRef.current(String(decodedText)),
        (err) => onErrorRef.current?.(String(err)),
      )
      .catch((err) => console.error("[QRScanner] start failed:", err));

    return () => {
      scanner.isScanning && scanner.stop().catch(() => {});
    };
  }, []);

  if (blockedReason) {
    return (
      <div
        className="rounded-2xl px-5 py-8 text-center"
        style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#9a3412" }}
      >
        <p className="text-sm font-semibold">{blockedReason}</p>
      </div>
    );
  }

  return (
    <>
      <style>{`#qr-scanner-container img { display: none !important; }`}</style>
      <div
        id="qr-scanner-container"
        style={{ width: "100%", maxWidth: 360, margin: "0 auto" }}
      />
    </>
  );
}
