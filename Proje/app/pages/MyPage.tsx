import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Copy,
  Wallet,
  Fingerprint,
  LogIn,
  Loader2,
  FileText,
  MessageCircle,
  Bookmark,
  ChevronRight,
  Store,
  ExternalLink,
} from "lucide-react";
import { GiBaseballBat, GiBaseballGlove } from "react-icons/gi";
import { FaBaseballBall, FaTrophy } from "react-icons/fa";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { useAppSettings } from "../context/AppSettingsContext";
import { useAuth } from "../context/AuthContext";
import { connectWalletToServer, getChallenge, verifySignature } from "../api/walletApi";
import { createDid, getDidStatus, type DidStatus } from "../api/didApi";

type Preferences = {
  ticketAlerts: boolean;
  requireTradeSignature: boolean;
  hideWalletAddress: boolean;
};

const PREFERENCES_STORAGE_KEY = "base-chain-user-preferences-v1";
const INITIAL_TX_VISIBLE_COUNT = 5;

const defaultPreferences: Preferences = {
  ticketAlerts: true,
  requireTradeSignature: true,
  hideWalletAddress: true,
};

function loadPreferences() {
  if (typeof window === "undefined") return defaultPreferences;
  const stored = localStorage.getItem(PREFERENCES_STORAGE_KEY);
  if (!stored) return defaultPreferences;
  try {
    return { ...defaultPreferences, ...(JSON.parse(stored) as Partial<Preferences>) };
  } catch {
    return defaultPreferences;
  }
}

// DID 인증 단계 배지
function StepBadge({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: done ? "#5c8066" : "#d0d8e2" }}
      >
        {done && <CheckCircle2 className="w-3 h-3 text-white" />}
      </div>
      <span className="text-[0.82rem]" style={{ color: done ? "#22364b" : "#8a9aac" }}>{label}</span>
    </div>
  );
}

