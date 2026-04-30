/**
 * Public surface of the Privy proxy module.
 */

export type {
  PrivyConfig,
  PrivyContext,
  RealclawConfig,
  RealclawWallet,
  SignSolanaTransactionRequest,
  SignSolanaTransactionResponse,
} from './types.js';

export {
  loadAgentToken,
  loadPrivyConfig,
  loadRealclawConfig,
  loadSkillAgentTokenConfig,
  isPrivyAvailable,
} from './config.js';

export { signTransaction, signAndBroadcast } from './client.js';

export {
  getPrivyContext,
  requirePrivyContext,
  privyBroadcastOne,
  privyBroadcastMany,
  privySignMany,
  type BroadcastOneResult,
  type BroadcastManyResult,
  type SignManyResult,
} from './execute.js';
