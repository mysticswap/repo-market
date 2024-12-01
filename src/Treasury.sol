// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

/**
 * @title Treasury
 * @dev Manages custody operations with flexible asset management and withdrawal
 */
contract Treasury is AccessControl, ReentrancyGuard, Pausable {
  using SafeERC20 for IERC20;

  // Role definitions
  bytes32 public constant TREASURY_MANAGER_ROLE = keccak256("TREASURY_MANAGER_ROLE");
  bytes32 public constant WITHDRAWAL_OPERATOR_ROLE = keccak256("WITHDRAWAL_OPERATOR_ROLE");
  bytes32 public constant CUSTODIAN_OPERATOR_ROLE = keccak256("CUSTODIAN_OPERATOR_ROLE");

  // Withdrawal request status enum
  enum RequestStatus {
    Pending,
    CustodianWithdrawalApproved,
    CustodianWithdrawalRejected
  }

  // Structs for tracking assets and withdrawal requests
  struct AssetInfo {
    address tokenAddress;
    uint256 totalDeposited;
    bool isActive;
  }

  struct WithdrawalRequest {
    address user;
    address[] asset;
    uint256[] amount;
    uint256 requestTime;
    RequestStatus status;
    bool isProcessed;
    address target;
    bytes data;
  }

  // Mappings
  mapping(bytes32 => WithdrawalRequest) public withdrawalRequests;
  mapping(address => uint256) public pendingWithdrawals;
  mapping(address => AssetInfo) public supportedAssets;
  mapping(address => uint256) public assetWithdrawalLimits;
  mapping(address => bool) public approvedTargets;

  // State variables
  address public custodyWallet;
  address public repoLocker;
  bytes32 public lastRequestId;

  // Events
  event AssetDeposited(address indexed token, uint256 amount, address indexed depositor);

  event WithdrawalRequestCreated(
    bytes32 indexed requestId,
    address indexed user,
    address indexed asset,
    address target,
    uint256 amount
  );

  event RequestStatusUpdated(bytes32 indexed requestId, RequestStatus newStatus);
  event WithdrawalCompleted(bytes32 indexed requestId, address indexed user, address indexed asset, uint256 amount);
  event CustodyWalletUpdated(address newCustodyWallet);
  event RepoLockerUpdated(address newCustodyWallet);

  /**
   * @dev Constructor sets up initial roles and custody wallet
   * @param _custodyWallet Initial custody wallet address
   * @param _withdrawalOperators Array of addresses with withdrawal operator role
   */
  constructor(
    address _custodyWallet,
    address _repoLocker,
    address[] memory _withdrawalOperators,
    address[] memory _approvedTargets
  ) {
    // Validate inputs
    require(_custodyWallet != address(0), "Invalid custody wallet");

    // Set custody wallet
    custodyWallet = _custodyWallet;
    repoLocker = _repoLocker;

    // Set up roles
    _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    _setupRole(TREASURY_MANAGER_ROLE, msg.sender);
    _setupRole(CUSTODIAN_OPERATOR_ROLE, msg.sender);

    // Grant withdrawal operator roles
    for (uint256 i = 0; i < _withdrawalOperators.length; i++) {
      require(_withdrawalOperators[i] != address(0), "Invalid withdrawal operator");
      _setupRole(WITHDRAWAL_OPERATOR_ROLE, _withdrawalOperators[i]);
    }

    // Initialize approved targets
    for (uint256 i = 0; i < _approvedTargets.length; i++) {
      approvedTargets[_approvedTargets[i]] = true;
    }
  }

  /**
   * @dev Deposit assets into the treasury
   * @param token Address of the token to deposit
   * @param amount Amount of tokens to deposit
   */
  function depositAsset(address token, uint256 amount) external onlyRole(WITHDRAWAL_OPERATOR_ROLE) nonReentrant {
    require(supportedAssets[token].isActive, "Asset not supported");
    require(amount > 0, "Invalid deposit amount");

    // Safely transfer tokens from sender to treasury
    IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

    // Update total deposited
    supportedAssets[token].totalDeposited += amount;

    // Transfer to custody wallet
    IERC20(token).safeTransfer(custodyWallet, amount);

    emit AssetDeposited(token, amount, msg.sender);
  }

  /**
   * @dev Request withdrawal with custodian integration
   * @param assets Token address
   * @param amounts Withdrawal amount
   * @param target Target contract/address for potential callback
   * @param data Callback data
   * @return requestId Unique request identifier
   */

  function requestWithdrawal(
    address[] memory assets, // Updated to accept an array of asset addresses
    uint256[] memory amounts, // Updated to accept an array of amounts
    address target,
    bytes memory data
  ) external onlyRole(WITHDRAWAL_OPERATOR_ROLE) nonReentrant whenNotPaused returns (bytes32) {
    require(assets.length == amounts.length, "Assets and amounts length mismatch");

    // Check if target is approved
    require(approvedTargets[target], "Target not approved");

    // Check withdrawal limits and create unique request ID
    bytes32 requestId = keccak256(abi.encodePacked(block.timestamp, msg.sender, block.number));
    lastRequestId = requestId;

    // Create withdrawal request
    withdrawalRequests[requestId] = WithdrawalRequest({
      user: msg.sender,
      asset: assets,
      amount: amounts,
      requestTime: block.timestamp,
      status: RequestStatus.Pending,
      isProcessed: false,
      target: target,
      data: data
    });

    // Track pending withdrawals
    for (uint256 i = 0; i < assets.length; i++) {
      require(supportedAssets[assets[i]].isActive, "Asset not supported");
      require(amounts[i] > 0, "Invalid amount");

      // Check withdrawal limit if set
      uint256 limit = assetWithdrawalLimits[assets[i]];
      if (limit > 0) {
        require(amounts[i] <= limit, "Exceeds withdrawal limit");
      }

      pendingWithdrawals[assets[i]] += amounts[i];
    }

    emit WithdrawalRequestCreated(requestId, msg.sender, assets[0], target, amounts[0]); // Emit for the first asset
    return requestId;
  }

  /**
   * @dev Update request status after Anchorage API interaction
   * @param requestId Unique request identifier
   * @param newStatus New status for the request
   */
  function updateRequest(bytes32 requestId, RequestStatus newStatus)
    external
    nonReentrant
    onlyRole(CUSTODIAN_OPERATOR_ROLE)
  {
    WithdrawalRequest storage request = withdrawalRequests[requestId];
    require(request.requestTime != 0, "Request does not exist");
    require(uint8(newStatus) > uint8(request.status), "Invalid status transition");
    require(!request.isProcessed, "Already processed");

    // Update request status
    request.status = newStatus;
    request.isProcessed = true;

    // Loop through assets and amounts
    for (uint256 i = 0; i < request.asset.length; i++) {
      pendingWithdrawals[request.asset[i]] -= request.amount[i];
      // Safely transfer tokens from sender to locker
      IERC20(request.asset[i]).safeTransfer(repoLocker, request.amount[i]);
      supportedAssets[request.asset[i]].totalDeposited -= request.amount[i];
      emit WithdrawalCompleted(requestId, request.user, request.asset[i], request.amount[i]);
    }

    // Optional callback if withdrawal approved
    if (newStatus == RequestStatus.CustodianWithdrawalApproved && request.target != address(0)) {
      (bool success, ) = request.target.call(request.data);
      require(success, "Withdrawal callback failed");
    }

    emit RequestStatusUpdated(requestId, newStatus);
  }

  /**
   * @dev Add a new supported asset
   * @param token Token address to support
   */
  function addSupportedAsset(address token) external onlyRole(TREASURY_MANAGER_ROLE) {
    require(token != address(0), "Invalid token address");
    require(!supportedAssets[token].isActive, "Asset already supported");

    supportedAssets[token] = AssetInfo({tokenAddress: token, totalDeposited: 0, isActive: true});
  }

  /**
   * @dev Add a new supported target
   * @param _target target to support
   */
  function addApprovedTarget(address _target) external onlyRole(TREASURY_MANAGER_ROLE) {
    require(_target != address(0), "Invalid token address");
    approvedTargets[_target] = true;
  }

  /**
   * @dev Update custody wallet address
   * @param newCustodyWallet New custody wallet address
   */
  function updateCustodyWallet(address newCustodyWallet) external onlyRole(TREASURY_MANAGER_ROLE) {
    require(newCustodyWallet != address(0), "Invalid custody wallet");

    custodyWallet = newCustodyWallet;
    emit CustodyWalletUpdated(newCustodyWallet);
  }

  /**
   * @dev Update repo locker address
   * @param _repoLocker New repo locker address
   */
  function updateLocker(address _repoLocker) external onlyRole(TREASURY_MANAGER_ROLE) {
    require(_repoLocker != address(0), "Invalid repo wallet");

    repoLocker = _repoLocker;
    emit RepoLockerUpdated(repoLocker);
  }

  /**
   * @dev Set withdrawal limit for a specific asset
   * @param asset Token address
   * @param limit Maximum withdrawal amount
   */
  function setWithdrawalLimit(address asset, uint256 limit) external onlyRole(TREASURY_MANAGER_ROLE) {
    require(supportedAssets[asset].isActive, "Asset not supported");
    assetWithdrawalLimits[asset] = limit;
  }

  /**
   * @dev Check if an asset is supported for custody
   * @param token Address of the token to check
   * @return Boolean indicating if the asset is supported
   */
  function isSupportedAsset(address token) public view returns (bool) {
    return supportedAssets[token].isActive;
  }

  /**
   * @dev Batch grant withdrawal operator roles
   * @param _newWithdrawalOperators Array of addresses to grant withdrawal operator role
   */
  function batchGrantWithdrawalOperatorRole(address[] calldata _newWithdrawalOperators)
    external
    onlyRole(TREASURY_MANAGER_ROLE)
  {
    for (uint256 i = 0; i < _newWithdrawalOperators.length; i++) {
      address operator = _newWithdrawalOperators[i];

      // Skip zero addresses or already assigned roles to prevent reverting entire batch
      if (operator == address(0) || hasRole(WITHDRAWAL_OPERATOR_ROLE, operator)) {
        continue;
      }

      // Grant role to new withdrawal operators
      _grantRole(WITHDRAWAL_OPERATOR_ROLE, operator);
    }
  }

  /**
   * @dev Remove withdrawal operator role
   * @param _withdrawalOperator Address to revoke withdrawal operator role
   */
  function revokeWithdrawalOperatorRole(address _withdrawalOperator) external onlyRole(TREASURY_MANAGER_ROLE) {
    revokeRole(WITHDRAWAL_OPERATOR_ROLE, _withdrawalOperator);
  }

  // Add a function to get supported asset details
  function getSupportedAssetDetails(address token)
    external
    view
    returns (
      address tokenAddress,
      uint256 totalDeposited,
      bool isActive
    )
  {
    AssetInfo memory asset = supportedAssets[token];
    return (asset.tokenAddress, asset.totalDeposited, asset.isActive);
  }

  /**
   * @dev Add a operator role
   * @param _withdrawalOperator Address to grant operator role
   */
  function addWithdrawalOperator(address _withdrawalOperator) external onlyRole(DEFAULT_ADMIN_ROLE) {
    grantRole(WITHDRAWAL_OPERATOR_ROLE, _withdrawalOperator);
  }

  /**
   * @dev Remove a operator role
   * @param _withdrawalOperator Address to revoke operator role
   */
  function removeWithdrawalOperator(address _withdrawalOperator) external onlyRole(DEFAULT_ADMIN_ROLE) {
    revokeRole(WITHDRAWAL_OPERATOR_ROLE, _withdrawalOperator);
  }

  /**
   * @dev Pause contract operations
   */
  function pause() external onlyRole(TREASURY_MANAGER_ROLE) {
    _pause();
  }

  /**
   * @dev Unpause contract operations
   */
  function unpause() external onlyRole(TREASURY_MANAGER_ROLE) {
    _unpause();
  }

  // Prevent direct ETH transfers
  receive() external payable {
    revert("Direct transfers not allowed");
  }

  fallback() external payable {
    revert("Direct transfers not allowed");
  }
}
