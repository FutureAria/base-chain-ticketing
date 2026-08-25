import { useState } from "react";
import { motion } from "motion/react";
import { Book, Lock, Star, Award, Trophy, Crown, Zap } from "lucide-react";
import { Card } from "../components/ui/card";

interface FanAsset {
  id: number;
  name: string;
  image: string;
  collected: boolean;
  count?: number;
}

interface Title {
  id: number;
  name: string;
  description: string;
  tier: string;
  icon: string;
  obtained: boolean;
  condition: string;
}

export function Collection() {
  const [selectedTab, setSelectedTab] = useState<"assets" | "titles">("assets");

  const fanAssets: FanAsset[] = [
    { id: 1, name: "개막전 홈런볼 카드", image: "⚾", collected: true, count: 2 },
    { id: 2, name: "승리 세리머니 카드", image: "🙌", collected: true, count: 1 },
    { id: 3, name: "원정 포토카드 #999", image: "📷", collected: true, count: 3 },
    { id: 4, name: "클러치 히어로 카드", image: "🔥", collected: true, count: 1 },
    { id: 5, name: "응원 타월 배지", image: "🧣", collected: true, count: 5 },
    { id: 6, name: "불펜 체인지업 배지", image: "🧤", collected: false },
    { id: 7, name: "끝내기 세리머니 카드", image: "🎉", collected: false },
    { id: 8, name: "포스트시즌 MVP 카드", image: "🏆", collected: false },
    { id: 9, name: "올스타 시리즈 카드", image: "⭐", collected: false },
    { id: 10, name: "원정 응원 배지", image: "🎺", collected: true, count: 2 },
    { id: 11, name: "사인볼 NFT", image: "💎", collected: false },
    { id: 12, name: "팀 컬러 핀", image: "📍", collected: true, count: 8 },
  ];

  const titles: Title[] = [
    {
      id: 1,
      name: "직관 입문자",
      description: "첫 번째 팬 자산을 획득했습니다",
      tier: "브론즈",
      icon: "🥉",
      obtained: true,
      condition: "팬 자산 1개 획득",
    },
    {
      id: 2,
      name: "시즌 수집가",
      description: "10개 이상의 팬 자산을 수집했습니다",
      tier: "실버",
      icon: "🥈",
      obtained: true,
      condition: "팬 자산 10개 획득",
    },
    {
      id: 3,
      name: "구단 아카이브 마스터",
      description: "50개 이상의 팬 자산을 수집했습니다",
      tier: "골드",
      icon: "🥇",
      obtained: false,
      condition: "팬 자산 50개 획득",
    },
    {
      id: 4,
      name: "레전드 직관러",
      description: "특별 팬 자산을 3개 이상 보유했습니다",
      tier: "플래티넘",
      icon: "💎",
      obtained: false,
      condition: "특별 자산 3개 획득",
    },
    {
      id: 5,
      name: "하이라이트 편집장",
      description: "100번 이상 카드 조합에 성공했습니다",
      tier: "골드",
      icon: "⚡",
      obtained: false,
      condition: "조합 100회 성공",
    },
    {
      id: 6,
      name: "연승 루틴러",
      description: "연속으로 5번 조합에 성공했습니다",
      tier: "실버",
      icon: "🍀",
      obtained: true,
      condition: "연속 조합 5회 성공",
    },
    {
      id: 7,
      name: "팬팩 개척자",
      description: "모든 종류의 팬팩을 개봉했습니다",
      tier: "골드",
      icon: "📦",
      obtained: false,
      condition: "모든 팬팩 종류 개봉",
    },
    {
      id: 8,
      name: "볼파크 황제",
      description: "모든 팬 자산을 수집했습니다",
      tier: "다이아",
      icon: "👑",
      obtained: false,
      condition: "모든 팬 자산 획득",
    },
  ];

  const getTierColor = (tier: string) => {
    switch (tier) {
      case "다이아": return "from-[#00d9ff] to-[#0088cc]";
      case "플래티넘": return "from-[#a393d1] to-[#6b5b95]";
      case "골드": return "from-[#ffaa00] to-[#ff6b00]";
      case "실버": return "from-[#e0d9ff] to-[#a393d1]";
      default: return "from-[#ff6b00] to-[#cc5500]";
    }
  };

  const getTierIcon = (tier: string) => {
    switch (tier) {
      case "다이아": return Crown;
      case "플래티넘": return Trophy;
      case "골드": return Award;
      case "실버": return Star;
      default: return Zap;
    }
  };

  const collectedCount = fanAssets.filter(a => a.collected).length;
  const totalCount = fanAssets.length;
  const obtainedTitlesCount = titles.filter(t => t.obtained).length;
  const totalTitlesCount = titles.length;

  return (
    <div className="page-shell space-y-6">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#00d9ff] to-[#0088cc] flex items-center justify-center neon-border-cyan relative overflow-hidden">
              <Book className="w-6 h-6 text-white drop-shadow-lg relative z-10" />
            <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/20"></div>
          </div>
          <div>
            <p className="page-eyebrow text-[#1456a0] mb-2">Collection</p>
            <h1 className="page-title chrome-text">시즌 컬렉션</h1>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-5 neon-border-cyan panel-surface">
          <div className="flex items-center justify-between">
            <div>
              <p className="page-stat-label mb-1.5">수집한 팬 자산</p>
              <p className="page-value text-[#00d9ff]">{collectedCount} / {totalCount}</p>
            </div>
            <div className="text-4xl">🎨</div>
          </div>
        </Card>
        <Card className="p-5 neon-border-pink panel-surface">
          <div className="flex items-center justify-between">
            <div>
              <p className="page-stat-label mb-1.5">획득한 칭호</p>
              <p className="page-value text-[#ff10f0]">{obtainedTitlesCount} / {totalTitlesCount}</p>
            </div>
            <div className="text-4xl">🏆</div>
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 p-1.5 rounded-2xl neon-border-pink panel-surface">
        <button
          onClick={() => setSelectedTab("assets")}
          className={`flex-1 px-4 py-3 rounded-xl font-medium transition-all ${
            selectedTab === "assets"
              ? "bg-gradient-to-r from-[#00d9ff]/30 to-[#0088cc]/30 text-[#00d9ff] neon-border-cyan"
              : "text-[#a393d1] hover:text-[#00d9ff]"
          }`}
        >
          자산
        </button>
        <button
          onClick={() => setSelectedTab("titles")}
          className={`flex-1 px-4 py-3 rounded-xl font-medium transition-all ${
            selectedTab === "titles"
              ? "bg-gradient-to-r from-[#ff10f0]/30 to-[#bd00e8]/30 text-[#ff10f0] neon-border-pink"
              : "text-[#a393d1] hover:text-[#00d9ff]"
          }`}
        >
          칭호
        </button>
      </div>

      {/* 팬 자산 그리드 */}
      {selectedTab === "assets" && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {fanAssets.map((asset, index) => (
            <motion.div
              key={asset.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.05 }}
          >
              <Card className={`p-4 transition-all relative overflow-hidden panel-surface ${
                asset.collected 
                  ? "neon-border-cyan hover:neon-border-pink cursor-pointer group" 
                  : "opacity-60 neon-border-pink"
              }`}>
                {!asset.collected && (
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-10">
                    <div className="text-center">
                      <Lock className="w-8 h-8 mx-auto mb-2 text-[#a393d1]" />
                      <p className="text-xs text-[#a393d1]">미획득</p>
                    </div>
                  </div>
                )}
                
                <div className={`aspect-square rounded-lg glass-strong mb-3 flex items-center justify-center text-6xl relative overflow-hidden ${
                  asset.collected ? "group-hover:scale-110" : ""
                } transition-transform`}>
                  <span style={{ filter: asset.collected ? "none" : "grayscale(100%)" }}>
                    {asset.image}
                  </span>
                </div>

                <h3 className="text-[0.95rem] font-semibold mb-2 text-[#f6f2ff] truncate">{asset.name}</h3>

                <div className="flex items-center justify-end">
                  {asset.collected && asset.count && (
                    <span className="text-xs text-[#00d9ff] font-bold">×{asset.count}</span>
                  )}
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Titles List */}
      {selectedTab === "titles" && (
        <div className="space-y-3">
          {["다이아", "플래티넘", "골드", "실버", "브론즈"].map(tier => {
            const tierTitles = titles.filter(t => t.tier === tier);
            if (tierTitles.length === 0) return null;

            const TierIcon = getTierIcon(tier);

            return (
              <div key={tier} className="space-y-3">
                <div className="flex items-center gap-2">
                  <TierIcon className="w-5 h-5" style={{ 
                    color: tier === "다이아" ? "#00d9ff" : tier === "골드" ? "#ffaa00" : "#a393d1",
                    filter: `drop-shadow(0 0 8px ${tier === "다이아" ? "rgba(0, 217, 255, 0.8)" : tier === "골드" ? "rgba(255, 170, 0, 0.8)" : "rgba(163, 147, 209, 0.8)"})`
                  }} />
                  <h3 className="text-lg font-semibold tracking-[-0.03em]" style={{
                    color: tier === "다이아" ? "#00d9ff" : tier === "골드" ? "#ffaa00" : "#e0d9ff",
                    textShadow: `0 0 10px ${tier === "다이아" ? "rgba(0, 217, 255, 0.8)" : tier === "골드" ? "rgba(255, 170, 0, 0.8)" : "transparent"}`
                  }}>
                    {tier}
                  </h3>
                </div>

                {tierTitles.map((title, index) => (
                  <motion.div
                    key={title.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    <Card className={`p-5 transition-all relative overflow-hidden panel-surface ${
                      title.obtained
                        ? "neon-border-cyan hover:neon-border-pink cursor-pointer group"
                        : "opacity-60 neon-border-pink"
                    }`}>
                      {!title.obtained && (
                        <div className="absolute top-4 right-4 z-10">
                          <Lock className="w-6 h-6 text-[#a393d1]" />
                        </div>
                      )}

                      <div className="flex items-start gap-4">
                        <div className={`w-16 h-16 rounded-xl glass-strong flex items-center justify-center text-4xl flex-shrink-0 relative overflow-hidden ${
                          title.obtained ? "" : "grayscale"
                        }`}>
                          <div className={`absolute inset-0 bg-gradient-to-br ${getTierColor(title.tier)}/20`}></div>
                          <span className="relative z-10">{title.icon}</span>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div>
                              <h4 className={`section-title text-[1.12rem] mb-1 ${title.obtained ? "text-white chrome-text" : "text-[#a393d1]"}`}>
                                {title.name}
                              </h4>
                              <p className="page-muted">{title.description}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 mt-3">
                            <span className={`px-2 py-1 rounded-lg bg-gradient-to-r ${getTierColor(title.tier)} text-white text-xs font-semibold`}>
                              {title.tier}
                            </span>
                            <span className="page-stat-label">
                              {title.condition}
                            </span>
                          </div>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
