/**
 * mockNftBridgeService.js
 *
 * Phase 1: 퍼블릭 블록체인 ownerOf / markUsed Mock
 * Phase 2: nftBridgeService.js로 교체 (실제 Hoodi Testnet 조회)
 *
 * 교체 방법 (entryRoutes.js):
 *   Phase 1: const nftBridge = require('../mock/mockNftBridgeService');
 *   Phase 2: const nftBridge = require('../services/nftBridgeService');
 */

/**
 * NFT 소유권 확인
 * Phase 1: 항상 true 반환
 * Phase 2: ownerOf(tokenId) 실제 조회로 교체
 */
async function checkNftOwner(tokenId, walletAddress) {
  console.log(`[MockNFT] checkNftOwner: tokenId=${tokenId}, wallet=${walletAddress?.slice(0, 10)}...`);

  // Phase 1: walletAddress만 있으면 항상 true (token_id가 null일 수도 있음)
  if (!walletAddress) return false;
  return true;
}

/**
 * NFT 입장 처리 (markUsed)
 * Phase 1: Mock txHash 반환
 * Phase 2: markTicketUsedOnChain(tokenId) 실제 호출로 교체
 */
async function markNftUsed(tokenId) {
  console.log(`[MockNFT] markNftUsed: tokenId=${tokenId}`);

  // Phase 1: Mock 해시 반환
  const mockHash = '0x' + Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');

  return mockHash;
}

/**
 * NFT 소각 요청 (burn)
 * TicketNFT.sol에 burn 함수가 없으므로 현재는 markUsed로 대체
 * 이벤트만 Fabric에 기록하고 실제 burn은 추후 팀원 코드와 연결
 */
async function requestNftBurn(tokenId, _walletAddress) {
  console.log(`[MockNFT] requestNftBurn: tokenId=${tokenId} (burn 함수 없음, markUsed 대체)`);
  return { requested: true, note: 'TicketNFT에 burn 함수 없음 - markUsed로 처리' };
}

module.exports = {
  checkNftOwner,
  markNftUsed,
  requestNftBurn,
};
