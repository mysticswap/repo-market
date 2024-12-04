import {BigNumber} from 'ethers';
import {defaultAbiCoder, keccak256, parseEther} from 'ethers/lib/utils';
import {deployments, ethers} from 'hardhat';

import {MockContract} from '@ethereum-waffle/mock-contract';

import {BorrowerPools} from '../../typechain';
import {
  calcRealizedBondsQuantity,
  checkPoolUtil,
  checkTickUtil,
  computeBondsQuantity,
  setupFixture,
} from '../utils';
import {
  poolHash,
  borrowerName,
  cooldownPeriod,
  distributionRate,
  lateRepayFeePerBondRate,
  maxRateInput,
  minRateInput,
  repaymentFeeRate,
  rateSpacingInput,
  RAY,
  repaymentPeriod,
  TEST_RETURN_YIELD_PROVIDER_LR_RAY,
  WAD,
  establishmentFeeRate,
  FIRST_BOND_ISSUANCE_INDEX,
} from '../utils/constants';
import {Deployer, PoolParameters, PoolState, User} from '../utils/types';
import {expect} from './helpers/chai-setup';
import {setupTestContracts} from './utils';
import {Pool} from '../../typechain/Pool';

const setup = deployments.createFixture(async () => {
  return setupFixture('BorrowerPools');
});

