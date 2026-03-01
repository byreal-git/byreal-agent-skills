/**
 * Get the list of positions for a specified user (on-chain way)
 */

import { userAddress, chain } from './config.js';

async function main(): Promise<void> {
  // Get the list of positions for a specified user
  console.log('userAddress =>', userAddress.toBase58());
  const positionList = await chain.getRawPositionInfoListByUserAddress(userAddress);
  console.log(positionList);
}

main();
