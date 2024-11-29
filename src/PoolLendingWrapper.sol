// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./extensions/ITreasury.sol";

contract LendingPool is Ownable {
  using SafeMath for uint256;
  ITreasury treasury;

  // Struct to store user deposit information
  struct UserDeposit {
    uint256 amount;
    uint256 depositTimestamp;
  }

  // Mapping to track user deposits
  mapping(address => mapping(address => UserDeposit)) public userDeposits;

  // Mapping to track total deposits for each token
  mapping(address => uint256) public totalReserves;

  // Interest rate parameters
  uint256 public constant INTEREST_RATE = 0; // 5% annual interest
  uint256 public constant INTEREST_RATE_PRECISION = 10000;
  uint256 public constant SECONDS_PER_YEAR = 365 days;

  // Events
  event Deposit(address indexed user, address indexed token, uint256 amount);
  event Withdrawal(address indexed user, address indexed token, uint256 amount);
  event ReserveUpdated(address indexed token, uint256 totalReserve);
  event TeasuryUpdated(address indexed token);

  constructor(address _treasury) {
    treasury = ITreasury(_treasury);
  }

  // Deposit function
  function deposit(
    address token,
    uint256 amount,
    address to,
    bool
  ) external {
    require(amount > 0, "Deposit amount must be greater than 0");

    // Transfer tokens from user to contract
    IERC20(token).transferFrom(msg.sender, address(this), amount);

    // Update user deposit
    UserDeposit storage userDeposit = userDeposits[to][token];
    userDeposit.amount = userDeposit.amount.add(amount);
    userDeposit.depositTimestamp = block.timestamp;

    // Update total reserves
    totalReserves[token] = totalReserves[token].add(amount);

    // send to treasury if asset is supported
    if (treasury.isSupportedAsset(token)) {
      treasury.depositAsset(token, amount);
    }

    emit Deposit(to, token, amount);
    emit ReserveUpdated(token, totalReserves[token]);
  }

  // Withdrawal function with interest calculation
  function withdraw(
    address token,
    uint256 amount,
    address to
  ) external {
    UserDeposit storage userDeposit = userDeposits[msg.sender][token];

    require(amount > 0, "Withdrawal amount must be greater than 0");
    require(userDeposit.amount >= amount, "Insufficient balance");

    // Calculate interest
    uint256 interest = calculateInterest(userDeposit.amount, userDeposit.depositTimestamp);
    uint256 totalWithdrawalAmount = amount.add(interest);

    // Update user deposit
    userDeposit.amount = userDeposit.amount.sub(amount);

    // Update total reserves
    totalReserves[token] = totalReserves[token].sub(amount);

    // Transfer tokens back to user
    IERC20(token).transfer(to, totalWithdrawalAmount);

    emit Withdrawal(to, token, totalWithdrawalAmount);
    emit ReserveUpdated(token, totalReserves[token]);
  }

  // Interest calculation function
  function calculateInterest(uint256 amount, uint256 depositTimestamp) public view returns (uint256) {
    uint256 depositDuration = block.timestamp - depositTimestamp;
    uint256 interest = amount.mul(INTEREST_RATE).mul(depositDuration).div(SECONDS_PER_YEAR).div(
      INTEREST_RATE_PRECISION
    );

    return interest;
  }

  // Get reserve normalized income (simplified version)
  function getReserveNormalizedIncome(address token) external view returns (uint256) {
    uint256 totalDeposits = totalReserves[token];
    uint256 normalizedIncome = (totalDeposits > 0)
      ? ((totalDeposits.add(calculateTotalInterest(token))) * 1e27) / totalDeposits
      : 1e27;

    return normalizedIncome;
  }

  // Calculate total interest for a token
  function calculateTotalInterest(address token) internal view returns (uint256) {
    // This is a simplified calculation and should be replaced with more sophisticated interest tracking in a real-world scenario
    uint256 totalInterest = totalReserves[token].mul(INTEREST_RATE).div(INTEREST_RATE_PRECISION);
    return totalInterest;
  }

  function updateTreasury(address _treasury) external onlyOwner {
    require(_treasury != address(0), "Invalid repo wallet");

    treasury = ITreasury(_treasury);
    emit TeasuryUpdated(_treasury);
  }

  // Fallback function to reject direct transfers
  receive() external payable {
    revert("Direct transfers not allowed");
  }
}
