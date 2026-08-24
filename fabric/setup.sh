#!/bin/bash
# =============================================================
# TicketBlockChain — Hyperledger Fabric 원클릭 초기화 스크립트
# Ubuntu 22.04 LTS 기준
#
# 사용법:
#   cd /path/to/TicketBlockChain
#   bash fabric/setup.sh [--reset]
#
#   --reset : 기존 네트워크/인증서/원장 완전 초기화 후 재시작
# =============================================================

# 실패 시 즉시 중단하고, 정의되지 않은 변수 사용도 오류로 잡는다.
# rm -rf 가 변수 경로를 쓰기 때문에 set -u 가 특히 중요하다.
set -euo pipefail

RESET=false
for arg in "$@"; do
  [ "$arg" = "--reset" ] && RESET=true
done

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FABRIC_DIR="$PROJECT_ROOT/fabric"
BASIC_NET="$FABRIC_DIR/basic-network"
BIN_DIR="$FABRIC_DIR/bin"
SCRIPTS="$BASIC_NET/scripts"
DOCKER_DIR="$BASIC_NET/docker"
APP_DIR="$FABRIC_DIR/application"

IMAGE_TAG="2.5.4"
CA_IMAGE_TAG="1.5.7"
export IMAGE_TAG CA_IMAGE_TAG
export COMPOSE_PROJECT_NAME=fabric
export FABRIC_CFG_PATH="$BASIC_NET/configtx"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   TicketBlockChain  Fabric Setup                ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ─── 0. 의존성 확인 ────────────────────────────────────────
echo "[ 0/7 ] 의존성 확인..."
for cmd in docker go node; do
  if ! command -v $cmd &>/dev/null; then
    echo "❌ '$cmd' 이 설치되어 있지 않습니다."
    echo "   sudo apt-get install -y docker.io golang-go nodejs npm"
    exit 1
  fi
done
# Docker Compose v1(docker-compose) 또는 v2(docker compose) 자동 감지
if command -v docker-compose &>/dev/null; then
  DC="docker-compose"
elif docker compose version &>/dev/null 2>&1; then
  DC="docker compose"
else
  echo "❌ Docker Compose 를 찾을 수 없습니다."
  echo "   sudo apt-get install -y docker-compose-plugin"
  exit 1
fi
echo "✅ docker ($DC), go, node 확인됨"

