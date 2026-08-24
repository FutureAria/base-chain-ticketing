// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * FragmentNFT — ERC-1155 기반 파편 & 카드 NFT
 *
 * tokenId 설계:
 *   1 ~ 99   → 파편 (fragment_type_id 와 1:1 매핑)
 *   100 ~    → 완성 카드 (card_type_id + 100 으로 매핑)
 *
 * 민팅/소각은 오직 minter 역할만 가능 (서버 지갑)
 */
contract FragmentNFT is ERC1155, Ownable {

    // minter 역할 (서버 지갑 주소)
    mapping(address => bool) public minters;

    event MinterSet(address indexed account, bool enabled);
    event FragmentMinted(address indexed to, uint256 fragmentTypeId, uint256 amount);
    event FragmentBurned(address indexed from, uint256 fragmentTypeId, uint256 amount);
    event CardMinted(address indexed to, uint256 cardTypeId, uint256 tokenId);

    modifier onlyMinter() {
        require(minters[msg.sender], "FragmentNFT: caller is not a minter");
        _;
    }

    constructor() ERC1155("") Ownable(msg.sender) {
        // 배포자를 초기 minter 로 설정
        minters[msg.sender] = true;
    }

    // ─── 관리자 함수 ────────────────────────────────────────

    function setMinter(address account, bool enabled) external onlyOwner {
        minters[account] = enabled;
        emit MinterSet(account, enabled);
    }

    // ─── 파편 민팅 (박스 오픈 보상) ─────────────────────────

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

    function mintCard(
        address to,
        uint256 cardTypeId
    ) external onlyMinter {
        uint256 tokenId = cardTypeId + 100;
        _mint(to, tokenId, 1, "");
        emit CardMinted(to, cardTypeId, tokenId);
    }

    // ─── 잔액 조회 헬퍼 ─────────────────────────────────────

    function fragmentBalance(address account, uint256 fragmentTypeId)
        external view returns (uint256)
    {
        return balanceOf(account, fragmentTypeId);
    }

    function cardBalance(address account, uint256 cardTypeId)
        external view returns (uint256)
    {
        return balanceOf(account, cardTypeId + 100);
    }
}
