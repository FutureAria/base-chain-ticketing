import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ThemeMode = "light" | "dark";

type AppSettingsContextValue = {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  walletAddress: string | null;
  walletChainId: string | null;
  walletConnected: boolean;
  walletProviderName: string;
  walletError: string | null;
  isConnectingWallet: boolean;
  connectWallet: () => Promise<boolean>;
  disconnectWallet: () => void;
};

const THEME_STORAGE_KEY = "base-chain-theme";
const WALLET_STORAGE_KEY = "base-chain-wallet";
const WALLET_PAUSED_KEY = "base-chain-wallet-paused";
const AUTH_CHANGED_EVENT = "base-chain-auth-changed";
const WALLET_REFRESH_EVENT = "base-chain-wallet-refresh";
const API_BASE = (
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (typeof window !== "undefined" ? window.location.origin : "")
).replace(/\/$/, "");

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "dark" ? "dark" : "light";
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function parseTokenUserId(): string | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem("auth_token");
  if (!token) return null;
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(window.atob(padded)) as { user_id?: string; sub?: string; id?: string };
    return parsed.user_id ?? parsed.sub ?? parsed.id ?? null;
  } catch {
    return null;
  }
}

function scopedStorageKey(baseKey: string) {
  const userId = parseTokenUserId();
  return userId ? `${baseKey}:${userId}` : `${baseKey}:guest`;
}