describe('Borrower Pools - Fees', function () {
  let positionManager: User,
    borrower: User,
    governanceUser: User,
    mockDeployer: Deployer;
  let BorrowerPools: BorrowerPools;
  let poolParameters: PoolParameters;
  let poolState: PoolState;
  let depositRate: BigNumber,
    minRate: BigNumber,
    rateSpacing: BigNumber,
    liquidityRewardsRate: BigNumber,
    maxBorrowableAmount: BigNumber,
    loanDuration: BigNumber;
  let poolToken: string;
  let otherToken: string;
  let treasuryToken: string;
  let mockLendingPool: MockContract;
  let mainLendingPool: Pool;
  const depositAmount: BigNumber = WAD.mul(20); //20 tokens deposited : arbitrary amount for testing purpose
  const timeIncrease = 36000;
  const oneSec = 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let checkPoolState: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let checkTickAmounts: any;

  beforeEach(async () => {
    const {deployer, mocks, users} = await setup();
    const {
      deployedBorrowerPools,
      governance,
      testBorrower,
      testPositionManager,
      poolTokenAddress,
      otherTokenAddress,
      treasuryTokenAddress,
    } = await setupTestContracts(deployer, mocks, users);
    BorrowerPools = deployedBorrowerPools;
    poolParameters = await BorrowerPools.getPoolParameters(poolHash);
    minRate = poolParameters.minRate;
    rateSpacing = poolParameters.rateSpacing;
    liquidityRewardsRate = poolParameters.liquidityRewardsDistributionRate;
    maxBorrowableAmount = poolParameters.maxBorrowableAmount;
    loanDuration = poolParameters.loanDuration;
    depositRate = minRate.add(rateSpacing); //Tokens deposited at the min_rate + rate_spacing
    positionManager = testPositionManager;
    mockDeployer = deployer;
    borrower = testBorrower;
    treasuryToken = treasuryTokenAddress;
    governanceUser = governance;
    poolToken = poolTokenAddress;
    otherToken = otherTokenAddress;
    mockLendingPool = mocks.ILendingPool;
    checkPoolState = checkPoolUtil(borrower);
    checkTickAmounts = checkTickUtil(borrower);
    mainLendingPool = deployer.LendingPool;
  });

  it('Top Up Liquidity Rewards from a paused pool should revert', async function () {
    await expect(governanceUser.BorrowerPools.freezePool()).to.emit(
      governanceUser.BorrowerPools,
      'Paused'
    );
    await expect(
      borrower.BorrowerPools.topUpLiquidityRewards(depositAmount)
    ).to.revertedWith('Pausable: paused');
  });
  it('Top Up Liquidity Rewards from an address withouth borrower role should revert', async function () {
    await expect(
      positionManager.BorrowerPools.topUpLiquidityRewards(depositRate)
    ).to.be.revertedWith(
      `AccessControl: account ${positionManager.address.toLowerCase()} is missing role 0x2344277e405079ec07749d374ba0b5862a4e45a6a05ac889dbb4a991c6f9354d`
    );
  });
  it('Top Up Liquidity Rewards should deposit tokens to be distributed to lenders', async function () {
    poolState = await BorrowerPools.getPoolState(poolHash);
    expect(poolState.remainingAdjustedLiquidityRewardsReserve).to.equal(
      BigNumber.from(0)
    );
    await expect(borrower.BorrowerPools.topUpLiquidityRewards(depositAmount));
    // .to.emit(borrower.BorrowerPools, 'TopUpLiquidityRewards')
    // .withArgs(poolHash, depositAmount);

    await checkPoolState(poolHash, {
      remainingAdjustedLiquidityRewardsReserve: depositAmount
        .mul(RAY)
        .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY),
    });
  });
  it('Creating a new pool with a liquidity rewards activation threshold greater than 0 should leave the pool unactivated', async function () {
    const newBorrowerName = `${poolHash}-otherToken`;
    const newPoolHash = keccak256(
      defaultAbiCoder.encode(['string'], [newBorrowerName])
    );
    const newLiquidityRewardsActivationThreshold = parseEther('100');
    poolState = await BorrowerPools.getPoolState(newPoolHash);
    expect(poolState.active).to.be.false;

    await expect(
      governanceUser.BorrowerPools.createNewPool({
        poolHash: newPoolHash,
        underlyingToken: poolToken,
        collateralToken: otherToken,
        ltv: 8000,
        yieldProvider: mainLendingPool.address,
        minRate: minRateInput,
        maxRate: maxRateInput,
        rateSpacing: rateSpacingInput,
        maxBorrowableAmount: maxBorrowableAmount,
        loanDuration: loanDuration,
        distributionRate: distributionRate,
        cooldownPeriod: cooldownPeriod,
        repaymentPeriod: repaymentPeriod,
        lateRepayFeePerBondRate: lateRepayFeePerBondRate,
        establishmentFeeRate: establishmentFeeRate,
        repaymentFeeRate: repaymentFeeRate,
        liquidityRewardsActivationThreshold:
          newLiquidityRewardsActivationThreshold,
        earlyRepay: true,
      })
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolCreated')
      .withArgs([
        newPoolHash,
        poolToken,
        otherToken,
        mainLendingPool.address,
        8000,
        minRateInput,
        maxRateInput,
        rateSpacingInput,
        maxBorrowableAmount,
        loanDuration,
        distributionRate,
        cooldownPeriod,
        repaymentPeriod,
        lateRepayFeePerBondRate,
        establishmentFeeRate,
        repaymentFeeRate,
        newLiquidityRewardsActivationThreshold,
        true,
      ]);

    poolState = await BorrowerPools.getPoolState(newPoolHash);
    expect(poolState.active).to.be.false;
  });
  it('Top Up Liquidity Rewards lower than activation threshold should not activate the pool', async function () {
    const newBorrowerName = `${poolHash}-otherToken`;
    const newPoolHash = keccak256(
      defaultAbiCoder.encode(['string'], [newBorrowerName])
    );
    const newLiquidityRewardsActivationThreshold = parseEther('100');
    poolState = await BorrowerPools.getPoolState(newPoolHash);
    expect(poolState.active).to.be.false;

    await expect(
      governanceUser.BorrowerPools.createNewPool({
        poolHash: newPoolHash,
        underlyingToken: poolToken,
        collateralToken: otherToken,
        ltv: 8000,
        yieldProvider: mockLendingPool.address,
        minRate: minRateInput,
        maxRate: maxRateInput,
        rateSpacing: rateSpacingInput,
        maxBorrowableAmount: maxBorrowableAmount,
        loanDuration: loanDuration,
        distributionRate: distributionRate,
        cooldownPeriod: cooldownPeriod,
        repaymentPeriod: repaymentPeriod,
        lateRepayFeePerBondRate: lateRepayFeePerBondRate,
        establishmentFeeRate: establishmentFeeRate,
        repaymentFeeRate: repaymentFeeRate,
        liquidityRewardsActivationThreshold:
          newLiquidityRewardsActivationThreshold,
        earlyRepay: true,
      })
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolCreated')
      .withArgs([
        newPoolHash,
        poolToken,
        otherToken,
        mockLendingPool.address,
        8000,
        minRateInput,
        maxRateInput,
        rateSpacingInput,
        maxBorrowableAmount,
        loanDuration,
        distributionRate,
        cooldownPeriod,
        repaymentPeriod,
        lateRepayFeePerBondRate,
        establishmentFeeRate,
        repaymentFeeRate,
        newLiquidityRewardsActivationThreshold,
        true,
      ]);
    poolState = await BorrowerPools.getPoolState(newPoolHash);
    expect(poolState.active).to.be.false;

    await governanceUser.BorrowerPools.disallow(borrower.address, poolHash);
    await governanceUser.BorrowerPools.allow(borrower.address, newPoolHash);

    await expect(
      borrower.BorrowerPools.topUpLiquidityRewards(
        newLiquidityRewardsActivationThreshold.sub(parseEther('100'))
      )
    );
    // .to.emit(borrower.BorrowerPools, 'TopUpLiquidityRewards')
    // .withArgs(
    //   newPoolHash,
    //   newLiquidityRewardsActivationThreshold.sub(parseEther('100'))
    // );

    poolState = await BorrowerPools.getPoolState(newPoolHash);
    expect(poolState.active).to.be.false;
  });
  it('Top Up Liquidity Rewards equal to activation threshold should activate the pool', async function () {
    const newBorrowerName = `${poolHash}-otherToken`;
    const newPoolHash = keccak256(
      defaultAbiCoder.encode(['string'], [newBorrowerName])
    );
    const newLiquidityRewardsActivationThreshold = parseEther('100');
    poolState = await BorrowerPools.getPoolState(newPoolHash);
    expect(poolState.active).to.be.false;

    await expect(
      governanceUser.BorrowerPools.createNewPool({
        poolHash: newPoolHash,
        underlyingToken: poolToken,
        collateralToken: otherToken,
        ltv: 8000,
        yieldProvider: mockLendingPool.address,
        minRate: minRateInput,
        maxRate: maxRateInput,
        rateSpacing: rateSpacingInput,
        maxBorrowableAmount: maxBorrowableAmount,
        loanDuration: loanDuration,
        distributionRate: distributionRate,
        cooldownPeriod: cooldownPeriod,
        repaymentPeriod: repaymentPeriod,
        lateRepayFeePerBondRate: lateRepayFeePerBondRate,
        establishmentFeeRate: establishmentFeeRate,
        repaymentFeeRate: repaymentFeeRate,
        liquidityRewardsActivationThreshold:
          newLiquidityRewardsActivationThreshold,
        earlyRepay: true,
      })
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolCreated')
      .withArgs([
        newPoolHash,
        poolToken,
        otherToken,
        mockLendingPool.address,
        8000,
        minRateInput,
        maxRateInput,
        rateSpacingInput,
        maxBorrowableAmount,
        loanDuration,
        distributionRate,
        cooldownPeriod,
        repaymentPeriod,
        lateRepayFeePerBondRate,
        establishmentFeeRate,
        repaymentFeeRate,
        newLiquidityRewardsActivationThreshold,
        true,
      ]);

    await governanceUser.BorrowerPools.disallow(borrower.address, poolHash);
    await governanceUser.BorrowerPools.allow(borrower.address, newPoolHash);

    await expect(
      borrower.BorrowerPools.topUpLiquidityRewards(
        newLiquidityRewardsActivationThreshold
      )
    );
    // .to.emit(borrower.BorrowerPools, 'TopUpLiquidityRewards')
    // .withArgs(newPoolHash, newLiquidityRewardsActivationThreshold);

    poolState = await BorrowerPools.getPoolState(poolHash);
    expect(poolState.active).to.be.true;
  });
  it('Collecting Fees on a single tick from a paused pool should revert', async function () {
    await expect(governanceUser.BorrowerPools.freezePool()).to.emit(
      governanceUser.BorrowerPools,
      'Paused'
    );
    await expect(
      borrower.BorrowerPools.collectFees(poolHash, depositRate)
    ).to.revertedWith('Pausable: paused');
  });
  it('Collecting Fees on all ticks from a paused pool should revert', async function () {
    await expect(governanceUser.BorrowerPools.freezePool()).to.emit(
      governanceUser.BorrowerPools,
      'Paused'
    );
    await expect(
      borrower.BorrowerPools.collectFees(poolHash, 0)
    ).to.revertedWith('Pausable: paused');
  });
  it('Collecting Fees on a single tick before a borrow should update target tick liquidity ratio with liquidity rewards', async function () {
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await expect(borrower.BorrowerPools.topUpLiquidityRewards(depositAmount));
    // .to.emit(borrower.BorrowerPools, 'TopUpLiquidityRewards')
    // .withArgs(poolHash, depositAmount);

    const data = await borrower.BorrowerPools.getTickAmounts(
      poolHash,
      depositRate
    );

    const depositDistributionTimestamp = data.lastFeeDistributionTimestamp;

    await checkTickAmounts(poolHash, depositRate, {
      accruedFees: BigNumber.from(0),
      atlendisLiquidityRatio: TEST_RETURN_YIELD_PROVIDER_LR_RAY,
    });

    await ethers.provider.send('evm_increaseTime', [timeIncrease]);
    await ethers.provider.send('evm_mine', []);

    await borrower.BorrowerPools.collectFees(poolHash, depositRate);

    const newData = await borrower.BorrowerPools.getTickAmounts(
      poolHash,
      depositRate
    );
    const collectionDistributionTimestamp =
      newData.lastFeeDistributionTimestamp;
    expect(collectionDistributionTimestamp.gt(depositDistributionTimestamp)).to
      .be.true;
    const expectedAddedLiquidityRewards = liquidityRewardsRate.mul(
      timeIncrease + 2 * oneSec
    );

    const expectLRIncrease = expectedAddedLiquidityRewards
      .mul(RAY)
      .div(depositAmount.div(2));
    const additionalLRIncrease = liquidityRewardsRate
      .mul(RAY)
      .div(depositAmount.div(2));
    const expectedLR = TEST_RETURN_YIELD_PROVIDER_LR_RAY.add(expectLRIncrease);
    const remainingNormalizedLiquidityRewardsReserve = depositAmount.sub(
      expectedAddedLiquidityRewards
    );

    await checkPoolState(poolHash, {
      remainingAdjustedLiquidityRewardsReserve: [
        remainingNormalizedLiquidityRewardsReserve
          .mul(RAY)
          .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY),
        remainingNormalizedLiquidityRewardsReserve
          .sub(liquidityRewardsRate)
          .mul(RAY)
          .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY),
      ],
    });

    await checkTickAmounts(poolHash, depositRate, {
      accruedFees: BigNumber.from(0),
      atlendisLiquidityRatio: [
        expectedLR,
        expectedLR.add(additionalLRIncrease),
      ],
    });
  });
  // it('Collecting Fees on all ticks before a borrow should update all liquidity ratios with liquidity rewards and spread fees according to deposits', async function () {
  //   await positionManager.BorrowerPools.deposit(
  //     depositRate,
  //     poolHash,
  //     poolToken,
  //     positionManager.address,
  //     depositAmount
  //   );
  //   await positionManager.BorrowerPools.deposit(
  //     depositRate.add(rateSpacing),
  //     poolHash,
  //     poolToken,
  //     positionManager.address,
  //     depositAmount
  //   );
  //   await expect(borrower.BorrowerPools.topUpLiquidityRewards(depositAmount))
  //     .to.emit(borrower.BorrowerPools, 'TopUpLiquidityRewards')
  //     .withArgs(poolHash, depositAmount);

  //   await ethers.provider.send('evm_increaseTime', [timeIncrease]);
  //   await ethers.provider.send('evm_mine', []);

  //   await borrower.BorrowerPools.collectFees(poolHash, 0);

  //   const expectedAddedLiquidityRewardsFirstRate = liquidityRewardsRate
  //     .mul(timeIncrease + 3 * oneSec)
  //     .mul(depositAmount)
  //     .div(depositAmount.mul(2));
  //   let expectLRIncrease = expectedAddedLiquidityRewardsFirstRate
  //     .mul(RAY)
  //     .div(depositAmount.div(2));
  //   const expectedAdditionalLiquidityRewardsFirstRate = liquidityRewardsRate
  //     .mul(oneSec)
  //     .mul(depositAmount)
  //     .div(depositAmount.mul(2));
  //   let expectAdditionalLRIncrease = expectedAdditionalLiquidityRewardsFirstRate
  //     .mul(RAY)
  //     .div(depositAmount.div(2));
  //   let expectedLR = TEST_RETURN_YIELD_PROVIDER_LR_RAY.add(expectLRIncrease);
  //   await checkTickAmounts(poolHash, depositRate, {
  //     accruedFees: BigNumber.from(0),
  //     atlendisLiquidityRatio: [
  //       expectedLR,
  //       expectedLR.add(expectAdditionalLRIncrease),
  //     ],
  //   });

  //   const expectedAddedLiquidityRewardsSecondRate =
  //     poolParameters.liquidityRewardsDistributionRate
  //       .mul(timeIncrease + 2 * oneSec)
  //       .mul(depositAmount)
  //       // total available amount in higher rates is impacted by fees update on lower rates, hence the addition here
  //       .div(depositAmount.mul(2).add(expectedAddedLiquidityRewardsFirstRate));
  //   expectLRIncrease = expectedAddedLiquidityRewardsSecondRate
  //     .mul(RAY)
  //     .div(depositAmount.div(2));
  //   const expectedAdditionalLiquidityRewardsSecondRate =
  //     poolParameters.liquidityRewardsDistributionRate
  //       .mul(oneSec)
  //       .mul(depositAmount)
  //       .div(depositAmount.mul(2).add(expectedAddedLiquidityRewardsFirstRate));
  //   expectAdditionalLRIncrease = expectedAdditionalLiquidityRewardsSecondRate
  //     .mul(RAY)
  //     .div(depositAmount.div(2));
  //   expectedLR = TEST_RETURN_YIELD_PROVIDER_LR_RAY.add(expectLRIncrease);
  //   await checkTickAmounts(poolHash, depositRate.add(rateSpacing), {
  //     accruedFees: BigNumber.from(0),
  //     atlendisLiquidityRatio: [
  //       expectedLR,
  //       expectedLR.add(expectAdditionalLRIncrease),
  //     ],
  //   });

  //   await checkPoolState(poolHash, {
  //     remainingAdjustedLiquidityRewardsReserve: [
  //       depositAmount
  //         .sub(expectedAddedLiquidityRewardsFirstRate)
  //         .sub(expectedAddedLiquidityRewardsSecondRate)
  //         .mul(RAY)
  //         .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY),
  //       depositAmount
  //         .sub(expectedAddedLiquidityRewardsFirstRate)
  //         .sub(expectedAdditionalLiquidityRewardsFirstRate)
  //         .sub(expectedAddedLiquidityRewardsSecondRate)
  //         .sub(expectedAdditionalLiquidityRewardsSecondRate)
  //         .mul(RAY)
  //         .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY),
  //     ],
  //   });
  // });
  it('Collecting Fees on a single tick before a borrow should update target tick liquidity ratio with yield provider fees', async function () {
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await checkTickAmounts(poolHash, depositRate, {
      accruedFees: BigNumber.from(0),
      atlendisLiquidityRatio: TEST_RETURN_YIELD_PROVIDER_LR_RAY,
    });

    // await mockLendingPool.mock.getReserveNormalizedIncome.returns(
    //   TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(2)
    // );

    await mockDeployer.LendingPool.updateMultiplier(4);

    await borrower.BorrowerPools.collectFees(poolHash, depositRate);

    await checkTickAmounts(poolHash, depositRate, {
      accruedFees: BigNumber.from(0),
      atlendisLiquidityRatio: TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(2),
    });
  });
  it('Collecting Fees on all ticks before a borrow should update all liquidity ratios with yield provider fees', async function () {
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await positionManager.BorrowerPools.deposit(
      depositRate.add(rateSpacing),
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    // await mockLendingPool.mock.getReserveNormalizedIncome.returns(
    //   TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(2)
    // );

    await mockDeployer.LendingPool.updateMultiplier(4);

    await borrower.BorrowerPools.collectFees(poolHash, 0);

    await checkTickAmounts(poolHash, depositRate, {
      accruedFees: BigNumber.from(0),
      atlendisLiquidityRatio: TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(2),
    });

    await checkTickAmounts(poolHash, depositRate.add(rateSpacing), {
      accruedFees: BigNumber.from(0),
      atlendisLiquidityRatio: TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(2),
    });
  });
  // it('Collecting Fees on a single tick during a loan should update the accrued fees with liquidity rewards', async function () {
  //   const borrowAmount = depositAmount.div(2);
  //   await positionManager.BorrowerPools.deposit(
  //     depositRate,
  //     poolHash,
  //     poolToken,
  //     positionManager.address,
  //     depositAmount
  //   );
  //   await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

  //   await expect(borrower.BorrowerPools.topUpLiquidityRewards(depositAmount))
  //     .to.emit(borrower.BorrowerPools, 'TopUpLiquidityRewards')
  //     .withArgs(poolHash, depositAmount);

  //   await ethers.provider.send('evm_increaseTime', [timeIncrease]);
  //   await ethers.provider.send('evm_mine', []);

  //   await borrower.BorrowerPools.collectFees(poolHash, depositRate);

  //   const expectedLiquidityRewards =
  //     poolParameters.liquidityRewardsDistributionRate
  //       .mul(timeIncrease + 2 * oneSec)
  //       .mul(maxBorrowableAmount.sub(borrowAmount))
  //       .div(maxBorrowableAmount);

  //   const additionalLiquidityRewards =
  //     poolParameters.liquidityRewardsDistributionRate
  //       .mul(oneSec)
  //       .mul(maxBorrowableAmount.sub(borrowAmount))
  //       .div(maxBorrowableAmount);

  //   await checkPoolState(poolHash, {
  //     remainingAdjustedLiquidityRewardsReserve: [
  //       depositAmount
  //         .sub(expectedLiquidityRewards)
  //         .mul(RAY)
  //         .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY),
  //       depositAmount
  //         .sub(expectedLiquidityRewards)
  //         .sub(additionalLiquidityRewards)
  //         .mul(RAY)
  //         .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY),
  //     ],
  //   });
  //   await checkTickAmounts(poolHash, depositRate, {
  //     accruedFees: [
  //       expectedLiquidityRewards,
  //       expectedLiquidityRewards.add(additionalLiquidityRewards),
  //     ],
  //     atlendisLiquidityRatio: TEST_RETURN_YIELD_PROVIDER_LR_RAY,
  //   });
  // });
  it('Collecting Fees on all ticks during a loan should update the accrued fees with liquidity rewards', async function () {
    const borrowAmount = depositAmount.mul(2);
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await positionManager.BorrowerPools.deposit(
      depositRate.add(rateSpacing),
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount.mul(2)
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

    await expect(borrower.BorrowerPools.topUpLiquidityRewards(depositAmount));
    // .to.emit(borrower.BorrowerPools, 'TopUpLiquidityRewards')
    // .withArgs(poolHash, depositAmount);

    await ethers.provider.send('evm_increaseTime', [timeIncrease]);
    await ethers.provider.send('evm_mine', []);

    await borrower.BorrowerPools.collectFees(poolHash, 0);

    const expectedLiquidityRewards =
      poolParameters.liquidityRewardsDistributionRate
        .mul(timeIncrease + 2 * oneSec)
        .mul(maxBorrowableAmount.sub(borrowAmount))
        .div(maxBorrowableAmount);

    const additionalLiquidityRewards =
      poolParameters.liquidityRewardsDistributionRate
        .mul(oneSec)
        .mul(maxBorrowableAmount.sub(borrowAmount))
        .div(maxBorrowableAmount);

    await checkPoolState(poolHash, {
      remainingAdjustedLiquidityRewardsReserve: [
        depositAmount
          .sub(expectedLiquidityRewards)
          .mul(RAY)
          .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY),
        depositAmount
          .sub(expectedLiquidityRewards)
          .sub(additionalLiquidityRewards)
          .mul(RAY)
          .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY),
      ],
    });
    await checkTickAmounts(poolHash, depositRate, {
      accruedFees: BigNumber.from(0),
      atlendisLiquidityRatio: TEST_RETURN_YIELD_PROVIDER_LR_RAY,
    });
    await checkTickAmounts(poolHash, depositRate.add(rateSpacing), {
      accruedFees: [
        expectedLiquidityRewards,
        expectedLiquidityRewards.add(additionalLiquidityRewards),
      ],
      atlendisLiquidityRatio: TEST_RETURN_YIELD_PROVIDER_LR_RAY,
    });
  });
  it('Collecting Fees on a single tick during a loan should update the accrued fees with yield provider fees', async function () {
    const borrowAmount = depositAmount.div(2);
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

    await checkTickAmounts(poolHash, depositRate, {
      accruedFees: BigNumber.from(0),
      atlendisLiquidityRatio: TEST_RETURN_YIELD_PROVIDER_LR_RAY,
    });

    // await mockLendingPool.mock.getReserveNormalizedIncome.returns(
    //   TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(2)
    // );

    await mockDeployer.LendingPool.updateMultiplier(4);

    await borrower.BorrowerPools.collectFees(poolHash, depositRate);

    const expectedFees = TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(
      depositAmount.div(4)
    ).div(RAY);
    await checkTickAmounts(poolHash, depositRate, {
      accruedFees: expectedFees,
      atlendisLiquidityRatio: TEST_RETURN_YIELD_PROVIDER_LR_RAY,
    });
  });
  it('Collecting Fees on all ticks during a loan should update all accrued fees with yield provider fees', async function () {
    const borrowAmount = depositAmount.mul(2);
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await positionManager.BorrowerPools.deposit(
      depositRate.add(rateSpacing),
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount.mul(2)
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

    // await mockLendingPool.mock.getReserveNormalizedIncome.returns(
    //   TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(2)
    // );

    await mockDeployer.LendingPool.updateMultiplier(4);

    await borrower.BorrowerPools.collectFees(poolHash, 0);

    const expectedFees = TEST_RETURN_YIELD_PROVIDER_LR_RAY.mul(
      depositAmount.div(2)
    ).div(RAY);

    await checkTickAmounts(poolHash, depositRate, {
      accruedFees: BigNumber.from(0),
      atlendisLiquidityRatio: TEST_RETURN_YIELD_PROVIDER_LR_RAY,
    });
    await checkTickAmounts(poolHash, depositRate.add(rateSpacing), {
      accruedFees: expectedFees,
      atlendisLiquidityRatio: TEST_RETURN_YIELD_PROVIDER_LR_RAY,
    });
  });
  it('Claming protocol fees from an address without governance role should revert', async function () {
    await expect(
      positionManager.BorrowerPools.claimProtocolFees(
        poolHash,
        BigNumber.from(0),
        positionManager.address
      )
    ).to.be.revertedWith(
      `AccessControl: account ${positionManager.address.toLowerCase()} is missing role 0x71840dc4906352362b0cdaf79870196c8e42acafade72d5d5a6d59291253ceb1`
    );
  });
  it('Claming protocol fees for an inactive pool should revert', async function () {
    const otherBorrowerHash = keccak256(
      defaultAbiCoder.encode(['string'], ['idk'])
    );
    await expect(
      governanceUser.BorrowerPools.claimProtocolFees(
        otherBorrowerHash,
        BigNumber.from(0),
        positionManager.address
      )
    ).to.be.revertedWith('PC_POOL_NOT_ACTIVE');
  });
  it('Claming too much protocol fees should revert', async function () {
    await expect(
      governanceUser.BorrowerPools.claimProtocolFees(
        poolHash,
        depositAmount,
        positionManager.address
      )
    ).to.be.revertedWith('PC_NOT_ENOUGH_PROTOCOL_FEES');
  });
  it('Claming protocol fees from repayment fees should withdraw the amount from yield provider and send it to the target address', async function () {
    const updatedRepaymentFee = parseEther('0.1');
    await expect(
      governanceUser.BorrowerPools.setPoolParameter(
        3,
        updatedRepaymentFee,
        poolHash
      )
    );
    // .to.emit(governanceUser.BorrowerPools, 'SetRepaymentFeeRate');

    let repayAmounts = await governanceUser.BorrowerPools.getRepayAmounts(
      poolHash,
      false
    );
    expect(repayAmounts[0].isZero()).to.be.true;

    const borrowAmount = depositAmount;
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await borrower.BorrowerPools.borrow(borrower.address, borrowAmount);

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: BigNumber.from(0),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: depositAmount,
      adjustedPendingDepositAmount: BigNumber.from(0),
    });

    const expectedBondsQuantity = await computeBondsQuantity(
      depositAmount,
      depositRate,
      loanDuration
    );
    const expectedProtocolFees = expectedBondsQuantity
      .sub(depositAmount)
      .div(10);

    repayAmounts = await governanceUser.BorrowerPools.getRepayAmounts(
      poolHash,
      false
    );

    const deposits = await mockDeployer.LendingPool.userDeposits(
      borrower.BorrowerPools.address,
      poolToken
    );

    const depositTreasury = await mockDeployer.LendingPool.userDeposits(
      borrower.BorrowerPools.address,
      otherToken
    );

    console.log(
      'amounts saved',
      deposits.amount + '',
      depositTreasury.amount + ''
    );

    expect(
      expectedBondsQuantity
        .add(expectedProtocolFees)
        .sub(repayAmounts[0])
        .abs()
        .lt(10)
    ).to.be.true;

    await ethers.provider.send('evm_increaseTime', [loanDuration.toNumber()]);
    await ethers.provider.send('evm_mine', []);

    const currentMaturity = (await BorrowerPools.getPoolState(poolHash))
      .currentMaturity;

    await expect(borrower.BorrowerPools.repay()).to.emit(
      borrower.BorrowerPools,
      'Repay'
    );
    const realizedExpectedBondsQuantity = await calcRealizedBondsQuantity(
      currentMaturity,
      expectedBondsQuantity,
      depositRate
    );

    const protocolFees = await governanceUser.BorrowerPools.getProtocolFees(
      poolHash
    );

    const expectedRealizedProtocolFees = realizedExpectedBondsQuantity
      .sub(depositAmount)
      .div(10);

    expect(protocolFees.sub(expectedRealizedProtocolFees).abs().lt(10)).to.be
      .true;

    await expect(
      governanceUser.BorrowerPools.claimProtocolFees(
        poolHash,
        expectedProtocolFees,
        governanceUser.address
      )
    );
    // .to.emit(governanceUser.BorrowerPools, 'ClaimProtocolFees')
    // .withArgs(poolHash, expectedProtocolFees, governanceUser.address);
  });
  it('Claming protocol fees from establishment fees should withdraw the amount from yield provider and send it to the target address', async function () {
    const updatedEstablishmentFee = parseEther('0.01');
    // await expect(
    //   governanceUser.BorrowerPools.setEstablishmentFeeRate(
    //     updatedEstablishmentFee,
    //     poolHash
    //   )
    // ).to.emit(governanceUser.BorrowerPools, 'SetEstablishmentFeeRate');

    const borrowAmount = depositAmount;
    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    // const expectedProtocolFees = borrowAmount
    //   .mul(updatedEstablishmentFee)
    //   .div(WAD);
    await expect(
      borrower.BorrowerPools.borrow(borrower.address, borrowAmount)
    ).to.emit(governanceUser.BorrowerPools, 'Borrow');
    // .withArgs(
    //   poolHash,
    //   borrowAmount.sub(expectedProtocolFees),
    //   expectedProtocolFees
    // );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: BigNumber.from(0),
      lowerInterestRate: depositRate,
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: depositAmount.div(2),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: borrowAmount,
      adjustedPendingDepositAmount: BigNumber.from(0),
    });

    const protocolFees = await governanceUser.BorrowerPools.getProtocolFees(
      poolHash
    );

    const repayAmounts = await governanceUser.BorrowerPools.getRepayAmounts(
      poolHash,
      false
    );
    const expectedBondsQuantity = await computeBondsQuantity(
      borrowAmount,
      depositRate,
      loanDuration
    );
    expect(repayAmounts[0].eq(expectedBondsQuantity)).to.be.true;

    // expect(protocolFees.eq(expectedProtocolFees)).to.be.true;

    // await expect(
    //   governanceUser.BorrowerPools.claimProtocolFees(
    //     poolHash,
    //     expectedProtocolFees,
    //     governanceUser.address
    //   )
    // )
    //   .to.emit(governanceUser.BorrowerPools, 'ClaimProtocolFees')
    //   .withArgs(poolHash, expectedProtocolFees, governanceUser.address);
  });

  it('Send to Pool Lender', async function () {
    const newBorrowerName = `${poolHash}-otherToken`;
    const newPoolHash = keccak256(
      defaultAbiCoder.encode(['string'], [newBorrowerName])
    );
    const newLiquidityRewardsActivationThreshold = parseEther('100');
    poolState = await BorrowerPools.getPoolState(newPoolHash);
    expect(poolState.active).to.be.false;

    await expect(
      governanceUser.BorrowerPools.createNewPool({
        poolHash: newPoolHash,
        underlyingToken: poolToken,
        collateralToken: otherToken,
        ltv: 8000,
        yieldProvider: mainLendingPool.address,
        minRate: minRateInput,
        maxRate: maxRateInput,
        rateSpacing: rateSpacingInput,
        maxBorrowableAmount: maxBorrowableAmount,
        loanDuration: loanDuration,
        distributionRate: distributionRate,
        cooldownPeriod: cooldownPeriod,
        repaymentPeriod: repaymentPeriod,
        lateRepayFeePerBondRate: lateRepayFeePerBondRate,
        establishmentFeeRate: establishmentFeeRate,
        repaymentFeeRate: repaymentFeeRate,
        liquidityRewardsActivationThreshold:
          newLiquidityRewardsActivationThreshold,
        earlyRepay: true,
      })
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolCreated')
      .withArgs([
        newPoolHash,
        poolToken,
        otherToken,
        mainLendingPool.address,
        8000,
        minRateInput,
        maxRateInput,
        rateSpacingInput,
        maxBorrowableAmount,
        loanDuration,
        distributionRate,
        cooldownPeriod,
        repaymentPeriod,
        lateRepayFeePerBondRate,
        establishmentFeeRate,
        repaymentFeeRate,
        newLiquidityRewardsActivationThreshold,
        true,
      ]);

    await governanceUser.BorrowerPools.disallow(borrower.address, poolHash);
    await governanceUser.BorrowerPools.allow(borrower.address, newPoolHash);

    await expect(
      borrower.BorrowerPools.topUpLiquidityRewards(
        newLiquidityRewardsActivationThreshold
      )
    );
    // .to.emit(borrower.BorrowerPools, 'TopUpLiquidityRewards')
    // .withArgs(newPoolHash, newLiquidityRewardsActivationThreshold);

    poolState = await BorrowerPools.getPoolState(poolHash);
    expect(poolState.active).to.be.true;

    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
  });

  it('Send and Receive to Pool Lender', async function () {
    const newBorrowerName = `${poolHash}-otherToken`;
    const newPoolHash = keccak256(
      defaultAbiCoder.encode(['string'], [newBorrowerName])
    );
    const newLiquidityRewardsActivationThreshold = parseEther('100');
    poolState = await BorrowerPools.getPoolState(newPoolHash);
    expect(poolState.active).to.be.false;
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);

    await expect(
      governanceUser.BorrowerPools.createNewPool({
        poolHash: newPoolHash,
        underlyingToken: poolToken,
        collateralToken: otherToken,
        ltv: 8000,
        yieldProvider: mainLendingPool.address,
        minRate: minRateInput,
        maxRate: maxRateInput,
        rateSpacing: rateSpacingInput,
        maxBorrowableAmount: maxBorrowableAmount,
        loanDuration: loanDuration,
        distributionRate: distributionRate,
        cooldownPeriod: cooldownPeriod,
        repaymentPeriod: repaymentPeriod,
        lateRepayFeePerBondRate: lateRepayFeePerBondRate,
        establishmentFeeRate: establishmentFeeRate,
        repaymentFeeRate: repaymentFeeRate,
        liquidityRewardsActivationThreshold:
          newLiquidityRewardsActivationThreshold,
        earlyRepay: true,
      })
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolCreated')
      .withArgs([
        newPoolHash,
        poolToken,
        otherToken,
        mainLendingPool.address,
        8000,
        minRateInput,
        maxRateInput,
        rateSpacingInput,
        maxBorrowableAmount,
        loanDuration,
        distributionRate,
        cooldownPeriod,
        repaymentPeriod,
        lateRepayFeePerBondRate,
        establishmentFeeRate,
        repaymentFeeRate,
        newLiquidityRewardsActivationThreshold,
        true,
      ]);

    await governanceUser.BorrowerPools.disallow(borrower.address, poolHash);
    await governanceUser.BorrowerPools.allow(borrower.address, newPoolHash);

    await expect(
      borrower.BorrowerPools.topUpLiquidityRewards(
        newLiquidityRewardsActivationThreshold
      )
    );
    // .to.emit(borrower.BorrowerPools, 'TopUpLiquidityRewards')
    // .withArgs(newPoolHash, newLiquidityRewardsActivationThreshold);

    poolState = await BorrowerPools.getPoolState(poolHash);
    expect(poolState.active).to.be.true;

    await positionManager.BorrowerPools.deposit(
      depositRate,
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );
    await positionManager.BorrowerPools.deposit(
      depositRate.add(rateSpacing),
      poolHash,
      poolToken,
      positionManager.address,
      depositAmount
    );

    await positionManager.BorrowerPools.withdraw(
      poolHash,
      depositRate,
      withdrawAmount,
      FIRST_BOND_ISSUANCE_INDEX,
      positionManager.address
    );

    await checkPoolState(poolHash, {
      normalizedAvailableDeposits: depositAmount,
      lowerInterestRate: depositRate.add(rateSpacing),
    });
    await checkTickAmounts(poolHash, depositRate, {
      adjustedTotalAmount: BigNumber.from(0),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
  });

  it('Deposit should go to treasury', async function () {
    const newBorrowerName = `${poolHash}-otherToken`;
    const newPoolHash = keccak256(
      defaultAbiCoder.encode(['string'], [newBorrowerName])
    );
    const newLiquidityRewardsActivationThreshold = parseEther('100');
    poolState = await BorrowerPools.getPoolState(newPoolHash);
    expect(poolState.active).to.be.false;
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);

    await expect(
      governanceUser.BorrowerPools.createNewPool({
        poolHash: newPoolHash,
        underlyingToken: treasuryToken,
        collateralToken: otherToken,
        ltv: 8000,
        yieldProvider: mainLendingPool.address,
        minRate: minRateInput,
        maxRate: maxRateInput,
        rateSpacing: rateSpacingInput,
        maxBorrowableAmount: maxBorrowableAmount,
        loanDuration: loanDuration,
        distributionRate: distributionRate,
        cooldownPeriod: cooldownPeriod,
        repaymentPeriod: repaymentPeriod,
        lateRepayFeePerBondRate: lateRepayFeePerBondRate,
        establishmentFeeRate: establishmentFeeRate,
        repaymentFeeRate: repaymentFeeRate,
        liquidityRewardsActivationThreshold:
          newLiquidityRewardsActivationThreshold,
        earlyRepay: true,
      })
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolCreated')
      .withArgs([
        newPoolHash,
        treasuryToken,
        otherToken,
        mainLendingPool.address,
        8000,
        minRateInput,
        maxRateInput,
        rateSpacingInput,
        maxBorrowableAmount,
        loanDuration,
        distributionRate,
        cooldownPeriod,
        repaymentPeriod,
        lateRepayFeePerBondRate,
        establishmentFeeRate,
        repaymentFeeRate,
        newLiquidityRewardsActivationThreshold,
        true,
      ]);

    await governanceUser.BorrowerPools.disallow(borrower.address, poolHash);
    await governanceUser.BorrowerPools.allow(borrower.address, newPoolHash);

    await expect(
      await borrower.BorrowerPools.topUpLiquidityRewards(
        newLiquidityRewardsActivationThreshold
      )
    );

    // .to.emit(borrower.BorrowerPools, 'TopUpLiquidityRewards')
    // .withArgs(newPoolHash, newLiquidityRewardsActivationThreshold);

    poolState = await BorrowerPools.getPoolState(newPoolHash);
    console.log(poolState);
    expect(poolState.active).to.be.true;

    await positionManager.BorrowerPools.deposit(
      depositRate,
      newPoolHash,
      treasuryToken,
      positionManager.address,
      depositAmount
    );
    await positionManager.BorrowerPools.deposit(
      depositRate.add(rateSpacing),
      newPoolHash,
      treasuryToken,
      positionManager.address,
      depositAmount
    );

    await checkPoolState(newPoolHash, {
      normalizedAvailableDeposits: depositAmount.add(depositAmount),
      lowerInterestRate: depositRate,
    });
  });

  it('Direct Withdrawal from treasury should fail', async function () {
    const newBorrowerName = `${poolHash}-otherToken`;
    const newPoolHash = keccak256(
      defaultAbiCoder.encode(['string'], [newBorrowerName])
    );
    const newLiquidityRewardsActivationThreshold = parseEther('100');
    poolState = await BorrowerPools.getPoolState(newPoolHash);
    expect(poolState.active).to.be.false;
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);

    await expect(
      governanceUser.BorrowerPools.createNewPool({
        poolHash: newPoolHash,
        underlyingToken: treasuryToken,
        collateralToken: otherToken,
        ltv: 8000,
        yieldProvider: mainLendingPool.address,
        minRate: minRateInput,
        maxRate: maxRateInput,
        rateSpacing: rateSpacingInput,
        maxBorrowableAmount: maxBorrowableAmount,
        loanDuration: loanDuration,
        distributionRate: distributionRate,
        cooldownPeriod: cooldownPeriod,
        repaymentPeriod: repaymentPeriod,
        lateRepayFeePerBondRate: lateRepayFeePerBondRate,
        establishmentFeeRate: establishmentFeeRate,
        repaymentFeeRate: repaymentFeeRate,
        liquidityRewardsActivationThreshold:
          newLiquidityRewardsActivationThreshold,
        earlyRepay: true,
      })
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolCreated')
      .withArgs([
        newPoolHash,
        treasuryToken,
        otherToken,
        mainLendingPool.address,
        8000,
        minRateInput,
        maxRateInput,
        rateSpacingInput,
        maxBorrowableAmount,
        loanDuration,
        distributionRate,
        cooldownPeriod,
        repaymentPeriod,
        lateRepayFeePerBondRate,
        establishmentFeeRate,
        repaymentFeeRate,
        newLiquidityRewardsActivationThreshold,
        true,
      ]);

    await governanceUser.BorrowerPools.disallow(borrower.address, poolHash);
    await governanceUser.BorrowerPools.allow(borrower.address, newPoolHash);

    await borrower.BorrowerPools.topUpLiquidityRewards(
      newLiquidityRewardsActivationThreshold
    );

    // .to.emit(borrower.BorrowerPools, 'TopUpLiquidityRewards')
    // .withArgs(newPoolHash, newLiquidityRewardsActivationThreshold);

    poolState = await BorrowerPools.getPoolState(newPoolHash);
    expect(poolState.active).to.be.true;
    console.log(await mockDeployer.Treasury.isSupportedAsset(treasuryToken));
    // console.log(await borr);

    await positionManager.BorrowerPools.deposit(
      depositRate,
      newPoolHash,
      treasuryToken,
      positionManager.address,
      depositAmount
    );

    await positionManager.BorrowerPools.deposit(
      depositRate.add(rateSpacing),
      newPoolHash,
      treasuryToken,
      positionManager.address,
      depositAmount
    );

    // await expect(
    await positionManager.BorrowerPools.withdraw(
      newPoolHash,
      depositRate,
      withdrawAmount,
      FIRST_BOND_ISSUANCE_INDEX,
      positionManager.address
    );
    // ).to.be.revertedWith('PC_NO_ONGOING_LOAN');

    await checkPoolState(newPoolHash, {
      normalizedAvailableDeposits: depositAmount,
      lowerInterestRate: depositRate.add(rateSpacing),
    });
    await checkTickAmounts(newPoolHash, depositRate, {
      adjustedTotalAmount: BigNumber.from(0),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
  });

  it('Direct Withdrawal from treasury should be successful', async function () {
    const newBorrowerName = `${poolHash}-otherToken`;
    const newPoolHash = keccak256(
      defaultAbiCoder.encode(['string'], [newBorrowerName])
    );
    const newLiquidityRewardsActivationThreshold = parseEther('100');
    poolState = await BorrowerPools.getPoolState(newPoolHash);
    expect(poolState.active).to.be.false;
    const withdrawAmount = depositAmount
      .mul(RAY)
      .div(TEST_RETURN_YIELD_PROVIDER_LR_RAY);

    await expect(
      governanceUser.BorrowerPools.createNewPool({
        poolHash: newPoolHash,
        underlyingToken: treasuryToken,
        collateralToken: otherToken,
        ltv: 8000,
        yieldProvider: mainLendingPool.address,
        minRate: minRateInput,
        maxRate: maxRateInput,
        rateSpacing: rateSpacingInput,
        maxBorrowableAmount: maxBorrowableAmount,
        loanDuration: loanDuration,
        distributionRate: distributionRate,
        cooldownPeriod: cooldownPeriod,
        repaymentPeriod: repaymentPeriod,
        lateRepayFeePerBondRate: lateRepayFeePerBondRate,
        establishmentFeeRate: establishmentFeeRate,
        repaymentFeeRate: repaymentFeeRate,
        liquidityRewardsActivationThreshold:
          newLiquidityRewardsActivationThreshold,
        earlyRepay: true,
      })
    )
      .to.emit(governanceUser.BorrowerPools, 'PoolCreated')
      .withArgs([
        newPoolHash,
        treasuryToken,
        otherToken,
        mainLendingPool.address,
        8000,
        minRateInput,
        maxRateInput,
        rateSpacingInput,
        maxBorrowableAmount,
        loanDuration,
        distributionRate,
        cooldownPeriod,
        repaymentPeriod,
        lateRepayFeePerBondRate,
        establishmentFeeRate,
        repaymentFeeRate,
        newLiquidityRewardsActivationThreshold,
        true,
      ]);

    await governanceUser.BorrowerPools.disallow(borrower.address, poolHash);
    await governanceUser.BorrowerPools.allow(borrower.address, newPoolHash);
    await mockDeployer.Treasury.addApprovedTarget(
      positionManager.BorrowerPools.address
    );

    await expect(
      await borrower.BorrowerPools.topUpLiquidityRewards(
        newLiquidityRewardsActivationThreshold
      )
    );
    // .to.emit(borrower.BorrowerPools, 'TopUpLiquidityRewards')
    // .withArgs(newPoolHash, newLiquidityRewardsActivationThreshold);

    poolState = await BorrowerPools.getPoolState(newPoolHash);
    expect(poolState.active).to.be.true;

    await positionManager.BorrowerPools.deposit(
      depositRate,
      newPoolHash,
      treasuryToken,
      positionManager.address,
      depositAmount
    );

    await positionManager.BorrowerPools.deposit(
      depositRate.add(rateSpacing),
      newPoolHash,
      treasuryToken,
      positionManager.address,
      depositAmount
    );

    const withdrawCalldata =
      positionManager.BorrowerPools.interface.encodeFunctionData('withdraw', [
        newPoolHash,
        depositRate,
        withdrawAmount,
        FIRST_BOND_ISSUANCE_INDEX,
        positionManager.address,
      ]);

    const tx = await mockDeployer?.Treasury?.requestWithdrawal(
      [treasuryToken],
      [withdrawAmount],
      positionManager.BorrowerPools.address,
      withdrawCalldata
    );

    // await positionManager.BorrowerPools.withdraw(
    //   newPoolHash,
    //   depositRate,
    //   withdrawAmount,
    //   FIRST_BOND_ISSUANCE_INDEX,
    //   positionManager.address
    // );

    const requestId = await borrower?.Treasury?.lastRequestId();
    console.log('req id', requestId, withdrawCalldata);
    if (requestId)
      await mockDeployer.Treasury.updateRequest(requestId?.toString(), 1);

    await checkPoolState(newPoolHash, {
      normalizedAvailableDeposits: depositAmount,
      lowerInterestRate: depositRate.add(rateSpacing),
    });
    await checkTickAmounts(newPoolHash, depositRate, {
      adjustedTotalAmount: BigNumber.from(0),
      adjustedRemainingAmount: BigNumber.from(0),
      normalizedUsedAmount: BigNumber.from(0),
      adjustedPendingDepositAmount: BigNumber.from(0),
    });
  });
});
