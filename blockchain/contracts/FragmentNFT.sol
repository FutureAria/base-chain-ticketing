// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title FragmentNFT — ERC-1155 조각·카드
/// @author BASE CHAIN
/// @notice 카드 조각과 합성 완성 카드를 하나의 컨트랙트에서 발행·소각한다.
/// @dev tokenId 영역을 나눠 두 종류를 구분한다.
///      1 ~ 99  : 조각 (DB fragment_type_id 와 1:1)
///      100 ~   : 완성 카드 (card_type_id + 100)
///
///      ERC-721 이 아니라 ERC-1155 를 쓴 이유 — 조각은 "몇 개 가졌는가"가 본질이다.
///      조각마다 고유 토큰을 발행하면 100개 보유 시 토큰 100개가 생겨
///      가스비와 조회 비용만 커진다.
contract FragmentNFT is ERC1155, Ownable {

    // minter 역할 (서버 지갑 주소)
    /// @notice 발행·소각 권한을 가진 주소 목록. 서버 지갑이 등록된다.
    mapping(address => bool) public minters;

    /// @notice minter 권한이 부여·회수될 때 발생.
    /// @param account 대상 주소
    /// @param enabled true 면 부여, false 면 회수
    event MinterSet(address indexed account, bool enabled);
    /// @notice 조각이 발행될 때 발생.
    /// @param to 수령자
    /// @param fragmentTypeId 조각 종류 id
    /// @param amount 수량
    event FragmentMinted(address indexed to, uint256 fragmentTypeId, uint256 amount);
    /// @notice 조각이 소각될 때 발생.
    /// @param from 소각 대상 주소
    /// @param fragmentTypeId 조각 종류 id
    /// @param amount 수량
    event FragmentBurned(address indexed from, uint256 fragmentTypeId, uint256 amount);
    /// @notice 합성으로 카드가 발행될 때 발생.
    /// @param to 수령자
    /// @param cardTypeId 카드 종류 id
    /// @param tokenId 실제 토큰 id (cardTypeId + 100)
    event CardMinted(address indexed to, uint256 cardTypeId, uint256 tokenId);

    /// @dev minter 로 등록된 주소만 통과시킨다.
    modifier onlyMinter() {
        require(minters[msg.sender], "FragmentNFT: caller is not a minter");
        _;
    }

    /// @notice 배포자를 owner 이자 초기 minter 로 설정한다.
    /// @dev URI 를 빈 문자열로 두었다. 메타데이터는 서버가 제공한다.
    constructor() ERC1155("") Ownable(msg.sender) {
        // 배포자를 초기 minter 로 설정
        minters[msg.sender] = true;
    }

    // ─── 관리자 함수 ────────────────────────────────────────

    /// @notice minter 권한을 부여하거나 회수한다.
    /// @dev owner 전용.
    /// @param account 대상 주소
    /// @param enabled true 면 부여, false 면 회수
    function setMinter(address account, bool enabled) external onlyOwner {
        minters[account] = enabled;
        emit MinterSet(account, enabled);
    }

    // ─── 파편 민팅 (박스 오픈 보상) ─────────────────────────

    /// @notice 조각을 발행한다. 박스 개봉 보상으로 호출된다.
    /// @dev 1~99 범위를 강제하는 이유 — 100 이상은 카드 영역이다.
    ///      범위를 넘기면 조각 발행으로 카드를 만들어 낼 수 있다.
    /// @param to 수령자 주소
    /// @param fragmentTypeId 조각 종류 id (1~99)
    /// @param amount 발행 수량
    function mintFragment(
        address to,
        uint256 fragmentTypeId,
        uint256 amount
    ) external onlyMinter {
        require(fragmentTypeId >= 1 && fragmentTypeId <= 99, "Invalid fragment type");
        _mint(to, fragmentTypeId, amount, "");
        emit FragmentMinted(to, fragmentTypeId, amount);
    }

    // ─── 파편 소각 (조합 시) ─────────────────────────────────

    /// @notice 조각을 소각한다. 합성 시 재료를 태우는 데 쓴다.
    /// @dev 소각이 실패하면 합성 전체가 되돌아가야 한다.
    ///      서버는 소각 성공을 확인한 뒤에 카드를 발행한다 — 순서가 바뀌면 조각이 복제된다.
    /// @param from 소각 대상 주소
    /// @param fragmentTypeId 조각 종류 id (1~99)
    /// @param amount 소각 수량
    function burnFragment(
        address from,
        uint256 fragmentTypeId,
        uint256 amount
    ) external onlyMinter {
        require(fragmentTypeId >= 1 && fragmentTypeId <= 99, "Invalid fragment type");
        _burn(from, fragmentTypeId, amount);
        emit FragmentBurned(from, fragmentTypeId, amount);
    }

    // ─── 카드 민팅 (조합 완성 보상) ──────────────────────────

    /// @notice 합성 완성 카드를 발행한다.
    /// @dev tokenId 는 cardTypeId + 100 이다. 조각(1~99)과 영역을 나눠
    ///      같은 컨트랙트 안에서 두 종류를 구분한다.
    /// @param to 수령자 주소
    /// @param cardTypeId 카드 종류 id
    function mintCard(
        address to,
        uint256 cardTypeId
    ) external onlyMinter {
        uint256 tokenId = cardTypeId + 100;
        _mint(to, tokenId, 1, "");
        emit CardMinted(to, cardTypeId, tokenId);
    }

    // ─── 잔액 조회 헬퍼 ─────────────────────────────────────

    /// @notice 보유 조각 수량을 조회한다.
    /// @param account 조회 대상 주소
    /// @param fragmentTypeId 조각 종류 id
    /// @return 보유 수량
    function fragmentBalance(address account, uint256 fragmentTypeId)
        external view returns (uint256)
    {
        return balanceOf(account, fragmentTypeId);
    }

    /// @notice 보유 카드 수량을 조회한다.
    /// @dev 호출자가 +100 오프셋을 몰라도 되도록 감싼 헬퍼다.
    /// @param account 조회 대상 주소
    /// @param cardTypeId 카드 종류 id
    /// @return 보유 수량
    function cardBalance(address account, uint256 cardTypeId)
        external view returns (uint256)
    {
        return balanceOf(account, cardTypeId + 100);
    }
}