export function MyPage() {
  const navigate = useNavigate();
  const {
    walletAddress,
    walletChainId,
    walletConnected,
    walletProviderName,
    walletError,
    isConnectingWallet,
    connectWallet,
    disconnectWallet,
  } = useAppSettings();
  const { isLoggedIn, user } = useAuth();
  const [preferences] = useState<Preferences>(loadPreferences);

  // 멤버십 티어
  const [memberTier, setMemberTier] = useState<string>("...");
  useEffect(() => {
    if (!isLoggedIn) return;
    const token = localStorage.getItem("auth_token") ?? "";
    fetch(`${import.meta.env.VITE_API_URL}/api/auth/membership`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(d => { if (d.success) setMemberTier(d.joined ? d.currentTier : "미가입"); }).catch(() => {});
  }, [isLoggedIn]);

  // DID 상태
  const [didStatus, setDidStatus] = useState<DidStatus | null>(null);
  const [isDIDLoading, setIsDIDLoading] = useState(false);
  const [didError, setDidError] = useState<string | null>(null);

  // 트랜잭션 이력
  type TxLog = { id: string; label: string; txHash: string; createdAt: string; explorerUrl: string; };
  const [txLogs, setTxLogs] = useState<TxLog[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txExpanded, setTxExpanded] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) return;
    setTxLoading(true);
    fetch(`${import.meta.env.VITE_API_URL}/api/tx-history`, {
      headers: { Authorization: `Bearer ${localStorage.getItem("auth_token") ?? ""}` },
    })
      .then(r => r.json())
      .then(d => { if (d.success) setTxLogs(d.data); })
      .catch(() => {})
      .finally(() => setTxLoading(false));
  }, [isLoggedIn]);

  useEffect(() => {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  // 로그인 상태이면 DID 상태 불러오기
  useEffect(() => {
    if (!isLoggedIn) return;
    getDidStatus()
      .then(setDidStatus)
      .catch(() => { /* 미인증 상태면 무시 */ });
  }, [isLoggedIn]);

  const nickname = user?.nickname ?? localStorage.getItem("nickname") ?? "사용자";
  const memberId = useMemo(() => {
    const seed = nickname
      .split("")
      .reduce((sum, char) => sum + char.charCodeAt(0), 0)
      .toString()
      .padStart(6, "0");
    return `BN-${seed.slice(0, 6)}`;
  }, [nickname]);

  const visibleWalletAddress = walletAddress
    ? preferences.hideWalletAddress
      ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
      : walletAddress
    : "연결된 지갑 없음";

  const networkLabel =
    walletChainId === "0x1"
      ? "Ethereum Mainnet"
      : walletChainId === "0x89"
        ? "Polygon"
        : walletChainId === "0xaa36a7"
          ? "Sepolia"
          : walletChainId
            ? `체인 ${walletChainId}`
            : "네트워크 확인 전";

  // 전체 DID 인증 흐름: 지갑등록 → nonce발급 → 서명 → 검증 → DID생성
  async function handleDIDVerify() {
    setIsDIDLoading(true);
    setDidError(null);
    try {
      // MetaMask 설치 여부 확인
      if (!window.ethereum) {
        throw new Error("MetaMask가 설치되어 있지 않습니다. 브라우저에 MetaMask 확장 프로그램을 설치해주세요.");
      }

      // 1. MetaMask 잠금 해제 및 계정 연결 (이미 연결돼 있어도 재확인)
      const eth = window.ethereum as {
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      };
      // wallet_requestPermissions → MetaMask 계정 선택 팝업 강제 표시
      await eth.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
      const accounts = await eth.request({ method: "eth_accounts" }) as string[];
      if (!accounts || accounts.length === 0) {
        throw new Error("MetaMask에서 계정을 찾을 수 없습니다.");
      }
      const currentAddress = accounts[0];

      // 2. 서버에 지갑 주소 등록
      await connectWalletToServer(currentAddress);

      // 3. nonce 발급
      const { nonce } = await getChallenge();

      // 4. MetaMask personal_sign 서명 요청
      const signature = await eth.request({
        method: "personal_sign",
        params: [nonce, currentAddress],
      }) as string;

      // 5. 서버에서 서명 검증
      await verifySignature(signature);

      // 6. DID 생성
      await createDid();

      // 7. 상태 갱신
      const status = await getDidStatus();
      setDidStatus(status);
      window.dispatchEvent(new Event("base-chain-wallet-refresh"));
    } catch (err: unknown) {
      // MetaMask 사용자 거부
      if (typeof err === "object" && err !== null && "code" in err && (err as { code: number }).code === 4001) {
        setDidError("MetaMask 서명 요청을 거부했습니다. 팝업에서 '서명'을 눌러주세요.");
      } else {
        setDidError(err instanceof Error ? err.message : "DID 인증 실패");
      }
    } finally {
      setIsDIDLoading(false);
    }
  }

  const isDidVerified = didStatus?.did_status === "verified";
  const authSteps = didStatus?.auth_steps;
  const visibleTxLogs = txExpanded ? txLogs : txLogs.slice(0, INITIAL_TX_VISIBLE_COUNT);
  const hiddenTxCount = Math.max(0, txLogs.length - INITIAL_TX_VISIBLE_COUNT);

  return (
    <div className="page-shell space-y-8">
      <div className="page-header">
        <div>
          <p className="page-eyebrow mb-3" style={{ color: "#1456a0" }}>My Page</p>
          <h1 className="page-title mb-3" style={{ color: "#1f3248" }}>내 설정</h1>
          
        </div>
      </div>

      {/* 프로필 카드 */}
      <section
        className="rounded-[24px] border px-6 py-6"
        style={{ background: "#f8fafc", borderColor: "#d6dfe8", boxShadow: "0 10px 24px rgba(17, 40, 73, 0.05)" }}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-[18px] text-xl font-bold text-white"
              style={{ background: "linear-gradient(135deg, #546d88, #71907e)" }}
            >
              {nickname.charAt(0)}
            </div>
            <div>
              <p className="text-[1.3rem] font-bold" style={{ color: "#1f3248" }}>{nickname}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.8rem]" style={{ color: "#6d7d90" }}>
                <span className="rounded-full border px-2.5 py-1" style={{ background: "#eef2f6", borderColor: "#d0d8e2" }}>
                  회원 ID {memberId}
                </span>
                {isLoggedIn && (
                  <span className="rounded-full border px-2.5 py-1" style={{ background: "#eef2f6", borderColor: "#d0d8e2" }}>
                    {user?.email}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { icon: Wallet, label: "지갑 상태", value: walletConnected ? "연결됨" : "미연결" },
              { icon: Fingerprint, label: "DID 인증", value: isDidVerified ? "인증" : "미인증" },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="rounded-[16px] border px-4 py-4" style={{ background: "#eef2f6", borderColor: "#d3dbe4" }}>
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4" style={{ color: "#546d88" }} />
                    <p className="text-[0.75rem] font-semibold" style={{ color: "#6d7d90" }}>{item.label}</p>
                  </div>
                  <p className="mt-2 text-[0.95rem] font-bold" style={{ color: "#1f3248" }}>{item.value}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 내 활동 내역 */}
      <section
        className="rounded-[24px] border px-6 py-6 flex flex-col"
        style={{ background: "#f8fafc", borderColor: "#d6dfe8", boxShadow: "0 10px 24px rgba(17, 40, 73, 0.05)" }}
      >
        <div className="mb-6 flex items-center gap-3">
          <h2 className="section-title text-[1.15rem]" style={{ color: "#1f3248" }}>내 활동 내역</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          {[
            { icon: FileText,      label: "내 글",   count: "0", bg: "#eff6ff", text: "#3b82f6", border: "#dbeafe" },
            { icon: MessageCircle, label: "내 댓글", count: "0", bg: "#f0fdf4", text: "#22c55e", border: "#dcfce7" },
            { icon: Bookmark,      label: "북마크",  count: "0", bg: "#fefce8", text: "#ca8a04", border: "#fef9c3" },
            { icon: Store,         label: "매물",    count: "0", bg: "#faf5ff", text: "#a855f7", border: "#f3e8ff" },
          ].map((item) => (
            <button
              key={item.label}
              className="rounded-[24px] border h-[140px] transition-all hover:brightness-95 group flex flex-col items-center justify-center gap-2"
              style={{ background: item.bg, borderColor: item.border }}
            >
              <div className="text-center">
                <p className="text-[1rem] font-bold" style={{ color: item.text, opacity: 0.9 }}>{item.label}</p>
                <p className="text-[1.8rem] font-black" style={{ color: item.text }}>{item.count}</p>
              </div>
            </button>
          ))}
          <button
            type="button"
            onClick={() => navigate("/mypage/membership")}
            className="group relative col-span-2 overflow-hidden rounded-[24px] border h-[140px] transition-all hover:brightness-95 md:col-span-1"
            style={{
              background: "linear-gradient(145deg, #f8fbff 0%, #eefcf7 100%)",
              borderColor: { 미가입: "#9ca3af", 베이직: "#9ca3af", 브론즈: "#d97706", 실버: "#94a3b8", 골드: "#f59e0b" }[memberTier] ?? "#94a3b8",
              borderWidth: 2,
            }}
          >
            <div className="flex h-full flex-col items-center justify-center gap-1.5">
              <div
                className="relative flex h-12 w-12 items-center justify-center"
                style={{
                  clipPath: "polygon(50% 3%, 92% 25%, 92% 75%, 50% 97%, 8% 75%, 8% 25%)",
                  background: `linear-gradient(145deg, ${{ 미가입: "#9ca3af", 베이직: "#9ca3af", 브론즈: "#d97706", 실버: "#94a3b8", 골드: "#f59e0b" }[memberTier] ?? "#94a3b8"}, ${{ 미가입: "#6b7280", 베이직: "#6b7280", 브론즈: "#b45309", 실버: "#475569", 골드: "#d97706" }[memberTier] ?? "#475569"})`,
                }}
              >
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full border-2"
                  style={{
                    background: "linear-gradient(145deg, #f8fafc, #cbd5e1)",
                    borderColor: "#f8fafc",
                    color: { 미가입: "#6b7280", 베이직: "#6b7280", 브론즈: "#b45309", 실버: "#64748b", 골드: "#d97706" }[memberTier] ?? "#64748b",
                  }}
                >
                  {memberTier === "골드" ? (
                    <FaTrophy className="h-5 w-5" />
                  ) : memberTier === "브론즈" ? (
                    <div className="relative h-6 w-6">
                      <GiBaseballBat className="absolute left-0 top-0 h-6 w-6 -rotate-[32deg]" />
                      <FaBaseballBall className="absolute bottom-0 right-0 h-3 w-3" />
                    </div>
                  ) : memberTier === "베이직" || memberTier === "미가입" ? (
                    <FaBaseballBall className="h-5 w-5" />
                  ) : (
                    <GiBaseballGlove className="h-6 w-6" />
                  )}
                </div>
              </div>
              <div className="text-center">
                <p className="text-[1rem] font-bold leading-tight" style={{ color: "#3f4e68" }}>멤버십</p>
                <p className="text-[1.35rem] font-black leading-tight" style={{ color: { 미가입: "#6b7280", 베이직: "#6b7280", 브론즈: "#b45309", 실버: "#64748b", 골드: "#d97706" }[memberTier] ?? "#64748b" }}>{memberTier}</p>
              </div>
              <span className="mt-1 inline-flex items-center gap-1 text-[0.76rem] font-extrabold" style={{ color: "#475569" }}>
                정보 보기
                <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </div>
          </button>
        </div>
      </section>

      <div className="space-y-6">
          {/* 지갑 연결 */}
          <section
            className="rounded-[24px] border px-6 py-6"
            style={{ background: "#f8fafc", borderColor: "#d6dfe8", boxShadow: "0 10px 24px rgba(17, 40, 73, 0.05)" }}
          >
            <div className="mb-5 flex items-center gap-3">
              <div>
                <h2 className="section-title text-[1.15rem]" style={{ color: "#1f3248" }}>지갑 연결</h2>
                <p className="page-muted mt-1" style={{ color: "#6d7d90" }}>메타마스크를 연결해서 NFT 티켓과 팬 자산 거래를 인증합니다.</p>
              </div>
            </div>

            <div className="rounded-[18px] border px-4 py-4" style={{ background: "#eef2f6", borderColor: "#d3dbe4" }}>
              <p className="text-[0.76rem] font-semibold" style={{ color: "#6d7d90" }}>현재 상태</p>
              <p className="mt-2 text-[0.98rem] font-bold" style={{ color: "#1f3248" }}>{walletProviderName}</p>
              <div className="mt-3 space-y-2 text-[0.84rem]" style={{ color: "#6d7d90" }}>
                <div className="flex items-center justify-between gap-3">
                  <span>연결 주소</span>
                  <span style={{ color: "#22364b" }}>{visibleWalletAddress}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>네트워크</span>
                  <span style={{ color: "#22364b" }}>{networkLabel}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>공식 거래 서명</span>
                  <span style={{ color: preferences.requireTradeSignature ? "#5c8066" : "#9a7d3e" }}>
                    {preferences.requireTradeSignature ? "활성" : "단순 확인"}
                  </span>
                </div>
              </div>
            </div>

            {walletError && (
              <div className="mt-4 rounded-[16px] border px-4 py-4 text-[0.84rem] leading-6" style={{ background: "#f8efe9", borderColor: "#ead5c7", color: "#8f5d3b" }}>
                {walletError}
              </div>
            )}

            <div className="mt-4 grid gap-2">
              <Button
                className="h-11 rounded-[14px] font-semibold text-white"
                style={{ background: "#526183" }}
                onClick={() => void connectWallet()}
                disabled={isConnectingWallet}
              >
                <Wallet className="mr-2 h-4 w-4" />
                {isConnectingWallet ? "메타마스크 연결 중..." : walletConnected ? "다시 연결 확인" : "메타마스크 연결"}
              </Button>
              <Button
                variant="outline"
                className="h-11 rounded-[14px] font-semibold"
                style={{ background: "#f8fafc", borderColor: "#d0d8e2", color: "#44556c" }}
                onClick={disconnectWallet}
                disabled={!walletConnected}
              >
                연결 해제
              </Button>
              {walletConnected && (
                <Button
                  variant="outline"
                  className="h-11 rounded-[14px] font-semibold"
                  style={{ background: "#f8fafc", borderColor: "#d0d8e2", color: "#44556c" }}
                  onClick={() => navigator.clipboard.writeText(walletAddress ?? "")}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  주소 복사
                </Button>
              )}
            </div>
          </section>

          {/* ─── DID 인증 섹션 ─────────────────────────────── */}
          <section
            id="did"
            className="rounded-[24px] border px-6 py-6"
            style={{ background: "#f8fafc", borderColor: "#d6dfe8", boxShadow: "0 10px 24px rgba(17, 40, 73, 0.05)" }}
          >
            <div className="mb-5 flex items-center gap-3">
              <div>
                <h2 className="section-title text-[1.15rem]" style={{ color: "#1f3248" }}>DID 인증</h2>
                <p className="page-muted mt-1" style={{ color: "#6d7d90" }}>MetaMask 서명으로 지갑 소유권을 검증하고 분산 신원을 등록합니다.</p>
              </div>
            </div>

            {/* 인증 단계 표시 */}
            <div className="rounded-[16px] border px-4 py-4 mb-4 space-y-2.5" style={{ background: "#eef2f6", borderColor: "#d3dbe4" }}>
              <StepBadge done={true} label="1단계: 회원가입 완료" />
              <StepBadge done={Boolean(authSteps?.step2_wallet_connected)} label="2단계: 지갑 연결" />
              <StepBadge done={Boolean(authSteps?.step3_wallet_verified)} label="3단계: 서명 검증" />
              <StepBadge done={Boolean(authSteps?.step4_did_created)} label="4단계: DID 인증 완료" />
            </div>

            {/* 인증 완료 상태 */}
            {isDidVerified ? (
              <div className="rounded-[16px] border px-4 py-4" style={{ background: "#e8f1ec", borderColor: "#c2d8c9" }}>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-4 w-4" style={{ color: "#3d6b4f" }} />
                  <span className="font-semibold text-sm" style={{ color: "#3d6b4f" }}>인증 완료</span>
                </div>
                <p className="text-[0.72rem] font-mono break-all leading-5" style={{ color: "#4a6b56" }}>
                  {didStatus?.did_value}
                </p>
                {didStatus?.did_verified_at && (
                  <p className="mt-2 text-[0.74rem]" style={{ color: "#6d8a76" }}>
                    {new Date(didStatus.did_verified_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })} 인증
                  </p>
                )}
              </div>
            ) : !isLoggedIn ? (
              /* 로그인 안 된 상태 */
              <div className="space-y-3">
                <p className="text-[0.83rem]" style={{ color: "#8a9aac" }}>
                  DID 인증을 위해 먼저 로그인이 필요합니다.
                </p>
                <Button
                  className="w-full h-11 rounded-[14px] font-semibold text-white"
                  style={{ background: "#526183" }}
                  onClick={() => navigate("/login")}
                >
                  <LogIn className="mr-2 h-4 w-4" />
                  로그인하러 가기
                </Button>
              </div>
            ) : !walletConnected ? (
              /* 지갑 미연결 상태 */
              <p className="text-[0.83rem]" style={{ color: "#8a9aac" }}>
                먼저 위에서 MetaMask를 연결해주세요.
              </p>
            ) : (
              /* 인증 가능 상태 */
              <div className="space-y-3">
                <Button
                  className="w-full h-11 rounded-[14px] font-semibold text-white"
                  style={{ background: isDIDLoading ? "#8a9aac" : "#526183" }}
                  onClick={handleDIDVerify}
                  disabled={isDIDLoading}
                >
                  {isDIDLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      인증 진행 중...
                    </>
                  ) : (
                    <>
                      <Fingerprint className="mr-2 h-4 w-4" />
                      DID 인증 시작
                    </>
                  )}
                </Button>
                <p className="text-[0.76rem] leading-5" style={{ color: "#8a9aac" }}>
                  MetaMask 팝업이 열리면 서명 요청을 승인해주세요. 개인키는 서버에 전송되지 않습니다.
                </p>
              </div>
            )}

            {didError && (
              <div className="mt-3 rounded-[12px] border px-4 py-3 text-[0.82rem]" style={{ background: "#f8efe9", borderColor: "#ead5c7", color: "#8f5d3b" }}>
                {didError}
              </div>
            )}
          </section>

          {/* 온체인 트랜잭션 이력 */}
          <section
            className="rounded-[24px] border px-6 py-6 flex flex-col"
            style={{ background: "#f8fafc", borderColor: "#d6dfe8", boxShadow: "0 10px 24px rgba(17,40,73,0.05)" }}
          >
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <h2 className="section-title text-[1.15rem]" style={{ color: "#1f3248" }}>온체인 트랜잭션 이력</h2>
                {txLogs.length > 0 && (
                  <span className="rounded-full border px-2.5 py-1 text-[0.72rem] font-semibold" style={{ background: "#eef2f6", borderColor: "#d0d8e2", color: "#6d7d90" }}>
                    총 {txLogs.length}건
                  </span>
                )}
              </div>
              {hiddenTxCount > 0 && (
                <button
                  type="button"
                  onClick={() => setTxExpanded((current) => !current)}
                  className="inline-flex h-9 items-center justify-center rounded-[10px] border px-3 text-[0.78rem] font-bold transition"
                  style={{ background: "#fff", borderColor: "#d0d8e2", color: "#526183" }}
                >
                  {txExpanded ? "접기" : `${hiddenTxCount}개 더보기`}
                  <ChevronRight className={`ml-1 h-3.5 w-3.5 transition-transform ${txExpanded ? "-rotate-90" : "rotate-90"}`} />
                </button>
              )}
            </div>
            {txLoading ? (
              <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "#526183" }} /></div>
            ) : txLogs.length === 0 ? (
              <p className="text-center text-[0.85rem] py-6" style={{ color: "#8a9aac" }}>온체인 트랜잭션 내역이 없습니다.</p>
            ) : (
              <div className="space-y-3">
                {visibleTxLogs.map(tx => (
                  <div key={tx.id} className="flex items-center justify-between rounded-[14px] border px-4 py-3"
                    style={{ background: "#fff", borderColor: "#e2eaf2" }}>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[0.82rem] font-semibold" style={{ color: "#1f3248" }}>{tx.label}</span>
                      <span className="text-[0.72rem] truncate" style={{ color: "#8a9aac" }}>
                        {new Date(tx.createdAt).toLocaleString("ko-KR")}
                      </span>
                    </div>
                    <a
                      href={tx.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 ml-4 shrink-0 text-[0.75rem] font-medium px-3 py-1.5 rounded-[10px]"
                      style={{ background: "#eef4ff", color: "#3b6cb7", border: "1px solid #c8d8ef" }}
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Hoodi 확인
                    </a>
                  </div>
                ))}
                {hiddenTxCount > 0 && !txExpanded && (
                  <button
                    type="button"
                    onClick={() => setTxExpanded(true)}
                    className="w-full rounded-[14px] border px-4 py-3 text-[0.82rem] font-bold transition"
                    style={{ background: "#eef2f6", borderColor: "#d0d8e2", color: "#526183" }}
                  >
                    나머지 {hiddenTxCount}개 트랜잭션 더보기
                  </button>
                )}
              </div>
            )}
          </section>

      </div>
    </div>
  );
}
