'use strict';

const { Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const fs   = require('fs');
const path = require('path');

async function main() {
    try {
        const ccpPath = path.resolve(__dirname, '..', 'connection-org1.json');
        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

        const caInfo = ccp.certificateAuthorities['ca.org1.example.com'];
        const ca = new FabricCAServices(
            caInfo.url,
            { trustedRoots: caInfo.tlsCACerts.pem, verify: false },
            caInfo.caName
        );

        const walletPath = path.join(process.cwd(), '..', 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);
        console.log(`Wallet path: ${walletPath}`);

        const userIdentity = await wallet.get('appUser');
        if (userIdentity) {
            console.log('appUser 이미 등록됨');
            return;
        }

        const adminIdentity = await wallet.get('admin');
        if (!adminIdentity) {
            console.log('admin 먼저 등록하세요: node enrollAdmin.js');
            return;
        }

        const provider  = wallet.getProviderRegistry().getProvider(adminIdentity.type);
        const adminUser = await provider.getUserContext(adminIdentity, 'admin');

        const secret = await ca.register(
            { affiliation: 'org1.department1', enrollmentID: 'appUser', role: 'client' },
            adminUser
        );

        const enrollment = await ca.enroll({
            enrollmentID: 'appUser',
            enrollmentSecret: secret,
        });
        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey:  enrollment.key.toBytes(),
            },
            mspId: 'Org1MSP',
            type:  'X.509',
        };

        await wallet.put('appUser', x509Identity);
        console.log('appUser 등록 완료');

    } catch (error) {
        console.error(`appUser 등록 실패: ${error}`);
        process.exit(1);
    }
}

main();
