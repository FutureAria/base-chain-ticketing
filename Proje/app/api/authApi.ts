const API_ORIGIN = (
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (typeof window !== 'undefined' ? window.location.origin : '')
).replace(/\/$/, '');
const SAFE_API_ORIGIN =
  typeof window !== 'undefined' &&
  window.location.hostname !== 'localhost' &&
  window.location.hostname !== '127.0.0.1' &&
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API_ORIGIN)
    ? window.location.origin
    : API_ORIGIN;
const BASE = `${SAFE_API_ORIGIN}/api`;

function getToken(): string | null {
  return localStorage.getItem('auth_token');
}

function authHeader(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getToken()}`,
  };
}

export type AuthUser = {
  user_id: string;
  nickname: string;
  email: string;
  role?: 'user' | 'admin';
  profile_image?: string | null;
};

type AuthResponse = {
  token: string;
  user: AuthUser;
};

async function readJson<T>(res: Response, fallbackMessage: string): Promise<T> {
  const contentType = res.headers.get('content-type') ?? '';
  const text = await res.text();

  if (!contentType.includes('application/json')) {
    throw new Error(
      res.ok
        ? '서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해주세요.'
        : fallbackMessage
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('서버 응답을 읽는 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.');
  }
}

function apiError(data: unknown, fallbackMessage: string): Error {
  if (data && typeof data === 'object' && 'error' in data) {
    const message = (data as { error?: unknown }).error;
    if (typeof message === 'string' && message.trim()) return new Error(message);
  }
  return new Error(fallbackMessage);
}

export async function register(
  email: string,
  password: string,
  nickname: string
): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, nickname }),
  });
  const data = await readJson<AuthResponse | { error?: string }>(res, '회원가입 실패');
  if (!res.ok) throw apiError(data, '회원가입 실패');
  return data as AuthResponse;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await readJson<AuthResponse | { error?: string }>(res, '로그인 실패');
  if (!res.ok) throw apiError(data, '로그인 실패');
  return data as AuthResponse;
}

export async function getMe(): Promise<AuthUser> {
  const res = await fetch(`${BASE}/auth/me`, { headers: authHeader() });
  const data = await readJson<AuthUser | { error?: string }>(res, '인증 실패');
  if (!res.ok) throw apiError(data, '인증 실패');
  return data as AuthUser;
}

export async function googleLogin(access_token: string): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token }),
  });
  const data = await readJson<AuthResponse | { error?: string }>(res, '구글 로그인 실패');
  if (!res.ok) throw apiError(data, '구글 로그인 실패');
  return data as AuthResponse;
}
