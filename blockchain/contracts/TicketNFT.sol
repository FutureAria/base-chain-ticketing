// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title TicketNFT — ERC-721 야구 입장권
/// @author BASE CHAIN
/// @notice 티켓 1장을 NFT 1개로 발급하고, 좌석·경기 정보를 온체인에 남긴다.
///         발급된 티켓은 TicketMarketplace 를 통해 2차 거래할 수 있다.
/// @dev 발급 경로가 두 개다.
///      - purchaseTicket : 사용자가 직접 ETH 결제. 온체인에서 좌석 중복을 막는다.
///      - mint           : 서버(minter)가 대신 발급. 좌석 중복은 MySQL 이 이미 확정했다.
///      "이 좌석이 팔렸는가"의 단일 기준은 서버의 MySQL 유니크 제약이며,
///      이 컨트랙트는 "발급되었다는 증명"을 담당한다.
contract TicketNFT is ERC721, Ownable {

    /// @dev 다음에 발급할 tokenId. 1부터 시작해 순차 증가하며 재사용하지 않는다.
    ///      0은 "없음"을 뜻하는 값으로 _seatToToken 에서 쓰이므로 절대 발급하지 않는다.
    uint256 private _nextTokenId;

    /// @notice 발급·입장처리 권한을 가진 주소 목록. 서버 지갑이 여기 등록된다.
    /// @dev owner 와 별개다. owner 는 minter 를 지정만 하고, 실제 발급은 minter 가 한다.
    mapping(address => bool) public minters;

    /// @notice 온체인에 남기는 티켓 정보.
    /// @dev originalPrice 는 정보용이다. 실제 결제 금액 검증은 서버 가격표가 담당한다.
    struct TicketInfo {
        string  gameId;
        string  gameDate;
        string  homeTeam;
        string  awayTeam;
        string  seatSection;
        uint256 originalPrice;  // 원가 (KRW, 정보용)
        bool    used;
    }

    /// @notice tokenId → 티켓 정보.
    mapping(uint256 => TicketInfo) public tickets;

    // gameId+blockLabel+row+seatNumber → tokenId (0 = 없음)
    mapping(bytes32 => uint256) private _seatToToken;

    /// @notice minter 권한이 부여·회수될 때 발생.
    /// @param account 대상 주소
    /// @param enabled true 면 부여, false 면 회수
    event MinterSet(address indexed account, bool enabled);
    /// @notice 티켓이 발급될 때 발생.
    /// @param to 수령자
    /// @param tokenId 발급된 토큰 id
    /// @param gameId 경기 식별자
    /// @param seatSection 좌석 표시 문자열
    event TicketMinted(address indexed to, uint256 tokenId, string gameId, string seatSection);
    /// @notice 입장 처리로 티켓이 사용될 때 발생.
    /// @param tokenId 사용된 토큰 id
    event TicketUsed(uint256 tokenId);

    /// @dev minter 로 등록된 주소만 통과시킨다. 발급·입장처리의 유일한 관문.
    modifier onlyMinter() {
        require(minters[msg.sender], "TicketNFT: not a minter");
        _;
    }

    /// @notice 배포자를 owner 이자 초기 minter 로 설정한다.
    /// @dev 운영에서는 배포 후 setMinter 로 서버 지갑을 추가하고,
    ///      배포자 키의 minter 권한은 회수하는 것을 권한다.
    constructor() ERC721("BASE NINE Ticket", "BNTICKET") Ownable(msg.sender) {
        minters[msg.sender] = true;
        _nextTokenId = 1;
    }

    // ─── 관리자 ────────────────────────────────────────────

    /// @notice minter 권한을 부여하거나 회수한다.
    /// @dev owner 전용. 서버 지갑을 교체할 때 쓴다.
    /// @param account 대상 주소
    /// @param enabled true 면 부여, false 면 회수
    function setMinter(address account, bool enabled) external onlyOwner {
        minters[account] = enabled;
        emit MinterSet(account, enabled);
    }

    // ─── 유틸 ──────────────────────────────────────────────

    /// @dev 좌석을 유일하게 식별하는 키를 만든다.
    /// @param gameId 경기 식별자
    /// @param blockLabel 블록 표시
    /// @param row 열 번호
    /// @param seatNumber 좌석 번호
    /// @return 좌석 해시 키
    function _seatKey(
        string calldata gameId,
        string calldata blockLabel,
        uint256 row,
        uint256 seatNumber
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(gameId, blockLabel, row, seatNumber));
    }

    // ─── 좌석 중복 확인 (프론트 호출) ──────────────────────

    /// @notice 해당 좌석이 온체인 직접 구매로 이미 팔렸는지 확인한다.
    /// @dev 주의 — 이 함수는 purchaseTicket 경로로 팔린 좌석만 안다.
    ///      서버가 mint 로 발급한 티켓은 여기에 잡히지 않는다.
    ///      "이 좌석이 팔렸는가"의 최종 판단은 서버의 MySQL 유니크 제약이다.
    /// @param gameId 경기 식별자
    /// @param blockLabel 블록 표시
    /// @param row 열 번호
    /// @param seatNumber 좌석 번호
    /// @return 팔렸으면 true
    function isSeatTaken(
        string calldata gameId,
        string calldata blockLabel,
        uint256 row,
        uint256 seatNumber
    ) external view returns (bool) {
        return _seatToToken[_seatKey(gameId, blockLabel, row, seatNumber)] != 0;
    }

    // ─── 티켓 구매 (사용자가 직접 ETH 결제) ─────────────────

    /// @notice 사용자가 ETH 를 직접 지불하고 티켓을 발급받는다.
    /// @dev 이 경로에서는 온체인에서 좌석 중복을 막는다(_seatToToken).
    ///      서버를 거치지 않으므로 DB 제약의 보호를 받을 수 없기 때문이다.
    ///      마지막 인자(tokenURI)는 현재 쓰지 않으며 인터페이스 호환을 위해 남겨 두었다.
    /// @param gameId 경기 식별자
    /// @param stadium 구장 이름
    /// @param grade 좌석 등급
    /// @param blockLabel 블록 표시
    /// @param row 열 번호
    /// @param seatNumber 좌석 번호
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

    /// @dev uint256 을 10진 문자열로 바꾼다. 좌석 표시 문자열을 온체인에서 조립하는 데 쓴다.
    /// @param v 변환할 값
    /// @return 10진 문자열
    function _uint2str(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 tmp = v; uint256 digits;
        while (tmp != 0) { digits++; tmp /= 10; }
        bytes memory buf = new bytes(digits);
        while (v != 0) { digits--; buf[digits] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(buf);
    }

    // ─── 민팅 (서버 호출용) ──────────────────────────────────

    /// @notice 서버 발급 경로의 입력 묶음.
    /// @dev 인자를 구조체로 묶은 이유는 stack too deep 을 피하기 위해서다.
    struct MintParams {
        string  gameId;
        string  gameDate;
        string  homeTeam;
        string  awayTeam;
        string  seatSection;
        uint256 originalPrice;
    }

    /// @notice 서버(minter)가 대신 티켓을 발급한다.
    /// @dev 의도적으로 온체인 좌석 중복 검사를 하지 않는다.
    ///      이 경로의 좌석 점유는 서버가 MySQL 트랜잭션과 유니크 제약(uq_ticket_active_seat)으로
    ///      이미 확정한 뒤에 호출되므로, 온체인에서 다시 검사하면 같은 규칙이 두 곳에 생겨
    ///      어긋날 때 어느 쪽이 맞는지 판단할 근거가 사라진다.
    /// @param to 수령자 주소
    /// @param p 티켓 메타데이터
    /// @return tokenId 발급된 토큰 id
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

    /// @notice 입장 처리. 티켓을 사용 완료 상태로 바꾼다.
    /// @dev 재입장 방지의 온체인 방어선이다. 이미 used 인 티켓은 되돌린다.
    ///      호출 전 QR HMAC 검증은 서버가 수행한다.
    /// @param tokenId 대상 토큰 id
    function markUsed(uint256 tokenId) external onlyMinter {
        require(_ownerOf(tokenId) != address(0), "TicketNFT: nonexistent token");
        require(!tickets[tokenId].used, "TicketNFT: already used");
        tickets[tokenId].used = true;
        emit TicketUsed(tokenId);
    }

    // ─── 조회 ──────────────────────────────────────────────

    /// @notice 티켓 정보를 조회한다.
    /// @param tokenId 대상 토큰 id
    /// @return 티켓 정보 구조체
    function getTicket(uint256 tokenId) external view returns (TicketInfo memory) {
        require(_ownerOf(tokenId) != address(0), "TicketNFT: nonexistent token");
        return tickets[tokenId];
    }

    /// @inheritdoc ERC721
    function ownerOf(uint256 tokenId) public view override returns (address) {
        return super.ownerOf(tokenId);
    }
}
