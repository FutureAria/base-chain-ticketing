#!/bin/bash
# 인증서 생성 후 connection-org1.json의 TLS PEM을 자동으로 채웁니다.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$SCRIPT_DIR/.."
APP_DIR="$BASE_DIR/../application"

PEER_TLS_CERT="$BASE_DIR/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt"
CA_TLS_CERT="$BASE_DIR/organizations/peerOrganizations/org1.example.com/ca/ca.org1.example.com-cert.pem"
ORDERER_TLS_CERT="$BASE_DIR/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/ca.crt"

if [ ! -f "$PEER_TLS_CERT" ]; then
  echo "❌ 인증서 없음: $PEER_TLS_CERT"
  echo "   먼저 generateCert.sh를 실행하세요"
  exit 1
fi

# PEM을 한 줄 JSON 문자열로 변환
PEER_PEM=$(awk 'NF {printf "%s\\n", $0}' "$PEER_TLS_CERT")
CA_PEM=$(awk 'NF {printf "%s\\n", $0}' "$CA_TLS_CERT" 2>/dev/null || echo "$PEER_PEM")
ORDERER_PEM=$(awk 'NF {printf "%s\\n", $0}' "$ORDERER_TLS_CERT")

# connection-org1.json 생성
cat > "$APP_DIR/connection-org1.json" << EOF
{
    "name": "ticket-network-org1",
    "version": "1.0.0",
    "client": {
        "organization": "Org1",
        "connection": {
            "timeout": {
                "peer": { "endorser": "300" }
            }
        }
    },
    "organizations": {
        "Org1": {
            "mspid": "Org1MSP",
            "peers": ["peer0.org1.example.com"],
            "certificateAuthorities": ["ca.org1.example.com"]
        }
    },
    "channels": {
        "channel1": {
            "orderers": ["orderer.example.com"],
            "peers": {
                "peer0.org1.example.com": {
                    "endorsingPeer": true,
                    "chaincodeQuery": true,
                    "ledgerQuery": true,
                    "eventSource": true,
                    "discover": true
                }
            }
        }
    },
    "orderers": {
        "orderer.example.com": {
            "url": "grpcs://localhost:7050",
            "tlsCACerts": {
                "pem": "$ORDERER_PEM"
            },
            "grpcOptions": {
                "ssl-target-name-override": "orderer.example.com",
                "hostnameOverride": "orderer.example.com"
            }
        }
    },
    "peers": {
        "peer0.org1.example.com": {
            "url": "grpcs://localhost:7051",
            "tlsCACerts": {
                "pem": "$PEER_PEM"
            },
            "grpcOptions": {
                "ssl-target-name-override": "peer0.org1.example.com",
                "hostnameOverride": "peer0.org1.example.com"
            }
        }
    },
    "certificateAuthorities": {
        "ca.org1.example.com": {
            "url": "https://localhost:7054",
            "caName": "ca-org1",
            "tlsCACerts": {
                "pem": ["$CA_PEM"]
            },
            "httpOptions": {
                "verify": false
            }
        }
    }
}
EOF

echo "✅ connection-org1.json 업데이트 완료"
