// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title TicketMarketplace — 티켓 NFT 2차 거래소
/// @author BASE CHAIN
/// @notice 발급된 입장권을 에스크로 방식으로 사고팔고, 플랫폼 수수료를 분배한다.
/// @dev 거래 흐름
///      1. 판매자: TicketNFT.approve(marketplace, tokenId)
///      2. 판매자: listTicket(tokenId, priceWei)  → NFT 를 컨트랙트에 에스크로
///      3. 구매자: buyTicket(tokenId) payable     → ETH 분배 + NFT 이전
///         - 판매자 수령:  price * (10000 - feeBps) / 10000
///         - 플랫폼 수령:  price * feeBps / 10000
///      4. 판매자: cancelListing(tokenId)         → 판매 전에만 NFT 반환
///
///      정가 초과 판매(암표) 차단은 이 컨트랙트가 아니라 서버가 담당한다.
///      "원래 얼마였는가"는 서버 가격표가 알고 있고, 컨트랙트는 그 값을 신뢰할 수 없기 때문이다.
contract TicketMarketplace is ReentrancyGuard, Ownable {

    /// @notice 거래 대상 티켓 컨트랙트. 배포 후 변경할 수 없다.
    /// @dev immutable 로 고정한 이유 — 거래 도중 대상 컨트랙트가 바뀌면
    ///      에스크로된 NFT 를 되찾을 방법이 없어진다.
    IERC721 public immutable ticketNFT;

    /// @notice 플랫폼 수수료 (basis point). 300 = 3%.
    /// @dev 상한 1000(10%)을 setFeeBps 에서 강제한다.
    uint256 public feeBps = 300;          // 3% (basis points)
    /// @notice 수수료를 받는 지갑.
    address public platformWallet;

    /// @notice 판매 등록 정보.
    /// @dev active 를 지우지 않고 false 로 두는 이유 — 과거 판매 이력을 조회할 수 있게 하기 위해서다.
    struct Listing {
        address seller;
        uint256 priceWei;
        bool    active;
    }

    /// @notice tokenId → 판매 등록 정보.
    mapping(uint256 => Listing) public listings;

    /// @notice 판매 등록 시 발생.
    /// @param seller 판매자
    /// @param tokenId 대상 토큰 id
    /// @param priceWei 판매가 (wei)
    event Listed(address indexed seller, uint256 indexed tokenId, uint256 priceWei);
    /// @notice 거래 체결 시 발생.
    /// @param buyer 구매자
    /// @param tokenId 대상 토큰 id
    /// @param priceWei 거래가 (wei)
    /// @param fee 플랫폼 수수료 (wei)
    event Sold(address indexed buyer, uint256 indexed tokenId, uint256 priceWei, uint256 fee);
    /// @notice 판매 등록 취소 시 발생.
    /// @param seller 판매자
    /// @param tokenId 대상 토큰 id
    event Cancelled(address indexed seller, uint256 indexed tokenId);
    /// @notice 수수료율 변경 시 발생.
    /// @param newFeeBps 새 수수료율 (basis point)
    event FeeUpdated(uint256 newFeeBps);
    /// @notice 수수료 수령 지갑 변경 시 발생.
    /// @param newWallet 새 지갑 주소
    event PlatformWalletUpdated(address newWallet);

    /// @notice 거래 대상 티켓 컨트랙트와 수수료 지갑을 고정한다.
    /// @param _ticketNFT 티켓 NFT 컨트랙트 주소
    /// @param _platformWallet 수수료 수령 지갑
    constructor(address _ticketNFT, address _platformWallet) Ownable(msg.sender) {
        ticketNFT      = IERC721(_ticketNFT);
        platformWallet = _platformWallet;
    }

    // ─── 관리자 ────────────────────────────────────────────

    /// @notice 플랫폼 수수료율을 변경한다.
    /// @dev owner 전용. 최대 1000(10%)을 넘길 수 없다.
    ///      상한이 없으면 owner 가 수수료를 100%로 올려 판매자 대금을 가로챌 수 있다.
    /// @param _feeBps 새 수수료율 (basis point)
    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 1000, "Marketplace: fee too high (max 10%)");
        feeBps = _feeBps;
        emit FeeUpdated(_feeBps);
    }

    /// @notice 수수료 수령 지갑을 변경한다.
    /// @dev owner 전용. 0 주소를 막는 이유 — 수수료 전송이 실패하면
    ///      buyTicket 전체가 되돌아가 거래 자체가 불가능해진다.
    /// @param _wallet 새 지갑 주소
    function setPlatformWallet(address _wallet) external onlyOwner {
        require(_wallet != address(0), "Marketplace: zero address");
        platformWallet = _wallet;
        emit PlatformWalletUpdated(_wallet);
    }

    // ─── 판매 등록 ─────────────────────────────────────────

    /// @notice 보유한 티켓을 판매 등록한다. NFT 는 컨트랙트로 에스크로된다.
    /// @dev 호출 전 판매자가 TicketNFT.approve(marketplace, tokenId) 를 해 두어야 한다.
    ///      에스크로하는 이유 — 등록만 해 두고 다른 곳에 넘겨 버리면
    ///      구매자가 결제한 뒤 받을 NFT 가 없어진다.
    /// @param tokenId 판매할 토큰 id
    /// @param priceWei 판매가 (wei)
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

    /// @notice 등록된 티켓을 구매한다. 대금은 판매자와 플랫폼에 분배된다.
    /// @dev 재진입 방어를 두 겹으로 둔다.
    ///      1) nonReentrant
    ///      2) 외부 호출(NFT 이전·ETH 전송) 전에 l.active = false 로 상태를 먼저 확정
    ///      ETH 전송에 transfer 대신 call 을 쓰는 이유 — transfer 의 2300 gas 상한 때문에
    ///      스마트 컨트랙트 지갑이 대금을 받지 못하는 경우가 있다.
    /// @param tokenId 구매할 토큰 id
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

    /// @notice 판매 등록을 취소하고 에스크로된 NFT 를 돌려받는다.
    /// @dev 판매자 본인만 가능하며, 이미 팔린 뒤에는 취소할 수 없다.
    /// @param tokenId 취소할 토큰 id
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

    /// @notice 판매 등록 정보를 조회한다.
    /// @param tokenId 대상 토큰 id
    /// @return 판매 등록 정보
    function getListing(uint256 tokenId) external view returns (Listing memory) {
        return listings[tokenId];
    }
}
