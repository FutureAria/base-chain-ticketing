import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { motion } from "motion/react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Loader2,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingCart,
} from "lucide-react";
import { TbMoneybagPlus } from "react-icons/tb";
import { Button } from "../components/ui/button";
import { useAppSettings } from "../context/AppSettingsContext";
import { useAuth } from "../context/AuthContext";
import { loadTossPayments, ANONYMOUS } from "@tosspayments/tosspayments-sdk";
import { signListingMessage } from "../lib/contract";

// ─── API 설정 ─────────────────────────────────────────────────
const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

function apiUrl(path: string) {
  return `${API_BASE_URL}${path}`;
}

const API_HEADERS = (_walletAddress?: string | null) => ({
  "Content-Type": "application/json",
  "Authorization": `Bearer ${localStorage.getItem("auth_token") ?? ""}`,
});

async function parseApiResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    if (isJson && payload && typeof payload === "object" && "error" in payload) {
      throw new Error(String((payload as { error?: string }).error ?? "요청 처리 중 오류가 발생했습니다."));
    }
    if (typeof payload === "string" && payload.includes("<!DOCTYPE")) {
      throw new Error("장터 서버 응답을 받지 못했습니다. 백엔드가 실행 중인지 확인해주세요.");
    }
    throw new Error(typeof payload === "string" && payload.trim().length > 0 ? payload : "요청 처리 중 오류가 발생했습니다.");
  }

  if (!isJson) {
    throw new Error("장터 서버가 올바른 JSON 응답을 보내지 않았습니다.");
  }

  return payload as T;
}

type ListingSort = "price_asc" | "latest" | "quantity";
type FragmentSort = "price_asc" | "price_desc";
type SubmitStatus = "idle" | "submitting" | "success" | "error";
type SubmitError = null | { code: "wallet" | "quantity" | "server"; message: string };
type SellCtaState = "noInventory" | "noFragment" | "noPrice" | "overQuantity" | "submitting" | "success" | "error" | "ready";

type MarketListing = {
  id: string;
  sellerName: string;
  sellerHandle: string;
  quantity: number;
  price: number;
  postedAt: string;
};

type FragmentMarket = {
  id: string;
  idol: string;
  fragmentName: string;
  resultName?: string | null;
  color: string;
  accent: string;
  imageUrl: string | null;
  owned: number;
  floorPrice: number;
  lastPrice: number;
  changeRate: number;
  volume24h: number;
  demandScore: number;
  listedCount: number;
  description: string;
  chart: { time: string; price: number }[];
  trades: {
    time: string;
    type: "상승 체결" | "하락 체결" | "신규 등록";
    price: number;
    volume: number;
    buyer: string;
  }[];
  listings: MarketListing[];
  myListings: MarketListing[];
};

type SaleHistoryItem = {
  id: number;
  fragmentId: string;
  idol: string;
  fragmentName: string;
  buyerWalletAddress: string | null;
  sellerWalletAddress: string | null;
  tokenId: string | null;
  txHash: string | null;
  price: number;
  quantity: number;
  platformFee: number;
  settlementAmount: number;
  tradedAt: string;
};

const filterOptions = ["전체", "보유 중"];
const fragmentSortOptions: Array<{ key: FragmentSort; label: string }> = [
  { key: "price_desc", label: "가격 높은 순" },
  { key: "price_asc", label: "가격 낮은 순" },
];
const KBO_TEAMS = ["LG", "두산", "KIA", "삼성", "SSG", "롯데", "NC", "키움", "한화", "KT"];
const FRAGMENTS_PER_PAGE = 8;

function getMarketViewerHandle() {
  return localStorage.getItem("nickname") ?? "unknown";
}

function formatPrice(price: number) {
  return `${price.toLocaleString()}원`;
}

function hasMarketPrice(price: number | null | undefined) {
  return Number(price ?? 0) > 0;
}

function formatMarketPrice(price: number | null | undefined) {
  return hasMarketPrice(price) ? formatPrice(Number(price)) : "매물 없음";
}

function getSuggestedSellPrice(fragment: Pick<FragmentMarket, "floorPrice" | "lastPrice">) {
  if (hasMarketPrice(fragment.floorPrice)) return fragment.floorPrice + 1200;
  if (hasMarketPrice(fragment.lastPrice)) return fragment.lastPrice;
  return 1000;
}

function getComparableMarketPrice(fragment: Pick<FragmentMarket, "floorPrice" | "lastPrice">) {
  if (hasMarketPrice(fragment.floorPrice)) return fragment.floorPrice;
  if (hasMarketPrice(fragment.lastPrice)) return fragment.lastPrice;
  return null;
}

function marketCompareLabel(sellPrice: number, quantity: number, fragment: Pick<FragmentMarket, "floorPrice" | "lastPrice">) {
  const reference = getComparableMarketPrice(fragment);
  const referenceLabel = hasMarketPrice(fragment.floorPrice) ? "최저가" : hasMarketPrice(fragment.lastPrice) ? "최근 체결가" : null;
  if (!reference || !referenceLabel) return "비교 가능한 기존 매물이 없어 신규 등록가로 표시됩니다";
  const diff = sellPrice - reference;
  const unitLabel = diff === 0 ? `${referenceLabel}와 동일` : `${referenceLabel} 대비 ${diff > 0 ? "+" : ""}${formatPrice(diff)}`;
  return quantity > 1 ? `${unitLabel} · 총 ${formatPrice(sellPrice * quantity)}` : unitLabel;
}

function getFragmentResultName(fragment: Pick<FragmentMarket, "fragmentName" | "resultName">) {
  return fragment.resultName ?? fragment.fragmentName.replace(/\s*파편$/, "");
}

function parsePostedAtScore(postedAt: string) {
  if (postedAt.includes("방금")) return 0;
  const minuteMatch = postedAt.match(/(\d+)분/);
  if (minuteMatch) return Number(minuteMatch[1]);
  const hourMatch = postedAt.match(/(\d+)시간/);
  if (hourMatch) return Number(hourMatch[1]) * 60;
  return 999;
}

function isFreshListing(postedAt: string) {
  return parsePostedAtScore(postedAt) <= 2;
}