# ─── 1. Fabric 바이너리 다운로드 ──────────────────────────
echo ""
echo "[ 1/7 ] Fabric 바이너리 확인..."
if [ ! -f "$BIN_DIR/peer" ]; then
  echo "▶ fabric-samples 바이너리 다운로드 (v${IMAGE_TAG})..."
  mkdir -p "$BIN_DIR"
  TMPDIR=$(mktemp -d)
  curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh \
    | bash -s -- --fabric-version "$IMAGE_TAG" --ca-version "$CA_IMAGE_TAG" binary
  mv bin/* "$BIN_DIR/" 2>/dev/null || true
  rm -rf "$TMPDIR"
  echo "✅ 바이너리 다운로드 완료"
else
  echo "✅ 바이너리 이미 존재 ($BIN_DIR/peer)"
fi
export PATH="$BIN_DIR:$PATH"

# ─── 2. 기존 네트워크 정리 (--reset 또는 최초) ─────────────
if $RESET || [ ! -d "$BASIC_NET/organizations/peerOrganizations" ]; then
  echo ""
  echo "[ 2/7 ] 기존 네트워크 정리..."
  cd "$DOCKER_DIR"
  $DC -f docker-compose-test-net.yaml down --volumes --remove-orphans 2>/dev/null || true
  # 잔여 컨테이너 강제 제거
  for c in orderer.example.com peer0.org1.example.com peer0.org2.example.com \
            ca.org1.example.com ca.org2.example.com cli; do
    docker rm -f "$c" 2>/dev/null || true
  done
  rm -rf "$BASIC_NET/organizations/peerOrganizations"
  rm -rf "$BASIC_NET/organizations/ordererOrganizations"
  rm -f  "$BASIC_NET/organizations/fabric-ca/org1/fabric-ca-server.db"
  rm -f  "$BASIC_NET/organizations/fabric-ca/org2/fabric-ca-server.db"
  rm -rf "$BASIC_NET/system-genesis-block"
  rm -rf "$BASIC_NET/channel-artifacts"
  rm -rf "$FABRIC_DIR/wallet"
  echo "✅ 정리 완료"
fi

# ─── 3. 인증서 생성 ────────────────────────────────────────
echo ""
echo "[ 3/7 ] 인증서 생성 (cryptogen)..."
bash "$SCRIPTS/generateCert.sh"

# ─── 4. 채널 아티팩트 생성 ────────────────────────────────
echo ""
echo "[ 4/7 ] 제네시스 블록 + 채널 트랜잭션 생성..."
bash "$SCRIPTS/createConfigtxgen.sh"

# ─── 5. Docker 컨테이너 기동 ──────────────────────────────
echo ""
echo "[ 5/7 ] Docker 컨테이너 기동 (orderer, peer, ca, cli)..."
cd "$DOCKER_DIR"
$DC -f docker-compose-test-net.yaml up -d
echo "▶ 컨테이너 안정화 대기 (5초)..."
sleep 5
docker ps --format "table {{.Names}}\t{{.Status}}"

# ─── 6. 채널 생성 + 조인 + 체인코드 배포 ──────────────────
echo ""
echo "[ 6/7 ] 채널 생성 / 조인 / 앵커피어 업데이트..."
docker exec cli bash scripts/joinChannel.sh createChannel

echo "▶ Org1 채널 조인 + 앵커피어..."
docker exec cli bash scripts/joinChannel.sh joinChannel
docker exec cli bash scripts/joinChannel.sh updateAnchor

echo "▶ Org2 채널 조인 + 앵커피어..."
docker exec cli bash scripts/joinChannel.sh joinChannelOrg2
docker exec cli bash scripts/joinChannel.sh updateAnchorOrg2

echo ""
echo "▶ 체인코드 패키지 생성 및 Docker 이미지 사전 태깅..."
# Docker 29.x + Fabric 2.5.x 호환성: 이미지 사전 태깅으로 broken pipe 우회
docker exec cli bash -c "
  cd /opt/gopath/src/github.com/hyperledger/fabric/peer/chaincode/ticket/go
  go mod tidy && go mod vendor
  cd /opt/gopath/src/github.com/hyperledger/fabric/peer
  peer lifecycle chaincode package ticket.tar.gz \
    --path ./chaincode/ticket/go/ --lang golang --label ticket_1
"
CC_PACKAGE_ID=$(docker exec cli bash -c \
  "peer lifecycle chaincode calculatepackageid /opt/gopath/src/github.com/hyperledger/fabric/peer/ticket.tar.gz 2>/dev/null")
CC_HASH="${CC_PACKAGE_ID#*:}"
echo "체인코드 해시: $CC_HASH"

# 기존 이미지를 현재 해시로 재태깅 (또는 신규 이미지가 없으면 스킵)
SRC=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep "ticket_1-" | head -1 || true)
if [ -n "$SRC" ] && [ -n "$CC_HASH" ]; then
  for TAG in \
    "dev-peer0.org1.example.com-ticket_1-${CC_HASH}" \
    "dev-peer0.org2.example.com-ticket_1-${CC_HASH}" \
    "dev-peer0-org1-example-com-ticket-1-${CC_HASH}" \
    "dev-peer0-org2-example-com-ticket-1-${CC_HASH}"; do
    docker tag "$SRC" "$TAG" 2>/dev/null || true
  done
  echo "✅ Docker 이미지 태깅 완료 ($SRC → $CC_HASH)"
fi

echo ""
echo "▶ 체인코드 배포 (ticket) — Org1 + Org2 양쪽 승인..."
docker exec cli bash scripts/installCC.sh ticket

# ─── 7. SDK 등록 (enrollAdmin + registerUser) ─────────────
echo ""
echo "[ 7/7 ] Fabric CA 사용자 등록..."
bash "$SCRIPTS/updateConnection.sh"
cd "$APP_DIR"
npm install --silent 2>/dev/null || true
node sdk/importAdminAsUser.js

# ─── 완료 ─────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  ✅ Fabric 네트워크 초기화 완료!                ║"
echo "║                                                  ║"
echo "║  서버 실행 전 .env 수정:                        ║"
echo "║    FABRIC_MODE=real                              ║"
echo "║                                                  ║"
echo "║  서버 재시작:                                    ║"
echo "║    cd server && node index.js                   ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
