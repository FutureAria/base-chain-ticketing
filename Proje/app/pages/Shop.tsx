import { useState } from "react";
import { ShoppingBag, Package, Key, Gem, Coins, Sparkles, Star, Gift } from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { motion, AnimatePresence } from "motion/react";
import { LegendaryReveal } from "../components/LegendaryReveal";

export function Shop() {
  const [purchaseResult, setPurchaseResult] = useState<any>(null);
  const [showLegendary, setShowLegendary] = useState(false);

  const boxes = [
    {
      id: 1,
      name: "스타터 박스",
      rarity: "일반",
      image: "📦",
      price: 100,
      description: "기본적인 밈 파편과 NFT를 얻을 수 있는 입문용 박스",
      rewards: ["일반 파편 2-3개", "희귀 파편 10% 확률"],
      gradient: "from-[#a393d1] to-[#6b5b95]",
      needsKey: false
    },
    {
      id: 2,
      name: "프리미엄 박스",
      rarity: "희귀",
      image: "🎁",
      price: 500,
      description: "더 나은 보상이 들어있는 프리미엄 박스",
      rewards: ["희귀 파편 2-3개", "영웅 파편 30% 확률", "전설 파편 5% 확률"],
      gradient: "from-[#00d9ff] to-[#0088cc]",
      needsKey: true
    },
    {
      id: 3,
      name: "레전드 박스",
      rarity: "영웅",
      image: "💎",
      price: 2000,
      description: "최고급 보상이 보장되는 레전더리 박스",
      rewards: ["영웅 파편 2-3개", "전설 파편 50% 확률", "완성된 NFT 10% 확률"],
      gradient: "from-[#ff10f0] to-[#bd00e8]",
      needsKey: true
    },
    {
      id: 4,
      name: "미스터리 박스",
      rarity: "전설",
      image: "❓",
      price: 3500,
      description: "무엇이 나올지 알 수 없는 신비로운 박스",
      rewards: ["전설 파편 보장", "완성된 NFT 30% 확률", "특별 보상 ???"],
      gradient: "from-[#ffaa00] to-[#ff6b00]",
      needsKey: true
    }
  ];

  const keys = [
    {
      id: 1,
      name: "일반 열쇠",
      rarity: "일반",
      image: "🔑",
      price: 50,
      description: "일반 박스를 여는 데 사용할 수 있는 기본 열쇠",
      count: 1,
      gradient: "from-[#a393d1] to-[#6b5b95]"
    },
    {
      id: 2,
      name: "일반 열쇠 (5개)",
      rarity: "일반",
      image: "🔑",
      price: 200,
      description: "일반 박스를 여는 데 사용할 수 있는 기본 열쇠 5개 묶음",
      count: 5,
      gradient: "from-[#a393d1] to-[#6b5b95]"
    },
    {
      id: 3,
      name: "황금 열쇠",
      rarity: "희귀",
      image: "🗝️",
      price: 150,
      description: "프리미엄 박스 이상을 여는 데 필요한 황금 열쇠",
      count: 1,
      gradient: "from-[#00d9ff] to-[#0088cc]"
    },
    {
      id: 4,
      name: "황금 열쇠 (3개)",
      rarity: "희귀",
      image: "🗝️",
      price: 400,
      description: "프리미엄 박스 이상을 여는 데 필요한 황금 열쇠 3개 묶음",
      count: 3,
      gradient: "from-[#00d9ff] to-[#0088cc]"
    },
    {
      id: 5,
      name: "마스터 키",
      rarity: "전설",
      image: "🔐",
      price: 500,
      description: "모든 박스를 열 수 있는 만능 열쇠",
      count: 1,
      gradient: "from-[#ffaa00] to-[#ff6b00]"
    }
  ];

  const bundles = [
    {
      id: 1,
      name: "스타터 패키지",
      items: ["스타터 박스 3개", "일반 열쇠 5개"],
      originalPrice: 550,
      price: 400,
      discount: 27,
      gradient: "from-[#00ff88] to-[#00d9ff]"
    },
    {
      id: 2,
      name: "프리미엄 패키지",
      items: ["프리미엄 박스 2개", "황금 열쇠 3개"],
      originalPrice: 1400,
      price: 1100,
      discount: 21,
      gradient: "from-[#ff10f0] to-[#00d9ff]"
    },
    {
      id: 3,
      name: "레전드 패키지",
      items: ["레전드 박스 2개", "미스터리 박스 1개", "마스터 키 3개"],
      originalPrice: 9000,
      price: 7500,
      discount: 17,
      gradient: "from-[#ffaa00] to-[#ff10f0]"
    }
  ];

  // Legendary drop chances per box rarity
  const LEGENDARY_CHANCE: Record<string, number> = {
    "전설": 0.55,  // 미스터리 박스
    "영웅":  0.25,  // 레전드 박스
    "희귀":  0.08,  // 프리미엄 박스
    "일반":  0,
  };

  const handlePurchase = (item: any, type: string) => {
    // Check for legendary drop
    if (type === "box") {
      const chance = LEGENDARY_CHANCE[item.rarity] ?? 0;
      if (Math.random() < chance) {
        setShowLegendary(true);
        return;
      }
    }

    // Normal purchase result
    setPurchaseResult({
      name: item.name,
      type: type,
      price: item.price,
      image: item.image || "🎁"
    });
    setTimeout(() => setPurchaseResult(null), 3000);
  };

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case "전설": return "from-[#ffaa00] to-[#ff6b00]";
      case "영웅": return "from-[#ff10f0] to-[#bd00e8]";
      case "희귀": return "from-[#00d9ff] to-[#0088cc]";
      default: return "from-[#a393d1] to-[#6b5b95]";
    }
  };

  return (
    <div className="page-shell space-y-8">
      {/* Legendary Reveal */}
      <LegendaryReveal show={showLegendary} onClose={() => setShowLegendary(false)} />

      {/* Header */}
      <div className="page-header page-header--center space-y-4">
        <div className="inline-block p-4 rounded-2xl glass-strong neon-border-pink relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-[#ff10f0]/20 to-[#00d9ff]/20"></div>
          <ShoppingBag className="w-16 h-16 text-[#ff10f0] relative z-10" style={{ filter: 'drop-shadow(0 0 20px rgba(255, 16, 240, 0.9))' }} />
        </div>
        <div>
          <p className="page-eyebrow text-[#ff8af8] mb-3">Store</p>
          <h1 className="page-title chrome-text mb-3">상점</h1>
          <p className="page-subtitle max-w-2xl">박스와 열쇠를 구매하고 새로운 밈 NFT를 획득하세요!</p>
        </div>
      </div>

      {/* User Balance */}
      <Card className="p-6 neon-border-cyan relative overflow-hidden panel-surface-strong">
        <div className="absolute inset-0 retro-grid opacity-20"></div>
        <div className="flex items-center justify-between relative z-10">
          <div className="flex items-center gap-3">
            <Coins className="w-8 h-8 text-[#00ff88]" style={{ filter: 'drop-shadow(0 0 10px rgba(0, 255, 136, 0.8))' }} />
            <div>
              <p className="page-stat-label mb-1">보유 MEME 코인</p>
              <p className="page-value chrome-text">1,250 MEME</p>
            </div>
          </div>
          <Button className="neon-border-pink hover:neon-border-cyan bg-gradient-to-r from-[#ff10f0]/30 to-[#bd00e8]/30 text-white font-bold rounded-xl h-11 px-5">
            <Gem className="w-5 h-5 mr-2" />
            충전하기
          </Button>
        </div>
      </Card>

      {/* Bundles Section */}
      <section>
        <div className="flex items-center gap-2 mb-6">
          <Gift className="w-7 h-7 text-[#ffaa00]" style={{ filter: 'drop-shadow(0 0 10px rgba(255, 170, 0, 0.8))' }} />
          <h2 className="section-title text-[#f6f2ff]" style={{ textShadow: '0 0 10px rgba(255, 170, 0, 0.25)' }}>특별 패키지</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {bundles.map((bundle) => (
            <Card key={bundle.id} className="p-6 neon-border-pink hover:neon-border-cyan transition-all relative overflow-hidden group panel-surface">
              <div className={`absolute inset-0 bg-gradient-to-br ${bundle.gradient} opacity-10 group-hover:opacity-20 transition-opacity`}></div>
              <div className="relative z-10">
                <div className="absolute -top-2 -right-2 bg-gradient-to-r from-[#ff10f0] to-[#bd00e8] text-white text-xs font-bold px-3 py-1 rounded-full neon-border-pink">
                  {bundle.discount}% OFF
                </div>
                
                <div className="text-center mb-4">
                  <div className="text-6xl mb-3">🎁</div>
                  <h3 className="section-title text-[1.2rem] mb-2 text-[#f6f2ff]">{bundle.name}</h3>
                </div>

                <div className="space-y-2 mb-4">
                  {bundle.items.map((item, index) => (
                    <div key={index} className="flex items-center gap-2 text-[0.92rem] text-[#b8add7]">
                      <Sparkles className="w-4 h-4 text-[#00ff88]" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="page-stat-label line-through">{bundle.originalPrice} MEME</p>
                    <p className="text-[1.5rem] font-bold text-[#00ff88]">{bundle.price} MEME</p>
                  </div>
                </div>

                <Button
                  onClick={() => handlePurchase(bundle, "bundle")}
                  className="w-full neon-border-cyan hover:neon-border-pink bg-gradient-to-r from-[#00d9ff]/30 to-[#00ff88]/30 text-white font-bold rounded-xl h-11"
                >
                  구매하기
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Boxes Section */}
      <section>
        <div className="flex items-center gap-2 mb-6">
          <Package className="w-7 h-7 text-[#ff10f0]" style={{ filter: 'drop-shadow(0 0 10px rgba(255, 16, 240, 0.8))' }} />
          <h2 className="section-title text-[#f6f2ff]">박스 상점</h2>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {boxes.map((box) => (
            <Card key={box.id} className="p-6 neon-border-cyan hover:neon-border-pink transition-all relative overflow-hidden group panel-surface">
              <div className={`absolute inset-0 bg-gradient-to-br ${box.gradient} opacity-10 group-hover:opacity-20 transition-opacity`}></div>
              <div className="relative z-10">
                <div className="text-center mb-4">
                  <div className="text-7xl mb-3">{box.image}</div>
                  <h3 className="section-title text-[1.15rem] mb-1 text-[#f6f2ff]">{box.name}</h3>
                  <span className={`inline-block text-xs px-2 py-1 rounded-lg bg-gradient-to-r ${getRarityColor(box.rarity)} text-white font-semibold`}>
                    {box.rarity}
                  </span>
                </div>

                <p className="page-muted mb-3 min-h-[48px]">{box.description}</p>

                <div className="space-y-1 mb-4">
                  <p className="page-stat-label text-[#00d9ff]">보상 목록:</p>
                  {box.rewards.map((reward, index) => (
                    <div key={index} className="flex items-center gap-1 text-[0.78rem] text-[#b8add7]">
                      <Star className="w-3 h-3 text-[#ffaa00]" />
                      <span>{reward}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between mb-3">
                  <p className="text-[1.45rem] font-bold text-[#00ff88]">{box.price} MEME</p>
                  {box.needsKey && (
                    <div className="flex items-center gap-1 page-stat-label text-[#ffaa00]">
                      <Key className="w-4 h-4" />
                      <span>열쇠 필요</span>
                    </div>
                  )}
                </div>

                <Button
                  onClick={() => handlePurchase(box, "box")}
                  className="w-full neon-border-pink hover:neon-border-cyan bg-gradient-to-r from-[#ff10f0]/30 to-[#bd00e8]/30 text-white font-bold rounded-xl h-11"
                >
                  구매하기
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Keys Section */}
      <section>
        <div className="flex items-center gap-2 mb-6">
          <Key className="w-7 h-7 text-[#00d9ff]" style={{ filter: 'drop-shadow(0 0 10px rgba(0, 217, 255, 0.8))' }} />
          <h2 className="section-title text-[#f6f2ff]">열쇠 상점</h2>
        </div>
        <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-4">
          {keys.map((key) => (
            <Card key={key.id} className="p-5 neon-border-cyan hover:neon-border-pink transition-all relative overflow-hidden group panel-surface">
              <div className={`absolute inset-0 bg-gradient-to-br ${key.gradient} opacity-10 group-hover:opacity-20 transition-opacity`}></div>
              <div className="relative z-10">
                <div className="text-center mb-3">
                  <div className="text-5xl mb-2 relative">
                    {key.image}
                    {key.count > 1 && (
                      <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-gradient-to-r from-[#ff10f0] to-[#bd00e8] flex items-center justify-center text-white text-xs font-bold neon-border-pink">
                        {key.count}
                      </div>
                    )}
                  </div>
                  <h3 className="text-[0.98rem] font-semibold mb-1 text-[#f6f2ff] leading-snug">{key.name}</h3>
                  <span className={`inline-block text-xs px-2 py-0.5 rounded-lg bg-gradient-to-r ${getRarityColor(key.rarity)} text-white font-semibold`}>
                    {key.rarity}
                  </span>
                </div>

                <p className="page-stat-label mb-3 min-h-[36px]">{key.description}</p>

                <p className="text-[1.25rem] font-bold text-[#00ff88] mb-3 text-center">{key.price} MEME</p>

                <Button
                  onClick={() => handlePurchase(key, "key")}
                  size="sm"
                  className="w-full neon-border-cyan hover:neon-border-pink bg-gradient-to-r from-[#00d9ff]/30 to-[#00ff88]/30 text-white font-semibold rounded-xl"
                >
                  구매
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* Purchase Success Modal */}
      <AnimatePresence>
        {purchaseResult && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, rotate: 180 }}
              transition={{ type: "spring", duration: 0.6 }}
            >
              <Card className="p-8 neon-border-pink relative overflow-hidden max-w-md panel-surface-strong">
                <div className="absolute inset-0 bg-gradient-to-br from-[#00ff88]/20 to-[#00d9ff]/20"></div>
                <div className="text-center relative z-10">
                  <motion.div
                    animate={{
                      scale: [1, 1.2, 1],
                      rotate: [0, 10, -10, 0]
                    }}
                    transition={{
                      duration: 0.5,
                      repeat: Infinity,
                      repeatDelay: 1
                    }}
                  >
                    <Sparkles className="w-16 h-16 text-[#00ff88] mx-auto mb-4" style={{ filter: 'drop-shadow(0 0 20px rgba(0, 255, 136, 0.9))' }} />
                  </motion.div>

                  <h2 className="section-title mb-4 text-white">구매 완료!</h2>

                  <div className="w-32 h-32 mx-auto mb-4 rounded-xl glass-strong flex items-center justify-center text-7xl relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#00ff88]/30 to-[#00d9ff]/30"></div>
                    <span className="relative z-10">{purchaseResult.image}</span>
                  </div>

                  <h3 className="section-title text-[1.2rem] mb-2 text-white">{purchaseResult.name}</h3>
                  <p className="page-muted mb-4">
                    {purchaseResult.price} MEME 코인이 차감되었습니다
                  </p>
                  <p className="page-muted text-[#00d9ff]">
                    인벤토리에서 확인하실 수 있습니다
                  </p>
                </div>
              </Card>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
