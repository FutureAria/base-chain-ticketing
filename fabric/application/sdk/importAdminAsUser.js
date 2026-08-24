'use strict';
const { Wallets } = require('fabric-network');
const path = require('path');
const fs   = require('fs');

async function main() {
  const walletPath = path.join(__dirname, '../../wallet');
  const wallet     = await Wallets.newFileSystemWallet(walletPath);

  const orgPath = path.join(__dirname,
    '../../basic-network/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp');

  const signcertsDir = path.join(orgPath, 'signcerts');
  const keystoreDir  = path.join(orgPath, 'keystore');

  const certFile = fs.readdirSync(signcertsDir)[0];
  const keyFile  = fs.readdirSync(keystoreDir)[0];

  const cert = fs.readFileSync(path.join(signcertsDir, certFile), 'utf8');
  const key  = fs.readFileSync(path.join(keystoreDir,  keyFile),  'utf8');

  const identity = {
    credentials: { certificate: cert, privateKey: key },
    mspId: 'Org1MSP',
    type:  'X.509',
  };

  await wallet.put('appUser', identity);
  console.log('✅ Admin@org1 → appUser 임포트 완료 (wallet:', walletPath, ')');
}

main().catch(err => { console.error(err); process.exit(1); });
