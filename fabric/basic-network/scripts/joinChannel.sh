#!/bin/bash

function createChannel() {
  echo "채널 블록 생성"
  peer channel create -o orderer.example.com:7050 -c channel1 \
    -f channel-artifacts/channel.tx \
    --outputBlock channel.block \
    --tls \
    --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem
  cp channel.block channel-artifacts/
}

ORDERER_CA=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem
ORG1_PEER_CA=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
ORG2_PEER_CA=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt
ORG2_ADMIN_MSP=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp

function joinChannel() {
  echo "채널 조인 peer0 Org1"
  peer channel join -b channel-artifacts/channel.block
}

function joinChannelOrg2() {
  echo "채널 조인 peer0 Org2"
  CORE_PEER_LOCALMSPID=Org2MSP \
  CORE_PEER_ADDRESS=peer0.org2.example.com:9051 \
  CORE_PEER_MSPCONFIGPATH=$ORG2_ADMIN_MSP \
  CORE_PEER_TLS_ROOTCERT_FILE=$ORG2_PEER_CA \
  peer channel join -b channel-artifacts/channel.block
}

function updateAnchor() {
  echo "앵커피어 업데이트 peer0 Org1"
  if [ ! -d anchor ]; then
    mkdir anchor
  fi
  cd anchor
  peer channel fetch config config_block.pb \
    -o orderer.example.com:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    -c channel1 \
    --tls \
    --cafile $ORDERER_CA
  configtxlator proto_decode \
    --input config_block.pb \
    --type common.Block \
    | jq .data.data[0].payload.data.config \
    > Org1MSPconfig.json
  jq '.channel_group.groups.Application.groups.Org1MSP.values += {"AnchorPeers":{"mod_policy": "Admins","value":{"anchor_peers": [{"host": "peer0.org1.example.com","port": "7051"}]},"version": "0"}}' Org1MSPconfig.json \
    > Org1MSPmodified_config.json
  configtxlator proto_encode \
    --input Org1MSPconfig.json \
    --type common.Config \
    > original_config.pb
  configtxlator proto_encode \
    --input Org1MSPmodified_config.json \
    --type common.Config \
    > modified_config.pb
  configtxlator compute_update \
    --channel_id channel1 \
    --original original_config.pb \
    --updated modified_config.pb \
    > config_update.pb
  configtxlator proto_decode \
    --input config_update.pb \
    --type common.ConfigUpdate \
    > config_update.json
  echo '{"payload":{"header":{"channel_header":{"channel_id":"channel1", "type":2}},"data":{"config_update":'$(cat config_update.json)'}}}' \
    | jq . \
    > config_update_in_envelope.json
  configtxlator proto_encode \
    --input config_update_in_envelope.json \
    --type common.Envelope \
    > Org1MSPanchors.tx
  peer channel signconfigtx -f Org1MSPanchors.tx
  peer channel update \
    -o orderer.example.com:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    -c channel1 \
    -f Org1MSPanchors.tx \
    --tls \
    --cafile $ORDERER_CA
  echo "Org1 앵커피어 업데이트 완료"
}

function updateAnchorOrg2() {
  echo "앵커피어 업데이트 peer0 Org2"
  if [ ! -d anchor ]; then
    mkdir anchor
  fi
  cd anchor
  CORE_PEER_LOCALMSPID=Org2MSP \
  CORE_PEER_ADDRESS=peer0.org2.example.com:9051 \
  CORE_PEER_MSPCONFIGPATH=$ORG2_ADMIN_MSP \
  CORE_PEER_TLS_ROOTCERT_FILE=$ORG2_PEER_CA \
  peer channel fetch config config_block_org2.pb \
    -o orderer.example.com:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    -c channel1 \
    --tls \
    --cafile $ORDERER_CA
  configtxlator proto_decode \
    --input config_block_org2.pb \
    --type common.Block \
    | jq .data.data[0].payload.data.config \
    > Org2MSPconfig.json
  jq '.channel_group.groups.Application.groups.Org2MSP.values += {"AnchorPeers":{"mod_policy": "Admins","value":{"anchor_peers": [{"host": "peer0.org2.example.com","port": "9051"}]},"version": "0"}}' Org2MSPconfig.json \
    > Org2MSPmodified_config.json
  configtxlator proto_encode \
    --input Org2MSPconfig.json \
    --type common.Config \
    > original_config_org2.pb
  configtxlator proto_encode \
    --input Org2MSPmodified_config.json \
    --type common.Config \
    > modified_config_org2.pb
  configtxlator compute_update \
    --channel_id channel1 \
    --original original_config_org2.pb \
    --updated modified_config_org2.pb \
    > config_update_org2.pb
  configtxlator proto_decode \
    --input config_update_org2.pb \
    --type common.ConfigUpdate \
    > config_update_org2.json
  echo '{"payload":{"header":{"channel_header":{"channel_id":"channel1", "type":2}},"data":{"config_update":'$(cat config_update_org2.json)'}}}' \
    | jq . \
    > config_update_in_envelope_org2.json
  configtxlator proto_encode \
    --input config_update_in_envelope_org2.json \
    --type common.Envelope \
    > Org2MSPanchors.tx
  CORE_PEER_LOCALMSPID=Org2MSP \
  CORE_PEER_ADDRESS=peer0.org2.example.com:9051 \
  CORE_PEER_MSPCONFIGPATH=$ORG2_ADMIN_MSP \
  CORE_PEER_TLS_ROOTCERT_FILE=$ORG2_PEER_CA \
  peer channel update \
    -o orderer.example.com:7050 \
    --ordererTLSHostnameOverride orderer.example.com \
    -c channel1 \
    -f Org2MSPanchors.tx \
    --tls \
    --cafile $ORDERER_CA
  echo "Org2 앵커피어 업데이트 완료"
}

if   [ "$1" == "createChannel"    ]; then createChannel
elif [ "$1" == "joinChannel"      ]; then joinChannel
elif [ "$1" == "joinChannelOrg2"  ]; then joinChannelOrg2
elif [ "$1" == "updateAnchor"     ]; then updateAnchor
elif [ "$1" == "updateAnchorOrg2" ]; then updateAnchorOrg2
else
  echo "unknown parameter: $1"
  exit 1
fi
