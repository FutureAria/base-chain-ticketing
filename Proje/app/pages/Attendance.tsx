import { useState } from "react";
import { ChevronLeft, ChevronRight, Check, Gift, Sparkles, Calendar, Flame, Key, Package } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Card } from "../components/ui/card";

const STORAGE_KEY = "attendance_dates";

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

// Consecutive streak milestones — boxes & keys only
const STREAK_REWARDS = [
  { streak: 5,  label: "일반 박스",  icon: "📦", color: "#00d9ff",  glow: "rgba(0,217,255,0.6)"  },
  { streak: 7,  label: "열쇠",       icon: "🔑", color: "#ffaa00",  glow: "rgba(255,170,0,0.6)"  },
  { streak: 10, label: "희귀 박스",  icon: "🎁", color: "#00ff88",  glow: "rgba(0,255,136,0.6)"  },
  { streak: 14, label: "영웅 박스",  icon: "⭐", color: "#ff10f0",  glow: "rgba(255,16,240,0.6)" },
  { streak: 21, label: "전설 박스",  icon: "🌟", color: "#bd00e8",  glow: "rgba(189,0,232,0.6)"  },
  { streak: 30, label: "황금 열쇠",  icon: "🗝️", color: "#ffaa00",  glow: "rgba(255,170,0,0.6)"  },
];

