/**
 * NFT 브리지 어댑터.
 *
 * `FABRIC_MODE` 하나로 실제 온체인 브리지와 인메모리 mock 중 하나를 고른다.
 * 호출하는 쪽은 어느 쪽인지 몰라도 되도록 **두 구현이 같은 인터페이스를 지켜야 한다.**
 * 한쪽에만 함수를 추가하면 모드를 바꾸는 순간 터진다.
 *
 * 기본값이 mock 인 이유 — 기여자가 테스트넷 지갑과 가스비 없이 전 기능을 돌려볼 수 있어야 한다.
 */
'use strict';
/** @type {'mock'|'real'} FABRIC_MODE 값. 지정하지 않으면 mock. */
const mode = (process.env.FABRIC_MODE || 'mock').trim().toLowerCase();

if (mode === 'real') {
  console.log('[NftBridgeAdapter] 🔗 실제 NFT Bridge 사용 (FABRIC_MODE=real)');
  module.exports = require('./nftBridgeService');
} else {
  console.log('[NftBridgeAdapter] 🧪 Mock NFT Bridge 사용 (FABRIC_MODE=mock)');
  module.exports = require('../mock/mockNftBridgeService');
}
