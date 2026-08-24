// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * BoxNFT — ERC-1155 기반 랜덤박스 NFT
 *
 * tokenId 설계:
 *   1 → 시즌 박스 (티켓 구매 보상)
 *
 * 흐름:
 *   티켓 구매 → mint(user, 1, 1)  : 박스 1개 지급
 *   박스 오픈 → burn(user, 1, 1)  : 박스 소각
 *             → FragmentNFT.mintFragment() 호출은 서버가 별도 처리
 */
contract BoxNFT is ERC1155, Ownable {

    uint256 public constant SEASON_BOX = 1;

    mapping(address => bool) public minters;

    event MinterSet(address indexed account, bool enabled);
    event BoxMinted(address indexed to, uint256 boxType, uint256 amount);
    event BoxBurned(address indexed from, uint256 boxType, uint256 amount);

    modifier onlyMinter() {
        require(minters[msg.sender], "BoxNFT: not a minter");
        _;
    }

    constructor() ERC1155("") Ownable(msg.sender) {
        minters[msg.sender] = true;
    }

    // ─── 관리자 ────────────────────────────────────────────

    function setMinter(address account, bool enabled) external onlyOwner {
        minters[account] = enabled;
        emit MinterSet(account, enabled);
    }

    // ─── 박스 민팅 (티켓 구매 보상) ──────────────────────────

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

    function boxBalance(address account, uint256 boxType)
        external view returns (uint256)
    {
        return balanceOf(account, boxType);
    }
}