function getAttendanceDates(): string[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}
function saveAttendanceDates(dates: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dates));
}
function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Calculate consecutive streak backwards from today */
function calcStreak(attended: string[]): number {
  const today = new Date();
  let count = 0;
  const d = new Date(today);
  while (true) {
    const s = toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
    if (attended.includes(s)) { count++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return count;
}

export function Attendance() {
  const today = new Date();
  const [viewYear, setViewYear]   = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [attended, setAttended]   = useState<string[]>(getAttendanceDates);
  const [showReward, setShowReward] = useState(false);
  const [rewardAnim, setRewardAnim] = useState(false);
  const [earnedReward, setEarnedReward] = useState<typeof STREAK_REWARDS[0] | null>(null);

  const todayStr    = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());
  const todayChecked = attended.includes(todayStr);
  const streak      = calcStreak(attended);

  // Next milestone above current streak
  const nextMilestone = STREAK_REWARDS.find((r) => r.streak > streak);
  // Last reached milestone
  const lastReached   = [...STREAK_REWARDS].reverse().find((r) => r.streak <= streak);

  const daysUntilNext = nextMilestone ? nextMilestone.streak - streak : 0;

  // Progress between last and next milestone
  const progressFrom  = lastReached?.streak ?? 0;
  const progressTo    = nextMilestone?.streak ?? STREAK_REWARDS[STREAK_REWARDS.length - 1].streak;
  const progressPct   = nextMilestone
    ? ((streak - progressFrom) / (progressTo - progressFrom)) * 100
    : 100;

  // Calendar helpers
  const firstDay    = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const isToday   = (d: number) => viewYear === today.getFullYear() && viewMonth === today.getMonth() && d === today.getDate();
  const isChecked = (d: number) => attended.includes(toDateStr(viewYear, viewMonth, d));
  const isFuture  = (d: number) => new Date(viewYear, viewMonth, d) > new Date(today.getFullYear(), today.getMonth(), today.getDate());

  function handleCheckIn() {
    if (todayChecked) return;
    const next = [...attended, todayStr];
    setAttended(next);
    saveAttendanceDates(next);

    const newStreak = calcStreak(next);
    const triggered = STREAK_REWARDS.find((r) => r.streak === newStreak) ?? null;
    setEarnedReward(triggered);
    setShowReward(true);
    setRewardAnim(true);
    setTimeout(() => setRewardAnim(false), 2200);
    setTimeout(() => setShowReward(false), 3600);
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="text-center space-y-3">
        <div className="inline-block p-4 rounded-2xl glass-strong neon-border-pink relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#ff10f0]/20 to-[#00d9ff]/20" />
          <Calendar className="w-14 h-14 text-[#00d9ff] relative z-10"
            style={{ filter: "drop-shadow(0 0 16px rgba(0,217,255,0.9))" }} />
        </div>
        <h1 className="chrome-text text-4xl">출석체크</h1>
        <p className="text-[#00d9ff] neon-cyan">연속 출석으로 박스와 열쇠를 획득하세요</p>
      </div>

      {/* ── Streak Progress Card ── */}
      <Card className="p-6 glass-strong neon-border-pink relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#ff10f0]/10 via-[#bd00e8]/10 to-[#00d9ff]/10" />
        <div className="absolute inset-0 scanlines opacity-5" />

        <div className="relative z-10 space-y-5">
          {/* Top row: streak + next reward info */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            {/* Current streak */}
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#ff6b00] to-[#ffaa00] flex items-center justify-center shrink-0"
                style={{ boxShadow: "0 0 20px rgba(255,107,0,0.55)" }}>
                <Flame className="w-7 h-7 text-white" />
              </div>
              <div>
                <p className="text-[#a393d1] text-xs tracking-widest uppercase">현재 연속 출석</p>
                <p className="text-4xl font-black chrome-text leading-none">
                  {streak}<span className="text-lg text-[#a393d1] ml-1">일</span>
                </p>
              </div>
            </div>

            {/* Divider */}
            <div className="hidden sm:block w-px h-12 bg-white/10" />

            {/* Days until next */}
            <div className="text-center sm:text-right">
              {nextMilestone ? (
                <>
                  <p className="text-[#a393d1] text-xs tracking-widest uppercase mb-0.5">다음 보상까지</p>
                  <p className="text-3xl font-black text-[#00ff88] leading-none"
                    style={{ filter: "drop-shadow(0 0 8px rgba(0,255,136,0.7))" }}>
                    {daysUntilNext}<span className="text-base text-[#a393d1] ml-1">일</span>
                  </p>
                  <p className="text-xs text-[#a393d1] mt-1">
                    {nextMilestone.icon} {nextMilestone.label} ({nextMilestone.streak}일 연속)
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[#ffaa00] text-sm font-bold">🏆 모든 보상 달성!</p>
                  <p className="text-[#a393d1] text-xs mt-1">전설 달성자</p>
                </>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div>
            <div className="flex justify-between text-xs text-[#a393d1] mb-1.5">
              <span>{progressFrom}일</span>
              <span>{progressTo}일 연속 → {nextMilestone?.icon} {nextMilestone?.label ?? "완주"}</span>
            </div>
            <div className="h-3 rounded-full bg-white/10 overflow-hidden relative">
              <motion.div
                className="h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
                style={{
                  background: "linear-gradient(90deg, #ff10f0, #bd00e8, #00d9ff)",
                  boxShadow: "0 0 10px rgba(255,16,240,0.6)",
                }}
              />
              {/* Shimmer */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full"
                style={{ animation: "shimmer 2s infinite" }} />
            </div>
            <div className="flex justify-between text-[10px] text-[#6b5b95] mt-1">
              <span>{streak}일 달성</span>
              <span>{nextMilestone ? `${nextMilestone.streak - streak}일 더 필요` : "완주!"}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Calendar Card ── */}
      <Card className="p-6 glass-strong neon-border-cyan relative overflow-hidden">
        <div className="absolute inset-0 retro-grid opacity-10" />

        {/* Month Navigation */}
        <div className="relative z-10 flex items-center justify-between mb-6">
          <button onClick={prevMonth}
            className="w-10 h-10 rounded-xl glass neon-border-cyan hover:neon-border-pink flex items-center justify-center text-[#00d9ff] hover:text-[#ff10f0] transition-all">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h2 className="text-white chrome-text tracking-widest">
            {viewYear}년 {viewMonth + 1}월
          </h2>
          <button onClick={nextMonth}
            className="w-10 h-10 rounded-xl glass neon-border-cyan hover:neon-border-pink flex items-center justify-center text-[#00d9ff] hover:text-[#ff10f0] transition-all">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Day Labels */}
        <div className="relative z-10 grid grid-cols-7 mb-2">
          {DAY_LABELS.map((d, i) => (
            <div key={d} className={`text-center text-xs font-semibold py-2 tracking-widest ${
              i === 0 ? "text-[#ff6b6b]" : i === 6 ? "text-[#00d9ff]" : "text-[#a393d1]"
            }`}>{d}</div>
          ))}
        </div>

        {/* Grid */}
        <div className="relative z-10 grid grid-cols-7 gap-1.5">
          {cells.map((day, idx) => {
            if (day === null) return <div key={`e-${idx}`} />;
            const checked  = isChecked(day);
            const future   = isFuture(day);
            const today_   = isToday(day);
            const isSun    = idx % 7 === 0;
            const isSat    = idx % 7 === 6;
            return (
              <motion.div
                key={day}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.01, duration: 0.25 }}
                className={`
                  relative aspect-square rounded-xl flex flex-col items-center justify-center gap-0.5
                  ${today_ ? "neon-border-pink" : "border border-white/10"}
                  ${future ? "opacity-30" : ""}
                  ${checked ? "bg-gradient-to-br from-[#00ff88]/15 to-[#00d9ff]/15" : "glass"}
                  ${today_ ? "bg-gradient-to-br from-[#ff10f0]/15 to-[#00d9ff]/15" : ""}
                  transition-all duration-200
                `}
                style={today_ ? { boxShadow: "0 0 12px rgba(255,16,240,0.4)" } : {}}
              >
                <span className={`text-sm font-semibold leading-none ${
                  today_   ? "text-[#ff10f0] neon-pink" :
                  checked  ? "text-[#e0d9ff]" :
                  future   ? "text-[#4a3a6a]" :
                  isSun    ? "text-[#ff6b6b]" :
                  isSat    ? "text-[#00d9ff]" :
                             "text-[#a393d1]"
                }`}>{day}</span>

                <AnimatePresence>
                  {checked && (
                    <motion.div
                      key="chk"
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 320, damping: 18 }}
                      className="w-5 h-5 rounded-full bg-gradient-to-br from-[#00ff88] to-[#00d9ff] flex items-center justify-center"
                      style={{ boxShadow: "0 0 8px rgba(0,255,136,0.7)" }}
                    >
                      <Check className="w-3 h-3 text-white" strokeWidth={3} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="relative z-10 flex items-center gap-5 mt-5 pt-4 border-t border-white/10 flex-wrap">
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-full bg-gradient-to-br from-[#00ff88] to-[#00d9ff] flex items-center justify-center">
              <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
            </div>
            <span className="text-xs text-[#a393d1]">출석 완료</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded-xl border border-[#ff10f0]/60"
              style={{ boxShadow: "0 0 6px rgba(255,16,240,0.4)" }} />
            <span className="text-xs text-[#a393d1]">오늘</span>
          </div>
        </div>
      </Card>

      {/* ── Check-in Button ── */}
      <div className="flex justify-center">
        <motion.button
          onClick={handleCheckIn}
          disabled={todayChecked}
          whileHover={!todayChecked ? { scale: 1.04 } : {}}
          whileTap={!todayChecked ? { scale: 0.97 } : {}}
          className={`px-12 py-4 rounded-2xl font-bold tracking-widest transition-all duration-300 relative overflow-hidden text-lg ${
            todayChecked
              ? "glass border border-[#00ff88]/40 text-[#00ff88] cursor-default"
              : "glass-strong neon-border-pink text-white cursor-pointer"
          }`}
          style={!todayChecked ? {
            background: "linear-gradient(135deg,rgba(255,16,240,.25),rgba(189,0,232,.25),rgba(0,217,255,.25))",
            boxShadow: "0 0 24px rgba(255,16,240,.35), 0 0 48px rgba(255,16,240,.12)",
          } : {}}
        >
          <span className="relative z-10 flex items-center gap-2">
            {todayChecked ? (
              <><Check className="w-5 h-5" style={{ filter: "drop-shadow(0 0 6px rgba(0,255,136,.8))" }} />오늘 출석 완료!</>
            ) : (
              <><Sparkles className="w-5 h-5" style={{ filter: "drop-shadow(0 0 8px rgba(255,16,240,.8))" }} />오늘 출석체크</>
            )}
          </span>
        </motion.button>
      </div>

      {/* ── Streak Reward Milestones ── */}
      <Card className="p-6 glass neon-border-cyan relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#00d9ff]/5 to-[#00ff88]/5" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-5">
            <Gift className="w-5 h-5 text-[#ffaa00]"
              style={{ filter: "drop-shadow(0 0 8px rgba(255,170,0,.8))" }} />
            <h3 className="text-[#e0d9ff]">연속 출석 보상</h3>
            <span className="ml-auto text-xs text-[#a393d1] bg-white/5 px-2 py-1 rounded-lg border border-white/10">
              현재 {streak}일 연속
            </span>
          </div>

          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {STREAK_REWARDS.map((r) => {
              const reached  = streak >= r.streak;
              const isCurrent = streak < r.streak && (!STREAK_REWARDS.find(x => x.streak > streak && x.streak < r.streak));
              const isNext   = nextMilestone?.streak === r.streak;
              return (
                <motion.div
                  key={r.streak}
                  whileHover={{ scale: 1.05 }}
                  className={`rounded-2xl p-3 text-center border relative overflow-hidden transition-all ${
                    reached
                      ? "border-[#00ff88]/50 bg-gradient-to-br from-[#00ff88]/15 to-[#00d9ff]/15"
                      : isNext
                      ? "border-[#ff10f0]/60 bg-gradient-to-br from-[#ff10f0]/10 to-[#bd00e8]/10"
                      : "glass border-white/10"
                  }`}
                  style={reached ? { boxShadow: `0 0 14px ${r.glow}` } : isNext ? { boxShadow: "0 0 12px rgba(255,16,240,.3)" } : {}}
                >
                  {/* Reached overlay glow */}
                  {reached && (
                    <div className="absolute inset-0 rounded-2xl"
                      style={{ background: `radial-gradient(circle at 50% 30%, ${r.glow.replace("0.6","0.15")}, transparent 70%)` }} />
                  )}

                  <div className="relative z-10">
                    <div className="text-3xl mb-1">{r.icon}</div>
                    <p className={`text-[10px] font-bold tracking-wide ${reached ? "text-[#00ff88]" : isNext ? "text-[#ff10f0]" : "text-[#6b5b95]"}`}>
                      {r.streak}일 연속
                    </p>
                    <p className={`text-[10px] mt-0.5 ${reached ? "text-[#e0d9ff]" : isNext ? "text-[#c8b9f0]" : "text-[#4a3a6a]"}`}>
                      {r.label}
                    </p>

                    {reached ? (
                      <div className="mt-1.5 flex justify-center">
                        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#00ff88] to-[#00d9ff] flex items-center justify-center"
                          style={{ boxShadow: "0 0 8px rgba(0,255,136,.7)" }}>
                          <Check className="w-3 h-3 text-white" strokeWidth={3} />
                        </div>
                      </div>
                    ) : isNext ? (
                      <div className="mt-1.5">
                        <span className="text-[9px] text-[#ff10f0] bg-[#ff10f0]/15 px-1.5 py-0.5 rounded-full border border-[#ff10f0]/30">
                          D-{daysUntilNext}
                        </span>
                      </div>
                    ) : (
                      <div className="mt-1.5 w-5 h-5 mx-auto rounded-full border border-white/10" />
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* ── Reward Popup ── */}
      <AnimatePresence>
        {showReward && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0, y: 40 }}
              animate={{ scale: rewardAnim ? 1 : 0.85, opacity: rewardAnim ? 1 : 0, y: rewardAnim ? 0 : -50 }}
              transition={{ type: "spring", stiffness: 260, damping: 18 }}
              className="glass-strong rounded-3xl p-10 text-center relative overflow-hidden"
              style={{
                border: earnedReward ? `1px solid ${earnedReward.color}60` : "1px solid rgba(255,16,240,.5)",
                boxShadow: earnedReward
                  ? `0 0 60px ${earnedReward.glow}, 0 0 120px ${earnedReward.glow.replace("0.6","0.2")}`
                  : "0 0 60px rgba(255,16,240,.5)",
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-[#ff10f0]/15 via-[#bd00e8]/15 to-[#00d9ff]/15" />
              <div className="absolute inset-0 scanlines opacity-10" />
              <div className="relative z-10">
                {earnedReward ? (
                  <>
                    <motion.div
                      animate={{ rotate: [0, -15, 15, -10, 0], scale: [1, 1.3, 1] }}
                      transition={{ duration: 0.7 }}
                      className="text-8xl mb-3"
                    >{earnedReward.icon}</motion.div>
                    <h2 className="chrome-text text-2xl mb-1 neon-pink">보상 획득!</h2>
                    <p className="text-white font-bold text-xl mb-1">{earnedReward.label}</p>
                    <p className="text-[#a393d1] text-sm">{earnedReward.streak}일 연속 출석 달성 🎉</p>
                  </>
                ) : (
                  <>
                    <motion.div
                      animate={{ rotate: [0, -10, 10, -10, 0], scale: [1, 1.2, 1] }}
                      transition={{ duration: 0.6 }}
                      className="text-7xl mb-3"
                    >✅</motion.div>
                    <h2 className="chrome-text text-2xl mb-1 neon-cyan">출석 완료!</h2>
                    <p className="text-[#00d9ff]">{streak}일 연속 출석 중</p>
                    {nextMilestone && (
                      <p className="text-[#a393d1] text-sm mt-1">
                        {nextMilestone.icon} {nextMilestone.label}까지 {daysUntilNext}일 남음
                      </p>
                    )}
                  </>
                )}
                <div className="mt-4 flex justify-center gap-1">
                  {[...Array(5)].map((_, i) => (
                    <motion.span key={i} className="text-lg"
                      initial={{ y: 0, opacity: 1 }}
                      animate={{ y: -28, opacity: 0 }}
                      transition={{ delay: i * 0.1, duration: 0.9, repeat: Infinity, repeatDelay: 0.4 }}>
                      ✨
                    </motion.span>
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
