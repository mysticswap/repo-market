import debugModule from 'debug';
import {DeployFunction} from 'hardhat-deploy/types';
import {HardhatRuntimeEnvironment} from 'hardhat/types';
import {Contract} from 'ethers';
require('dotenv').config();

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const log = debugModule('deploy-setup');
  log.enabled = true;

  const {deployments, ethers} = hre;
  const {deploy} = deployments;
  const {getNamedAccounts} = hre;

  // keep ts support on hre members
  const {deployer} = await getNamedAccounts();

  const ZERO_ADDRESS = ethers.constants.AddressZero;

  // deploy LendingPool
  const PoolWrapper = await deploy('LendingPool', {
    contract: 'LendingPool',
    from: deployer,
    log: true,
    args: [ZERO_ADDRESS],
  });

  log('LendingPool contract: ' + PoolWrapper.address);

  const otherContracts = process.env.OTHER_CONTRACTS
    ? process.env.OTHER_CONTRACTS.split(',')
    : [];
  // deploy Treasury
  const Treasury = await deploy('Treasury', {
    contract: 'Treasury',
    from: deployer,
    log: true,
    args: [
      PoolWrapper.address, //Replace with custody wallet env
      PoolWrapper.address,
      [deployer],
      [PoolWrapper.address, ...otherContracts], //update all .env
    ],
  });

  log('Treasury contract: ' + Treasury.address);

  // Load the deployed Treasury contract
  const poolWrapperContract = await ethers.getContractAt(
    'LendingPool',
    PoolWrapper.address
  );

  // Call updateTreasury function
  try {
    const tx = await poolWrapperContract.updateTreasury(Treasury.address);
    await tx.wait();
    log('Successfully called updateTreasury');
  } catch (error) {
    log('Error calling updateTreasury:', error);
    throw error;
  }
};

func.tags = ['LendingPool', 'Treasury'];
export default func;
