// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * TicketNFT — ERC-721 기반 야구 티켓 NFT
 *
 * - 티켓 1장 = NFT 1개 (고유 tokenId)
 * - 민팅은 서버 지갑(minter)만 가능
 * - 티켓 메타데이터(경기일, 홈팀, 원정팀, 좌석)를 온체인 저장
 * - 양도 시 TicketMarketplace 컨트랙트로 전송
 */
contract TicketNFT is ERC721, Ownable {

    uint256 private _nextTokenId;

    mapping(address => bool) public minters;

    struct TicketInfo {
        string  gameId;
        string  gameDate;
        string  homeTeam;
        string  awayTeam;
        string  seatSection;
        uint256 originalPrice;  // 원가 (KRW, 정보용)
        bool    used;
    }

    mapping(uint256 => TicketInfo) public tickets;

    // gameId+blockLabel+row+seatNumber → tokenId (0 = 없음)
    mapping(bytes32 => uint256) private _seatToToken;

    event MinterSet(address indexed account, bool enabled);
    event TicketMinted(address indexed to, uint256 tokenId, string gameId, string seatSection);
    event TicketUsed(uint256 tokenId);

    modifier onlyMinter() {
        require(minters[msg.sender], "TicketNFT: not a minter");
        _;
    }

    constructor() ERC721("BASE NINE Ticket", "BNTICKET") Ownable(msg.sender) {
        minters[msg.sender] = true;
        _nextTokenId = 1;
    }

    // ─── 관리자 ────────────────────────────────────────────

    function setMinter(address account, bool enabled) external onlyOwner {
        minters[account] = enabled;
        emit MinterSet(account, enabled);
    }

    // ─── 유틸 ──────────────────────────────────────────────

    function _seatKey(
        string calldata gameId,
        string calldata blockLabel,
        uint256 row,
        uint256 seatNumber
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(gameId, blockLabel, row, seatNumber));
    }

    // ─── 좌석 중복 확인 (프론트 호출) ──────────────────────

    function isSeatTaken(
        string calldata gameId,
        string calldata blockLabel,
        uint256 row,
        uint256 seatNumber
    ) external view returns (bool) {
        return _seatToToken[_seatKey(gameId, blockLabel, row, seatNumber)] != 0;
    }

    // ─── 티켓 구매 (사용자가 직접 ETH 결제) ─────────────────

    function purchaseTicket(
        string calldata gameId,
        string calldata stadium,
        string calldata grade,
        string calldata blockLabel,
        uint256 row,
        uint256 seatNumber,
        string calldata /*tokenURI*/
    ) external payable {
        require(msg.value > 0, "TicketNFT: payment required");
        bytes32 key = _seatKey(gameId, blockLabel, row, seatNumber);
        require(_seatToToken[key] == 0, "TicketNFT: seat already taken");

        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);

        string memory seatSection = string(abi.encodePacked(
            grade, " ", blockLabel, unicode"블록 ", _uint2str(row), unicode"열 ", _uint2str(seatNumber), unicode"번"
        ));

        tickets[tokenId] = TicketInfo({
            gameId:        gameId,
            gameDate:      "",
            homeTeam:      stadium,
            awayTeam:      "",
            seatSection:   seatSection,
            originalPrice: msg.value,
            used:          false
        });
        _seatToToken[key] = tokenId;

        emit TicketMinted(msg.sender, tokenId, gameId, seatSection);
    }

    function _uint2str(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 tmp = v; uint256 digits;
        while (tmp != 0) { digits++; tmp /= 10; }
        bytes memory buf = new bytes(digits);
        while (v != 0) { digits--; buf[digits] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(buf);
    }

    // ─── 민팅 (서버 호출용) ──────────────────────────────────

    struct MintParams {
        string  gameId;
        string  gameDate;
        string  homeTeam;
        string  awayTeam;
        string  seatSection;
        uint256 originalPrice;
    }

    function mint(
        address to,
        MintParams calldata p
    ) external onlyMinter returns (uint256) {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        tickets[tokenId] = TicketInfo({
            gameId:        p.gameId,
            gameDate:      p.gameDate,
            homeTeam:      p.homeTeam,
            awayTeam:      p.awayTeam,
            seatSection:   p.seatSection,
            originalPrice: p.originalPrice,
            used:          false
        });
        emit TicketMinted(to, tokenId, p.gameId, p.seatSection);
        return tokenId;
    }

    // ─── 입장 처리 (QR 검증 후 서버 호출) ───────────────────

    function markUsed(uint256 tokenId) external onlyMinter {
        require(_ownerOf(tokenId) != address(0), "TicketNFT: nonexistent token");
        require(!tickets[tokenId].used, "TicketNFT: already used");
        tickets[tokenId].used = true;
        emit TicketUsed(tokenId);
    }

    // ─── 조회 ──────────────────────────────────────────────

    function getTicket(uint256 tokenId) external view returns (TicketInfo memory) {
        require(_ownerOf(tokenId) != address(0), "TicketNFT: nonexistent token");
        return tickets[tokenId];
    }

    function ownerOf(uint256 tokenId) public view override returns (address) {
        return super.ownerOf(tokenId);
    }
}
