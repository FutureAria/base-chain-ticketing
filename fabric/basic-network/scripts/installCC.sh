#!/bin/bash
# 사용법: docker exec cli scripts/installCC.sh ticket

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <chaincode-name>"
  exit 1
fi

CC_NAME=$1
CC_VERSION=${2:-1}
CC_SEQUENCE=${3:-1}

ORDERER_CA=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem
ORG1_PEER_CA=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
ORG2_PEER_CA=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt
ORG2_ADMIN_MSP=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp
COLLECTIONS_CONFIG=/opt/gopath/src/github.com/hyperledger/fabric/peer/collections_config.json

## 체인코드 빌드 (vendor 포함 — Docker 빌드 중 인터넷 불필요)
echo "체인코드 빌드: $CC_NAME"
cd ./chaincode/${CC_NAME}/go/
# vendor가 없을 때만 다운로드 (해시 일관성 유지)
if [ ! -d vendor ]; then
  go mod tidy
  go mod vendor
fi

## 체인코드 패키지화
echo "체인코드 패키지화"
cd /opt/gopath/src/github.com/hyperledger/fabric/peer
peer lifecycle chaincode package ${CC_NAME}.tar.gz \
  --path ./chaincode/${CC_NAME}/go/ \
  --lang golang \
  --label ${CC_NAME}_${CC_VERSION}

## PACKAGE_ID 추출 (설치 전 calculatepackageid로 확정)
export PACKAGE_ID=$(peer lifecycle chaincode calculatepackageid ${CC_NAME}.tar.gz)
echo "packageID=$PACKAGE_ID"
if [ -z "$PACKAGE_ID" ]; then
  echo "ERROR: PACKAGE_ID 추출 실패"
  exit 1
fi

## Org1 설치 (Docker 29.x broken pipe 오류가 발생해도 패키지는 저장됨)
echo "Org1 peer0 체인코드 설치"
peer lifecycle chaincode install ${CC_NAME}.tar.gz || echo "⚠ Org1 install broken pipe (패키지는 저장됨, 계속)"

## Org1 승인
echo "Org1 체인코드 승인"
peer lifecycle chaincode approveformyorg \
  -o orderer.example.com:7050 \
  --ordererTLSHostnameOverride orderer.example.com \
  --tls \
  --cafile $ORDERER_CA \
  --channelID channel1 \
  --name ${CC_NAME} \
  --version ${CC_VERSION} \
  --package-id $PACKAGE_ID \
  --sequence ${CC_SEQUENCE} \
  --collections-config $COLLECTIONS_CONFIG \
  --signature-policy "OR('Org1MSP.member', 'Org2MSP.member')"

## Org2 설치
echo "Org2 peer0 체인코드 설치"
CORE_PEER_LOCALMSPID=Org2MSP \
CORE_PEER_ADDRESS=peer0.org2.example.com:9051 \
CORE_PEER_MSPCONFIGPATH=$ORG2_ADMIN_MSP \
CORE_PEER_TLS_ROOTCERT_FILE=$ORG2_PEER_CA \
peer lifecycle chaincode install ${CC_NAME}.tar.gz || echo "⚠ Org2 install broken pipe (패키지는 저장됨, 계속)"

## Org2 승인
echo "Org2 체인코드 승인"
CORE_PEER_LOCALMSPID=Org2MSP \
CORE_PEER_ADDRESS=peer0.org2.example.com:9051 \
CORE_PEER_MSPCONFIGPATH=$ORG2_ADMIN_MSP \
CORE_PEER_TLS_ROOTCERT_FILE=$ORG2_PEER_CA \
peer lifecycle chaincode approveformyorg \
  -o orderer.example.com:7050 \
  --ordererTLSHostnameOverride orderer.example.com \
  --tls \
  --cafile $ORDERER_CA \
  --channelID channel1 \
  --name ${CC_NAME} \
  --version ${CC_VERSION} \
  --package-id $PACKAGE_ID \
  --sequence ${CC_SEQUENCE} \
  --collections-config $COLLECTIONS_CONFIG \
  --signature-policy "OR('Org1MSP.member', 'Org2MSP.member')"

## 커밋 (OR policy — collection도 양쪽 포함이므로 write-set 일치 보장)
echo "체인코드 커밋"
peer lifecycle chaincode commit \
  -o orderer.example.com:7050 \
  --ordererTLSHostnameOverride orderer.example.com \
  --tls \
  --cafile $ORDERER_CA \
  --channelID channel1 \
  --name ${CC_NAME} \
  --peerAddresses peer0.org1.example.com:7051 \
  --tlsRootCertFiles $ORG1_PEER_CA \
  --peerAddresses peer0.org2.example.com:9051 \
  --tlsRootCertFiles $ORG2_PEER_CA \
  --version ${CC_VERSION} \
  --sequence ${CC_SEQUENCE} \
  --collections-config $COLLECTIONS_CONFIG \
  --signature-policy "OR('Org1MSP.member', 'Org2MSP.member')"

echo "체인코드 배포 완료: $CC_NAME"
