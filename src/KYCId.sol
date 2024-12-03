// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";

contract MysticIdentity is ERC721, ERC721Pausable, Ownable, ERC721Burnable {
  uint256 private _nextTokenId;

  constructor(address initialOwner) ERC721("Mystic Identity", "MyID") Ownable() {}

  function _baseURI() internal pure override returns (string memory) {
    return "https://mystic-swap.herokuapp.com/id/";
  }

  function pause() public onlyOwner {
    _pause();
  }

  function unpause() public onlyOwner {
    _unpause();
  }

  function safeMint(address to) public onlyOwner {
    uint256 tokenId = _nextTokenId++;
    _safeMint(to, tokenId);
  }

  function _beforeTokenTransfer(
    address from,
    address to,
    uint256 firstTokenId,
    uint256 batchSize
  ) internal override(ERC721, ERC721Pausable) {
    super._beforeTokenTransfer(from, to, firstTokenId, batchSize);
  }

  function _afterTokenTransfer(
    address from,
    address to,
    uint256 firstTokenId,
    uint256 batchSize
  ) internal override(ERC721) {
    super._afterTokenTransfer(from, to, firstTokenId, batchSize);
  }
}
