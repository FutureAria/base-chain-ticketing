#!/bin/bash

echo "컨테이너 및 이미지 삭제"
docker rm -f $(docker ps -aq) 2>/dev/null
docker rmi $(docker images dev-* -q) 2>/dev/null
docker system prune --volumes -f

cd $GOPATH/src/TicketBlockChain/fabric/basic-network/docker
COMPOSE_PROJECT_NAME=fabric docker-compose -f docker-compose-test-net.yaml down --volumes --remove-orphans

echo "인증서 및 채널 아티팩트 삭제"
cd $GOPATH/src/TicketBlockChain/fabric/basic-network
sudo rm -rf channel-artifacts
sudo rm -rf organizations/ordererOrganizations
sudo rm -rf organizations/peerOrganizations
sudo rm -rf system-genesis-block

echo "wallet 삭제"
cd $GOPATH/src/TicketBlockChain/fabric
rm -rf application/wallet

echo "네트워크 정리 완료"
