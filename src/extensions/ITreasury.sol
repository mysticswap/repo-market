// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ITreasury {
  // Events
  event AssetDeposited(address indexed token, uint256 amount, address indexed depositor);
  event WithdrawalRequestCreated(
    bytes32 indexed requestId,
    address indexed user,
    address indexed asset,
    address target,
    uint256 amount
  );
  event RequestStatusUpdated(bytes32 indexed requestId, uint8 newStatus);
  event WithdrawalCompleted(bytes32 indexed requestId, address indexed user, address indexed asset, uint256 amount);
  event CustodyWalletUpdated(address newCustodyWallet);

  // Functions
  function depositAsset(address token, uint256 amount) external;

  function requestWithdrawal(
    address[] memory assets,
    uint256[] memory amounts,
    address target,
    bytes memory data
  ) external returns (bytes32);

  function updateRequest(bytes32 requestId, uint8 newStatus) external;

  function addSupportedAsset(address token) external;

  function updateCustodyWallet(address newCustodyWallet) external;

  function setWithdrawalLimit(address asset, uint256 limit) external;

  function isSupportedAsset(address token) external view returns (bool);

  function getSupportedAssetDetails(address token)
    external
    view
    returns (
      address tokenAddress,
      uint256 totalDeposited,
      bool isActive
    );

  function pause() external;

  function unpause() external;
}
