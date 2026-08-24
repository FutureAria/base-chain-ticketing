const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');
const BASE = `${API_BASE}/api`;

function authHeader(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
  };
}

export type WalletInfo = {
  connected: boolean;
  address?: string;
  is_verified?: boolean;
  connected_at?: string;
  verified_at?: string | null;
};

// 서버에 지갑 주소 등록
export async function connectWalletToServer(address: string): Promise<void> {
  const res = await fetch(`${BASE}/wallet/connect`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ address }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '지갑 등록 실패');
}

// 서명용 nonce 발급
export async function getChallenge(): Promise<{ nonce: string }> {
  const res = await fetch(`${BASE}/wallet/challenge`, { headers: authHeader() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'challenge 발급 실패');
  return data as { nonce: string };
}

// MetaMask 서명 검증
export async function verifySignature(signature: string): Promise<void> {
  const res = await fetch(`${BASE}/wallet/verify`, {
    method: 'POST',
    headers: authHeader(),
    body: JSON.stringify({ signature }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '서명 검증 실패');
}

// 현재 지갑 상태 조회
export async function getWalletInfo(): Promise<WalletInfo> {
  const res = await fetch(`${BASE}/wallet/info`, { headers: authHeader() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '지갑 정보 조회 실패');
  return data as WalletInfo;
}
