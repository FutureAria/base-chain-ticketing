import { ethers } from "hardhat";

/**
 * TicketNFT + BoxNFT + TicketMarketplace 일괄 배포
 *
 * 실행:
 *   cd blockchain
 *   npx hardhat run scripts/deployAll.ts --network hoodi
 *
 * 완료 후 server/.env 에 출력된 주소 3개를 추가하세요.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("배포 지갑:", deployer.address);
  console.log("잔액:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  // ── 1. TicketNFT ──────────────────────────────────────────
  console.log("1) TicketNFT 배포 중...");
  const TicketNFT = await ethers.getContractFactory("TicketNFT");
  const ticketNFT = await TicketNFT.deploy();
  await ticketNFT.waitForDeployment();
  const ticketNFTAddr = await ticketNFT.getAddress();
  console.log("   ✅ TicketNFT:", ticketNFTAddr);

  // ── 2. BoxNFT ─────────────────────────────────────────────
  console.log("2) BoxNFT 배포 중...");
  const BoxNFT = await ethers.getContractFactory("BoxNFT");
  const boxNFT = await BoxNFT.deploy();
  await boxNFT.waitForDeployment();
  const boxNFTAddr = await boxNFT.getAddress();
  console.log("   ✅ BoxNFT:", boxNFTAddr);

  // ── 3. TicketMarketplace ──────────────────────────────────
  console.log("3) TicketMarketplace 배포 중...");
  const Marketplace = await ethers.getContractFactory("TicketMarketplace");
  // platformWallet = 배포자 지갑 (나중에 setPlatformWallet 으로 변경 가능)
  const marketplace = await Marketplace.deploy(ticketNFTAddr, deployer.address);
  await marketplace.waitForDeployment();
  const marketplaceAddr = await marketplace.getAddress();
  console.log("   ✅ TicketMarketplace:", marketplaceAddr);

  // ── 4. TicketNFT 에 Marketplace 를 minter 로 등록 ─────────
  // (Marketplace 가 에스크로/반환 시 transferFrom 을 호출하므로
  //  실제로는 minter 권한이 아닌 approve 방식 사용 — 이 단계는 생략)

  console.log("\n=== server/.env 에 아래 3줄 추가 ===");
  console.log(`TICKET_NFT_ADDRESS=${ticketNFTAddr}`);
  console.log(`BOX_NFT_ADDRESS=${boxNFTAddr}`);
  console.log(`TICKET_MARKETPLACE_ADDRESS=${marketplaceAddr}`);
  console.log("=====================================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
