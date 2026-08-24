'use strict';
/**
 * fabricBridge.js
 *
 * .env의 FABRIC_MODE 값에 따라 mock 또는 실제 Fabric 서비스를 반환합니다.
 *
 *   FABRIC_MODE=mock  (기본값) → mockFabricService  (Windows 개발 환경)
 *   FABRIC_MODE=real           → fabricService       (Linux VM + Fabric 네트워크)
 *
 * 모든 라우트는 이 파일 하나만 require 합니다:
 *   const fabricService = require('../services/fabricBridge');
 */

const mode = (process.env.FABRIC_MODE || 'mock').trim().toLowerCase();

if (mode === 'real') {
  console.log('[FabricBridge] 🔗 실제 Hyperledger Fabric SDK 사용 (FABRIC_MODE=real)');
  module.exports = require('./fabricService');
} else {
  console.log('[FabricBridge] 🧪 Mock Fabric 사용 (FABRIC_MODE=mock)');
  module.exports = require('../mock/mockFabricService');
}
