import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useAppSettings } from "../context/AppSettingsContext";
import { getDidStatus } from "../api/didApi";

export type AccessStatus = "checking" | "ok" | "need_login" | "need_wallet" | "need_did";

export const ACCESS_MESSAGES: Record<Exclude<AccessStatus, "checking" | "ok">, { stepLabel: string; title: string; desc: string; action: string; href: string }> = {
  need_login: {
    stepLabel: "로그인 필요",
    title: "로그인이 필요합니다",
    desc: "티켓 예매는 로그인한 회원만 이용할 수 있습니다.",
    action: "로그인하러 가기",
    href: "/login",
  },
  need_wallet: {
    stepLabel: "지갑 연결 필요",
    title: "MetaMask 지갑 연결이 필요합니다",
    desc: "티켓은 블록체인 NFT로 발행됩니다. 마이페이지에서 MetaMask 지갑을 연결해 주세요.",
    action: "마이페이지 가기",
    href: "/mypage",
  },
  need_did: {
    stepLabel: "DID 인증 필요",
    title: "DID 인증이 필요합니다",
    desc: "신원 인증(DID)을 완료한 사용자만 티켓을 예매할 수 있습니다. 마이페이지에서 DID 인증을 진행해 주세요.",
    action: "마이페이지 가기",
    href: "/mypage",
  },
};

export function useBookingAccess(): AccessStatus {
  const { user, isLoggedIn, isLoading } = useAuth();
  const { walletConnected } = useAppSettings();
  const [status, setStatus] = useState<AccessStatus>("checking");

  useEffect(() => {
    if (isLoading) return;

    if (!isLoggedIn) {
      setStatus("need_login");
      return;
    }

    if (user?.role === "admin") {
      setStatus("ok");
      return;
    }

    if (!walletConnected) {
      setStatus("need_wallet");
      return;
    }

    getDidStatus()
      .then((s) => {
        setStatus(s.did_status === "verified" ? "ok" : "need_did");
      })
      .catch(() => setStatus("need_did"));
  }, [isLoggedIn, isLoading, user?.email, user?.role, walletConnected]);

  return status;
}
