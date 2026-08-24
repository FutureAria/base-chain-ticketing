import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, PackageCheck, Search, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { useAppSettings } from "../context/AppSettingsContext";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const ITEMS_PER_PAGE = 8;

type PhysicalCard = {
  id: number;
  nftId: string;
  sourceMode: string | null;
  obtainedAt: string;
  team: string;
  name: string;
  image: string;
  note: string;
  redemptionId: string | null;
  redemptionStatus: "requested" | "shipping" | "completed" | "cancelled" | null;
  requestedAt: string | null;
};

type Delivery = {
  recipient: string;
  phone: string;
  zipcode: string;
  address: string;
  addressDetail: string;
};

const emptyDelivery: Delivery = {
  recipient: "",
  phone: "",
  zipcode: "",
  address: "",
  addressDetail: "",
};

const sourceLabel: Record<string, string> = {
  "tier-reward": "승급 혜택",
  "fragment-combine": "파편 조합",
  "point_random": "포인트 교환",
  "box-open": "박스 획득",
};

const statusLabel: Record<string, string> = {
  requested: "요청 완료",
  shipping: "배송 준비",
  completed: "교환 완료",
  cancelled: "취소됨",
};

function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${localStorage.getItem("auth_token") ?? ""}`,
  };
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.error || "요청 처리 중 오류가 발생했습니다.");
  }
  return data as T;
}

export function PhysicalExchange() {
  const { walletAddress } = useAppSettings();
  const [cards, setCards] = useState<PhysicalCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<"all" | "available" | "requested">("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PhysicalCard | null>(null);
  const [delivery, setDelivery] = useState<Delivery>(emptyDelivery);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const showToast = (text: string, type: "success" | "error") => {
    setToast({ text, type });
    window.setTimeout(() => setToast(null), 2600);
  };

  const loadCards = async () => {
    setLoading(true);
    try {
      const data = await fetch(`${API_BASE}/api/exchange/physical-options`, { headers: headers() })
        .then((res) => parseJson<{ success: true; data: PhysicalCard[] }>(res));
      setCards(data.data ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "실물 교환 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCards();
  }, [walletAddress]);

  const filteredCards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((card) => {
      const matchesQuery = !q ||
        card.team.toLowerCase().includes(q) ||
        card.name.toLowerCase().includes(q) ||
        card.nftId.toLowerCase().includes(q);
      const matchesMode =
        viewMode === "all" ||
        (viewMode === "available" && !card.redemptionStatus) ||
        (viewMode === "requested" && Boolean(card.redemptionStatus));
      return matchesQuery && matchesMode;
    });
  }, [cards, query, viewMode]);

  const totalPages = Math.max(1, Math.ceil(filteredCards.length / ITEMS_PER_PAGE));
  const pageItems = filteredCards.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
  const pageStart = filteredCards.length === 0 ? 0 : (page - 1) * ITEMS_PER_PAGE + 1;
  const pageEnd = Math.min(page * ITEMS_PER_PAGE, filteredCards.length);
  const availableCount = cards.filter((card) => !card.redemptionStatus).length;
  const requestedCount = cards.length - availableCount;

  useEffect(() => {
    setPage(1);
  }, [query, viewMode]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const deliveryReady =
    delivery.recipient.trim() &&
    delivery.phone.trim() &&
    delivery.zipcode.trim() &&
    delivery.address.trim();

  const handleRedeem = async () => {
    if (!selected || !walletAddress || !deliveryReady) return;
    setSubmitting(true);
    try {
      const data = await fetch(`${API_BASE}/api/exchange/physical-redeem`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ walletAddress, cardId: selected.id, delivery }),
      }).then((res) => parseJson<{ success: true; request: { id: string; status: PhysicalCard["redemptionStatus"] } }>(res));

      setCards((prev) => prev.map((card) => (
        card.id === selected.id
          ? { ...card, redemptionId: data.request.id, redemptionStatus: data.request.status, requestedAt: new Date().toISOString() }
          : card
      )));
      setSelected(null);
      setDelivery(emptyDelivery);
      showToast("실물 교환 요청이 접수되었습니다.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "실물 교환 요청에 실패했습니다.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="page-shell flex min-h-[420px] items-center justify-center">
        <p className="font-semibold" style={{ color: "#6f8094" }}>실물 교환 목록을 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <section className="border-b" style={{ borderColor: "#d6dee7", background: "linear-gradient(180deg, #eef2f5 0%, #e9eef2 100%)" }}>
        <div className="page-strip-wide pt-8 pb-7">
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5">
            <div>
              <p className="page-eyebrow mb-3" style={{ color: "#1456a0" }}>Physical Exchange</p>
              <h1 className="page-title mb-2" style={{ color: "#1c2f4a" }}>실물 NFT 교환</h1>
              <p className="page-subtitle max-w-3xl" style={{ color: "#728195" }}>
                승급 혜택이나 파편 조합으로 받은 완성 NFT를 실물 굿즈 교환 요청으로 전환할 수 있어요.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["보유 실물 NFT", cards.length],
                ["교환 가능", availableCount],
                ["요청 완료", requestedCount],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[18px] px-5 py-4" style={{ background: "#f8fafc", border: "1px solid #d6dee8" }}>
                  <p className="text-[0.74rem] font-bold" style={{ color: "#728195" }}>{label}</p>
                  <p className="mt-1 text-[1.45rem] font-black" style={{ color: "#1c2f4a" }}>{value}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      <section className="page-strip-wide py-8">
        <div className="flex gap-6 items-start">
          <aside className="hidden w-[220px] shrink-0 flex-col gap-4 md:flex">
            <div className="rounded-[18px] p-4" style={{ background: "#f8fafc", border: "1px solid #d6dee8" }}>
              <p className="mb-3 text-[0.7rem] font-bold uppercase tracking-[0.14em]" style={{ color: "#728195" }}>보기 방식</p>
              {[
                { key: "all", label: "전체" },
                { key: "available", label: "교환 가능" },
                { key: "requested", label: "요청 완료" },
              ].map((option) => (
                <label key={option.key} className="flex cursor-pointer items-center gap-2.5 py-1.5">
                  <input type="radio" checked={viewMode === option.key} onChange={() => setViewMode(option.key as typeof viewMode)} className="h-4 w-4 accent-[#4b6581]" />
                  <span className="text-[0.84rem] font-medium" style={{ color: viewMode === option.key ? "#1c2f4a" : "#728195" }}>{option.label}</span>
                </label>
              ))}
            </div>

            <div className="rounded-[18px] p-4" style={{ background: "#eef3f8", border: "1px solid #c6d2df" }}>
              <p className="mb-3 text-[0.7rem] font-bold uppercase tracking-[0.14em]" style={{ color: "#728195" }}>검색</p>
              <div className="flex overflow-hidden rounded-[12px]" style={{ border: "1px solid #c6d2df", background: "#fff" }}>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="팀, NFT명, 토큰 ID"
                  className="min-w-0 flex-1 px-3 py-2.5 text-[0.78rem] outline-none"
                  style={{ color: "#1c2f4a" }}
                />
                <button type="button" aria-label="검색" className="flex w-10 shrink-0 items-center justify-center" style={{ background: "#4b6581", color: "#fff" }}>
                  <Search className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="rounded-[18px] p-4 text-[0.78rem] leading-6" style={{ background: "#eef3f8", border: "1px solid #c6d2df", color: "#4b6581" }}>
              교환 요청 후에는 운영자가 배송 상태를 확인합니다. 같은 NFT는 한 번만 실물 교환 요청할 수 있어요.
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            <div className="mb-5 flex md:hidden">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="팀, NFT명, 토큰 ID 검색"
                className="h-12 flex-1 border px-4 text-[0.9rem] outline-none"
                style={{ background: "#fff", borderColor: "#6f82a0", color: "#1c2f4a" }}
              />
              <button type="button" aria-label="검색" className="h-12 w-14 border border-l-0 inline-flex items-center justify-center" style={{ background: "#4b6581", borderColor: "#4b6581", color: "#fff" }}>
                <Search className="h-4 w-4" />
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-[16px] px-4 py-3 text-[0.84rem] font-semibold" style={{ background: "#fff5f5", border: "1px solid #fecaca", color: "#b91c1c" }}>
                {error}
              </div>
            )}

            <div className="min-h-[716px]">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                {pageItems.map((card, index) => {
                  const requested = Boolean(card.redemptionStatus);
                  return (
                    <motion.button
                      key={card.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.03 }}
                      onClick={() => !requested && setSelected(card)}
                      className="overflow-hidden rounded-[22px] text-left transition-all hover:-translate-y-1 hover:shadow-md disabled:cursor-not-allowed"
                      style={{ background: "#f8fafc", border: "1px solid #d6dee8", opacity: requested ? 0.72 : 1 }}
                    >
                      <div className="relative h-[220px] overflow-hidden sm:h-[280px]" style={{ background: "#e8edf4" }}>
                        <img src={card.image} alt={card.name} className="h-full w-full object-cover" />
                        <span className="absolute left-2.5 top-2.5 rounded-full px-2 py-0.5 text-[0.62rem] font-bold" style={{ background: "#4b6581dd", color: "#fff" }}>{card.team}</span>
                        <span className="absolute right-2.5 top-2.5 rounded-full px-2 py-0.5 text-[0.62rem] font-bold" style={{ background: requested ? "#f1f5f9" : "#ecfdf5", border: "1px solid #cbe1d3", color: requested ? "#64748b" : "#547b63" }}>
                          {requested ? statusLabel[card.redemptionStatus!] : "교환 가능"}
                        </span>
                      </div>
                      <div className="px-3 py-3">
                        <p className="text-[0.72rem] font-bold" style={{ color: "#4b6581" }}>{sourceLabel[card.sourceMode ?? ""] ?? "완성 NFT"}</p>
                        <h3 className="mt-1 min-h-[2.3rem] text-[0.86rem] font-bold leading-snug line-clamp-2" style={{ color: "#1c2f4a" }}>{card.name}</h3>
                        <p className="mt-1 truncate text-[0.7rem]" style={{ color: "#728195" }}>{card.nftId}</p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <p className="text-[0.78rem] font-bold" style={{ color: requested ? "#64748b" : "#547b63" }}>
                            {requested ? "요청됨" : "배송 교환"}
                          </p>
                          <span className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[0.68rem] font-semibold" style={{ background: "#e9eef4", border: "1px solid #c6d2df", color: "#4b6581" }}>
                            교환 <ArrowRight className="h-2.5 w-2.5" />
                          </span>
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>

              {filteredCards.length === 0 && (
                <div className="rounded-[22px] px-5 py-16 text-center" style={{ background: "#f8fafc", border: "1px solid #d6dee8" }}>
                  <p className="mb-2 text-[0.95rem] font-bold" style={{ color: "#1c2f4a" }}>교환할 실물 NFT가 없습니다</p>
                  <p className="text-[0.82rem]" style={{ color: "#728195" }}>승급 혜택을 수령하거나 카드 조합에서 완성 NFT를 만든 뒤 다시 확인해주세요.</p>
                </div>
              )}
            </div>

            {filteredCards.length > 0 && (
              <div className="mt-6 flex flex-col items-center gap-3">
                <p className="text-[0.78rem] font-semibold" style={{ color: "#728195" }}>
                  총 {filteredCards.length}개 중 {pageStart}-{pageEnd}개 표시
                </p>
                <div className="flex justify-center gap-2">
                  <button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} className="h-9 rounded-[10px] px-3 text-[0.8rem] font-semibold disabled:cursor-not-allowed disabled:opacity-40" style={{ background: "#fff", border: "1px solid #d6dee7", color: "#728195" }}>
                    이전
                  </button>
                  {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
                    <button key={pageNumber} onClick={() => setPage(pageNumber)} className="h-9 min-w-9 rounded-[10px] px-3 text-[0.82rem] font-semibold" style={{ background: page === pageNumber ? "#4b6581" : "#fff", border: `1px solid ${page === pageNumber ? "#4b6581" : "#d6dee7"}`, color: page === pageNumber ? "#fff" : "#728195" }}>
                      {pageNumber}
                    </button>
                  ))}
                  <button onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages} className="h-9 rounded-[10px] px-3 text-[0.8rem] font-semibold disabled:cursor-not-allowed disabled:opacity-40" style={{ background: "#fff", border: "1px solid #d6dee7", color: "#728195" }}>
                    다음
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
      </section>

      <RedeemModal
        card={selected}
        delivery={delivery}
        setDelivery={setDelivery}
        deliveryReady={Boolean(deliveryReady)}
        submitting={submitting}
        onClose={() => { setSelected(null); setDelivery(emptyDelivery); }}
        onSubmit={handleRedeem}
      />

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-[14px] px-5 py-3 text-[0.9rem] font-bold shadow-xl" style={{ background: toast.type === "success" ? "#d1fae5" : "#fee2e2", border: `1px solid ${toast.type === "success" ? "#a7f3d0" : "#fca5a5"}`, color: toast.type === "success" ? "#065f46" : "#991b1b" }}>
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RedeemModal({
  card,
  delivery,
  setDelivery,
  deliveryReady,
  submitting,
  onClose,
  onSubmit,
}: {
  card: PhysicalCard | null;
  delivery: Delivery;
  setDelivery: Dispatch<SetStateAction<Delivery>>;
  deliveryReady: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const inputStyle = {
    background: "#f8fafc",
    border: "1px solid #d6dee8",
    color: "#1c2f4a",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: "0.88rem",
    width: "100%",
    outline: "none",
  };

  return (
    <AnimatePresence>
      {card && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
          <motion.div initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }} className="max-h-[90vh] w-full max-w-[520px] overflow-y-auto rounded-[22px]" style={{ background: "#ffffff", border: "1px solid #d6dee8", boxShadow: "0 24px 56px rgba(0,0,0,0.22)" }}>
            <div className="flex items-center justify-between border-b px-6 py-5" style={{ borderColor: "#e8edf4" }}>
              <p className="text-[1.05rem] font-black" style={{ color: "#1c2f4a" }}>실물 교환 요청</p>
              <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "#f2f5f8" }}>
                <X className="h-4 w-4" style={{ color: "#728195" }} />
              </button>
            </div>

            <div className="space-y-5 px-6 py-6">
              <div className="overflow-hidden rounded-[18px]" style={{ background: "#f8fafc", border: "1px solid #d6dee8" }}>
                <div className="aspect-[16/9] overflow-hidden">
                  <img src={card.image} alt={card.name} className="h-full w-full object-cover" />
                </div>
                <div className="p-4">
                  <p className="text-[0.76rem] font-bold" style={{ color: "#4b6581" }}>{card.team}</p>
                  <p className="mt-1 text-[1rem] font-black" style={{ color: "#1c2f4a" }}>{card.name}</p>
                  <p className="mt-1 text-[0.74rem]" style={{ color: "#728195" }}>{card.nftId}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="수령인" value={delivery.recipient} inputStyle={inputStyle} onChange={(value) => setDelivery((prev) => ({ ...prev, recipient: value }))} />
                <Field label="연락처" value={delivery.phone} inputStyle={inputStyle} onChange={(value) => setDelivery((prev) => ({ ...prev, phone: value }))} />
              </div>
              <Field label="우편번호" value={delivery.zipcode} inputStyle={inputStyle} onChange={(value) => setDelivery((prev) => ({ ...prev, zipcode: value }))} />
              <Field label="주소" value={delivery.address} inputStyle={inputStyle} onChange={(value) => setDelivery((prev) => ({ ...prev, address: value }))} />
              <Field label="상세주소" value={delivery.addressDetail} inputStyle={inputStyle} onChange={(value) => setDelivery((prev) => ({ ...prev, addressDetail: value }))} />

              <Button disabled={!deliveryReady || submitting} onClick={onSubmit} className="h-12 w-full rounded-[13px] text-[0.94rem] font-black" style={{ background: deliveryReady ? "linear-gradient(135deg, #132850, #4b6581)" : "#e2e8f0", color: deliveryReady ? "#fff" : "#728195" }}>
                {submitting ? "요청 중..." : <><PackageCheck className="mr-2 h-4 w-4" />실물 교환 요청</>}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({
  label,
  value,
  inputStyle,
  onChange,
}: {
  label: string;
  value: string;
  inputStyle: CSSProperties;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[0.76rem] font-bold" style={{ color: "#728195" }}>{label}</span>
      <input style={inputStyle} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
