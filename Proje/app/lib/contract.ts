import { BrowserProvider } from "ethers";

export const HOODI_CHAIN_ID = "0x88BB0"; // 560048 in hex

export const TICKET_NFT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as string;

export const HOODI_NETWORK = {
  chainId: HOODI_CHAIN_ID,
  chainName: "Hoodi Testnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://ethereum-hoodi-rpc.publicnode.com"],
  blockExplorerUrls: ["https://hoodi.ethpandaops.io"],
};

/**
 * MetaMask를 Hoodi 테스트넷으로 전환.
 * 결제는 토스페이로 하지만 NFT 관련 조회 시 네트워크 일치 필요.
 */
export async function switchToHoodi(): Promise<void> {
  if (!window.ethereum) throw new Error("MetaMask가 설치되어 있지 않습니다.");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: HOODI_CHAIN_ID }],
    });
  } catch (err: unknown) {
    const switchErr = err as { code?: number };
    if (switchErr.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [HOODI_NETWORK],
      });
    } else {
      throw err;
    }
  }
}

/**
 * MetaMask personal_sign으로 메시지 서명 (2차 거래 판매 등록 인증용).
 * ETH 결제 없음 — 서명만 수행.
 */
export async function signListingMessage(
  message: string,
  walletAddress: string,
): Promise<string> {
  if (!window.ethereum && import.meta.env.VITE_DEMO_ALLOW_MOCK_SIGNATURE === "true") {
    return `demo-mock-signature:${walletAddress}:${btoa(unescape(encodeURIComponent(message))).slice(0, 64)}`;
  }
  if (!window.ethereum) throw new Error("MetaMask가 설치되어 있지 않습니다.");
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  if (signer.address.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error("서명 지갑과 로그인 지갑이 일치하지 않습니다.");
  }
  return signer.signMessage(message);
}

// ─── 유틸 (가격 표시용) ──────────────────────────────────────
export function krwToWei(krw: number): bigint {
  return BigInt(krw) * BigInt(10 ** 9);
}

export function weiToKrw(wei: bigint): number {
  return Number(wei / BigInt(10 ** 9));
}
