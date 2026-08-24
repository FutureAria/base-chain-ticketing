#!/bin/bash
# 개별 컨테이너 기동용 (setup.sh에서 자동 호출됨)
# 직접 사용: bash upNetwork.sh [up|down]
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$SCRIPT_DIR/../docker"

export COMPOSE_PROJECT_NAME=fabric
export IMAGE_TAG="${IMAGE_TAG:-2.5.4}"
export CA_IMAGE_TAG="${CA_IMAGE_TAG:-1.5.7}"

cd "$DOCKER_DIR"

case "${1:-up}" in
  up)
    echo "▶ Fabric 네트워크 기동..."
    docker-compose -f docker-compose-test-net.yaml up -d
    docker ps --format "table {{.Names}}\t{{.Status}}"
    ;;
  down)
    echo "▶ Fabric 네트워크 종료..."
    docker-compose -f docker-compose-test-net.yaml down --volumes --remove-orphans
    ;;
  *)
    echo "Usage: $0 [up|down]"
    exit 1
    ;;
esac
