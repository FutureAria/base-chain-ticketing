// did-prototype/backend-node/src/didUtils.js 에서 핵심만 추출
const { ethers } = require('ethers');

// Ethereum 주소 → did:pkh:eip155:1:0x{checksum address}
function addressToDid(address) {
  return `did:pkh:eip155:1:${ethers.getAddress(address)}`;
}

// MetaMask personal_sign 서명 검증
// ethers.verifyMessage가 "\x19Ethereum Signed Message:\n" prefix를 자동 처리
function verifyEthSignature(message, signature, expectedAddress) {
  try {
    const recovered = ethers.verifyMessage(message, signature);
    return recovered.toLowerCase() === expectedAddress.toLowerCase();
  } catch {
    return false;
  }
}

module.exports = { addressToDid, verifyEthSignature };
