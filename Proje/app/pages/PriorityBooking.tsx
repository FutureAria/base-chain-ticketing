import { useEffect, useState, useCallback } from "react";
import { Star, Ticket, ChevronRight, AlertCircle, RefreshCw, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { useAppSettings } from "../context/AppSettingsContext";

// ─── 타입 ─────────────────────────────────────────────────

interface RaffleNFT {
  id:        string;
  status:    string;
  game_id:   string | null;
  draw_id:   string | null;
  game_date: string | null;
  home_team: string | null;
  away_team: string | null;
  issued_at: string;
}

interface DrawInfo {
  id:          string;
  game_id:     string;
  game_date:   string;
  home_team:   string;
  away_team:   string;
  winner_count: number;
  status:      string;
}

// ─── 메인 컴포넌트 ────────────────────────────────────────

export function PriorityBooking() {
  const navigate  = useNavigate();
  const { walletAddress } = useAppSettings();

  const [winnerNfts, setWinnerNfts] = useState<RaffleNFT[]>([]);
  const [draws,      setDraws]      = useState<Record<string, DrawInfo>>({});
  const [loading,    setLoading]    = useState(false);

  const base      = import.meta.env.VITE_API_URL;
  const authToken = () => localStorage.getItem("auth_token") || "";

  const fetchData = useCallback(async (silent = false) => {
    if (!walletAddress) return;
    if (!silent) setLoading(true);
    try {
      const res  = await fetch(`${base}/api/raffle/my?walletAddress=${walletAddress}`, {
        headers: { Authorization: `Bearer ${authToken()}` },
      });
      const data = await res.json();
      if (!data.success) return;

      const winners: RaffleNFT[] = data.data.filter(
        (n: RaffleNFT) => n.status === "WINNER"
      );
      setWinnerNfts(winners);

      // draw 정보 조회 (game_id 수집)
      const gameIds = [...new Set(winners.map(n => n.game_id).filter(Boolean))] as string[];
      const drawMap: Record<string, DrawInfo> = {};
      for (const gameId of gameIds) {
        const dRes  = await fetch(`${base}/api/raffle/draws/${gameId}`);
        const dData = await dRes.json();
        if (dData.success && dData.data.length > 0) {
          const completed = dData.data.find((d: DrawInfo) => d.status === "COMPLETED");
          if (completed) drawMap[gameId] = completed;
        }
      }
      setDraws(drawMap);
    } catch (err) {
      console.error("[PriorityBooking] fetchData error:", err);
    } finally {
      setLoading(false);
    }
  }, [walletAddress, base]);

  useEffect(() => { fetchData(true); }, [fetchData]);

  // WINNER NFT를 경기별로 그룹화
  const grouped = winnerNfts.reduce<Record<string, RaffleNFT[]>>((acc, nft) => {
    const key = nft.game_id ?? "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(nft);
    return acc;
  }, {});

  return (
    <div className="page-shell max-w-lg mx-auto">
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <p className="page-eyebrow text-[#1456a0] mb-3">Priority</p>
            <h1 className="page-title mb-3" style={{ color: "#14253f" }}>우선 예매</h1>
            <p className="page-subtitle" style={{ color: "#55657d" }}>
              당첨된 응모권으로 먼저 티켓을 예매하세요
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
      ) : loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#1456a0" }} />
        </div>
      ) : winnerNfts.length === 0 ? (
        <div className="rounded-2xl px-6 py-12 text-center"
          style={{ background: "#f8fbfd", border: "1px solid #d8e3ec" }}>
          <Star className="w-10 h-10 mx-auto mb-3" style={{ color: "#d1d5db" }} />
          <p className="font-semibold mb-1" style={{ color: "#21354b" }}>당첨된 응모권이 없습니다</p>
          <p className="text-sm mb-5" style={{ color: "#8a9aac" }}>
            응모권 NFT를 구매하고 추첨에 참여해보세요
          </p>
          <Button
            onClick={() => navigate("/raffle-status")}
            className="h-10 px-6 text-sm font-bold text-white rounded-xl"
            style={{ background: "linear-gradient(135deg, #1456a0, #2563eb)" }}
          >
            응모권 NFT 보러가기
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 우선 예매 안내 배너 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl p-4"
            style={{ background: "linear-gradient(135deg, #f0f6ff, #e8f0fb)", border: "1px solid #bfd0e2" }}
          >
            <div className="flex items-center gap-2 mb-1">
              <Star className="w-4 h-4" style={{ color: "#1456a0" }} />
              <p className="text-sm font-bold" style={{ color: "#1456a0" }}>우선 예매 안내</p>
            </div>
            <p className="text-xs" style={{ color: "#55657d" }}>
              당첨된 응모권으로 일반 예매 오픈 전에 먼저 티켓을 구매할 수 있습니다.
              티켓 구매 후 응모권은 자동으로 사용 처리됩니다.
            </p>
          </motion.div>

          {/* 경기별 당첨 내역 */}
          {Object.entries(grouped).map(([gameId, nfts]) => {
            const draw     = draws[gameId];
            const firstNft = nfts[0];
            const gameDate = draw?.game_date ?? firstNft.game_date ?? "";
            const homeTeam = draw?.home_team ?? firstNft.home_team ?? "홈팀";
            const awayTeam = draw?.away_team ?? firstNft.away_team ?? "원정팀";

            return (
              <motion.div
                key={gameId}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl p-5"
                style={{ background: "#fff", border: "1px solid #e2ebf4", boxShadow: "0 8px 24px rgba(17,40,73,0.06)" }}
              >
                {/* 경기 정보 */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-lg"
                        style={{ background: "#d1fae5", color: "#059669" }}>
                        당첨 {nfts.length}매
                      </span>
                    </div>
                    <p className="font-bold" style={{ color: "#14253f" }}>
                      {homeTeam} vs {awayTeam}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "#6d7d90" }}>{gameDate}</p>
                  </div>
                  <Ticket className="w-6 h-6 flex-shrink-0" style={{ color: "#1456a0" }} />
                </div>

                {/* 당첨 응모권 목록 */}
                <div className="space-y-2 mb-4">
                  {nfts.map(nft => (
                    <div key={nft.id} className="flex items-center gap-2 text-xs rounded-lg px-3 py-2"
                      style={{ background: "#f5f8fb", border: "1px solid #e2ebf4" }}>
                      <Star className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#f59e0b" }} />
                      <span style={{ color: "#34465c" }}>응모권 NFT</span>
                      <span className="ml-auto font-mono" style={{ color: "#8a9aac" }}>
                        {nft.id.slice(0, 8)}...
                      </span>
                    </div>
                  ))}
                </div>

                {/* 예매 버튼 */}
                <Button
                  onClick={() => navigate(`/tickets/${gameId}/booking?priority=true&raffleNftId=${nfts[0].id}`)}
                  className="w-full h-11 font-bold text-white rounded-xl text-sm flex items-center justify-center gap-2"
                  style={{ background: "linear-gradient(135deg, #059669, #10b981)" }}
                >
                  <Ticket className="w-4 h-4" />
                  우선 예매하기
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </motion.div>
            );
          })}

          {/* 이미 사용된 당첨권 안내 */}
          <div className="rounded-xl px-4 py-3 text-xs"
            style={{ background: "#f5f8fb", border: "1px solid #dbe4ed", color: "#6d7d90" }}>
            <p>우선 예매 기간이 지나면 일반 예매로 전환됩니다. 당첨된 응모권은 기간 내에 사용하세요.</p>
          </div>
        </div>
      )}
    </div>
  );
}
