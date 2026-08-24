import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

/**
 * TicketNFT 컨트랙트 테스트.
 *
 * 티켓을 NFT로 발급하는 이상, "누가 발급할 수 있는가"와 "한 좌석이 두 번 팔리지 않는가"는
 * 코드로 증명돼 있어야 한다. 배포만 하고 검증이 없으면 온체인이라는 말이 무색해진다.
 */
describe("TicketNFT", () => {
  async function deployFixture() {
    const [owner, server, buyer, stranger] = await ethers.getSigners();
    const TicketNFT = await ethers.getContractFactory("TicketNFT");
    const ticket = await TicketNFT.deploy();
    await ticket.waitForDeployment();
    return { ticket, owner, server, buyer, stranger };
  }

  const mintParams = {
    gameId: "G001",
    gameDate: "2026-08-27",
    homeTeam: "두산",
    awayTeam: "롯데",
    seatSection: "블루석 116블록 3열 5번",
    originalPrice: 24000n,
  };

  describe("배포", () => {
    it("이름·심볼이 설정되고 배포자가 minter 가 된다", async () => {
      const { ticket, owner } = await loadFixture(deployFixture);
      expect(await ticket.name()).to.equal("BASE NINE Ticket");
      expect(await ticket.symbol()).to.equal("BNTICKET");
      expect(await ticket.minters(owner.address)).to.equal(true);
    });
  });

  describe("민팅 권한", () => {
    it("minter 가 아니면 mint 할 수 없다", async () => {
      const { ticket, stranger, buyer } = await loadFixture(deployFixture);
      await expect(
        ticket.connect(stranger).mint(buyer.address, mintParams),
      ).to.be.revertedWith("TicketNFT: not a minter");
    });

    it("owner 만 minter 를 지정할 수 있다", async () => {
      const { ticket, stranger, server } = await loadFixture(deployFixture);
      await expect(
        ticket.connect(stranger).setMinter(server.address, true),
      ).to.be.revertedWithCustomError(ticket, "OwnableUnauthorizedAccount");
    });

    it("지정된 minter 는 발급할 수 있고, 해제하면 다시 막힌다", async () => {
      const { ticket, owner, server, buyer } = await loadFixture(deployFixture);

      await ticket.connect(owner).setMinter(server.address, true);
      await expect(ticket.connect(server).mint(buyer.address, mintParams)).to.not.be.reverted;

      await ticket.connect(owner).setMinter(server.address, false);
      await expect(
        ticket.connect(server).mint(buyer.address, mintParams),
      ).to.be.revertedWith("TicketNFT: not a minter");
    });
  });

  describe("티켓 발급", () => {
    it("발급하면 구매자가 소유자가 되고 메타데이터가 온체인에 남는다", async () => {
      const { ticket, owner, buyer } = await loadFixture(deployFixture);
      await ticket.connect(owner).mint(buyer.address, mintParams);

      expect(await ticket.ownerOf(1)).to.equal(buyer.address);
      expect(await ticket.balanceOf(buyer.address)).to.equal(1n);

      const info = await ticket.getTicket(1);
      expect(info.gameId).to.equal(mintParams.gameId);
      expect(info.seatSection).to.equal(mintParams.seatSection);
      expect(info.originalPrice).to.equal(mintParams.originalPrice);
      expect(info.used).to.equal(false);
    });

    it("TicketMinted 이벤트를 발생시킨다", async () => {
      const { ticket, owner, buyer } = await loadFixture(deployFixture);
      await expect(ticket.connect(owner).mint(buyer.address, mintParams))
        .to.emit(ticket, "TicketMinted")
        .withArgs(buyer.address, 1n, mintParams.gameId, mintParams.seatSection);
    });

    it("tokenId 는 1부터 순차 증가한다", async () => {
      const { ticket, owner, buyer } = await loadFixture(deployFixture);
      await ticket.connect(owner).mint(buyer.address, mintParams);
      await ticket.connect(owner).mint(buyer.address, mintParams);
      expect(await ticket.ownerOf(1)).to.equal(buyer.address);
      expect(await ticket.ownerOf(2)).to.equal(buyer.address);
    });

    it("존재하지 않는 토큰 조회는 되돌린다", async () => {
      const { ticket } = await loadFixture(deployFixture);
      await expect(ticket.getTicket(999)).to.be.revertedWith("TicketNFT: nonexistent token");
    });
  });

  describe("좌석 중복 방지 (직접 구매 경로)", () => {
    const seat = ["G001", "잠실", "블루석", "116", 3n, 5n, ""] as const;

    it("같은 좌석을 두 번 사면 두 번째는 되돌린다", async () => {
      const { ticket, buyer, stranger } = await loadFixture(deployFixture);
      const price = ethers.parseEther("0.01");

      await ticket.connect(buyer).purchaseTicket(...seat, { value: price });
      await expect(
        ticket.connect(stranger).purchaseTicket(...seat, { value: price }),
      ).to.be.revertedWith("TicketNFT: seat already taken");
    });

    it("isSeatTaken 이 판매 전후를 정확히 알려준다", async () => {
      const { ticket, buyer } = await loadFixture(deployFixture);
      expect(await ticket.isSeatTaken("G001", "116", 3n, 5n)).to.equal(false);
      await ticket.connect(buyer).purchaseTicket(...seat, { value: ethers.parseEther("0.01") });
      expect(await ticket.isSeatTaken("G001", "116", 3n, 5n)).to.equal(true);
    });

    it("다른 좌석은 영향을 받지 않는다", async () => {
      const { ticket, buyer } = await loadFixture(deployFixture);
      await ticket.connect(buyer).purchaseTicket(...seat, { value: ethers.parseEther("0.01") });
      expect(await ticket.isSeatTaken("G001", "116", 3n, 6n)).to.equal(false);
    });

    it("결제 금액이 0이면 되돌린다", async () => {
      const { ticket, buyer } = await loadFixture(deployFixture);
      await expect(
        ticket.connect(buyer).purchaseTicket(...seat, { value: 0 }),
      ).to.be.revertedWith("TicketNFT: payment required");
    });
  });

  describe("입장 처리", () => {
    it("minter 가 사용 처리하면 used 가 true 가 된다", async () => {
      const { ticket, owner, buyer } = await loadFixture(deployFixture);
      await ticket.connect(owner).mint(buyer.address, mintParams);

      await expect(ticket.connect(owner).markUsed(1)).to.emit(ticket, "TicketUsed").withArgs(1n);
      expect((await ticket.getTicket(1)).used).to.equal(true);
    });

    it("같은 티켓을 두 번 입장 처리할 수 없다 — 재입장 방지", async () => {
      const { ticket, owner, buyer } = await loadFixture(deployFixture);
      await ticket.connect(owner).mint(buyer.address, mintParams);
      await ticket.connect(owner).markUsed(1);

      await expect(ticket.connect(owner).markUsed(1)).to.be.revertedWith("TicketNFT: already used");
    });

    it("minter 가 아니면 입장 처리할 수 없다", async () => {
      const { ticket, owner, buyer, stranger } = await loadFixture(deployFixture);
      await ticket.connect(owner).mint(buyer.address, mintParams);

      await expect(ticket.connect(stranger).markUsed(1)).to.be.revertedWith("TicketNFT: not a minter");
    });

    it("존재하지 않는 티켓은 입장 처리할 수 없다", async () => {
      const { ticket, owner } = await loadFixture(deployFixture);
      await expect(ticket.connect(owner).markUsed(42)).to.be.revertedWith(
        "TicketNFT: nonexistent token",
      );
    });
  });

  describe("양도", () => {
    it("소유자는 티켓을 넘길 수 있다", async () => {
      const { ticket, owner, buyer, stranger } = await loadFixture(deployFixture);
      await ticket.connect(owner).mint(buyer.address, mintParams);

      await ticket.connect(buyer).transferFrom(buyer.address, stranger.address, 1);
      expect(await ticket.ownerOf(1)).to.equal(stranger.address);
    });

    it("남의 티켓은 승인 없이 가져갈 수 없다", async () => {
      const { ticket, owner, buyer, stranger } = await loadFixture(deployFixture);
      await ticket.connect(owner).mint(buyer.address, mintParams);

      await expect(
        ticket.connect(stranger).transferFrom(buyer.address, stranger.address, 1),
      ).to.be.revertedWithCustomError(ticket, "ERC721InsufficientApproval");
    });
  });
});
