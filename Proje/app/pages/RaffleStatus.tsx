import { useEffect, useState, useCallback } from "react";
import { Star, Ticket, RefreshCw, AlertCircle, Loader2, ChevronRight } from "lucide-react";
import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { useAppSettings } from "../context/AppSettingsContext";

// ─── 타입 ─────────────────────────────────────────────────

interface RaffleNFT {
  id:            string;
  status:        "ISSUED" | "ENTERED" | "WINNER" | "LOST" | "USED" | "EXPIRED";
  game_id:       string | null;
  draw_id:       string | null;
  game_date:     string | null;
  home_team:     string | null;
  away_team:     string | null;
  issued_at:     string;
}

interface Draw {
  id:           string;
  game_id:      string;
  status:       "PENDING" | "COMPLETED";
  winner_count: number;
  total_entries: number;
  entry_count:  number;
  game_date:    string;
  home_team:    string;
  away_team:    string;
}

// ─── 상태 뱃지 ───────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  ISSUED:  { label: "보유 중",    color: "#1456a0", bg: "#e8f0fb" },
  ENTERED: { label: "응모 완료",  color: "#6d28d9", bg: "#ede9fe" },
  WINNER:  { label: "당첨!",      color: "#059669", bg: "#d1fae5" },
  LOST:    { label: "낙첨",       color: "#6b7280", bg: "#f3f4f6" },
  USED:    { label: "사용 완료",  color: "#374151", bg: "#e5e7eb" },
  EXPIRED: { label: "만료",       color: "#9ca3af", bg: "#f9fafb" },
};

// ─── 메인 컴포넌트 ────────────────────────────────────────

