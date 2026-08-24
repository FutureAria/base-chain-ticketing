import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { Bell, Pin, PenLine, Lock, Unlock, Trash2, X, Calendar, Megaphone } from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { authHeaders } from "../lib/authHeaders";

interface Notice {
  id: number;
  title: string;
  content: string;
  date: string;
  type: "공지" | "이벤트" | "업데이트";
  isPinned?: boolean;
  image_url?: string;
}

const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");

export function Notice() {
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem("isAdminMode") === "true");
  const [notices, setNotices] = useState<Notice[]>([]);
  const [selectedTab, setSelectedTab] = useState<"all" | "notice" | "event">("all");
  const [selectedNotice, setSelectedNotice] = useState<Notice | null>(null);

  useEffect(() => {
    localStorage.setItem("isAdminMode", isAdmin.toString());
  }, [isAdmin]);

  const fetchNotices = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/notices`);
      const data = await response.json();
      const formatted: Notice[] = data.map((n: any) => ({
        id: n.id,
        title: n.title,
        content: n.content,
        date: new Date(n.created_at).toLocaleDateString(),
        type: n.type as any,
        isPinned: !!n.is_pinned,
        image_url: n.image_url,
      }));
      setNotices(formatted);
    } catch (error) {
      console.error("로딩 실패:", error);
    }
  };

  useEffect(() => { fetchNotices(); }, []);

  const handleDelete = async (id: number) => {
    if (window.confirm("정말로 이 공지사항을 삭제하시겠습니까?")) {
      try {
        const response = await fetch(`${API_BASE}/api/notices/${id}`, {
          method: "DELETE",
          headers: authHeaders(),
        });
        if (response.ok) {
          alert("삭제되었습니다!");
          setNotices(prev => prev.filter(n => n.id !== id));
          setSelectedNotice(null);
        }
      } catch (error) { console.error(error); }
    }
  };

  const handleDeleteAll = async () => {
    if (window.confirm("⚠️ 경고: 모든 공지사항이 영구적으로 삭제됩니다. 계속하시겠습니까?")) {
      try {
        const response = await fetch(`${API_BASE}/api/notices`, {
          method: "DELETE",
          headers: authHeaders(),
        });
        if (response.ok) {
          alert("모든 공지가 삭제되었습니다!");
          setNotices([]);
        } else {
          alert("전체 삭제 실패");
        }
      } catch (error) {
        console.error("전체 삭제 중 오류:", error);
      }
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "이벤트": return { bg: "#eef4ff", text: "#245ca6", border: "#c9d8ef" };
      case "업데이트": return { bg: "#edf7f1", text: "#28764d", border: "#c7dfd0" };
      default: return { bg: "#fff7e8", text: "#9a6b1b", border: "#ead4a2" };
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "이벤트": return Megaphone;
      case "업데이트": return Bell;
      default: return Bell;
    }
  };

  const filteredNotices = notices.filter(n => {
    if (selectedTab === "all") return true;
    if (selectedTab === "notice") return n.type === "공지";
    return n.type === "이벤트" || n.type === "업데이트";
  });

  return (
    <div className="page-shell space-y-6">
      {/* Header */}
      <div className="page-header flex items-center justify-between rounded-[20px] border bg-white px-6 py-5" style={{ borderColor: "#e2e8f0", boxShadow: "0 8px 24px rgba(17,40,73,0.06)" }}>
        <div className="flex items-center gap-3">
          <div>
            <p
              className="page-eyebrow mb-1 font-bold cursor-pointer transition-colors select-none"
              style={{ color: isAdmin ? "#ef4444" : "#1456a0" }}
              onClick={() => setIsAdmin(!isAdmin)}
            >
              {isAdmin ? "개발자 모드 ON" : "개발자 모드 OFF"}{" "}
              {isAdmin
                ? <Unlock className="w-3 h-3 inline ml-1" />
                : <Lock className="w-3 h-3 inline ml-1 opacity-30" />}
            </p>
            <h1 className="page-title font-bold" style={{ color: "#0f172a" }}>공지사항</h1>
          </div>
        </div>

        {isAdmin && (
          <div className="flex gap-2">
            <Button onClick={handleDeleteAll} variant="outline" className="border-red-200 text-red-500 hover:bg-red-50 rounded-xl">
              <Trash2 className="w-4 h-4 mr-2" /> 전체 삭제
            </Button>
            <Button onClick={() => navigate("/notice/write")} className="bg-[#1e3a8a] text-white rounded-xl shadow-md hover:bg-[#17306f]">
              <PenLine className="w-4 h-4 mr-2" /> 공지 쓰기
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 rounded-[18px] border bg-white p-1.5" style={{ borderColor: "#e2e8f0", boxShadow: "0 6px 18px rgba(17,40,73,0.04)" }}>
        {(["all", "notice", "event"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSelectedTab(tab)}
            className={`flex-1 rounded-[12px] px-4 py-3 font-bold transition-all ${
              selectedTab === tab ? "bg-[#1e3a8a] text-white shadow-sm" : "text-[#64748b] hover:bg-[#f8fafc]"
            }`}
          >
            {tab === "all" ? "전체" : tab === "notice" ? "공지" : "이벤트"}
          </button>
        ))}
      </div>

      {/* Notice List */}
      <div className="space-y-3">
        {filteredNotices.length === 0 ? (
          <div className="rounded-[18px] border border-dashed bg-white py-20 text-center text-[#64748b]" style={{ borderColor: "#cbd5e1" }}>등록된 공지사항이 없습니다.</div>
        ) : (
          filteredNotices.map((notice, index) => {
            const Icon = getTypeIcon(notice.type);
            const colors = getTypeColor(notice.type);
            return (
              <motion.div key={notice.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}>
                <Card
                  className={`group relative cursor-pointer overflow-hidden rounded-[18px] border p-5 transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(17,40,73,0.08)] ${
                    notice.isPinned ? "bg-[#fff7ed] border-[#fed7aa]" : "bg-white border-[#e2e8f0]"
                  }`}
                  style={{ boxShadow: "0 6px 18px rgba(17,40,73,0.04)" }}
                  onClick={() => setSelectedNotice(notice)}
                >
                  <div className="flex items-start gap-4 relative z-10">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: colors.bg, border: `1px solid ${colors.border}` }}>
                      <Icon className="w-6 h-6" style={{ color: colors.text }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          {notice.isPinned && <Pin className="w-4 h-4 text-[#ea580c] fill-[#ea580c]" />}
                          <h3 className="font-bold text-[#1c2f4a] truncate">{notice.title}</h3>
                        </div>
                        <span className="px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap"
                          style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}>
                          {notice.type}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-[#7b8ca4]">
                        <Calendar className="w-4 h-4" />
                        <span>{notice.date}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Notice Detail Modal */}
      <AnimatePresence>
        {selectedNotice && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setSelectedNotice(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-[20px] border border-[#e2e8f0] bg-white shadow-2xl"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white/90 p-6 backdrop-blur-md" style={{ borderColor: "#e2e8f0" }}>
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 rounded-lg text-sm font-semibold"
                    style={{
                      background: getTypeColor(selectedNotice.type).bg,
                      color: getTypeColor(selectedNotice.type).text,
                      border: `1px solid ${getTypeColor(selectedNotice.type).border}`,
                    }}>
                    {selectedNotice.type}
                  </span>
                  <div className="flex items-center gap-2 text-sm text-[#7b8ca4]">
                    <Calendar className="w-4 h-4" />
                    <span>{selectedNotice.date}</span>
                  </div>
                </div>
                <button onClick={() => setSelectedNotice(null)} className="rounded-full p-2 transition-colors hover:bg-[#f8fafc]">
                  <X size={20} className="text-[#64748b]" />
                </button>
              </div>
              <div className="p-8">
                <h2 className="text-2xl font-bold mb-6 text-[#1c2f4a]">{selectedNotice.title}</h2>
                {selectedNotice.image_url && (
                  <div className="mb-6 w-full rounded-2xl overflow-hidden border border-[#edf1f5] shadow-sm bg-white">
                    <img src={`${API_BASE}${selectedNotice.image_url}`} alt="공지 이미지" className="w-full h-auto object-contain" />
                  </div>
                )}
                <div className="text-[#3b4f67] leading-relaxed whitespace-pre-line text-base mb-8">
                  {selectedNotice.content}
                </div>
                <div className="pt-6 border-t flex gap-3">
                  {isAdmin && (
                    <>
                      <Button
                        onClick={() => navigate(`/notice/write/${selectedNotice.id}`)}
                        variant="outline"
                        className="flex-1 border-[#d2dbe5] text-[#1456a0] h-12 rounded-xl"
                      >
                        수정
                      </Button>
                      <Button
                        onClick={() => handleDelete(selectedNotice.id)}
                        variant="outline"
                        className="flex-1 border-red-100 text-red-500 hover:bg-red-50 h-12 rounded-xl"
                      >
                        삭제
                      </Button>
                    </>
                  )}
                  <button
                    onClick={() => setSelectedNotice(null)}
                    className={`${isAdmin ? "w-24" : "flex-1"} h-12 rounded-xl bg-[#1e3a8a] text-white`}
                  >
                    닫기
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
