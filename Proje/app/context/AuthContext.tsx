import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { login as apiLogin, register as apiRegister, getMe, googleLogin as apiGoogleLogin, type AuthUser } from '../api/authApi';

type AuthContextValue = {
  user: AuthUser | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, nickname: string) => Promise<void>;
  googleLogin: (access_token: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_CHANGED_EVENT = 'base-chain-auth-changed';

function notifyAuthChanged(user: AuthUser | null) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(AUTH_CHANGED_EVENT, {
      detail: { userId: user?.user_id ?? null, email: user?.email ?? null },
    }),
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 앱 시작 시 저장된 토큰으로 세션 복원
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      setIsLoading(false);
      return;
    }
    getMe()
      .then((u) => {
        setUser(u);
        localStorage.setItem('nickname', u.nickname);
        notifyAuthChanged(u);
      })
      .catch(() => {
        localStorage.removeItem('auth_token');
        notifyAuthChanged(null);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { token, user: u } = await apiLogin(email, password);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('nickname', u.nickname);
    setUser(u);
    notifyAuthChanged(u);
  }, []);

  const register = useCallback(async (email: string, password: string, nickname: string) => {
    const { token, user: u } = await apiRegister(email, password, nickname);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('nickname', u.nickname);
    setUser(u);
    notifyAuthChanged(u);
  }, []);

  const googleLogin = useCallback(async (access_token: string) => {
    const { token, user: u } = await apiGoogleLogin(access_token);
    localStorage.setItem('auth_token', token);
    localStorage.setItem('nickname', u.nickname);
    setUser(u);
    notifyAuthChanged(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('nickname');
    setUser(null);
    notifyAuthChanged(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoggedIn: Boolean(user), isLoading, login, register, googleLogin, logout }),
    [user, isLoading, login, register, googleLogin, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