function cleanupLegacyWalletStorage() {
  localStorage.removeItem(WALLET_STORAGE_KEY);
  localStorage.removeItem(WALLET_PAUSED_KEY);
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(getStoredTheme);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);

  const applyWalletState = useCallback((address: string | null, chainId: string | null) => {
    setWalletAddress(address);
    setWalletChainId(chainId);

    if (typeof window !== "undefined") {
      const storageKey = scopedStorageKey(WALLET_STORAGE_KEY);
      if (address) {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            address,
            chainId,
          }),
        );
      } else {
        localStorage.removeItem(storageKey);
      }
    }
  }, []);

  const syncWalletFromProvider = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) return;
    if (localStorage.getItem("auth_token")) return;
    if (localStorage.getItem(scopedStorageKey(WALLET_PAUSED_KEY))) return;

    try {
      const [accounts, chainId] = await Promise.all([
        window.ethereum.request({ method: "eth_accounts" }) as Promise<string[]>,
        window.ethereum.request({ method: "eth_chainId" }) as Promise<string>,
      ]);

      if (accounts.length > 0) {
        applyWalletState(accounts[0], chainId);
      }
    } catch {
      // keep stored state fallback only
    }
  }, [applyWalletState]);

  const syncVerifiedWalletFromServer = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(scopedStorageKey(WALLET_PAUSED_KEY))) return;

    const token = localStorage.getItem("auth_token");
    if (!token) {
      applyWalletState(null, null);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/did/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json() as {
        wallet_address?: string | null;
        wallet_verified?: boolean;
        did_status?: string;
      };
      if (data.wallet_address) {
        applyWalletState(
          data.wallet_address,
          data.wallet_verified && data.did_status === "verified" ? "server-verified" : "server-registered",
        );
      } else {
        applyWalletState(null, null);
      }
    } catch {
      // 서버 인증 지갑 자동 복원은 시연 편의 기능이므로 실패 시 조용히 무시한다.
    }
  }, [applyWalletState]);

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    cleanupLegacyWalletStorage();

    const storedWallet = localStorage.getItem(scopedStorageKey(WALLET_STORAGE_KEY));
    if (storedWallet) {
      try {
        const parsed = JSON.parse(storedWallet) as { address?: string; chainId?: string | null };
        if (parsed.address) {
          setWalletAddress(parsed.address);
          setWalletChainId(parsed.chainId ?? null);
        }
      } catch {
        localStorage.removeItem(scopedStorageKey(WALLET_STORAGE_KEY));
      }
    }

    if (localStorage.getItem("auth_token")) {
      void syncVerifiedWalletFromServer();
    } else {
      void syncWalletFromProvider();
    }
  }, [syncWalletFromProvider, syncVerifiedWalletFromServer]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleAuthChanged = () => {
      cleanupLegacyWalletStorage();
      setWalletError(null);
      applyWalletState(null, null);
      void syncVerifiedWalletFromServer();
    };

    const handleWalletRefresh = () => {
      void syncVerifiedWalletFromServer();
    };

    window.addEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
    window.addEventListener(WALLET_REFRESH_EVENT, handleWalletRefresh);

    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, handleAuthChanged);
      window.removeEventListener(WALLET_REFRESH_EVENT, handleWalletRefresh);
    };
  }, [applyWalletState, syncVerifiedWalletFromServer]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum?.on || !window.ethereum?.removeListener) return;

    const handleAccountsChanged = (accounts: unknown) => {
      if (localStorage.getItem("auth_token")) {
        void syncVerifiedWalletFromServer();
        return;
      }
      const walletAccounts = Array.isArray(accounts) ? (accounts as string[]) : [];
      if (walletAccounts.length === 0) {
        applyWalletState(null, null);
        return;
      }
      applyWalletState(walletAccounts[0], walletChainId);
    };

    const handleChainChanged = (chainId: unknown) => {
      setWalletChainId(typeof chainId === "string" ? chainId : null);
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [applyWalletState, walletChainId]);

  const setTheme = useCallback((nextTheme: ThemeMode) => {
    setThemeState(nextTheme);
  }, []);

  const connectWallet = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      setWalletError("메타마스크가 설치되어 있지 않아요. 확장 프로그램을 먼저 설치해 주세요.");
      return false;
    }

    setIsConnectingWallet(true);
    setWalletError(null);

    try {
      const [accounts, chainId] = await Promise.all([
        window.ethereum.request({ method: "eth_requestAccounts" }) as Promise<string[]>,
        window.ethereum.request({ method: "eth_chainId" }) as Promise<string>,
      ]);

      if (!accounts.length) {
        setWalletError("지갑 계정을 찾지 못했어요.");
        return false;
      }

      // 로그인된 상태라면 DID 등록 지갑과 일치하는지 확인
      const token = localStorage.getItem("auth_token");
      if (token) {
        try {
          const walletRes = await fetch(`${API_BASE}/api/auth/wallet`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (walletRes.ok) {
            const { walletAddress: registeredWallet } = await walletRes.json() as { walletAddress: string | null };
            if (registeredWallet && accounts[0].toLowerCase() !== registeredWallet.toLowerCase()) {
              setWalletError(
                `이 계정에 등록된 지갑(${registeredWallet.slice(0, 6)}...${registeredWallet.slice(-4)})과 다른 지갑입니다. 등록된 지갑으로 다시 선택해 주세요.`
              );
              return false;
            }
          }
        } catch {
          // 서버 오류 시 검증 생략 (연결은 허용)
        }
      }

      localStorage.removeItem(scopedStorageKey(WALLET_PAUSED_KEY));
      applyWalletState(accounts[0], chainId);
      return true;
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "메타마스크 연결이 취소되었거나 실패했어요.";
      setWalletError(message);
      return false;
    } finally {
      setIsConnectingWallet(false);
    }
  }, [applyWalletState]);

  const disconnectWallet = useCallback(() => {
    setWalletError(null);
    localStorage.setItem(scopedStorageKey(WALLET_PAUSED_KEY), "1");
    applyWalletState(null, null);
    // MetaMask 사이트 권한 해제 → 다음 연결 시 계정 선택 팝업 강제 표시
    if (window.ethereum) {
      (window.ethereum as { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> })
        .request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] })
        .catch(() => { /* 구버전 MetaMask 무시 */ });
    }
  }, [applyWalletState]);

  const value = useMemo<AppSettingsContextValue>(
    () => ({
      theme,
      setTheme,
      walletAddress,
      walletChainId,
      walletConnected: Boolean(walletAddress),
      walletProviderName: walletAddress ? `MetaMask · ${shortAddress(walletAddress)}` : "MetaMask 연결 안 됨",
      walletError,
      isConnectingWallet,
      connectWallet,
      disconnectWallet,
    }),
    [
      theme,
      setTheme,
      walletAddress,
      walletChainId,
      walletError,
      isConnectingWallet,
      connectWallet,
      disconnectWallet,
    ],
  );

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext);
  if (!context) {
    throw new Error("useAppSettings must be used inside AppSettingsProvider");
  }
  return context;
}
