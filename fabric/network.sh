#!/bin/bash

# 실패 시 즉시 중단하고, 정의되지 않은 변수 사용도 오류로 잡는다.
set -euo pipefail
# TicketBlockChain Fabric 네트워크 관리 스크립트
#
# 전제: VM에서 $GOPATH/src/TicketBlockChain/ 에 프로젝트가 있어야 합니다.
#       fabric-ca (CA 서버)는 별도로 실행 필요.
#
# 사용법:
#   ./network.sh generateCert     # 인증서 생성
#   ./network.sh createConfigtxgen # 제네시스/채널 아티팩트 생성
#   ./network.sh upNetwork         # 컨테이너 실행
#   ./network.sh createChannel     # 채널 생성
#   ./network.sh joinChannel       # 채널 참여
#   ./network.sh updateAnchor      # 앵커피어 업데이트
#   ./network.sh installCC ticket  # 체인코드 배포
#   ./network.sh start             # 전체 자동 실행
#   ./network.sh clean             # 네트워크 전체 초기화

function generateCert() {
  basic-network/scripts/generateCert.sh
}

function createConfigtxgen() {
  basic-network/scripts/createConfigtxgen.sh
}

function upNetwork() {
  basic-network/scripts/upNetwork.sh up
}

function joinChannel() {
  docker exec cli scripts/joinChannel.sh $1
}

function installCC() {
  docker exec cli scripts/installCC.sh $1
}

function cleanNetwork() {
  basic-network/scripts/cleanNetwork.sh
}

if   [ "$1" == "generateCert"     ]; then generateCert
elif [ "$1" == "createConfigtxgen" ]; then createConfigtxgen
elif [ "$1" == "upNetwork"         ]; then upNetwork org1peer0 orderer
elif [ "$1" == "createChannel"     ]; then joinChannel createChannel
elif [ "$1" == "joinChannel"       ]; then joinChannel joinChannel
elif [ "$1" == "updateAnchor"      ]; then joinChannel updateAnchor
elif [ "$1" == "installCC"         ]; then installCC $2
elif [ "$1" == "clean"             ]; then cleanNetwork
elif [ "$1" == "start"             ]; then
  generateCert
  sleep 2
  createConfigtxgen
  sleep 2
  upNetwork org1peer0 orderer
  sleep 20
  joinChannel createChannel
  joinChannel joinChannel
  joinChannel joinChannelOrg2
  joinChannel updateAnchor
  echo "네트워크 시작 완료 → 이제 installCC ticket 실행하세요"
else
  echo "Usage: ./network.sh [generateCert|createConfigtxgen|upNetwork|createChannel|joinChannel|updateAnchor|installCC <name>|start|clean]"
  exit 1
fi
