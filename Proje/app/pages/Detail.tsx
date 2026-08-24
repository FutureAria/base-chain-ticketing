import { useParams, Link } from "react-router";
import { ArrowLeft, TrendingUp, Calendar, User } from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";

export function Detail() {
  const { id } = useParams();

  // Mock data - in real app, fetch based on id
  const item = {
    id: id || "1",
    name: "페페 밈 #1337",
    rarity: "전설",
    image: "🐸",
    type: "NFT",
    description: "2010년대 초반 인터넷을 강타했던 전설적인 페페 밈입니다. 희귀한 표정과 독특한 스타일로 많은 사랑을 받았던 밈 NFT입니다.",
    owner: "User#1234",
    creator: "MemeArtist#777",
    mintDate: "2026.01.15",
    lastTrade: "2026.03.10",
    tradeCount: 12,
    price: "1,500",
    stats: {
      views: 1247,
      likes: 384,
      shares: 92
    }
  };

  const tradeHistory = [
    { date: "2026.03.10", from: "User#5555", to: "User#1234", price: "1,500" },
    { date: "2026.02.20", from: "User#3333", to: "User#5555", price: "1,200" },
    { date: "2026.02.01", from: "User#2222", to: "User#3333", price: "1,000" },
    { date: "2026.01.20", from: "MemeArtist#777", to: "User#2222", price: "800" },
  ];

  const similarItems = [
    { id: 2, name: "페페 밈 #1338", rarity: "영웅", image: "🐸", price: "890" },
    { id: 3, name: "페페 밈 #1339", rarity: "영웅", image: "🐸", price: "920" },
    { id: 4, name: "도지 밈 #420", rarity: "영웅", image: "🐕", price: "850" },
  ];

  const getRarityColor = (rarity: string) => {
    switch (rarity) {
      case "전설": return "from-yellow-500 to-orange-500";
      case "영웅": return "from-purple-500 to-pink-500";
      case "희귀": return "from-blue-500 to-cyan-500";
      default: return "from-gray-500 to-gray-600";
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Back Button */}
      <Link to="/">
        <Button variant="outline" className="glass neon-border-cyan hover:neon-border-pink text-[#00d9ff]">
          <ArrowLeft className="w-4 h-4 mr-2" />
          홈으로 돌아가기
        </Button>
      </Link>

      {/* Main Content */}
      <div className="grid md:grid-cols-2 gap-8">
        {/* Image */}
        <Card className="p-8 glass neon-border-pink">
          <div className="aspect-square rounded-lg bg-gradient-to-br from-blue-600/30 to-purple-600/30 flex items-center justify-center text-[200px] mb-6">
            {item.image}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-white">{item.stats.views}</p>
              <p className="text-sm text-gray-400">조회수</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-white">{item.stats.likes}</p>
              <p className="text-sm text-gray-400">좋아요</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-white">{item.stats.shares}</p>
              <p className="text-sm text-gray-400">공유</p>
            </div>
          </div>
        </Card>

        {/* Details */}
        <div className="space-y-6">
          {/* Title & Rarity */}
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-gray-100">{item.name}</h1>
              <span className={`text-sm px-3 py-1 rounded bg-gradient-to-r ${getRarityColor(item.rarity)} text-white`}>
                {item.rarity}
              </span>
            </div>
            <p className="text-gray-400">{item.type}</p>
          </div>

          {/* Description */}
          <Card className="p-6 bg-blue-900/20 border-blue-500/30">
            <h3 className="mb-3 text-gray-200">설명</h3>
            <p className="text-gray-400 leading-relaxed">{item.description}</p>
          </Card>

          {/* Info */}
          <Card className="p-6 bg-blue-900/20 border-blue-500/30">
            <h3 className="mb-4 text-gray-200">상세 정보</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-gray-400">
                  <User className="w-4 h-4" />
                  <span className="text-sm">소유자</span>
                </div>
                <span className="text-blue-400">{item.owner}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-gray-400">
                  <User className="w-4 h-4" />
                  <span className="text-sm">제작자</span>
                </div>
                <span className="text-blue-400">{item.creator}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-gray-400">
                  <Calendar className="w-4 h-4" />
                  <span className="text-sm">생성일</span>
                </div>
                <span className="text-gray-300">{item.mintDate}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-gray-400">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-sm">거래 횟수</span>
                </div>
                <span className="text-gray-300">{item.tradeCount}회</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Trade History */}
      <section>
        <h2 className="mb-4 text-gray-200">거래 이력</h2>
        <Card className="bg-blue-900/20 border-blue-500/30 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-blue-800/30">
                <tr>
                  <th className="px-6 py-3 text-left text-sm text-gray-300">날짜</th>
                  <th className="px-6 py-3 text-left text-sm text-gray-300">판매자</th>
                  <th className="px-6 py-3 text-left text-sm text-gray-300">구매자</th>
                  <th className="px-6 py-3 text-right text-sm text-gray-300">가격</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-blue-500/20">
                {tradeHistory.map((trade, index) => (
                  <tr key={index} className="hover:bg-blue-800/20 transition-colors">
                    <td className="px-6 py-4 text-sm text-gray-400">{trade.date}</td>
                    <td className="px-6 py-4 text-sm text-blue-400">{trade.from}</td>
                    <td className="px-6 py-4 text-sm text-blue-400">{trade.to}</td>
                    <td className="px-6 py-4 text-sm text-right text-white font-bold">
                      {trade.price} MEME
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* Similar Items */}
      <section>
        <h2 className="mb-4 text-gray-200">비슷한 아이템</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {similarItems.map((similar) => (
            <Link key={similar.id} to={`/detail/${similar.id}`}>
              <Card className="p-4 bg-blue-900/20 border-blue-500/30 hover:border-blue-400/50 hover:bg-blue-800/30 transition-all group cursor-pointer">
                <div className="aspect-square rounded-lg bg-gradient-to-br from-blue-600/30 to-purple-600/30 mb-3 flex items-center justify-center text-6xl group-hover:scale-105 transition-transform">
                  {similar.image}
                </div>
                <h3 className="text-sm mb-2 text-gray-200 truncate">{similar.name}</h3>
                <div className="flex items-center justify-between">
                  <span className={`text-xs px-2 py-1 rounded bg-gradient-to-r ${getRarityColor(similar.rarity)} text-white`}>
                    {similar.rarity}
                  </span>
                  <span className="text-sm text-blue-400">{similar.price} MEME</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}