/**
 * Solana connection helpers for Byreal CLI
 */

import { Connection } from '@solana/web3.js';
import { loadConfig } from '../auth/config.js';
import { SOLANA_RPC_URL, DEFAULTS } from './constants.js';

let connectionInstance: Connection | null = null;

/**
 * Get a Solana Connection, reading rpc_url from config
 */
export function getConnection(): Connection {
  if (connectionInstance) return connectionInstance;

  let rpcUrl = SOLANA_RPC_URL;
  const configResult = loadConfig();
  if (configResult.ok && configResult.value.rpc_url) {
    rpcUrl = configResult.value.rpc_url;
  }

  connectionInstance = new Connection(rpcUrl, 'confirmed');
  return connectionInstance;
}

/**
 * Get slippage from config, fallback to default
 */
export function getSlippageBps(): number {
  const configResult = loadConfig();
  if (configResult.ok) {
    return configResult.value.defaults.slippage_bps;
  }
  return DEFAULTS.SLIPPAGE_BPS;
}

/**
 * Get priority fee from config, fallback to default
 */
export function getPriorityFeeMicroLamports(): number {
  const configResult = loadConfig();
  if (configResult.ok) {
    return configResult.value.defaults.priority_fee_micro_lamports;
  }
  return DEFAULTS.PRIORITY_FEE_MICRO_LAMPORTS;
}