export function RaffleStatus() {
  const navigate = useNavigate();
  const { walletAddress } = useAppSettings();

  const [nfts,       setNfts]       = useState<RaffleNFT[]>([]);
  const [draws,      setDraws]      = useState<Draw[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [entering,   setEntering]   = useState<string | null>(null);
  const [toast,      setToast]      = useState<{ ok: boolean; msg: string } | null>(null);

  const base      = import.meta.env.VITE_API_URL;
  const authToken = () => localStorage.getItem("auth_token") || "";

  const fetchData = useCallback(async (silent = false) => {
    if (!walletAddress) return;
    if (!silent) setLoading(true);
    try {
      const [nftRes, drawRes] = await Promise.all([
        fetch(`${base}/api/raffle/my?walletAddress=${walletAddress}`, {
          headers: { Authorization: `Bearer ${authToken()}` },
        }),
        fetch(`${base}/api/raffle/draws`),
      ]);
      const nftData  = await nftRes.json();
      const drawData = await drawRes.json();
      if (nftData.success)  setNfts(nftData.data);
      if (drawData.success) setDraws(drawData.data);
    } catch (err) {
      console.error("[RaffleStatus] fetchData error:", err);
    } finally {
      setLoading(false);
    }
  }, [walletAddress, base]);

  useEffect(() => { fetchData(true); }, [fetchData]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") fetchData(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchData]);

  const showToast = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 3500);
  };

  const handleEnterDraw = async (raffleNftId: string, drawId: string) => {
    if (!walletAddress || entering) return;
    setEntering(raffleNftId);
    try {
      const res = await fetch(`${base}/api/raffle/enter`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raffleNftId, walletAddress, drawId }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(true, "추첨 응모가 완료되었습니다!");
        fetchData(true);
      } else {
        showToast(false, data.error ?? "응모 실패");
      }
    } catch {
      showToast(false, "서버 오류가 발생했습니다");
    } finally {
      setEntering(null);
    }
  };

  const issuedNfts  = nfts.filter(n => n.status === "ISSUED");
  const winnerNfts  = nfts.filter(n => n.status === "WINNER");
  const otherNfts   = nfts.filter(n => !["ISSUED"].includes(n.status));
  const pendingDraws = draws.filter(d => d.status === "PENDING");

  return (
    <div className="page-shell max-w-lg mx-auto">
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <p className="page-eyebrow text-[#1456a0] mb-3">Raffle</p>
            <h1 className="page-title mb-3" style={{ color: "#14253f" }}>응모권 NFT</h1>
            <p className="page-subtitle" style={{ color: "#55657d" }}>
              추첨에 참여하고 우선 예매 기회를 얻으세요
            </p>
          </div>
          <button
            onClick={() => fetchData()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium"
            style={{ background: "#f0f6ff", color: "#1456a0", border: "1px solid #bfd0e2" }}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "조회 중" : "새로고침"}
          </button>
        </div>
      </div>

      {!walletAddress ? (
        <div className="rounded-2xl px-6 py-10 text-center"
          style={{ background: "#f8fbfd", border: "1px solid #d8e3ec" }}>
          <AlertCircle className="w-10 h-10 mx-auto mb-3" style={{ color: "#9ca3af" }} />
          <p className="font-semibold" style={{ color: "#21354b" }}>MetaMask 지갑을 연결해주세요</p>
        </div>
      ) : (
        <div className="space-y-6">

          {/* 당첨된 응모권 → 우선 예매 안내 */}
          {winnerNfts.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl p-5"
              style={{ background: "linear-gradient(135deg, #059669, #10b981)", boxShadow: "0 12px 32px rgba(5,150,105,0.25)" }}
            >
              <div className="flex items-center gap-3 mb-3">
                <Star className="w-6 h-6 text-white" />
                <p className="font-bold text-white text-lg">당첨 축하드립니다! 🎉</p>
              </div>
              <p className="text-white/80 text-sm mb-4">
                {winnerNfts.length}개의 응모권이 당첨되었습니다. 우선 예매 페이지에서 티켓을 구매하세요.
              </p>
              <Button
                onClick={() => navigate("/priority-booking")}
                className="w-full h-10 font-bold rounded-xl text-sm"
                style={{ background: "rgba(255,255,255,0.2)", color: "#fff", border: "1px solid rgba(255,255,255,0.3)" }}
              >
                우선 예매하러 가기 <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </motion.div>
          )}

          {/* 진행 중인 추첨 */}
          {pendingDraws.length > 0 && (
            <section>
              <h2 className="text-sm font-bold mb-3" style={{ color: "#34465c" }}>진행 중인 추첨</h2>
              <div className="space-y-3">
                {pendingDraws.map(draw => (
                  <div key={draw.id} className="rounded-2xl p-4"
                    style={{ background: "#fff", border: "1px solid #e2ebf4", boxShadow: "0 4px 12px rgba(17,40,73,0.05)" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-sm" style={{ color: "#14253f" }}>
                          {draw.home_team} vs {draw.away_team}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: "#6d7d90" }}>
                          {draw.game_date} · 응모 {draw.entry_count}/{draw.winner_count} 명
                        </p>
                      </div>
                      {issuedNfts.length > 0 ? (
                        <Button
                          className="h-9 px-4 text-xs font-bold text-white rounded-xl flex-shrink-0"
                          style={{ background: "linear-gradient(135deg, #1456a0, #2563eb)" }}
                          disabled={!!entering}
                          onClick={() => handleEnterDraw(issuedNfts[0].id, draw.id)}
                        >
                          {entering === issuedNfts[0].id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : "응모하기"}
                        </Button>
                      ) : (
                        <span className="text-xs px-3 py-1.5 rounded-lg"
                          style={{ background: "#f3f4f6", color: "#9ca3af" }}>
                          응모권 없음
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 보유 중인 응모권 */}
          {issuedNfts.length > 0 && (
            <section>
              <h2 className="text-sm font-bold mb-3" style={{ color: "#34465c" }}>보유 중인 응모권</h2>
              <div className="grid grid-cols-2 gap-3">
                {issuedNfts.map(nft => (
                  <NftCard key={nft.id} nft={nft} />
                ))}
              </div>
            </section>
          )}

          {/* 내 응모 내역 */}
          {otherNfts.length > 0 && (
            <section>
              <h2 className="text-sm font-bold mb-3" style={{ color: "#34465c" }}>응모 내역</h2>
              <div className="space-y-2">
                {otherNfts.map(nft => (
                  <div key={nft.id} className="flex items-center justify-between rounded-xl px-4 py-3"
                    style={{ background: "#f8fafc", border: "1px solid #e2ebf4" }}>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "#14253f" }}>
                        {nft.home_team && nft.away_team
                          ? `${nft.home_team} vs ${nft.away_team}`
                          : "응모권 NFT"}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "#8a9aac" }}>
                        {nft.game_date ?? nft.issued_at?.slice(0, 10)}
                      </p>
                    </div>
                    {(() => {
                      const meta = STATUS_META[nft.status] ?? STATUS_META.EXPIRED;
                      return (
                        <span className="text-xs font-bold px-2.5 py-1 rounded-lg"
                          style={{ background: meta.bg, color: meta.color }}>
                          {meta.label}
                        </span>
                      );
                    })()}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 빈 상태 */}
          {nfts.length === 0 && !loading && (
            <div className="rounded-2xl px-6 py-12 text-center"
              style={{ background: "#f8fbfd", border: "1px solid #d8e3ec" }}>
              <Star className="w-10 h-10 mx-auto mb-3" style={{ color: "#d1d5db" }} />
              <p className="font-semibold mb-1" style={{ color: "#21354b" }}>응모권 NFT가 없습니다</p>
              <p className="text-sm mb-5" style={{ color: "#8a9aac" }}>
                포인트 교환소에서 1,500P로 응모권을 획득하세요
              </p>
              <Button
                onClick={() => navigate("/point-exchange")}
                className="h-10 px-6 text-sm font-bold text-white rounded-xl"
                style={{ background: "linear-gradient(135deg, #1456a0, #2563eb)" }}
              >
                포인트 교환소 가기
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-lg z-50"
          style={{ background: toast.ok ? "#2dba73" : "#ef4444" }}
        >
          {toast.msg}
        </motion.div>
      )}
    </div>
  );
}

// ─── NFT 카드 컴포넌트 ────────────────────────────────────

function NftCard({ nft }: { nft: RaffleNFT }) {
  const meta = STATUS_META[nft.status] ?? STATUS_META.EXPIRED;
  return (
    <div className="rounded-2xl p-4"
      style={{ background: "#fff", border: "1px solid #e2ebf4", boxShadow: "0 4px 12px rgba(17,40,73,0.05)" }}>
      <div className="flex items-center justify-between mb-3">
        <Star className="w-5 h-5" style={{ color: "#f59e0b" }} />
        <span className="text-xs font-bold px-2 py-0.5 rounded-lg"
          style={{ background: meta.bg, color: meta.color }}>
          {meta.label}
        </span>
      </div>
      <p className="text-xs font-semibold" style={{ color: "#14253f" }}>응모권 NFT</p>
      <p className="text-[0.68rem] mt-1 truncate" style={{ color: "#8a9aac" }}>
        {nft.id.slice(0, 8)}...
      </p>
      <p className="text-[0.68rem] mt-1" style={{ color: "#8a9aac" }}>
        {nft.issued_at?.slice(0, 10)}
      </p>
    </div>
  );
}
