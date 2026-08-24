#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$SCRIPT_DIR/.."
BIN_PATH="$BASE_DIR/../bin"

cd "$BASE_DIR"
export FABRIC_CFG_PATH="${PWD}/configtx/"

mkdir -p system-genesis-block channel-artifacts

echo "▶ 제네시스 블록 생성..."
"$BIN_PATH/configtxgen" \
  -profile DevOrdererGenesis \
  -channelID system-channel \
  -outputBlock ./system-genesis-block/genesis.block

echo "▶ 채널 트랜잭션 생성..."
"$BIN_PATH/configtxgen" \
  -profile DevChannel \
  -outputCreateChannelTx ./channel-artifacts/channel.tx \
  -channelID channel1

echo "✅ configtxgen 완료"
