// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title BoxNFT — ERC-1155 랜덤 박스
/// @author BASE CHAIN
/// @notice 티켓 구매 보상으로 지급되는 박스를 발행하고, 개봉 시 소각한다.
/// @dev 흐름
///      티켓 구매 -> mint(user, SEASON_BOX, 1)  : 박스 지급
///      박스 개봉 -> burn(user, SEASON_BOX, 1)  : 박스 소각
///                -> FragmentNFT.mintFragment() : 보상 발행은 서버가 별도로 호출
///
///      보상 추첨을 온체인에서 하지 않는 이유 — 블록 해시나 타임스탬프 기반 난수는
///      채굴자가 조작할 수 있다. 가중치 추첨은 서버가 하고, 결과만 온체인에 남긴다.
contract BoxNFT is ERC1155, Ownable {

    /// @notice 시즌 박스의 tokenId. 현재 박스 종류는 이것 하나뿐이다.
    uint256 public constant SEASON_BOX = 1;

    /// @notice 발행·소각 권한을 가진 주소 목록. 서버 지갑이 등록된다.
    mapping(address => bool) public minters;

    /// @notice minter 권한이 부여·회수될 때 발생.
    /// @param account 대상 주소
    /// @param enabled true 면 부여, false 면 회수
    event MinterSet(address indexed account, bool enabled);
    /// @notice 박스가 발행될 때 발생.
    /// @param to 수령자
    /// @param boxType 박스 종류
    /// @param amount 수량
    event BoxMinted(address indexed to, uint256 boxType, uint256 amount);
    /// @notice 박스가 소각될 때 발생.
    /// @param from 소각 대상 주소
    /// @param boxType 박스 종류
    /// @param amount 수량
    event BoxBurned(address indexed from, uint256 boxType, uint256 amount);

    /// @dev minter 로 등록된 주소만 통과시킨다.
    modifier onlyMinter() {
        require(minters[msg.sender], "BoxNFT: not a minter");
        _;
    }

    /// @notice 배포자를 owner 이자 초기 minter 로 설정한다.
    constructor() ERC1155("") Ownable(msg.sender) {
        minters[msg.sender] = true;
    }

    // ─── 관리자 ────────────────────────────────────────────

    /// @notice minter 권한을 부여하거나 회수한다.
    /// @dev owner 전용.
    /// @param account 대상 주소
    /// @param enabled true 면 부여, false 면 회수
    function setMinter(address account, bool enabled) external onlyOwner {
        minters[account] = enabled;
        emit MinterSet(account, enabled);
    }

    // ─── 박스 민팅 (티켓 구매 보상) ──────────────────────────

    /// @notice 박스를 발행한다. 티켓 구매 보상으로 호출된다.
    /// @dev boxType 을 SEASON_BOX 로 제한하는 이유 — 정의되지 않은 종류를 발행하면
    ///      개봉 시 보상 풀이 없어 사용자가 열 수 없는 박스가 생긴다.
    /// @param to 수령자 주소
    /// @param boxType 박스 종류 (SEASON_BOX 만 허용)
    /// @param amount 발행 수량
    function mint(
        address to,
        uint256 boxType,
        uint256 amount
    ) external onlyMinter {
        require(boxType == SEASON_BOX, "BoxNFT: unknown box type");
        _mint(to, boxType, amount, "");
        emit BoxMinted(to, boxType, amount);
    }

    // ─── 박스 소각 (오픈 시) ─────────────────────────────────

    /// @notice 박스를 소각한다. 개봉 시 호출된다.
    /// @dev 소각이 성공한 뒤에 서버가 FragmentNFT.mintFragment 로 보상을 발행한다.
    ///      순서가 바뀌면 같은 박스로 보상을 두 번 받을 수 있다.
    /// @param from 소각 대상 주소
    /// @param boxType 박스 종류 (SEASON_BOX 만 허용)
    /// @param amount 소각 수량
    function burn(
        address from,
        uint256 boxType,
        uint256 amount
    ) external onlyMinter {
        require(boxType == SEASON_BOX, "BoxNFT: unknown box type");
        _burn(from, boxType, amount);
        emit BoxBurned(from, boxType, amount);
    }

    // ─── 잔액 조회 ───────────────────────────────────────────

    /// @notice 보유 박스 수량을 조회한다.
    /// @param account 조회 대상 주소
    /// @param boxType 박스 종류
    /// @return 보유 수량
    function boxBalance(address account, uint256 boxType)
        external view returns (uint256)
    {
        return balanceOf(account, boxType);
    }
}