export function Market() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const viewerHandle = getMarketViewerHandle();
  const { walletAddress } = useAppSettings();
  const { isLoggedIn, isLoading: authLoading } = useAuth();

  const [marketState, setMarketState] = useState<FragmentMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"market" | "sell">("market");
  const [marketViewMode, setMarketViewMode] = useState<"browse" | "detail">("browse");
  const [activeFilter, setActiveFilter] = useState("전체");
  const [fragmentSort, setFragmentSort] = useState<FragmentSort>("price_asc");
  const [fragmentPage, setFragmentPage] = useState(1);
  const [query, setQuery] = useState("");
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [listingSort, setListingSort] = useState<ListingSort>("price_asc");
  const [selectedId, setSelectedId] = useState<string>("");
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  const [sellPrice, setSellPrice] = useState(0);
  const [sellQuantity, setSellQuantity] = useState(2);
  const [listedTarget, setListedTarget] = useState<string | null>(null);
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [submitError, setSubmitError] = useState<SubmitError>(null);
  const [recentlyListedId, setRecentlyListedId] = useState<string | null>(null);
  // ⚠️ 아래 두 상태는 JSX 에서 읽히지만(구매 영수증·품절 안내) setter 가 어디에서도 호출되지 않는다.
  // 즉 해당 UI 는 현재 절대 렌더링되지 않는다. 구매 성공/품절 처리 경로에 연결이 빠져 있다.
  // 지우지 않는 이유 — 표시할 내용과 위치가 이미 잡혀 있어 연결만 하면 되기 때문이다.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 미연결 UI. 이슈로 추적한다.
  const [purchaseReceipt, setPurchaseReceipt] = useState<{ fragmentId: string; sellerName: string; price: number } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 미연결 UI. 이슈로 추적한다.
  const [soldOutNotice, setSoldOutNotice] = useState<{ fragmentId: string; sellerName: string; price: number } | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  // ⚠️ setSalesHistory 로 채워지지만 salesHistory 를 읽는 화면이 없다 — 판매 이력이 표시되지 않는다.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- 미표시 데이터. 이슈로 추적한다.
  const [salesHistory, setSalesHistory] = useState<SaleHistoryItem[]>([]);

  const [showBuyModal, setShowBuyModal]           = useState(false);
  const [tossBuyWidgets, setTossBuyWidgets]       = useState<any>(null);
  const [tossBuyWidgetReady, setTossBuyWidgetReady] = useState(false);
  const [tossBuyError, setTossBuyError]           = useState("");
  const tossBuyListingRef = useRef<MarketListing | null>(null);

  const fetchMarket = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/market/fragments"), { headers: API_HEADERS(walletAddress) });
      const data = await parseApiResponse<FragmentMarket[]>(res);
      setMarketState(data);
      if (!selectedId && data.length > 0) {
        setSelectedId(data[0].id);
        setSellPrice(getSuggestedSellPrice(data[0]));
      }
      setApiError(null);
    } catch {
      setApiError("장터 데이터를 불러오지 못했습니다.");
    }
  }, [selectedId, walletAddress]);

  const fetchSalesHistory = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/market/sales"), { headers: API_HEADERS(walletAddress) });
      const data = await parseApiResponse<SaleHistoryItem[]>(res);
      setSalesHistory(data);
    } catch {
      setSalesHistory([]);
    }
  }, [walletAddress]);

  const requireLogin = useCallback(() => {
    if (authLoading) return false;
    if (!isLoggedIn) {
      navigate("/login");
      return false;
    }
    return true;
  }, [authLoading, isLoggedIn, navigate]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchMarket(), fetchSalesHistory()]).finally(() => setLoading(false));
  }, [fetchMarket, fetchSalesHistory]);

  useEffect(() => {
    if (authLoading || isLoggedIn || activeTab !== "sell") return;
    setActiveTab("market");
    setMarketViewMode("browse");
  }, [activeTab, authLoading, isLoggedIn]);

  const EMPTY_FRAGMENT: FragmentMarket = {
    id: "", idol: "", fragmentName: "", color: "#888", accent: "#888",
    imageUrl: null, owned: 0, floorPrice: 0, lastPrice: 0, changeRate: 0, volume24h: 0,
    demandScore: 0, listedCount: 0, description: "", chart: [], trades: [], listings: [], myListings: [],
  };

  const selectedFragment = marketState.find((f) => f.id === selectedId) ?? marketState[0] ?? EMPTY_FRAGMENT;
  const selectedFragmentListings = useMemo(() => [...(selectedFragment.listings ?? [])], [selectedFragment]);

  useEffect(() => {
    if (searchParams.get("action") === "sell") {
      if (authLoading) return;
      if (!isLoggedIn) {
        navigate("/login");
        return;
      }
      setActiveTab("sell");
      setMarketViewMode("browse");
    }
  }, [authLoading, isLoggedIn, navigate, searchParams]);

  useEffect(() => {
    const requestedFragmentId = searchParams.get("fragment");
    if (!requestedFragmentId) return;
    if (authLoading) return;
    if (!isLoggedIn) {
      navigate("/login");
      return;
    }
    const requestedFragment = marketState.find((f) => f.id === requestedFragmentId);
    if (!requestedFragment) return;
    setSelectedId(requestedFragment.id);
    setActiveTab(searchParams.get("action") === "sell" ? "sell" : "market");
    setMarketViewMode("detail");
    setActiveFilter("전체");
    setQuery("");
    setSellPrice(getSuggestedSellPrice(requestedFragment));
    setSellQuantity(Math.min(2, Math.max(requestedFragment.owned, 1)));
  }, [authLoading, isLoggedIn, marketState, navigate, searchParams]);

  useEffect(() => {
    if (activeTab === "sell") return;
    if (searchParams.get("fragment")) return;
    setMarketViewMode("browse");
  }, [activeTab, searchParams]);

  useEffect(() => {
    const requestedFragmentId = searchParams.get("fragment");
    const requestedSellerHandle = searchParams.get("sellerHandle");
    const requestedPrice = Number(searchParams.get("price"));
    const defaultListingId =
      selectedFragmentListings.find((l) => l.sellerHandle !== viewerHandle)?.id ??
      selectedFragmentListings[0]?.id ?? null;

    if (requestedFragmentId === selectedFragment.id) {
      const matchedListing = selectedFragmentListings.find(
        (l) =>
          (!requestedSellerHandle || l.sellerHandle === requestedSellerHandle) &&
          (!Number.isFinite(requestedPrice) || requestedPrice <= 0 || l.price === requestedPrice),
      );
      setSelectedListingId(matchedListing?.id ?? defaultListingId);
      return;
    }
    setSelectedListingId(defaultListingId);
  }, [searchParams, selectedFragment.id, selectedFragmentListings, viewerHandle]);

  const getOwnedCount = (fragment: FragmentMarket) => Math.max(fragment.owned, 0);

  const filteredFragments = useMemo(() => {
    return marketState.filter((fragment) => {
      const matchesQuery =
        query.trim().length === 0 ||
        fragment.idol.toLowerCase().includes(query.toLowerCase()) ||
        fragment.fragmentName.toLowerCase().includes(query.toLowerCase()) ||
        getFragmentResultName(fragment).toLowerCase().includes(query.toLowerCase()) ||
        fragment.description.toLowerCase().includes(query.toLowerCase());
      const matchesFilter = activeFilter === "전체" || (activeFilter === "보유 중" && getOwnedCount(fragment) > 0);
      const matchesTeam = selectedTeams.length === 0 || selectedTeams.includes(fragment.idol);
      return matchesQuery && matchesFilter && matchesTeam;
    }).sort((left, right) => {
      const leftPrice = getComparableMarketPrice(left) ?? Number.MAX_SAFE_INTEGER;
      const rightPrice = getComparableMarketPrice(right) ?? Number.MAX_SAFE_INTEGER;
      if (fragmentSort === "price_desc") return rightPrice - leftPrice;
      return leftPrice - rightPrice;
    });
  }, [activeFilter, fragmentSort, marketState, query, selectedTeams]);

  const totalFragmentPages = Math.max(1, Math.ceil(filteredFragments.length / FRAGMENTS_PER_PAGE));
  const fragmentPageStart = filteredFragments.length === 0 ? 0 : (fragmentPage - 1) * FRAGMENTS_PER_PAGE + 1;
  const fragmentPageEnd = Math.min(fragmentPage * FRAGMENTS_PER_PAGE, filteredFragments.length);
  const paginatedFragments = useMemo(() => {
    const start = (fragmentPage - 1) * FRAGMENTS_PER_PAGE;
    return filteredFragments.slice(start, start + FRAGMENTS_PER_PAGE);
  }, [filteredFragments, fragmentPage]);

  useEffect(() => {
    setFragmentPage(1);
  }, [activeFilter, fragmentSort, query, selectedTeams]);

  useEffect(() => {
    if (fragmentPage > totalFragmentPages) setFragmentPage(totalFragmentPages);
  }, [fragmentPage, totalFragmentPages]);

  const ownedFragments = useMemo(() => marketState.filter((f) => getOwnedCount(f) > 0), [marketState]);
  const sellableFragments = useMemo(() => filteredFragments.filter((f) => getOwnedCount(f) > 0), [filteredFragments]);

  const resetCategoryFilters = () => { setSelectedTeams([]); setActiveFilter("전체"); setQuery(""); };
  const toggleTeam = (team: string) => setSelectedTeams((prev) => prev.includes(team) ? prev.filter((t) => t !== team) : [...prev, team]);

  const registrationFee = 300;
  const saleFee = Math.round(sellPrice * sellQuantity * 0.05);
  const expectedSettlement = sellPrice * sellQuantity - registrationFee - saleFee;
  const selectedOwnedCount = getOwnedCount(selectedFragment);
  const hasSellInventory = ownedFragments.length > 0 && selectedOwnedCount > 0;
  const totalSaleAmount = sellPrice * sellQuantity;
  const sellStep: 1 | 2 | 3 = !selectedId || selectedOwnedCount === 0 ? 1 : sellPrice <= 0 || sellQuantity > selectedOwnedCount ? 2 : 3;
  const sellCtaState: SellCtaState =
    selectedOwnedCount === 0 ? "noInventory"
      : !selectedId ? "noFragment"
        : sellPrice <= 0 ? "noPrice"
          : sellQuantity > selectedOwnedCount ? "overQuantity"
            : submitStatus === "submitting" ? "submitting"
              : submitStatus === "success" ? "success"
                : submitStatus === "error" ? "error"
                  : "ready";
  const sellCtaCopy: Record<SellCtaState, { label: string; hint: string; disabled: boolean; bg: string; color: string; border?: string }> = {
    noInventory: { label: "먼저 파편을 모아보세요", hint: "장터, 카드 조합, 교환소에서 판매할 파편을 먼저 확보해 주세요.", disabled: true, bg: "#cbd5e1", color: "#ffffff" },
    noFragment: { label: "판매할 파편을 선택해 주세요", hint: "왼쪽 보유 파편 목록에서 판매할 파편을 선택하세요.", disabled: true, bg: "#cbd5e1", color: "#ffffff" },
    noPrice: { label: "판매 단가를 입력해 주세요", hint: "가격 보조 버튼이나 입력창으로 단가를 먼저 정해 주세요.", disabled: true, bg: "#cbd5e1", color: "#ffffff" },
    overQuantity: { label: `보유 수량(${selectedOwnedCount}개)을 초과했어요`, hint: `최대 ${selectedOwnedCount}개까지 등록할 수 있어요.`, disabled: true, bg: "#fff7ed", color: "#ea580c", border: "#fed7aa" },
    submitting: { label: "등록 처리 중...", hint: "지갑 서명과 장터 등록을 처리하고 있어요.", disabled: true, bg: "#1e3a8acc", color: "#ffffff" },
    success: { label: "같은 파편 추가 등록하기", hint: "등록 완료. 아래 내 매물 관리에서 바로 수정하거나 취소할 수 있어요.", disabled: false, bg: "#16a34a", color: "#ffffff" },
    error: { label: submitError?.code === "wallet" ? "지갑 연결 후 다시 등록하기" : submitError?.code === "quantity" ? "수량을 조정해 다시 등록" : "다시 시도", hint: submitError?.message ?? "등록에 실패했어요. 잠시 후 다시 시도해 주세요.", disabled: false, bg: submitError?.code === "quantity" ? "#fff7ed" : "#1e3a8a", color: submitError?.code === "quantity" ? "#ea580c" : "#ffffff", border: submitError?.code === "quantity" ? "#fed7aa" : undefined },
    ready: { label: `${formatPrice(totalSaleAmount)}에 ${sellQuantity}개 판매 등록하기`, hint: `단가 ${formatPrice(sellPrice)} · 정산 ${formatPrice(Math.max(expectedSettlement, 0))} · 수수료 ${formatPrice(saleFee)}`, disabled: false, bg: "#1e3a8a", color: "#ffffff" },
  };
  const sellCta = sellCtaCopy[sellCtaState];
  const comparableMarketPrice = getComparableMarketPrice(selectedFragment);
  const abnormalPriceRatio = comparableMarketPrice ? sellPrice / comparableMarketPrice : 1;
  const hasPriceWarning = sellPrice > 0 && Boolean(comparableMarketPrice) && (abnormalPriceRatio < 0.5 || abnormalPriceRatio > 2);

  const visibleFragmentListings = useMemo(() => {
    return [...selectedFragmentListings].sort((left, right) => {
      if (listingSort === "latest") return parsePostedAtScore(left.postedAt) - parsePostedAtScore(right.postedAt);
      if (listingSort === "quantity") return right.quantity - left.quantity || left.price - right.price;
      return left.price - right.price;
    });
  }, [listingSort, selectedFragmentListings]);

  const openMarketDetail = (fragment: FragmentMarket) => {
    if (!requireLogin()) return;
    setSelectedId(fragment.id);
    setSellPrice(getSuggestedSellPrice(fragment));
    setSellQuantity(Math.min(2, Math.max(getOwnedCount(fragment), 1)));
    setMarketViewMode("detail");
  };

  const selectedListing =
    visibleFragmentListings.find((l) => l.id === selectedListingId) ??
    visibleFragmentListings.find((l) => l.sellerHandle !== viewerHandle) ??
    visibleFragmentListings[0] ?? null;

  useEffect(() => {
    const defaultListingId =
      visibleFragmentListings.find((l) => l.sellerHandle !== viewerHandle)?.id ??
      visibleFragmentListings[0]?.id ?? null;
    if (!selectedListingId && defaultListingId) { setSelectedListingId(defaultListingId); return; }
    if (selectedListingId && !visibleFragmentListings.some((l) => l.id === selectedListingId)) setSelectedListingId(defaultListingId);
  }, [selectedListingId, viewerHandle, visibleFragmentListings]);

  useEffect(() => {
    if (!showBuyModal || !tossBuyListingRef.current) return;
    setTossBuyWidgetReady(false);
    setTossBuyWidgets(null);
    setTossBuyError("");
    let cancelled = false;
    (async () => {
      try {
        const tossPayments = await loadTossPayments(import.meta.env.VITE_TOSS_CLIENT_KEY as string);
        const widgets = tossPayments.widgets({ customerKey: ANONYMOUS });
        await widgets.setAmount({ value: tossBuyListingRef.current!.price, currency: "KRW" });
        await widgets.renderPaymentMethods({ selector: "#toss-market-payment-widget", variantKey: "DEFAULT" });
        await widgets.renderAgreement({ selector: "#toss-market-agreement-widget", variantKey: "AGREEMENT" });
        if (!cancelled) { setTossBuyWidgets(widgets); setTossBuyWidgetReady(true); }
      } catch {
        if (!cancelled) setTossBuyError("결제 위젯 초기화에 실패했습니다.");
      }
    })();
    return () => { cancelled = true; };
  }, [showBuyModal]);

  const handleOpenBuyModal = () => {
    if (!requireLogin()) return;
    if (!selectedListing || selectedListing.sellerHandle === viewerHandle) return;
    tossBuyListingRef.current = selectedListing;
    setShowBuyModal(true);
  };

  const handleTossBuy = async () => {
    if (!requireLogin()) return;
    if (!tossBuyWidgets || !tossBuyListingRef.current) return;
    setIsPurchasing(true);
    const listing = tossBuyListingRef.current;
    const orderId = `fr-${crypto.randomUUID()}`;
    sessionStorage.setItem(`toss_fragment_${orderId}`, JSON.stringify({
      listingId:    listing.id,
      fragmentName: selectedFragment.fragmentName,
      sellerName:   listing.sellerName,
      price:        listing.price,
    }));
    try {
      await tossBuyWidgets.requestPayment({
        orderId,
        orderName: `${selectedFragment.fragmentName} 파편 구매`,
        successUrl: `${window.location.origin}/market/fragment/buy/success`,
        failUrl:    `${window.location.origin}/market`,
      });
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      if (e.code !== "USER_CANCEL") setTossBuyError(e.message ?? "결제 오류가 발생했습니다.");
      setIsPurchasing(false);
    }
  };

  const handleCreateListing = async () => {
    if (!requireLogin()) return;
    setSubmitError(null);
    if (getOwnedCount(selectedFragment) <= 0) {
      setSubmitStatus("error");
      setSubmitError({ code: "quantity", message: "판매 가능한 파편이 없습니다." });
      return;
    }
    if (sellQuantity > getOwnedCount(selectedFragment)) {
      setSubmitStatus("error");
      setSubmitError({ code: "quantity", message: `보유 수량 ${getOwnedCount(selectedFragment)}개 안에서만 등록할 수 있어요.` });
      return;
    }
    const sellableCount = Math.max(sellQuantity, 0);
    if (sellableCount <= 0 || sellPrice <= 0) {
      setSubmitStatus("error");
      setSubmitError({ code: "server", message: "판매 단가와 수량을 다시 확인해 주세요." });
      return;
    }
    if (!walletAddress) {
      setSubmitStatus("error");
      setSubmitError({ code: "wallet", message: "지갑을 연결한 뒤 판매 등록을 다시 시도해 주세요." });
      return;
    }
    if (hasPriceWarning) {
      const ok = window.confirm("시장 최저가와 차이가 큰 가격입니다. 이 가격으로 판매 등록할까요?");
      if (!ok) return;
    }
    setSubmitStatus("submitting");
    let listingMessage: string;
    let listingSignature: string;
    try {
      listingMessage = `Listing fragment ${selectedFragment.id} quantity ${sellableCount} price ${sellPrice} KRW at ${Date.now()}`;
      listingSignature = await signListingMessage(listingMessage, walletAddress);
    } catch (err) {
      setSubmitStatus("error");
      setSubmitError({ code: "wallet", message: err instanceof Error ? err.message : "지갑 서명에 실패했습니다." });
      return;
    }
    try {
      const res = await fetch(apiUrl("/api/market/listings"), {
        method: "POST",
        headers: API_HEADERS(walletAddress),
        body: JSON.stringify({ fragmentId: selectedFragment.id, price: sellPrice, quantity: sellableCount, listingMessage, listingSignature }),
      });
      const data = await parseApiResponse<{ updatedFragment?: FragmentMarket; listingId?: string }>(res);
      if (data.updatedFragment) {
        setMarketState((prev) => prev.map((f) => f.id === data.updatedFragment!.id ? data.updatedFragment! : f));
        setSellPrice(data.updatedFragment.floorPrice);
        const remainingOwned = Math.max(data.updatedFragment.owned ?? 0, 0);
        setSellQuantity(remainingOwned > 0 ? Math.min(remainingOwned, 2) : 1);
      }
      if (data.listingId) {
        setSelectedListingId(data.listingId);
        setRecentlyListedId(data.listingId);
        window.setTimeout(() => setRecentlyListedId((current) => current === data.listingId ? null : current), 3000);
      }
      setListedTarget(selectedFragment.id);
      fetchSalesHistory();
      setSubmitStatus("success");
    } catch (err) {
      setSubmitStatus("error");
      setSubmitError({ code: "server", message: err instanceof Error ? err.message : "판매 등록 중 오류가 발생했습니다." });
    }
  };

  const applySuggestedSellPrice = (mode: "floor" | "undercut" | "last") => {
    const reference = getComparableMarketPrice(selectedFragment);
    if (mode === "floor") { setSellPrice(reference ?? getSuggestedSellPrice(selectedFragment)); return; }
    if (mode === "undercut") { setSellPrice(reference ? Math.max(reference - 100, 1000) : getSuggestedSellPrice(selectedFragment)); return; }
    setSellPrice(hasMarketPrice(selectedFragment.lastPrice) ? selectedFragment.lastPrice : getSuggestedSellPrice(selectedFragment));
  };

  const handleCancelListing = async (listingId: string) => {
    try {
      const res = await fetch(apiUrl(`/api/market/listings/${listingId}`), { method: "DELETE", headers: API_HEADERS(walletAddress) });
      const data = await parseApiResponse<{ updatedFragment?: FragmentMarket }>(res);
      if (data.updatedFragment) setMarketState((prev) => prev.map((f) => f.id === data.updatedFragment!.id ? data.updatedFragment! : f));
      setSelectedListingId((current) => (current === listingId ? null : current));
      fetchSalesHistory();
    } catch (err) {
      alert(err instanceof Error ? err.message : "매물 취소 중 오류가 발생했습니다.");
    }
  };

  const handleAdjustListingPrice = async (listingId: string, delta: number) => {
    const listing = selectedFragment.myListings.find((l) => l.id === listingId);
    if (!listing) return;
    const newPrice = Math.max(listing.price + delta, 1000);
    try {
      const res = await fetch(apiUrl(`/api/market/listings/${listingId}`), {
        method: "PATCH",
        headers: API_HEADERS(walletAddress),
        body: JSON.stringify({ price: newPrice }),
      });
      const data = await parseApiResponse<{ updatedFragment?: FragmentMarket }>(res);
      if (data.updatedFragment) setMarketState((prev) => prev.map((f) => f.id === data.updatedFragment!.id ? data.updatedFragment! : f));
      fetchSalesHistory();
    } catch (err) {
      alert(err instanceof Error ? err.message : "가격 수정 중 오류가 발생했습니다.");
    }
  };

  const selectedViewerListings = useMemo(() => [...(selectedFragment.myListings ?? [])].sort((a, b) => a.price - b.price), [selectedFragment.myListings]);
  const totalViewerListingCount = useMemo(() => marketState.reduce((sum, f) => sum + (f.myListings?.length ?? 0), 0), [marketState]);
  const totalViewerListingQuantity = useMemo(() => marketState.reduce((sum, f) => sum + (f.myListings ?? []).reduce((q, l) => q + l.quantity, 0), 0), [marketState]);
  const selectedListingVsFloor = selectedListing && hasMarketPrice(selectedFragment.floorPrice) ? selectedListing.price - selectedFragment.floorPrice : null;

  useEffect(() => {
    if (activeTab !== "sell") return;
    if (getOwnedCount(selectedFragment) > 0 || ownedFragments.length === 0) return;
    const firstOwned = ownedFragments[0];
    setSelectedId(firstOwned.id);
    setSellPrice(getSuggestedSellPrice(firstOwned));
    setSellQuantity(1);
  }, [activeTab, ownedFragments, selectedFragment]);

  const panelStyle = { background: "#f8fafc", border: "1px solid #d6dee8", boxShadow: "0 10px 24px rgba(17, 40, 73, 0.05)" };
  const inputStyle = { border: "1px solid #cbd5e1", background: "#fcfdfe", color: "#1f2f47" };
  const neutralText = "#1c2f4a";
  const mutedText = "#728195";
  const lineColor = "#d6dee7";
  const actionBlue = "#4b6581";
  const priceGreen = "#547b63";
  const subtleSurface = "#f2f5f8";
  const accentSurface = "#e9eef4";
  const accentBorder = "#c6d2df";
  const isMarketDetail = activeTab === "market" && marketViewMode === "detail";

  if (loading) {
    return (
      <div className="w-full flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-3">
          <div className="animate-spin w-8 h-8 border-4 border-blue-200 border-t-blue-500 rounded-full mx-auto" />
          <p style={{ color: "#728195" }}>장터 데이터 불러오는 중...</p>
        </div>
      </div>
    );
  }

  if (apiError || marketState.length === 0) {
    return (
      <div className="w-full flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-4">
          <p style={{ color: "#d45555" }}>{apiError ?? "장터 데이터가 없습니다."}</p>
          <Button onClick={() => { setLoading(true); fetchMarket().finally(() => setLoading(false)); }} style={{ background: "#446f9f", color: "#fff" }}>
            다시 시도
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <section className="border-b" style={{ borderColor: lineColor, background: "radial-gradient(circle at top left, rgba(83,111,141,0.08), transparent 28%), linear-gradient(180deg, #eef2f5 0%, #e9eef2 100%)" }}>
        <div className="page-strip-wide pt-8 pb-7">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="grid xl:grid-cols-[minmax(0,1.1fr)_360px] gap-6 items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="page-eyebrow" style={{ color: "#1456a0" }}>Fragment Market</span>
                <span className="rounded-full px-3 py-1 text-[0.72rem] font-semibold" style={{ background: "#edf7f1", border: "1px solid #cbe1d3", color: priceGreen }}>판매자별 등록가 비교</span>
              </div>
              <h1 className="page-title mb-2" style={{ color: neutralText }}>파편 장터</h1>
              <p className="page-subtitle max-w-3xl" style={{ color: mutedText }}>굿즈 파편 매물을 확인하고, 조합에 필요한 파편을 사고팔 수 있어요.</p>
              {!isMarketDetail && (
                <p className="mt-6 text-[0.95rem] leading-7" style={{ color: mutedText }}>파편을 선택하면 보유 수량과 판매 매물을 바로 확인할 수 있어요.</p>
              )}
            </div>
          </motion.div>

          <div className="flex flex-wrap gap-3 mt-6">
            {[{ key: "market", label: "파편 장터&구매", icon: ShoppingCart }, { key: "sell", label: "파편 등록&판매", icon: TbMoneybagPlus }].map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <button key={tab.key} onClick={() => { const nextTab = tab.key as "market" | "sell"; if (nextTab === "sell" && !requireLogin()) return; setActiveTab(nextTab); if (nextTab === "market") { fetchMarket(); if (!searchParams.get("fragment")) setMarketViewMode("browse"); } }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-[14px] text-sm font-semibold transition-all"
                  style={{ background: active ? accentSurface : "#f9fbfc", border: active ? `1px solid ${accentBorder}` : `1px solid ${lineColor}`, color: active ? actionBlue : mutedText }}>
                  <Icon className="w-4 h-4" />{tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="page-strip-wide py-8">
        {activeTab === "market" ? (
          marketViewMode === "browse" ? (
            <div className="flex gap-6 items-start">
              <aside className="w-[220px] h-[716px] shrink-0 sticky top-6 flex flex-col gap-4">
                <div className="rounded-[18px] p-4 flex-1" style={panelStyle}>
                  <p className="text-[0.7rem] font-bold uppercase tracking-[0.14em] mb-3" style={{ color: mutedText }}>보기 방식</p>
                  {filterOptions.map((filter) => (
                    <label key={filter} className="flex items-center gap-2.5 cursor-pointer py-1.5">
                      <input type="radio" name="filter" checked={activeFilter === filter} onChange={() => setActiveFilter(filter)} className="accent-[#4b6581] w-4 h-4" />
                      <span className="text-[0.84rem] font-medium" style={{ color: activeFilter === filter ? neutralText : mutedText }}>{filter}</span>
                    </label>
                  ))}
                </div>

                <div className="rounded-[18px] p-4" style={panelStyle}>
                  <p className="text-[0.7rem] font-bold uppercase tracking-[0.14em] mb-3" style={{ color: mutedText }}>필터</p>
                  {fragmentSortOptions.map((option) => (
                    <label key={option.key} className="flex items-center gap-2.5 cursor-pointer py-1.5">
                      <input type="radio" name="fragmentSort" checked={fragmentSort === option.key} onChange={() => setFragmentSort(option.key)} className="accent-[#4b6581] w-4 h-4" />
                      <span className="text-[0.84rem] font-medium" style={{ color: fragmentSort === option.key ? neutralText : mutedText }}>{option.label}</span>
                    </label>
                  ))}
                </div>

                <div className="rounded-[18px] p-4" style={panelStyle}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[0.7rem] font-bold uppercase tracking-[0.14em]" style={{ color: mutedText }}>구단</p>
                    {selectedTeams.length > 0 && <button onClick={() => setSelectedTeams([])} className="text-[0.68rem] font-semibold" style={{ color: actionBlue }}>초기화</button>}
                  </div>
                  <div className="space-y-0.5">
                    {KBO_TEAMS.map((team) => (
                      <label key={team} className="flex items-center gap-2.5 cursor-pointer py-1.5 rounded-[10px] px-2 transition-colors hover:bg-[#eef2f5]">
                        <input type="checkbox" checked={selectedTeams.includes(team)} onChange={() => setSelectedTeams((prev) => prev.includes(team) ? prev.filter((t) => t !== team) : [...prev, team])} className="accent-[#4b6581] w-4 h-4 rounded" />
                        <span className="text-[0.84rem] font-medium" style={{ color: selectedTeams.includes(team) ? neutralText : mutedText }}>{team}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {selectedTeams.length > 0 && (
                  <div className="rounded-[16px] px-4 py-3" style={{ background: accentSurface, border: `1px solid ${accentBorder}` }}>
                    <p className="text-[0.72rem] font-semibold mb-2" style={{ color: actionBlue }}>적용된 필터</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedTeams.map((t) => <button key={t} onClick={() => setSelectedTeams((prev) => prev.filter((x) => x !== t))} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold" style={{ background: "#fff", border: `1px solid ${accentBorder}`, color: actionBlue }}>{t} ×</button>)}
                    </div>
                    <button onClick={resetCategoryFilters} className="mt-2 text-[0.68rem] font-semibold" style={{ color: mutedText }}>전체 초기화</button>
                  </div>
                )}

              </aside>

              <div className="flex-1 min-w-0">
                <div className="min-h-[716px]">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                    {paginatedFragments.map((fragment, index) => (
                      <motion.button key={fragment.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }} onClick={() => openMarketDetail(fragment)}
                        className="text-left rounded-[22px] overflow-hidden transition-all hover:-translate-y-1 hover:shadow-md" style={panelStyle}>
                        <div className="w-full h-[220px] sm:h-[280px] overflow-hidden relative" style={{ background: fragment.imageUrl ? "transparent" : `linear-gradient(135deg, ${fragment.color}22, ${fragment.color}08)` }}>
                          {fragment.imageUrl ? (
                            <img src={fragment.imageUrl} alt={fragment.fragmentName} className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <div className="rounded-full w-16 h-16 flex items-center justify-center text-[1.6rem] font-black" style={{ background: `${fragment.color}28`, color: fragment.color }}>{fragment.idol.slice(0, 1)}</div>
                            </div>
                          )}
                          <span className="absolute top-2.5 left-2.5 rounded-full px-2 py-0.5 text-[0.62rem] font-bold" style={{ background: `${fragment.color}dd`, color: "#fff" }}>{fragment.idol}</span>
                          {fragment.listings.length > 0 && <span className="absolute top-2.5 right-2.5 rounded-full px-2 py-0.5 text-[0.62rem] font-bold" style={{ background: "rgba(255,255,255,0.92)", border: "1px solid #cbe1d3", color: priceGreen }}>{fragment.listings.length}명</span>}
                        </div>
                        <div className="px-3 py-2.5">
                          <h3 className="text-[0.82rem] font-bold leading-snug line-clamp-2" style={{ color: neutralText }}>{fragment.fragmentName}</h3>
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <p className="text-[0.92rem] font-bold" style={{ color: priceGreen }}>{formatMarketPrice(fragment.floorPrice)}</p>
                            <span className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[0.68rem] font-semibold" style={{ background: accentSurface, border: `1px solid ${accentBorder}`, color: actionBlue }}>구매 <ArrowRight className="w-2.5 h-2.5" /></span>
                          </div>
                        </div>
                      </motion.button>
                    ))}
                  </div>

                  {filteredFragments.length === 0 && (
                    <div className="rounded-[22px] px-5 py-16 text-center" style={panelStyle}>
                      <p className="text-[0.92rem] font-semibold mb-2" style={{ color: neutralText }}>{activeFilter === "보유 중" ? "보유한 파편이 없습니다" : "검색 결과가 없습니다"}</p>
                      <p className="text-[0.82rem]" style={{ color: mutedText }}>{activeFilter === "보유 중" ? "장터에서 파편을 구매하거나 카드 조합 페이지에서 박스를 개봉해보세요." : "필터를 조정하거나 다른 검색어를 입력해보세요."}</p>
                      <button onClick={() => { setSelectedTeams([]); setActiveFilter("전체"); setQuery(""); }} className="mt-4 rounded-[12px] px-4 py-2 text-[0.8rem] font-semibold" style={{ background: accentSurface, border: `1px solid ${accentBorder}`, color: actionBlue }}>필터 초기화</button>
                    </div>
                  )}
                </div>

                {filteredFragments.length > 0 && (
                  <div className="mt-6 flex flex-col items-center gap-3">
                    <p className="text-[0.78rem] font-semibold" style={{ color: mutedText }}>
                      한 페이지 8개씩 · 총 {filteredFragments.length}개 중 {fragmentPageStart}-{fragmentPageEnd}개 표시
                    </p>
                    <div className="flex justify-center gap-2">
                      <button
                        onClick={() => setFragmentPage((page) => Math.max(1, page - 1))}
                        disabled={fragmentPage === 1}
                        className="h-9 rounded-[10px] px-3 text-[0.8rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                        style={{ background: "#fff", border: `1px solid ${lineColor}`, color: mutedText }}
                      >
                        이전
                      </button>
                      {Array.from({ length: totalFragmentPages }, (_, index) => index + 1).map((page) => (
                        <button
                          key={page}
                          onClick={() => setFragmentPage(page)}
                          className="h-9 min-w-9 rounded-[10px] px-3 text-[0.82rem] font-semibold transition-colors"
                          style={{
                            background: fragmentPage === page ? actionBlue : "#fff",
                            border: `1px solid ${fragmentPage === page ? actionBlue : lineColor}`,
                            color: fragmentPage === page ? "#fff" : mutedText,
                          }}
                        >
                          {page}
                        </button>
                      ))}
                      <button
                        onClick={() => setFragmentPage((page) => Math.min(totalFragmentPages, page + 1))}
                        disabled={fragmentPage === totalFragmentPages}
                        className="h-9 rounded-[10px] px-3 text-[0.8rem] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                        style={{ background: "#fff", border: `1px solid ${lineColor}`, color: mutedText }}
                      >
                        다음
                      </button>
                    </div>
                  </div>
                )}

                <div className="mx-auto mt-4 flex w-full max-w-[860px]">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="파편 검색"
                    className="h-12 flex-1 rounded-none border px-4 text-[0.9rem] outline-none"
                    style={{ background: "#fff", borderColor: "#6f82a0", color: neutralText }}
                  />
                  <button
                    type="button"
                    aria-label="파편 검색"
                    className="h-12 w-14 shrink-0 inline-flex items-center justify-center border border-l-0"
                    style={{ background: actionBlue, borderColor: actionBlue, color: "#fff" }}
                  >
                    <Search className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid xl:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[minmax(0,1fr)_460px] gap-5 items-stretch">
              <motion.aside initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4 }} className="hidden">
                <button
                  onClick={() => setMarketViewMode("browse")}
                  className="inline-flex items-center gap-2 text-[0.86rem] font-semibold"
                  style={{ color: actionBlue }}
                >
                  <ArrowRight className="w-4 h-4 rotate-180" />
                  장터로 돌아가기
                </button>
              </motion.aside>

              <motion.main initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.05 }} className="space-y-5">
                <div className="rounded-[18px] px-4 py-3 flex items-center gap-3 overflow-x-auto" style={{ background: panelStyle.background, border: panelStyle.border }}>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[0.65rem] font-black" style={{ background: priceGreen, color: "#fff" }}>✓</div>
                    <div><p className="text-[0.64rem] font-semibold" style={{ color: priceGreen }}>STEP 1</p><p className="text-[0.78rem] font-bold" style={{ color: neutralText }}><span className="inline-block rounded-full px-1.5 py-0.5 mr-1 text-[0.6rem] font-bold" style={{ background: `${selectedFragment.color}18`, color: selectedFragment.color }}>{selectedFragment.idol}</span>{selectedFragment.fragmentName}</p></div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0" style={{ color: mutedText }} />
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[0.65rem] font-black" style={selectedListing ? { background: priceGreen, color: "#fff" } : { background: accentSurface, border: `2px solid ${actionBlue}`, color: actionBlue }}>{selectedListing ? "✓" : "2"}</div>
                    <div><p className="text-[0.64rem] font-semibold" style={{ color: selectedListing ? priceGreen : actionBlue }}>STEP 2</p><p className="text-[0.78rem] font-bold" style={{ color: neutralText }}>{selectedListing ? <span style={{ color: priceGreen }}>{formatPrice(selectedListing.price)} 선택됨</span> : <span style={{ color: actionBlue }}>아래 매물 클릭 ↓</span>}</p></div>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0" style={{ color: mutedText }} />
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[0.65rem] font-black" style={selectedListing ? { background: accentSurface, border: `2px solid ${actionBlue}`, color: actionBlue } : { background: subtleSurface, border: `1px solid ${lineColor}`, color: mutedText }}>3</div>
                    <div><p className="text-[0.64rem] font-semibold" style={{ color: selectedListing ? actionBlue : mutedText }}>STEP 3</p><p className="text-[0.78rem] font-bold" style={{ color: selectedListing ? neutralText : mutedText }}>{selectedListing ? "오른쪽에서 구매 →" : "구매하기"}</p></div>
                  </div>
                </div>

                <div className="rounded-[22px] px-5 py-4" style={panelStyle}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <button onClick={() => setMarketViewMode("browse")} className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: subtleSurface, border: `1px solid ${lineColor}` }}>
                        <ArrowRight className="w-3.5 h-3.5 rotate-180" style={{ color: mutedText }} />
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="rounded-full px-2 py-0.5 text-[0.66rem] font-bold" style={{ background: `${selectedFragment.color}18`, color: selectedFragment.color, border: `1px solid ${selectedFragment.color}30` }}>{selectedFragment.idol}</span>
                        </div>
                        <h2 className="mt-1 text-[1.3rem] font-bold tracking-[-0.03em] truncate" style={{ color: neutralText }}>{selectedFragment.fragmentName}</h2>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0 text-[0.8rem]">
                      <div className="text-center"><p className="text-[0.62rem]" style={{ color: mutedText }}>최저가</p><p className="font-bold" style={{ color: priceGreen }}>{formatMarketPrice(selectedFragment.floorPrice)}</p></div>
                      <div className="text-center"><p className="text-[0.62rem]" style={{ color: mutedText }}>판매자</p><p className="font-semibold" style={{ color: neutralText }}>{selectedFragmentListings.length}명</p></div>
                      <div className="text-center"><p className="text-[0.62rem]" style={{ color: mutedText }}>내 보유</p><p className="font-semibold" style={{ color: neutralText }}>{getOwnedCount(selectedFragment)}개</p></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${lineColor}` }}>
                    <span className="text-[0.68rem] shrink-0" style={{ color: mutedText }}>정렬</span>
                    {[{ key: "price_asc", label: "최저가순" }, { key: "latest", label: "최신순" }, { key: "quantity", label: "수량순" }].map((option) => (
                      <button key={option.key} onClick={() => setListingSort(option.key as ListingSort)} className="rounded-[10px] px-2.5 py-1.5 text-[0.7rem] font-semibold" style={{ background: listingSort === option.key ? accentSurface : "transparent", border: listingSort === option.key ? `1px solid ${accentBorder}` : `1px solid transparent`, color: listingSort === option.key ? actionBlue : mutedText }}>{option.label}</button>
                    ))}
                  </div>
                  {soldOutNotice?.fragmentId === selectedFragment.id && (
                    <div className="mt-3 rounded-[14px] px-4 py-3" style={{ background: "rgba(239,143,154,0.10)", border: "1px solid rgba(239,143,154,0.20)" }}>
                      <p className="text-[0.74rem] font-semibold" style={{ color: "#ef8f9a" }}>방금 판매 완료 — {soldOutNotice.sellerName} 님의 {formatPrice(soldOutNotice.price)} 매물</p>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="rounded-[22px] overflow-hidden" style={panelStyle}>
                    <div className="grid grid-cols-[minmax(0,1.45fr)_120px_72px_90px_96px] gap-3 px-5 py-3 text-[0.7rem] font-bold uppercase tracking-[0.14em]" style={{ color: mutedText, background: "#eef2f5", borderBottom: `1px solid ${lineColor}` }}>
                      <span>판매자</span><span className="text-right">제시가</span><span className="text-right">수량</span><span className="text-right">등록</span><span className="text-right">선택</span>
                    </div>
                    <div className="divide-y" style={{ borderColor: lineColor }}>
                      {visibleFragmentListings.length > 0 ? visibleFragmentListings.map((listing) => {
                        const active = selectedListing?.id === listing.id;
                        return (
                          <button key={listing.id} onClick={() => setSelectedListingId(listing.id)} className="grid w-full grid-cols-[minmax(0,1.45fr)_120px_72px_90px_96px] gap-3 px-5 py-4 text-left transition-all" style={{ background: active ? accentSurface : "transparent" }}>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2"><span className="truncate text-[0.92rem] font-semibold" style={{ color: neutralText }}>{listing.sellerName}</span></div>
                              <p className="mt-1 text-[0.76rem]" style={{ color: mutedText }}>@{listing.sellerHandle}</p>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {isFreshListing(listing.postedAt) && <span className="rounded-full px-2 py-0.5 text-[0.62rem] font-bold" style={{ background: accentSurface, border: `1px solid ${accentBorder}`, color: actionBlue }}>방금 등록</span>}
                                {listing.quantity === 1 && <span className="rounded-full px-2 py-0.5 text-[0.62rem] font-bold" style={{ background: "rgba(239,143,154,0.12)", border: "1px solid rgba(239,143,154,0.22)", color: "#ef8f9a" }}>1개 남음</span>}
                              </div>
                            </div>
                            <p className="text-right text-[0.95rem] font-bold" style={{ color: priceGreen }}>{formatPrice(listing.price)}</p>
                            <p className="text-right text-[0.85rem] font-semibold" style={{ color: neutralText }}>{listing.quantity}개</p>
                            <p className="text-right text-[0.76rem]" style={{ color: mutedText }}>{listing.postedAt}</p>
                            <div className="flex justify-end"><span className="inline-flex items-center rounded-[10px] px-3 py-2 text-[0.72rem] font-semibold" style={{ background: active ? actionBlue : subtleSurface, border: active ? "none" : `1px solid ${lineColor}`, color: active ? "#fff" : mutedText }}>{active ? "✓ 선택됨" : "선택하기"}</span></div>
                          </button>
                        );
                      }) : (
                        <div className="px-5 py-10 text-center">
                          <p className="text-[0.92rem] font-semibold" style={{ color: neutralText }}>등록된 매물이 없어요</p>
                          <p className="mt-2 text-[0.8rem]" style={{ color: mutedText }}>다른 자산을 선택하거나 나중에 다시 확인해보세요.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.main>

              <motion.aside initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, delay: 0.08 }} className="space-y-4 xl:self-stretch">
                <div className="rounded-[22px] p-5 sticky top-4 xl:min-h-full" style={panelStyle}>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-[1rem] font-black shrink-0" style={{ background: `${selectedFragment.color}20`, color: selectedFragment.color }}>{selectedFragment.idol.slice(0, 1)}</div>
                    <div className="min-w-0">
                      <p className="text-[0.72rem] font-semibold truncate" style={{ color: selectedFragment.color }}>{selectedFragment.idol}</p>
                      <p className="text-[0.92rem] font-bold truncate" style={{ color: neutralText }}>{selectedFragment.fragmentName}</p>
                    </div>
                    <div className="ml-auto rounded-full px-2.5 py-1 text-[0.68rem] font-bold shrink-0" style={selectedListing ? { background: "rgba(147,213,138,0.12)", border: "1px solid rgba(147,213,138,0.22)", color: priceGreen } : { background: subtleSurface, border: `1px solid ${lineColor}`, color: mutedText }}>{selectedListing ? "선택됨" : "미선택"}</div>
                  </div>

                  {selectedListing ? (
                    <div className="rounded-[16px] px-4 py-4 mb-4" style={{ background: accentSurface, border: `1px solid ${accentBorder}` }}>
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div><p className="text-[0.72rem]" style={{ color: mutedText }}>판매자</p><p className="text-[0.88rem] font-semibold" style={{ color: neutralText }}>{selectedListing.sellerName}<span className="ml-1 text-[0.72rem] font-normal" style={{ color: mutedText }}>@{selectedListing.sellerHandle}</span></p></div>
                        <div className="text-right"><p className="text-[0.72rem]" style={{ color: mutedText }}>등록</p><p className="text-[0.76rem]" style={{ color: mutedText }}>{selectedListing.postedAt}</p></div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-[0.78rem]">
                        <div className="rounded-[10px] px-2 py-2 text-center" style={{ background: "rgba(255,255,255,0.7)", border: `1px solid ${accentBorder}` }}><p style={{ color: mutedText }}>가격</p><p className="font-bold" style={{ color: priceGreen }}>{formatPrice(selectedListing.price)}</p></div>
                        <div className="rounded-[10px] px-2 py-2 text-center" style={{ background: "rgba(255,255,255,0.7)", border: `1px solid ${accentBorder}` }}><p style={{ color: mutedText }}>수량</p><p className="font-semibold" style={{ color: neutralText }}>{selectedListing.quantity}개</p></div>
                        <div className="rounded-[10px] px-2 py-2 text-center" style={{ background: "rgba(255,255,255,0.7)", border: `1px solid ${accentBorder}` }}><p style={{ color: mutedText }}>최저가 대비</p><p className="font-semibold" style={{ color: selectedListingVsFloor && selectedListingVsFloor > 0 ? "#ef8f9a" : priceGreen }}>{selectedListingVsFloor === 0 ? "최저가" : selectedListingVsFloor === null ? "-" : `${selectedListingVsFloor > 0 ? "+" : ""}${formatPrice(selectedListingVsFloor)}`}</p></div>
                      </div>
                      {selectedListing.sellerHandle === viewerHandle && (
                        <div className="mt-3 rounded-[12px] px-3 py-3 text-[0.74rem] font-semibold" style={{ background: "rgba(239,143,154,0.10)", border: "1px solid rgba(239,143,154,0.22)", color: "#b85a68" }}>이 매물은 내가 등록한 매물이라 구매할 수 없어요. 다른 판매자의 매물을 선택해주세요.</div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-[16px] px-4 py-5 mb-4 text-center" style={{ background: subtleSurface, border: `1px solid ${lineColor}` }}>
                      <p className="text-[0.82rem]" style={{ color: mutedText }}>위에서 매물을 선택하면<br/>여기에 구매 정보가 표시돼요</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 mb-4 text-[0.78rem]">
                    <div className="rounded-[12px] px-3 py-2.5" style={{ background: subtleSurface, border: `1px solid ${lineColor}` }}><p style={{ color: mutedText }}>최저가</p><p className="font-semibold" style={{ color: priceGreen }}>{formatMarketPrice(selectedFragment.floorPrice)}</p></div>
                    <div className="rounded-[12px] px-3 py-2.5" style={{ background: subtleSurface, border: `1px solid ${lineColor}` }}><p style={{ color: mutedText }}>최근 체결</p><p className="font-semibold" style={{ color: neutralText }}>{formatPrice(selectedFragment.lastPrice)}</p></div>
                    <div className="rounded-[12px] px-3 py-2.5" style={{ background: subtleSurface, border: `1px solid ${lineColor}` }}><p style={{ color: mutedText }}>판매자 수</p><p className="font-semibold" style={{ color: neutralText }}>{selectedFragmentListings.length}명</p></div>
                    <div className="rounded-[12px] px-3 py-2.5" style={{ background: subtleSurface, border: `1px solid ${lineColor}` }}><p style={{ color: mutedText }}>내 보유</p><p className="font-semibold" style={{ color: neutralText }}>{getOwnedCount(selectedFragment)}개 → {selectedListing ? getOwnedCount(selectedFragment) + 1 : getOwnedCount(selectedFragment)}개</p></div>
                  </div>

                  <Button className="w-full h-12 text-sm font-bold disabled:opacity-50" style={{ background: isPurchasing ? "#888" : !isLoggedIn ? actionBlue : selectedListing && selectedListing.sellerHandle !== viewerHandle ? priceGreen : "#c8d6cc", color: !isLoggedIn ? "#ffffff" : "#102015" }}
                    onClick={handleOpenBuyModal} disabled={isPurchasing || !selectedListing || selectedListing.sellerHandle === viewerHandle}>
                    {isPurchasing ? (
                      <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />구매 처리 중...</span>
                    ) : (
                      <><ShoppingCart className="w-4 h-4 mr-1" />{!isLoggedIn ? "로그인 후 구매" : selectedListing ? selectedListing.sellerHandle === viewerHandle ? "내 매물은 구매할 수 없어요" : `${formatPrice(selectedListing.price)}에 구매하기` : "매물을 선택해주세요"}</>
                    )}
                  </Button>

                  {purchaseReceipt?.fragmentId === selectedFragment.id && (
                    <div className="rounded-[16px] px-4 py-4 mt-3" style={{ background: "rgba(147,213,138,0.10)", border: "1px solid rgba(147,213,138,0.20)" }}>
                      <p className="text-[0.8rem] font-bold" style={{ color: priceGreen }}>✓ 구매 완료</p>
                      <p className="mt-2 text-[0.82rem] leading-6" style={{ color: neutralText }}>{purchaseReceipt.sellerName} 님 매물을 {formatPrice(purchaseReceipt.price)}에 구매했어요.</p>
                      <Button asChild className="mt-3 h-10 px-4 text-sm font-semibold w-full" style={{ background: "#f3f6f8", color: neutralText, border: `1px solid ${lineColor}` }}>
                        <Link to="/combine">파편 조합 보러가기<ArrowRight className="w-4 h-4" /></Link>
                      </Button>
                    </div>
                  )}
                </div>
              </motion.aside>
            </div>
          )
        ) : (
          <div className="pb-24 md:pb-0">
            <div className="mb-5 overflow-x-auto rounded-[18px] px-4 py-3" style={{ background: "#fff", border: `1px solid ${lineColor}`, boxShadow: "0 6px 18px rgba(15,23,42,0.04)" }}>
              <div className="flex min-w-[720px] items-center gap-3">
                {[
                  { step: 1, label: "STEP 1", title: "판매할 파편 선택", summary: selectedOwnedCount > 0 ? `${selectedFragment.idol} · ${selectedFragment.fragmentName}` : "보유 파편을 먼저 선택" },
                  { step: 2, label: "STEP 2", title: "가격/수량 입력", summary: hasSellInventory && sellPrice > 0 ? `${formatPrice(sellPrice)} × ${sellQuantity}개` : "단가 입력 대기" },
                  { step: 3, label: "STEP 3", title: "등록 확인", summary: hasSellInventory && sellStep === 3 ? `정산 ${formatPrice(Math.max(expectedSettlement, 0))}` : "우측에서 확인" },
                ].map((item, index) => {
                  const done = sellStep > item.step;
                  const active = sellStep === item.step;
                  return (
                    <div key={item.step} className="flex flex-1 items-center gap-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full text-[0.72rem] font-black" style={done ? { background: priceGreen, color: "#fff" } : active ? { background: accentSurface, border: `2px solid #1e3a8a`, color: "#1e3a8a" } : { background: subtleSurface, border: `1px solid ${lineColor}`, color: mutedText }}>
                          {done ? <Check className="h-4 w-4" /> : item.step}
                        </div>
                        <div>
                          <p className="text-[0.64rem] font-bold" style={{ color: done ? priceGreen : active ? "#1e3a8a" : mutedText }}>{item.label}</p>
                          <p className="text-[0.78rem] font-bold" style={{ color: active || done ? neutralText : mutedText }}>{item.title}</p>
                          <p className="max-w-[190px] truncate text-[0.7rem]" style={{ color: mutedText }}>{item.summary}</p>
                        </div>
                      </div>
                      {index < 2 && <ArrowRight className="h-4 w-4 shrink-0" style={{ color: mutedText }} />}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)_400px] items-start">
              <aside className="space-y-4">
                <div className="rounded-[20px] p-4" style={panelStyle}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="market-eyebrow" style={{ color: mutedText }}>내 보유 파편</p>
                      <p className="mt-1 text-[0.95rem] font-bold" style={{ color: neutralText }}>판매할 파편 선택</p>
                    </div>
                    <span className="text-[0.76rem] font-semibold" style={{ color: mutedText }}>{ownedFragments.length}종</span>
                  </div>
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: mutedText }} />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="파편 검색" className="w-full rounded-[12px] py-2.5 pl-8 pr-3 text-[0.82rem] outline-none" style={inputStyle} />
                  </div>
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {KBO_TEAMS.map((team) => (
                      <button key={team} onClick={() => toggleTeam(team)} className="rounded-full px-2.5 py-1 text-[0.68rem] font-semibold" style={{ background: selectedTeams.includes(team) ? accentSurface : subtleSurface, border: selectedTeams.includes(team) ? `1px solid ${accentBorder}` : `1px solid ${lineColor}`, color: selectedTeams.includes(team) ? actionBlue : mutedText }}>{team}</button>
                    ))}
                  </div>
                  <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "456px" }}>
                    {sellableFragments.length > 0 ? sellableFragments.map((fragment, index) => {
                      const selected = fragment.id === selectedId;
                      return (
                        <motion.button key={fragment.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.02 }}
                          onClick={() => { setSelectedId(fragment.id); setSellPrice(getSuggestedSellPrice(fragment)); setSellQuantity(1); setSubmitStatus("idle"); setSubmitError(null); }}
                          className="w-full rounded-[14px] px-3 py-3 text-left transition-all"
                          style={{ background: selected ? "#f8fbff" : subtleSurface, border: selected ? "1px solid #1e3a8a" : `1px solid ${lineColor}`, boxShadow: selected ? "0 0 0 2px #dbeafe" : "none" }}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="mb-2 flex items-center gap-2">
                                <span className="rounded-full px-2 py-0.5 text-[0.64rem] font-bold" style={{ background: `${fragment.color}18`, color: fragment.color }}>{fragment.idol}</span>
                                <span className="text-[0.7rem]" style={{ color: mutedText }}>최저가 {formatMarketPrice(fragment.floorPrice)}</span>
                              </div>
                              <p className="truncate text-[0.9rem] font-bold" style={{ color: neutralText }}>{fragment.fragmentName}</p>
                              <p className="mt-1 text-[0.74rem]" style={{ color: priceGreen }}>보유 {getOwnedCount(fragment)}개 · 판매가능</p>
                            </div>
                            {selected && <Check className="h-4 w-4 shrink-0" style={{ color: "#1e3a8a" }} />}
                          </div>
                        </motion.button>
                      );
                    }) : (
                      <div className="rounded-[14px] px-4 py-5 text-[0.82rem] leading-6" style={{ background: subtleSurface, border: `1px solid ${lineColor}`, color: mutedText }}>
                        현재 필터 기준으로 판매 가능한 파편이 없어요. 필터를 풀거나 파편을 먼저 확보해보세요.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[20px] p-4" style={panelStyle}>
                  <p className="market-eyebrow" style={{ color: mutedText }}>내 판매 요약</p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-[14px] px-3 py-3" style={{ background: subtleSurface, border: `1px solid ${lineColor}` }}><p className="text-[0.7rem]" style={{ color: mutedText }}>전체 매물</p><p className="mt-1 text-[1rem] font-black" style={{ color: neutralText }}>{totalViewerListingCount}건</p></div>
                    <div className="rounded-[14px] px-3 py-3" style={{ background: subtleSurface, border: `1px solid ${lineColor}` }}><p className="text-[0.7rem]" style={{ color: mutedText }}>등록 수량</p><p className="mt-1 text-[1rem] font-black" style={{ color: neutralText }}>{totalViewerListingQuantity}개</p></div>
                  </div>
                </div>
              </aside>

              <main className="space-y-5">
                <div className="rounded-[22px] p-5" style={panelStyle}>
                  {ownedFragments.length === 0 ? (
                    <div className="rounded-[18px] px-5 py-12 text-center" style={{ background: "#fff", border: `1px solid ${lineColor}` }}>
                      <Package className="mx-auto h-9 w-9" style={{ color: mutedText }} />
                      <h2 className="mt-4 text-[1.15rem] font-black" style={{ color: neutralText }}>아직 판매 가능한 파편이 없어요</h2>
                      <p className="mx-auto mt-2 max-w-[520px] text-[0.9rem] leading-6" style={{ color: mutedText }}>장터에서 사거나, 카드 조합으로 박스를 열거나, 교환소에서 굿즈 NFT를 받아보세요.</p>
                      <div className="mt-5 grid gap-2 sm:grid-cols-3">
                        <button onClick={() => { setActiveTab("market"); setMarketViewMode("browse"); }} className="rounded-[12px] px-4 py-3 text-[0.82rem] font-bold" style={{ background: accentSurface, border: `1px solid ${accentBorder}`, color: actionBlue }}>파편 장터에서 구매하기</button>
                        <Link to="/combine" className="rounded-[12px] px-4 py-3 text-[0.82rem] font-bold" style={{ background: "#fff", border: `1px solid ${lineColor}`, color: neutralText }}>카드 조합 열러 가기</Link>
                        <Link to="/exchange" className="rounded-[12px] px-4 py-3 text-[0.82rem] font-bold" style={{ background: "#fff", border: `1px solid ${lineColor}`, color: neutralText }}>교환소에서 굿즈 받기</Link>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="market-eyebrow" style={{ color: mutedText }}>선택한 파편</p>
                          <h2 className="mt-1 text-[1.35rem] font-black tracking-[-0.03em]" style={{ color: neutralText }}>{selectedFragment.fragmentName}</h2>
                          <p className="mt-2 text-[0.88rem]" style={{ color: mutedText }}>{selectedFragment.idol} · 보유 {selectedOwnedCount}개 · 판매 등록 가능</p>
                        </div>
                        <div className="grid min-w-[260px] grid-cols-2 gap-2 text-[0.8rem]">
                          <div className="rounded-[13px] px-3 py-3" style={{ background: subtleSurface, border: `1px solid ${lineColor}` }}><p style={{ color: mutedText }}>시장 최저가</p><p className="mt-1 font-black" style={{ color: priceGreen }}>{formatMarketPrice(selectedFragment.floorPrice)}</p></div>
                          <div className="rounded-[13px] px-3 py-3" style={{ background: subtleSurface, border: `1px solid ${lineColor}` }}><p style={{ color: mutedText }}>최근 체결가</p><p className="mt-1 font-black" style={{ color: neutralText }}>{formatPrice(selectedFragment.lastPrice)}</p></div>
                          <div className="rounded-[13px] px-3 py-3" style={{ background: subtleSurface, border: `1px solid ${lineColor}` }}><p style={{ color: mutedText }}>판매자 수</p><p className="mt-1 font-black" style={{ color: neutralText }}>{selectedFragmentListings.length}명</p></div>
                          <div className="rounded-[13px] px-3 py-3" style={{ background: subtleSurface, border: `1px solid ${lineColor}` }}><p style={{ color: mutedText }}>내 보유</p><p className="mt-1 font-black" style={{ color: neutralText }}>{selectedOwnedCount}개</p></div>
                        </div>
                      </div>

                      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                        <label className="block">
                          <span className="mb-2 block text-[0.8rem] font-bold" style={{ color: mutedText }}>판매 단가</span>
                          <input type="number" min={0} step={100} value={sellPrice} onChange={(e) => { setSellPrice(Number(e.target.value)); setSubmitStatus("idle"); setSubmitError(null); }} className="w-full rounded-[14px] px-4 py-3 text-[1rem] font-bold outline-none" style={{ ...inputStyle, borderColor: sellPrice <= 0 ? "#fed7aa" : "#cbd5e1" }} />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-[0.8rem] font-bold" style={{ color: mutedText }}>등록 수량</span>
                          <div className="flex h-[50px] items-center rounded-[14px] border" style={{ background: "#fcfdfe", borderColor: sellQuantity > selectedOwnedCount ? "#ea580c" : "#cbd5e1" }}>
                            <button type="button" onClick={() => { setSellQuantity((q) => Math.max(1, q - 1)); setSubmitStatus("idle"); }} className="flex h-full w-12 items-center justify-center" style={{ color: mutedText }}><Minus className="h-4 w-4" /></button>
                            <input type="number" min={1} value={sellQuantity} onChange={(e) => { setSellQuantity(Math.max(Number(e.target.value), 1)); setSubmitStatus("idle"); setSubmitError(null); }} className="h-full min-w-0 flex-1 bg-transparent text-center text-[1rem] font-black outline-none" style={{ color: neutralText }} />
                            <button type="button" disabled={sellQuantity >= selectedOwnedCount} onClick={() => { setSellQuantity((q) => q + 1); setSubmitStatus("idle"); }} className="flex h-full w-12 items-center justify-center disabled:opacity-35" style={{ color: mutedText }}><Plus className="h-4 w-4" /></button>
                          </div>
                          <p className="mt-1 text-[0.72rem]" style={{ color: sellQuantity > selectedOwnedCount ? "#ea580c" : mutedText }}>최대 {selectedOwnedCount}개까지 등록 가능</p>
                        </label>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {[{ label: "최저가 맞추기", mode: "floor" as const }, { label: "최저가보다 100원 낮게", mode: "undercut" as const }, { label: "최근 체결가 적용", mode: "last" as const }].map((item) => (
                          <button key={item.label} onClick={() => { applySuggestedSellPrice(item.mode); setSubmitStatus("idle"); setSubmitError(null); }} className="rounded-[12px] px-3 py-2 text-[0.76rem] font-bold" style={{ background: subtleSurface, border: `1px solid ${lineColor}`, color: mutedText }}>{item.label}</button>
                        ))}
                      </div>

                      {hasPriceWarning && (
                        <div className="mt-4 flex gap-2 rounded-[14px] px-4 py-3 text-[0.82rem] font-semibold" style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#ea580c" }}>
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          최저가와 차이가 큰 가격이에요. 등록 시 한 번 더 확인합니다.
                        </div>
                      )}

                      <div className="mt-5 rounded-[16px] px-4 py-4" style={{ background: subtleSurface, border: `1px solid ${lineColor}` }}>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div><p className="text-[0.72rem]" style={{ color: mutedText }}>등록비</p><p className="mt-1 font-black" style={{ color: neutralText }}>{formatPrice(registrationFee)}</p></div>
                          <div><p className="text-[0.72rem]" style={{ color: mutedText }}>판매 수수료</p><p className="mt-1 font-black" style={{ color: neutralText }}>{formatPrice(saleFee)}</p></div>
                          <div><p className="text-[0.72rem]" style={{ color: mutedText }}>예상 정산액</p><p className="mt-1 text-[1.15rem] font-black" style={{ color: priceGreen }}>{formatPrice(Math.max(expectedSettlement, 0))}</p></div>
                        </div>
                        <p className="mt-4 text-[0.84rem] leading-6" style={{ color: mutedText }}>{selectedFragment.fragmentName}을 단가 {formatPrice(sellPrice)}, 총 {sellQuantity}개({formatPrice(totalSaleAmount)})로 등록합니다. {marketCompareLabel(sellPrice, sellQuantity, selectedFragment)}이고, 예상 정산액은 {formatPrice(Math.max(expectedSettlement, 0))}입니다.</p>
                      </div>
                    </>
                  )}
                </div>
              </main>

              <aside className="space-y-4 xl:sticky xl:top-4">
                <div className="rounded-[22px] p-5" style={panelStyle}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="market-eyebrow" style={{ color: mutedText }}>판매 요약</p>
                      <h3 className="mt-1 truncate text-[1.05rem] font-black" style={{ color: neutralText }}>{hasSellInventory ? selectedFragment.fragmentName : "판매할 파편이 없어요"}</h3>
                      <p className="mt-1 text-[0.78rem]" style={{ color: mutedText }}>{hasSellInventory ? `${selectedFragment.idol} · 보유 ${selectedOwnedCount}개` : "파편 확보 후 판매 등록 가능"}</p>
                    </div>
                    <span className="rounded-full px-2.5 py-1 text-[0.68rem] font-bold" style={{ background: selectedOwnedCount > 0 ? "#ecfdf5" : subtleSurface, border: selectedOwnedCount > 0 ? "1px solid #bbf7d0" : `1px solid ${lineColor}`, color: selectedOwnedCount > 0 ? priceGreen : mutedText }}>{selectedOwnedCount > 0 ? "선택됨" : "대기"}</span>
                  </div>

                  <div className="mt-5 space-y-2 text-[0.84rem]">
                    {[
                      ["판매 단가", hasSellInventory ? formatPrice(sellPrice) : "-"],
                      ["등록 수량", hasSellInventory ? `${sellQuantity}개` : "-"],
                      ["총 판매가", hasSellInventory ? formatPrice(totalSaleAmount) : formatPrice(0)],
                      ["등록비", hasSellInventory ? formatPrice(registrationFee) : formatPrice(0)],
                      ["수수료", hasSellInventory ? formatPrice(saleFee) : formatPrice(0)],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-3"><span style={{ color: mutedText }}>{label}</span><span className="font-bold" style={{ color: neutralText }}>{value}</span></div>
                    ))}
                    <div className="mt-3 border-t pt-4" style={{ borderColor: lineColor }}>
                      <p className="text-[0.72rem] font-bold uppercase tracking-[0.14em]" style={{ color: mutedText }}>예상 정산액</p>
                      <p className="mt-1 text-[2rem] font-black tracking-[-0.04em]" style={{ color: priceGreen }}>{formatPrice(hasSellInventory ? Math.max(expectedSettlement, 0) : 0)}</p>
                    </div>
                  </div>

                  {(submitError || listedTarget === selectedFragment.id) && (
                    <div className="mt-4 rounded-[14px] px-4 py-3 text-[0.82rem] font-semibold" style={submitError ? { background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626" } : { background: "#ecfdf5", border: "1px solid #bbf7d0", color: "#15803d" }}>
                      {submitError ? `등록에 실패했어요 — ${submitError.message}` : "등록 완료. 아래 내 매물 관리에서 바로 확인할 수 있어요."}
                    </div>
                  )}

                  <Button className="mt-4 h-12 w-full rounded-[12px] text-sm font-black" disabled={sellCta.disabled} style={{ background: sellCta.bg, color: sellCta.color, border: sellCta.border ? `1px solid ${sellCta.border}` : "none" }} onClick={handleCreateListing}>
                    {submitStatus === "submitting" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Package className="mr-2 h-4 w-4" />}
                    {sellCta.label}
                  </Button>
                  <p className="mt-2 text-[0.76rem] leading-5" style={{ color: sellCtaState === "overQuantity" ? "#ea580c" : mutedText }}>{sellCta.hint}</p>

                  <div className="mt-5 border-t pt-5" style={{ borderColor: lineColor }}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-[0.9rem] font-black" style={{ color: neutralText }}>내 매물</p>
                      <span className="text-[0.76rem]" style={{ color: mutedText }}>{selectedViewerListings.length}건</span>
                    </div>
                    <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
                      {selectedViewerListings.length > 0 ? selectedViewerListings.map((listing) => (
                        <div key={listing.id} className="rounded-[14px] px-3 py-3 transition-all" style={{ background: subtleSurface, border: recentlyListedId === listing.id ? "2px solid #16a34a" : `1px solid ${lineColor}`, boxShadow: recentlyListedId === listing.id ? "0 0 0 3px rgba(22,163,74,0.12)" : "none" }}>
                          <div className="flex items-start justify-between gap-3">
                            <div><p className="text-[0.84rem] font-black" style={{ color: neutralText }}>{formatPrice(listing.price)} × {listing.quantity}개</p><p className="mt-1 text-[0.72rem]" style={{ color: mutedText }}>{listing.postedAt}</p></div>
                            <span className="rounded-full px-2 py-0.5 text-[0.62rem] font-bold" style={{ background: "#fff", border: `1px solid ${lineColor}`, color: mutedText }}>내 매물</span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {[-100, 100].map((delta) => <button key={delta} onClick={() => handleAdjustListingPrice(listing.id, delta)} className="rounded-[9px] px-2.5 py-1.5 text-[0.72rem] font-bold" style={{ background: "#fff", border: `1px solid ${lineColor}`, color: mutedText }}>{delta > 0 ? `+${delta}` : delta}</button>)}
                            <button onClick={() => handleCancelListing(listing.id)} className="rounded-[9px] px-2.5 py-1.5 text-[0.72rem] font-bold" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626" }}>취소</button>
                          </div>
                        </div>
                      )) : (
                        <div className="rounded-[14px] px-4 py-5 text-center" style={{ background: subtleSurface, border: `1px solid ${lineColor}` }}>
                          <p className="text-[0.84rem] font-semibold" style={{ color: neutralText }}>등록된 매물 없음</p>
                          <p className="mt-1 text-[0.76rem]" style={{ color: mutedText }}>가격과 수량을 입력하고 등록해보세요.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </aside>
            </div>

            <div className="fixed inset-x-0 bottom-0 z-40 border-t px-4 py-3 md:hidden" style={{ background: "rgba(255,255,255,0.96)", borderColor: lineColor, paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
              <div className="mb-2 flex items-center justify-between gap-3 text-[0.8rem]">
                <span className="font-bold" style={{ color: mutedText }}>정산 {formatPrice(hasSellInventory ? Math.max(expectedSettlement, 0) : 0)}</span>
                <span style={{ color: sellCtaState === "overQuantity" ? "#ea580c" : mutedText }}>{sellCta.hint}</span>
              </div>
              <Button className="h-11 w-full rounded-[12px] text-sm font-black" disabled={sellCta.disabled} style={{ background: sellCta.bg, color: sellCta.color, border: sellCta.border ? `1px solid ${sellCta.border}` : "none" }} onClick={handleCreateListing}>
                {sellCta.label}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ════════ 파편 구매 모달 (Toss) ════════ */}
      {showBuyModal && tossBuyListingRef.current && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(17,40,73,.45)", backdropFilter: "blur(6px)" }}
          onClick={e => { if (e.target === e.currentTarget && !isPurchasing) { setShowBuyModal(false); setTossBuyError(""); } }}>
          <div className="w-full max-w-sm rounded-[24px] p-6 overflow-y-auto"
            style={{ background: "#fff", border: "1px solid #d6dee8", boxShadow: "0 24px 64px rgba(17,40,73,.14)", maxHeight: "90vh" }}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[1.05rem] font-bold" style={{ color: "#1c2f4a" }}>파편 구매</h2>
              {!isPurchasing && (
                <button onClick={() => { setShowBuyModal(false); setTossBuyError(""); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#728195" }}>
                  ✕
                </button>
              )}
            </div>

            <div className="rounded-[16px] p-4 mb-4 space-y-2" style={{ background: "#eef2f5", border: "1px solid #dde4ec" }}>
              {[
                ["파편", selectedFragment.fragmentName],
                ["판매자", tossBuyListingRef.current.sellerName],
                ["수량", "1개"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-[0.85rem]">
                  <span style={{ color: "#728195" }}>{k}</span>
                  <span style={{ color: "#1c2f4a", fontWeight: 500 }}>{v}</span>
                </div>
              ))}
              <div className="pt-2 border-t" style={{ borderColor: "#d6dee7" }}>
                <div className="flex justify-between text-[0.95rem]">
                  <span style={{ color: "#728195" }}>결제 금액</span>
                  <span style={{ color: "#547b63", fontWeight: 700 }}>{tossBuyListingRef.current.price.toLocaleString()}원</span>
                </div>
                <div className="flex justify-between text-[0.75rem] mt-1">
                  <span style={{ color: "#9aaab8" }}>플랫폼 수수료</span>
                  <span style={{ color: "#9aaab8" }}>9%</span>
                </div>
              </div>
            </div>

            <div id="toss-market-payment-widget" className="mb-3" />
            <div id="toss-market-agreement-widget" className="mb-3" />

            {!tossBuyWidgetReady && !tossBuyError && (
              <div className="flex items-center gap-2 p-3 rounded-xl text-[0.84rem] mb-3"
                style={{ background: "#eef4ff", color: "#4b6581", border: "1px solid #c8d8ef" }}>
                <span className="w-4 h-4 border-2 border-[#4b6581] border-t-transparent rounded-full animate-spin shrink-0" />
                결제 위젯을 불러오는 중...
              </div>
            )}

            {tossBuyError && (
              <div className="flex items-center gap-2 p-3 rounded-xl text-[0.84rem] mb-3"
                style={{ background: "#fce8e8", color: "#b94040", border: "1px solid #f0c4c4" }}>
                ⚠ {tossBuyError}
              </div>
            )}

            <button onClick={handleTossBuy} disabled={isPurchasing || !tossBuyWidgetReady}
              className="w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 text-[0.9rem]"
              style={{
                background: isPurchasing || !tossBuyWidgetReady ? "#b0bec8" : "#547b63",
                color: "#fff", border: "none",
                cursor: isPurchasing || !tossBuyWidgetReady ? "not-allowed" : "pointer",
              }}>
              {isPurchasing && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {isPurchasing ? "결제 처리 중…" : "토스페이로 결제"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
