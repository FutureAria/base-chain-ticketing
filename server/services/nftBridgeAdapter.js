'use strict';
const mode = (process.env.FABRIC_MODE || 'mock').trim().toLowerCase();

if (mode === 'real') {
  console.log('[NftBridgeAdapter] 🔗 실제 NFT Bridge 사용 (FABRIC_MODE=real)');
  module.exports = require('./nftBridgeService');
} else {
  console.log('[NftBridgeAdapter] 🧪 Mock NFT Bridge 사용 (FABRIC_MODE=mock)');
  module.exports = require('../mock/mockNftBridgeService');
}
