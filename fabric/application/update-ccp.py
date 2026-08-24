#!/usr/bin/env python3
"""
connection-org1.json에 TLS 인증서, channels, orderers 섹션을 채워 넣는 스크립트.
네트워크를 새로 올린 뒤 (generateCert 후) 실행할 것.

사용법:
  cd /home/ubuntu/Desktop/TICKETBLOCKCHAIN
  python3 fabric/application/update-ccp.py
"""
import json, os, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE = os.path.join(REPO, 'fabric', 'basic-network', 'organizations')
CCP  = os.path.join(REPO, 'fabric', 'application', 'connection-org1.json')

peer1_ca_path   = os.path.join(BASE, 'peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt')
peer2_ca_path   = os.path.join(BASE, 'peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt')
orderer_ca_path = os.path.join(BASE, 'ordererOrganizations/example.com/orderers/orderer.example.com/tls/ca.crt')

for p in [peer1_ca_path, orderer_ca_path, CCP]:
    if not os.path.exists(p):
        print(f'❌ 파일 없음: {p}')
        sys.exit(1)

# Org2 TLS CA는 없을 수도 있음 (dev 모드에서 Org2 컨테이너 미실행 시)
has_org2 = os.path.exists(peer2_ca_path)
if not has_org2:
    print('⚠️  Org2 TLS CA 없음 — Org2 피어 제외 (dev 모드)')

peer1_ca    = open(peer1_ca_path).read().strip()
orderer_ca  = open(orderer_ca_path).read().strip()
peer2_ca    = open(peer2_ca_path).read().strip() if has_org2 else None

d = json.load(open(CCP))

# ── Org1 피어 ─────────────────────────────────────────────
d['peers']['peer0.org1.example.com']['tlsCACerts']['pem'] = peer1_ca
d['peers']['peer0.org1.example.com']['grpcOptions'] = {
    'ssl-target-name-override': 'peer0.org1.example.com',
    'hostnameOverride':         'peer0.org1.example.com',
    'request-timeout':          30000,
    'grpc-wait-for-ready-timeout': 30000,
}

# ── Org2 피어 (있을 때만) ──────────────────────────────────
if has_org2:
    d['peers']['peer0.org2.example.com'] = {
        'url': 'grpcs://localhost:9051',
        'tlsCACerts': {'pem': peer2_ca},
        'grpcOptions': {
            'ssl-target-name-override': 'peer0.org2.example.com',
            'hostnameOverride':         'peer0.org2.example.com',
            'request-timeout':          30000,
            'grpc-wait-for-ready-timeout': 30000,
        },
    }

# ── organizations ─────────────────────────────────────────
if has_org2:
    d['organizations']['Org2'] = {
        'mspid': 'Org2MSP',
        'peers': ['peer0.org2.example.com'],
    }

# ── orderers ─────────────────────────────────────────────
d['orderers'] = {
    'orderer.example.com': {
        'url': 'grpcs://localhost:7050',
        'tlsCACerts': {'pem': orderer_ca},
        'grpcOptions': {
            'ssl-target-name-override': 'orderer.example.com',
            'hostnameOverride':         'orderer.example.com',
            'request-timeout':          30000,
            'grpc-wait-for-ready-timeout': 30000,
        },
    }
}

# ── channels ─────────────────────────────────────────────
channel_peers = {
    'peer0.org1.example.com': {
        'endorsingPeer': True,
        'chaincodeQuery': True,
        'ledgerQuery':    True,
        'eventSource':    True,
    }
}
if has_org2:
    channel_peers['peer0.org2.example.com'] = {
        'endorsingPeer': False,  # collectionOrg1은 Org1 전용 — Org2 endorsement 제외
        'chaincodeQuery': False,
        'ledgerQuery':    False,
        'eventSource':    False,
    }

d['channels'] = {
    'channel1': {
        'orderers': ['orderer.example.com'],
        'peers': channel_peers,
    }
}

# ── CA TLS ───────────────────────────────────────────────
d['certificateAuthorities']['ca.org1.example.com']['tlsCACerts']['pem'] = [peer1_ca]

json.dump(d, open(CCP, 'w'), indent=2)
print('✅ connection-org1.json 업데이트 완료')
print(f'   channels : {list(d["channels"].keys())}')
print(f'   orderers : {list(d["orderers"].keys())}')
print(f'   peers    : {list(d["peers"].keys())}')
