import { useEffect, useState, useCallback } from "react";
import { Trophy, Play, RefreshCw, Users, CheckCircle, Clock, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "../components/ui/button";

interface Draw {
  id: string;
  game_id: string;
  status: "PENDING" | "COMPLETED";
  winner_count: number;
  total_entries: number;
  entry_count: number;
  executed_at: string | null;
  game_date: string;
  home_team: string;
  away_team: string;
}

interface Winner {
  id: string;
  wallet_address: string;
  nickname: string;
  updated_at: string;
}

export function AdminDraw() {
  const [draws, setDraws] = useState<Draw[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [expandedDraw, setExpandedDraw] = useState<string | null>(null);
  const [winners, setWinners] = useState<Record<string, Winner[]>>({});
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const base = import.meta.env.VITE_API_URL;

  const fetchDraws = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`${base}/api/raffle/draws`);
      const data = await res.json();
      if (data.success) setDraws(data.data);
    } catch (err) {
      console.error("[AdminDraw] fetchDraws:", err);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => { fetchDraws(); }, [fetchDraws]);

  const showToast = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const authHeader = () => {
    const token = localStorage.getItem("auth_token") || "";
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  };

  const executeDraw = async (drawId: string) => {
    if (executing) return;
    setExecuting(drawId);
    try {
      const res = await fetch(`${base}/api/raffle/draw/execute`, {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({ drawId }),
      });
      const data = await res.json();
      if (data.success) {
        const winnerCount = data.data?.winners?.length ?? 0;
        showToast(true, `추첨 완료! 당첨자 ${winnerCount}명 선정됨`);
        await fetchDraws(true);
        setExpandedDraw(drawId);
        fetchWinners(drawId);
      } else {
        showToast(false, data.error ?? "추첨 실행 실패");
      }
    } catch {
      showToast(false, "서버 오류");
    } finally {
      setExecuting(null);
    }
  };

  const fetchWinners = async (drawId: string) => {
    const draw = draws.find(d => d.id === drawId);
    if (!draw) return;
    try {
      const res = await fetch(`${base}/api/raffle/winners/${draw.game_id}`);
      const data = await res.json();
      if (data.success) {
        setWinners(prev => ({ ...prev, [drawId]: data.data }));
      }
    } catch (err) {
      console.error("[AdminDraw] fetchWinners:", err);
    }
  };

  const toggleExpand = (drawId: string) => {
    if (expandedDraw === drawId) {
      setExpandedDraw(null);
    } else {
      setExpandedDraw(drawId);
      if (!winners[drawId]) fetchWinners(drawId);
    }
  };

  const pendingDraws = draws.filter(d => d.status === "PENDING");
  const completedDraws = draws.filter(d => d.status === "COMPLETED");

  return (
    <div className="page-shell max-w-lg mx-auto">
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <p className="page-eyebrow text-[#1456a0] mb-3">Admin</p>
            <h1 className="page-title mb-3" style={{ color: "#14253f" }}>추첨 관리</h1>
            <p className="page-subtitle" style={{ color: "#55657d" }}>
              응모 현황을 확인하고 추첨을 실행하세요
            </p>
          </div>
          <button
            onClick={() => fetchDraws()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium"
            style={{ background: "#f0f6ff", color: "#1456a0", border: "1px solid #bfd0e2" }}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "조회 중" : "새로고침"}
          </button>
        </div>
      </div>

      <div className="space-y-6">

        {/* 진행 중인 추첨 */}
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4" style={{ color: "#1456a0" }} />
            <h2 className="text-sm font-bold" style={{ color: "#34465c" }}>
              응모 진행 중 ({pendingDraws.length})
            </h2>
          </div>

          {pendingDraws.length === 0 ? (
            <div className="rounded-2xl px-5 py-8 text-center"
              style={{ background: "#f8fbfd", border: "1px solid #d8e3ec" }}>
              <p className="text-sm" style={{ color: "#8a9aac" }}>진행 중인 추첨이 없습니다</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingDraws.map(draw => (
                <motion.div
                  key={draw.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl p-5"
                  style={{ background: "#fff", border: "1px solid #e2ebf4", boxShadow: "0 4px 12px rgba(17,40,73,0.05)" }}
                >
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <p className="font-bold" style={{ color: "#14253f" }}>
                        {draw.home_team} vs {draw.away_team}
                      </p>
                      <p className="text-xs mt-1" style={{ color: "#6d7d90" }}>
                        {draw.game_date} · game #{draw.game_id}
                      </p>
                    </div>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-lg"
                      style={{ background: "#fff7ed", color: "#c2620a" }}>
                      응모 진행 중
                    </span>
                  </div>

                  {/* 통계 */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="rounded-xl p-3 text-center"
                      style={{ background: "#f0f6ff", border: "1px solid #d6e4f7" }}>
                      <p className="text-xl font-black" style={{ color: "#1456a0" }}>
                        {draw.entry_count}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "#6d7d90" }}>응모자 수</p>
                    </div>
                    <div className="rounded-xl p-3 text-center"
                      style={{ background: "#f0fbf5", border: "1px solid #c6ebd8" }}>
                      <p className="text-xl font-black" style={{ color: "#059669" }}>
                        {draw.winner_count}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "#6d7d90" }}>당첨자 수</p>
                    </div>
                  </div>

                  <Button
                    className="w-full h-11 font-bold text-white rounded-xl flex items-center justify-center gap-2"
                    style={{ background: executing === draw.id ? "#94a3b8" : "linear-gradient(135deg, #1456a0, #2563eb)" }}
                    disabled={executing === draw.id || draw.entry_count === 0}
                    onClick={() => executeDraw(draw.id)}
                  >
                    {executing === draw.id ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        추첨 실행 중...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        {draw.entry_count === 0 ? "응모자 없음" : "추첨 실행하기"}
                      </>
                    )}
                  </Button>
                  {draw.entry_count === 0 && (
                    <p className="text-xs text-center mt-2" style={{ color: "#9ca3af" }}>
                      응모자가 있어야 추첨을 실행할 수 있습니다
                    </p>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {/* 완료된 추첨 */}
        {completedDraws.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="w-4 h-4" style={{ color: "#059669" }} />
              <h2 className="text-sm font-bold" style={{ color: "#34465c" }}>
                추첨 완료 ({completedDraws.length})
              </h2>
            </div>
            <div className="space-y-3">
              {completedDraws.map(draw => (
                <div key={draw.id} className="rounded-2xl overflow-hidden"
                  style={{ background: "#fff", border: "1px solid #e2ebf4", boxShadow: "0 4px 12px rgba(17,40,73,0.04)" }}>
                  <button
                    className="w-full flex items-center justify-between p-5 text-left"
                    onClick={() => toggleExpand(draw.id)}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-sm" style={{ color: "#14253f" }}>
                          {draw.home_team} vs {draw.away_team}
                        </p>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-lg"
                          style={{ background: "#d1fae5", color: "#059669" }}>
                          완료
                        </span>
                      </div>
                      <p className="text-xs mt-1" style={{ color: "#6d7d90" }}>
                        {draw.game_date} · 응모 {draw.entry_count}명 → 당첨 {draw.winner_count}명
                      </p>
                    </div>
                    {expandedDraw === draw.id
                      ? <ChevronUp className="w-4 h-4 flex-shrink-0" style={{ color: "#8a9aac" }} />
                      : <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: "#8a9aac" }} />
                    }
                  </button>

                  <AnimatePresence>
                    {expandedDraw === draw.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-5 border-t" style={{ borderColor: "#f0f4f8" }}>
                          <div className="flex items-center gap-2 mt-4 mb-3">
                            <Trophy className="w-4 h-4" style={{ color: "#f59e0b" }} />
                            <p className="text-sm font-bold" style={{ color: "#34465c" }}>당첨자 목록</p>
                          </div>
                          {!winners[draw.id] ? (
                            <div className="flex items-center justify-center py-4">
                              <Loader2 className="w-5 h-5 animate-spin" style={{ color: "#94a3b8" }} />
                            </div>
                          ) : winners[draw.id].length === 0 ? (
                            <p className="text-sm text-center py-4" style={{ color: "#9ca3af" }}>
                              당첨자 정보를 불러올 수 없습니다
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {winners[draw.id].map((w, idx) => (
                                <div key={w.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                                  style={{ background: "#f8fafb" }}>
                                  <div className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black text-white flex-shrink-0"
                                    style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)" }}>
                                    {idx + 1}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold truncate" style={{ color: "#14253f" }}>
                                      {w.nickname}
                                    </p>
                                    <p className="text-xs truncate" style={{ color: "#8a9aac" }}>
                                      {w.wallet_address.slice(0, 10)}...{w.wallet_address.slice(-6)}
                                    </p>
                                  </div>
                                  <Users className="w-4 h-4 flex-shrink-0" style={{ color: "#059669" }} />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-lg z-50 whitespace-nowrap"
          style={{ background: toast.ok ? "#2dba73" : "#ef4444" }}
        >
          {toast.msg}
        </motion.div>
      )}
    </div>
  );
}
