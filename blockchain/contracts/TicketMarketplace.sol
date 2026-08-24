// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * TicketMarketplace — 티켓 NFT 2차 거래 + 플랫폼 수수료
 *
 * 흐름:
 *   1. 판매자: TicketNFT.approve(marketplace, tokenId)
 *   2. 판매자: listTicket(tokenId, priceWei)  → NFT 에스크로
 *   3. 구매자: buyTicket(tokenId) payable     → ETH 분배 + NFT 이전
 *      ├─ seller 수령: price × (10000 - feeBps) / 10000
 *      └─ platform 수령: price × feeBps / 10000
 *   4. 판매자: cancelListing(tokenId)         → NFT 반환 (구매 전만)
 *
 * feeBps: 기본 300 = 3%  (owner가 변경 가능, 최대 1000 = 10%)
 */
contract TicketMarketplace is ReentrancyGuard, Ownable {

    IERC721 public immutable ticketNFT;

    uint256 public feeBps = 300;          // 3% (basis points)
    address public platformWallet;

    struct Listing {
        address seller;
        uint256 priceWei;
        bool    active;
    }

    mapping(uint256 => Listing) public listings;

    event Listed(address indexed seller, uint256 indexed tokenId, uint256 priceWei);
    event Sold(address indexed buyer, uint256 indexed tokenId, uint256 priceWei, uint256 fee);
    event Cancelled(address indexed seller, uint256 indexed tokenId);
    event FeeUpdated(uint256 newFeeBps);
    event PlatformWalletUpdated(address newWallet);

    constructor(address _ticketNFT, address _platformWallet) Ownable(msg.sender) {
        ticketNFT      = IERC721(_ticketNFT);
        platformWallet = _platformWallet;
    }

    // ─── 관리자 ────────────────────────────────────────────

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 1000, "Marketplace: fee too high (max 10%)");
        feeBps = _feeBps;
        emit FeeUpdated(_feeBps);
    }

    function setPlatformWallet(address _wallet) external onlyOwner {
        require(_wallet != address(0), "Marketplace: zero address");
        platformWallet = _wallet;
        emit PlatformWalletUpdated(_wallet);
    }

    // ─── 판매 등록 ─────────────────────────────────────────

    function listTicket(uint256 tokenId, uint256 priceWei) external nonReentrant {
        require(ticketNFT.ownerOf(tokenId) == msg.sender, "Marketplace: not owner");
        require(priceWei > 0, "Marketplace: price must be > 0");
        require(!listings[tokenId].active, "Marketplace: already listed");

        // NFT를 컨트랙트로 에스크로
        ticketNFT.transferFrom(msg.sender, address(this), tokenId);

        listings[tokenId] = Listing({
            seller:   msg.sender,
            priceWei: priceWei,
            active:   true
        });

        emit Listed(msg.sender, tokenId, priceWei);
    }

    // ─── 구매 ──────────────────────────────────────────────

    function buyTicket(uint256 tokenId) external payable nonReentrant {
        Listing storage l = listings[tokenId];
        require(l.active, "Marketplace: not listed");
        require(msg.sender != l.seller, "Marketplace: cannot buy own listing");
        require(msg.value == l.priceWei, "Marketplace: incorrect ETH amount");

        uint256 fee            = (l.priceWei * feeBps) / 10000;
        uint256 sellerAmount   = l.priceWei - fee;
        address seller         = l.seller;

        // 상태 먼저 변경 (reentrancy 방어)
        l.active = false;

        // NFT → 구매자
        ticketNFT.transferFrom(address(this), msg.sender, tokenId);

        // ETH 분배
        (bool ok1, ) = payable(seller).call{value: sellerAmount}("");
        require(ok1, "Marketplace: seller transfer failed");

        if (fee > 0) {
            (bool ok2, ) = payable(platformWallet).call{value: fee}("");
            require(ok2, "Marketplace: fee transfer failed");
        }

        emit Sold(msg.sender, tokenId, l.priceWei, fee);
    }

    // ─── 등록 취소 ─────────────────────────────────────────

    function cancelListing(uint256 tokenId) external nonReentrant {
        Listing storage l = listings[tokenId];
        require(l.active, "Marketplace: not listed");
        require(l.seller == msg.sender, "Marketplace: not seller");

        l.active = false;

        // 에스크로된 NFT → 판매자 반환
        ticketNFT.transferFrom(address(this), msg.sender, tokenId);

        emit Cancelled(msg.sender, tokenId);
    }

    // ─── 조회 ──────────────────────────────────────────────

    function getListing(uint256 tokenId) external view returns (Listing memory) {
        return listings[tokenId];
    }
}
