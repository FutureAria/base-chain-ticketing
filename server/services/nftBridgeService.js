'use strict';
/**
 * nftBridgeService.js  —  Phase 2: 실제 Hoodi Testnet NFT 연동
 *
 * Phase 1에서는 server/mock/mockNftBridgeService.js 를 사용합니다.
 * Phase 2 전환 시 각 라우트에서 require 경로만 변경하면 됩니다.
 *
 *   // Phase 1
 *   const nftBridge = require('../mock/mockNftBridgeService');
 *   // Phase 2
 *   const nftBridge = require('../services/nftBridgeService');
 *
 * TicketNFT.sol에 burn() 함수가 없으므로 markUsed()로 대체합니다.
 */

const { ethers } = require('ethers');

const RPC_URL = 'https://ethereum-hoodi-rpc.publicnode.com';

const TICKET_NFT_ABI = [
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function markUsed(uint256 tokenId) external',
];

function getProvider() {
  return new ethers.JsonRpcProvider(RPC_URL);
}

function getTicketContract(signerOrProvider) {
  const addr = process.env.TICKET_NFT_ADDRESS;
  if (!addr) throw new Error('TICKET_NFT_ADDRESS 환경변수가 설정되지 않았습니다');
  return new ethers.Contract(addr, TICKET_NFT_ABI, signerOrProvider);
}

function getSigner() {
  const key = process.env.MINTER_PRIVATE_KEY;
  if (!key) throw new Error('MINTER_PRIVATE_KEY 환경변수가 설정되지 않았습니다');
  return new ethers.Wallet(key, getProvider());
}

/**
 * NFT 소유권 확인
 * ownerOf(tokenId) 조회 후 walletAddress와 비교
 */
async function checkNftOwner(tokenId, walletAddress) {
  if (!tokenId || tokenId === '0' || !walletAddress) return false;
  try {
    const contract = getTicketContract(getProvider());
    const owner = await contract.ownerOf(BigInt(tokenId));
    return owner.toLowerCase() === walletAddress.toLowerCase();
  } catch (err) {
    console.error('[nftBridgeService] checkNftOwner error:', err.message);
    return false;
  }
}

/**
 * NFT 입장 처리: markUsed(tokenId) 호출 (burn 대체)
 * 서버 지갑(MINTER_PRIVATE_KEY)이 호출권을 가져야 합니다.
 */
async function markNftUsed(tokenId) {
  if (!tokenId || tokenId === '0') return null;
  const contract = getTicketContract(getSigner());
  const tx       = await contract.markUsed(BigInt(tokenId));
  const receipt  = await tx.wait();
  return receipt.hash;
}

/**
 * NFT 소각 요청 (burn 없음 → markUsed로 처리)
 */
async function requestNftBurn(tokenId, walletAddress) {
  return markNftUsed(tokenId);
}

module.exports = {
  checkNftOwner,
  markNftUsed,
  requestNftBurn,
};
