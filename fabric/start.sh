#!/bin/bash
# TicketBlockChain — VM 재부팅 후 Fabric 네트워크 재시작 스크립트
# 사용법: bash fabric/start.sh

# 실패 시 즉시 중단하고, 정의되지 않은 변수 사용도 오류로 잡는다.
# rm -rf 가 변수 경로를 쓰기 때문에 set -u 가 특히 중요하다.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_DIR="$PROJECT_ROOT/fabric/basic-network/docker"
APP_DIR="$PROJECT_ROOT/fabric/application"
WALLET_DIR="$PROJECT_ROOT/fabric/wallet"

export IMAGE_TAG=2.5.4
export CA_IMAGE_TAG=1.5.7
export COMPOSE_PROJECT_NAME=fabric

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   TicketBlockChain  Fabric Start         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ─── 1. 네트워크 충돌 정리 ──────────────────────────────────
echo "[ 1/4 ] 네트워크 충돌 정리..."
docker network rm fabric_test 2>/dev/null || true

# ─── 2. 컨테이너 기동 ──────────────────────────────────────
echo ""
echo "[ 2/4 ] Fabric 컨테이너 기동..."
cd "$DOCKER_DIR"
docker compose -f docker-compose-test-net.yaml up -d
echo "▶ 컨테이너 안정화 대기 (15초)..."
sleep 15
docker ps --format "table {{.Names}}\t{{.Status}}"

# ─── 3. 체인코드 설치 확인 ─────────────────────────────────
echo ""
echo "[ 3/4 ] 체인코드 설치 상태 확인..."
if docker exec cli peer lifecycle chaincode queryinstalled 2>/dev/null | grep -q "ticket_1"; then
  echo "✅ 체인코드 ticket 설치 확인됨"
else
  echo "⚠ 체인코드 미설치 — 재설치 중..."
  docker exec cli bash -c "
    cd /opt/gopath/src/github.com/hyperledger/fabric/peer
    peer lifecycle chaincode package ticket.tar.gz \
      --path ./chaincode/ticket/go/ --lang golang --label ticket_1
    peer lifecycle chaincode install ticket.tar.gz
    CORE_PEER_LOCALMSPID=Org2MSP \
    CORE_PEER_ADDRESS=peer0.org2.example.com:9051 \
    CORE_PEER_MSPCONFIGPATH=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp \
    CORE_PEER_TLS_ROOTCERT_FILE=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt \
    peer lifecycle chaincode install ticket.tar.gz
  "
  echo "✅ 체인코드 재설치 완료"
fi

# ─── 4. Wallet 확인 ────────────────────────────────────────
echo ""
echo "[ 4/4 ] SDK Wallet 확인..."
if [ -f "$WALLET_DIR/appUser.id" ]; then
  echo "✅ Wallet 존재 (appUser.id)"
else
  echo "▶ Wallet 없음 — Admin 인증서 임포트..."
  cd "$APP_DIR"
  node sdk/importAdminAsUser.js
fi

# ─── 완료 ─────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  ✅ Fabric 네트워크 준비 완료!           ║"
echo "║                                          ║"
echo "║  서버 시작:                              ║"
echo "║    cd server && node index.js            ║"
echo "╚══════════════════════════════════════════╝"
echo ""
