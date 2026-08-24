const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');
const BASE = `${API_BASE}/api`;

function authHeader(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
  };
}

export type DidStatus = {
  user_id: string;
  nickname: string;
  wallet_connected: boolean;
  wallet_address: string | null;
  wallet_verified: boolean;
  did_value: string | null;
  did_status: 'none' | 'pending' | 'verified' | 'revoked';
  did_verified_at: string | null;
  auth_steps: {
    step1_registered: boolean;
    step2_wallet_connected: boolean;
    step3_wallet_verified: boolean;
    step4_did_created: boolean;
  };
};

// DID 생성 (서명 검증 완료 후 호출)
export async function createDid(): Promise<{ did: string; message: string; already_exists: boolean }> {
  const res = await fetch(`${BASE}/did/create`, {
    method: 'POST',
    headers: authHeader(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'DID 생성 실패');
  return data as { did: string; message: string; already_exists: boolean };
}

// 전체 인증 상태 조회
export async function getDidStatus(): Promise<DidStatus> {
  const res = await fetch(`${BASE}/did/status`, { headers: authHeader() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '상태 조회 실패');
  return data as DidStatus;
}
