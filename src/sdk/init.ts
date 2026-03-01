/**
 * CLMM SDK initialization for Byreal CLI
 * Singleton pattern - lazily initializes Chain instance
 */

import { Chain } from '../libs/clmm-sdk/client/index.js';
import { BYREAL_CLMM_PROGRAM_ID } from '../libs/clmm-sdk/constants.js';
import { getConnection } from '../core/solana.js';

let chainInstance: Chain | null = null;

/**
 * Get the Chain singleton instance
 * Uses connection from config and the Byreal CLMM program ID
 */
export function getChain(): Chain {
  if (chainInstance) return chainInstance;
  chainInstance = new Chain({
    connection: getConnection(),
    programId: BYREAL_CLMM_PROGRAM_ID,
  });
  return chainInstance;
}
