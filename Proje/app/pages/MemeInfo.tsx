import { useState } from "react";
import { Coins, Sparkles, X, TrendingUp, User, Calendar, ArrowLeft } from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { motion, AnimatePresence } from "motion/react";
import { LegendaryReveal } from "../components/LegendaryReveal";
const whatTheHoImg =
  "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=900&q=80";

export function MemeInfo() {
  const [selectedMeme, setSelectedMeme] = useState<any>(null);
  const [showLegendary, setShowLegendary] = useState(false);

  const memeCoins = [
    {
      id: 0,
      name: "WHAT 야호",
      fullName: "WHAT 야호",
      icon: null,
      image: whatTheHoImg,
      isLegendary: true,
      price: "₩99,999",
      change: "+999.9%",
      marketCap: "₩∞",
      volume: "₩전설",
      description: "예상과 다른 상황에서 튀어나오는 반응형 표현으로, 순간적인 당황이나 황당함을 과장되게 드러내며 사용되는 밈이다",
      features: ["전설 등급", "극히 희귀", "특별 효과 보유"],
      history: "그땐 그랬지 플랫폼에서만 발행된 단 100개의 초한정판 전설 밈 코인입니다.",
      gradient: "from-[#ffaa00] to-[#ffcc88]",
      tier: "S",
      tierColor: "from-[#ffaa00] to-[#ffcc88]"
    },
    {
      id: 1,
      name: "WHAT 야호",
      fullName: "WHAT 야호",
      icon: "🐸",
      image: null,
      isLegendary: false,
      price: "₩2,450",
      change: "+15.3%",
      marketCap: "₩125B",
      volume: "₩8.5B",
      description: "예상과 다른 상황에서 튀어나오는 반응형 표현으로, 순간적인 당황이나 황당함을 과장되게 드러내며 사용되는 밈이다",
      features: ["밈계의 레전드", "높은 유동성", "커뮤니티 활발"],
      history: "2005년 Matt Furie의 만화에서 처음 등장하여 인터넷 밈 문화의 상징이 되었습니다.",
      gradient: "from-[#ffaa00] to-[#ffcc88]",
      tier: "S",
      tierColor: "from-[#ffaa00] to-[#ffcc88]"
    },
    {
      id: 2,
      name: "노칠가이",
      fullName: "노칠가이",
      icon: "🐕",
      image: null,
      isLegendary: false,
      price: "₩1,890",
      change: "+8.7%",
      marketCap: "₩89B",
      volume: "₩5.2B",
      description: "사소한 상황에도 과하게 반응하거나, 평범한 일을 크게 받아들이는 모습에서 웃음을 유도하는 캐릭터형 밈이다. 일상 속 과장된 감정 표현을 중심으로 확산되었다.",
      features: ["커뮤니티 중심", "친근한 이미지", "글로벌 인기"],
      history: "2013년 농담으로 시작되었지만 현재는 주요 암호화폐 중 하나로 성장했습니다.",
      gradient: "from-[#00d9ff] to-[#1a1a1a]",
      tier: "B",
      tierColor: "from-[#00d9ff] to-[#1a1a1a]"
    },
    {
      id: 3,
      name: "이 탈 것은 내거다",
      fullName: "이 탈 것은 내거다",
      icon: "🦊",
      image: null,
      isLegendary: false,
      price: "₩3,120",
      change: "+22.1%",
      marketCap: "₩156B",
      volume: "₩12.3B",
      description: "특정 대상이나 물건을 실제 소유 여부와 관계없이 자기 것처럼 단정 지으며, 상황을 과장되게 표현하는 데서 사용되는 밈이다. 일상 속 억지 주장이나 자기합리화 장면에서 자주 활용된다.",
      features: ["디파이 생태계", "NFT 통합", "강력한 커뮤니티"],
      history: "2020년 익명의 개발자 Ryoshi가 만든 탈중앙화 밈 토큰입니다.",
      gradient: "from-[#a855f7] to-[#1a1a1a]",
      tier: "A",
      tierColor: "from-[#a855f7] to-[#1a1a1a]"
    },
    {
      id: 4,
      name: "이거 보여줄랬는데 까먹었다",
      fullName: "이거 보여줄랬는데 까먹었다",
      icon: "😢",
      image: null,
      isLegendary: false,
      price: "₩890",
      change: "-2.4%",
      marketCap: "₩34B",
      volume: "₩2.1B",
      description: "무언가를 보여주거나 말하려던 흐름이 있었지만, 정작 핵심을 전달하지 못하고 흐지부지 끝나는 상황에서 사용되는 밈이다. 의도와 결과의 어긋남에서 오는 허무함을 표현한다.",
      features: ["감성 마케팅", "밈 다양성", "커뮤니티 주도"],
      history: "2010년대 초 4chan에서 유명해진 감정 표현 밈 캐릭터입니다.",
      gradient: "from-[#9ca3af] to-[#1a1a1a]",
      tier: "C",
      tierColor: "from-[#9ca3af] to-[#1a1a1a]"
    },
    {
      id: 5,
      name: "고기가 이븐하게 익었어요",
      fullName: "고기가 이븐하게 익었어요",
      icon: "🐶",
      image: null,
      isLegendary: false,
      price: "₩1,650",
      change: "+12.8%",
      marketCap: "₩67B",
      volume: "₩4.8B",
      description: "어떤 대상이나 결과가 한쪽으로 치우치지 않고 균형 있게 완성된 상태를 강조할 때 사용하는 표현형 밈이다. 다양한 상황에서 '균형 잡힘'을 긍정적으로 평가하는 의미로 확장되어 쓰인다.",
      features: ["메타버스 통합", "NFT 게임", "글로벌 마케팅"],
      history: "2021년 커뮤니티 주도로 시작되어 빠르게 성장한 밈 코인입니다.",
      gradient: "from-[#a855f7] to-[#1a1a1a]",
      tier: "A",
      tierColor: "from-[#a855f7] to-[#1a1a1a]"
    },
    {
      id: 6,
      name: "상상도 못했다",
      fullName: "상상도 못했다",
      icon: "🧽",
      image: null,
      isLegendary: false,
      price: "₩2,340",
      change: "+18.9%",
      marketCap: "₩98B",
      volume: "₩7.2B",
      description: "눈앞의 상황을 받아들이지 못하고, 현실이 아닌 것처럼 부정하거나 회피하는 태도를 표현하는 밈이다. 현실을 부정하는 태도에서 아이러니한 웃음을 만든다",
      features: ["재미있는 밈", "활발한 거래", "젊은 층 인기"],
      history: "애니메이션 스폰지밥의 인기를 기반으로 한 밈 토큰입니다.",
      gradient: "from-[#00d9ff] to-[#1a1a1a]",
      tier: "B",
      tierColor: "from-[#00d9ff] to-[#1a1a1a]"
    }
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* LegendaryReveal overlay */}
      <LegendaryReveal show={showLegendary} onClose={() => setShowLegendary(false)} />

      {/* Header */}
      <div className="text-center space-y-4">
        <div className="inline-block p-4 rounded-2xl glass-strong neon-border-pink relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#ff10f0]/20 to-[#00d9ff]/20"></div>
          <Coins className="w-16 h-16 text-[#ffaa00] relative z-10" style={{ filter: 'drop-shadow(0 0 20px rgba(255, 170, 0, 0.9))' }} />
        </div>
        <h1 className="chrome-text text-5xl">밈 코인 소개</h1>
        <p className="text-xl text-[#00d9ff] neon-cyan">다양한 밈 코인과 Y2K 유틸리티 토큰</p>
      </div>

      {/* Meme Coins Grid */}
      <section>
        <h2 className="mb-6 text-center text-[#e0d9ff] neon-pink">인기 밈 코인</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {memeCoins.map((meme) => {
            const isPositive = meme.change.startsWith("+");
            if (meme.isLegendary) {
              // ── WHAT THE HO legendary card ──
              return (
                <motion.div
                  key={meme.id}
                  whileHover={{ scale: 1.03 }}
                  className="md:col-span-2 lg:col-span-3"
                >
                  <Card
                    onClick={() => setShowLegendary(true)}
                    className="p-6 cursor-pointer relative overflow-hidden group"
                    style={{
                      background: "linear-gradient(135deg, rgba(255,170,0,0.15), rgba(255,100,0,0.1), rgba(255,220,0,0.15))",
                      border: "1px solid rgba(255,170,0,0.6)",
                      boxShadow: "0 0 30px rgba(255,170,0,0.25), 0 0 60px rgba(255,100,0,0.1), inset 0 0 30px rgba(255,170,0,0.05)",
                    }}
                  >
                    {/* Animated shimmer overlay */}
                    <motion.div
                      className="absolute inset-0 pointer-events-none"
                      animate={{ x: ["-100%", "200%"] }}
                      transition={{ duration: 3, repeat: Infinity, repeatDelay: 2, ease: "easeInOut" }}
                      style={{
                        background: "linear-gradient(105deg, transparent 30%, rgba(255,255,200,0.25) 50%, transparent 70%)",
                      }}
                    />
                    <div className="absolute inset-0 retro-grid opacity-10" />

                    <div className="relative z-10 flex flex-col md:flex-row items-center gap-6">
                      {/* Coin image */}
                      <motion.div
                        animate={{ rotateY: [0, 5, -5, 0] }}
                        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                        className="relative shrink-0"
                      >
                        <div
                          className="absolute -inset-3 rounded-full pointer-events-none"
                          style={{
                            background: "radial-gradient(circle, rgba(255,200,0,0.3) 30%, transparent 70%)",
                          }}
                        />
                        <img
                          src={whatTheHoImg}
                          alt="WHAT THE HO"
                          className="w-28 h-28 rounded-full object-cover relative z-10"
                          style={{
                            boxShadow: "0 0 30px rgba(255,200,0,0.6), 0 0 60px rgba(255,100,0,0.3)",
                          }}
                        />
                        {/* Crown */}
                        <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-2xl"
                          style={{ filter: "drop-shadow(0 0 8px rgba(255,200,0,0.9))" }}>
                          👑
                        </div>
                      </motion.div>

                      {/* Info */}
                      <div className="flex-1 text-center md:text-left">
                        <div className="flex items-center gap-3 mb-2 justify-center md:justify-start">
                          <span
                            className="text-xs px-3 py-1 rounded-full font-black tracking-widest"
                            style={{
                              background: "linear-gradient(90deg, #ffaa00, #ff8800, #ffcc00)",
                              color: "#fff",
                              boxShadow: "0 0 12px rgba(255,170,0,0.7)",
                              textShadow: "0 1px 2px rgba(0,0,0,0.4)",
                            }}
                          >
                            ✦ 전설
                          </span>
                          <span className="text-xs text-[#ffaa00] bg-[#ffaa00]/10 px-2 py-1 rounded-lg border border-[#ffaa00]/30">
                            한정 100개
                          </span>
                        </div>
                        <h3
                          className="font-black tracking-widest mb-1"
                          style={{
                            fontSize: "clamp(20px, 3vw, 32px)",
                            background: "linear-gradient(90deg, #ffaa00, #fff8c0, #ffcc00, #fff8c0, #ffaa00)",
                            backgroundSize: "200% 100%",
                            WebkitBackgroundClip: "text",
                            WebkitTextFillColor: "transparent",
                            filter: "drop-shadow(0 0 8px rgba(255,200,0,0.6))",
                            animation: "shimmer 3s linear infinite",
                          }}
                        >
                          WHAT THE HO
                        </h3>
                        <p className="text-[#a393d1] text-sm mb-3">{meme.description}</p>
                        <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                          {meme.features.map((f, i) => (
                            <span
                              key={i}
                              className="text-xs px-2 py-1 rounded-lg border font-semibold"
                              style={{
                                borderColor: "rgba(255,170,0,0.4)",
                                background: "rgba(255,170,0,0.1)",
                                color: "#ffcc44",
                              }}
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Stats + CTA */}
                      <div className="text-center shrink-0 space-y-3">
                        <div>
                          <p className="text-xs text-[#a393d1] mb-1">현재 가격</p>
                          <p className="text-2xl font-black" style={{ color: "#ffcc00", textShadow: "0 0 10px rgba(255,200,0,0.8)" }}>
                            {meme.price}
                          </p>
                          <span className="text-xs font-bold text-[#00ff88]">{meme.change}</span>
                        </div>
                        <Button
                          size="sm"
                          className="font-bold tracking-wide gap-2"
                          style={{
                            background: "linear-gradient(90deg, rgba(255,170,0,0.3), rgba(255,100,0,0.3))",
                            border: "1px solid rgba(255,170,0,0.6)",
                            color: "#fff",
                            boxShadow: "0 0 12px rgba(255,170,0,0.3)",
                          }}
                        >
                          <Sparkles className="w-4 h-4" />
                          전설 공개
                        </Button>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              );
            }

            // ── Regular meme coin card ──
            return (
              <Card
                key={meme.id}
                onClick={() => setSelectedMeme(meme)}
                className="p-6 glass relative overflow-hidden group cursor-pointer transition-all hover:scale-105"
                style={{
                  border: `2px solid transparent`,
                  backgroundImage: `linear-gradient(#0a0a0a, #0a0a0a), linear-gradient(135deg, ${meme.tierColor.replace('from-', '').replace('to-', ',')})`,
                  backgroundOrigin: 'border-box',
                  backgroundClip: 'padding-box, border-box',
                }}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${meme.gradient} opacity-10 group-hover:opacity-20 transition-opacity`}></div>
                <div className="relative z-10 space-y-4">
                  {/* Header with Icon and Tier */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="text-6xl">{meme.icon}</div>
                      <div>
                        <h3 className="text-[#e0d9ff] font-bold text-lg">{meme.name}</h3>
                        <p className="text-xs text-[#a393d1]">{meme.fullName}</p>
                      </div>
                    </div>
                  </div>

                  {/* Tier Badge */}
                  <div className="flex items-center justify-center">
                    <div
                      className="px-6 py-2 rounded-full font-black text-xl tracking-wider"
                      style={{
                        background: `linear-gradient(90deg, ${meme.tierColor.replace('from-', '').replace('to-', ',')})`,
                        boxShadow: `0 0 20px ${meme.tierColor.includes('ffaa00') ? 'rgba(255,170,0,0.5)' : meme.tierColor.includes('a855f7') ? 'rgba(168,85,247,0.5)' : meme.tierColor.includes('00d9ff') ? 'rgba(0,217,255,0.5)' : 'rgba(156,163,175,0.3)'}`,
                        color: '#fff',
                        textShadow: '0 2px 4px rgba(0,0,0,0.5)'
                      }}
                    >
                      {meme.tier} 랭크
                    </div>
                  </div>

                  {/* Description Preview */}
                  <p className="text-sm text-[#a393d1] text-center line-clamp-2">{meme.description}</p>

                  {/* View Button */}
                  <Button
                    size="sm"
                    className="w-full glass font-semibold"
                    style={{
                      background: `linear-gradient(90deg, ${meme.tierColor.replace('from-', '').replace('to-', ',')})`,
                      border: 'none',
                      boxShadow: `0 0 15px ${meme.tierColor.includes('ffaa00') ? 'rgba(255,170,0,0.3)' : meme.tierColor.includes('a855f7') ? 'rgba(168,85,247,0.3)' : meme.tierColor.includes('00d9ff') ? 'rgba(0,217,255,0.3)' : 'rgba(156,163,175,0.2)'}`,
                    }}
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    상세 보기
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      {/* How to Earn */}
      <Card className="p-8 glass-strong neon-border-pink relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-[#ff10f0]/10 via-[#00d9ff]/10 to-[#00ff88]/10"></div>
        <div className="absolute inset-0 scanlines opacity-10"></div>
        <div className="relative z-10 text-center space-y-4">
          <Sparkles className="w-12 h-12 text-[#ffaa00] mx-auto" style={{ filter: 'drop-shadow(0 0 12px rgba(255, 170, 0, 0.9))' }} />
          <h2 className="text-[#e0d9ff] neon-pink">MEME 코인 획득 방법</h2>
          <div className="grid md:grid-cols-3 gap-6 mt-6">
            <div className="space-y-2">
              <div className="text-4xl">📦</div>
              <h3 className="text-[#e0d9ff]">박스 개봉</h3>
              <p className="text-sm text-[#a393d1]">박스 개봉 시 랜덤 코인 보상</p>
            </div>
            <div className="space-y-2">
              <div className="text-4xl">🎯</div>
              <h3 className="text-[#e0d9ff]">파편 조합</h3>
              <p className="text-sm text-[#a393d1]">NFT 조합 성공 시 보너스</p>
            </div>
            <div className="space-y-2">
              <div className="text-4xl">🎁</div>
              <h3 className="text-[#e0d9ff]">일일 미션</h3>
              <p className="text-sm text-[#a393d1]">매일 접속 및 활동 보상</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Meme Detail Modal */}
      <AnimatePresence>
        {selectedMeme && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
            onClick={() => setSelectedMeme(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", duration: 0.4 }}
              onClick={(e) => e.stopPropagation()}
              className="max-w-6xl w-full"
            >
              <div className="grid md:grid-cols-[1fr_1fr] gap-6">
                {/* LEFT: Image Section */}
                <Card className="p-8 glass-strong neon-border-pink relative overflow-hidden flex items-center justify-center">
                  <div className={`absolute inset-0 bg-gradient-to-br ${selectedMeme.gradient} opacity-20`}></div>
                  <div className="absolute inset-0 retro-grid opacity-10"></div>
                  
                  <div className="relative z-10 flex flex-col items-center justify-center w-full">
                    {/* Back Button */}
                    <button
                      onClick={() => setSelectedMeme(null)}
                      className="absolute top-4 left-4 flex items-center gap-2 text-[#00d9ff] hover:text-[#ff10f0] transition-colors"
                    >
                      <ArrowLeft className="w-5 h-5" />
                      <span className="text-sm">홈으로 돌아가기</span>
                    </button>

                    {/* Large Image - Centered */}
                    <div className="w-full max-w-md aspect-square rounded-2xl bg-gradient-to-br from-blue-600/30 to-purple-600/30 flex items-center justify-center text-[200px] relative overflow-hidden">
                      <div className={`absolute inset-0 bg-gradient-to-br ${selectedMeme.gradient} opacity-30`}></div>
                      <span className="relative z-10">{selectedMeme.icon}</span>
                    </div>
                  </div>
                </Card>

                {/* RIGHT: Details Section */}
                <div className="space-y-4">
                  {/* Close Button */}
                  <button
                    onClick={() => setSelectedMeme(null)}
                    className="absolute top-4 right-4 w-10 h-10 rounded-full glass neon-border-cyan hover:neon-border-pink flex items-center justify-center text-[#00d9ff] hover:text-[#ff10f0] transition-all z-20"
                  >
                    <X className="w-5 h-5" />
                  </button>

                  {/* Title & Badge */}
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-white chrome-text text-3xl">{selectedMeme.fullName}</h2>
                      <span 
                        className="text-sm px-3 py-1 rounded-full font-bold text-white"
                        style={{
                          background: `linear-gradient(90deg, ${selectedMeme.tierColor.replace('from-', '').replace('to-', ',')})`,
                          boxShadow: `0 0 15px ${selectedMeme.tierColor.includes('ffaa00') ? 'rgba(255,170,0,0.4)' : selectedMeme.tierColor.includes('a855f7') ? 'rgba(168,85,247,0.4)' : selectedMeme.tierColor.includes('00d9ff') ? 'rgba(0,217,255,0.4)' : 'rgba(156,163,175,0.3)'}`
                        }}
                      >
                        {selectedMeme.tier} 랭크
                      </span>
                    </div>
                    <p className="text-[#a393d1]">NFT</p>
                  </div>

                  {/* 순위 - Square Shape */}
                  <div className="flex items-center justify-center">
                    <Card 
                      className="w-48 h-48 glass flex flex-col items-center justify-center"
                      style={{
                        border: `2px solid transparent`,
                        backgroundImage: `linear-gradient(#0a0a0a, #0a0a0a), linear-gradient(135deg, ${selectedMeme.tierColor.replace('from-', '').replace('to-', ',')})`,
                        backgroundOrigin: 'border-box',
                        backgroundClip: 'padding-box, border-box',
                      }}
                    >
                      <p className="text-2xl text-[#a393d1] mb-4 font-bold">순위</p>
                      <p 
                        className="text-8xl font-black chrome-text"
                        style={{
                          background: `linear-gradient(90deg, ${selectedMeme.tierColor.replace('from-', '').replace('to-', ',')})`,
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                          filter: `drop-shadow(0 0 15px ${selectedMeme.tierColor.includes('ffaa00') ? 'rgba(255,170,0,0.8)' : selectedMeme.tierColor.includes('a855f7') ? 'rgba(168,85,247,0.8)' : selectedMeme.tierColor.includes('00d9ff') ? 'rgba(0,217,255,0.8)' : 'rgba(156,163,175,0.5)'})`
                        }}
                      >
                        {selectedMeme.tier}
                      </p>
                    </Card>
                  </div>

                  {/* 설명 - Expanded */}
                  <Card 
                    className="p-8 glass"
                    style={{
                      border: `2px solid transparent`,
                      backgroundImage: `linear-gradient(#0a0a0a, #0a0a0a), linear-gradient(135deg, ${selectedMeme.tierColor.replace('from-', '').replace('to-', ',')})`,
                      backgroundOrigin: 'border-box',
                      backgroundClip: 'padding-box, border-box',
                    }}
                  >
                    <h3 className="mb-4 text-[#00d9ff] neon-cyan text-xl">설명</h3>
                    <p className="text-[#e0d9ff] leading-relaxed text-lg">{selectedMeme.description}</p>
                  </Card>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
