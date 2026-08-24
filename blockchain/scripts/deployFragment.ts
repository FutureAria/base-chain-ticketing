import { ethers } from "hardhat";

async function main() {
  console.log("FragmentNFT 배포 시작...");

  const FragmentNFT = await ethers.getContractFactory("FragmentNFT");
  const fragmentNFT = await FragmentNFT.deploy();
  await fragmentNFT.waitForDeployment();

  const address = await fragmentNFT.getAddress();
  console.log("✅ FragmentNFT 배포 완료!");
  console.log("컨트랙트 주소:", address);
  console.log("");
  console.log("server/.env 에 추가:");
  console.log(`FRAGMENT_NFT_ADDRESS=${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
