/**
 * CLOB account reads for readiness/portfolio L2 (Phase B). /clob passthrough →
 * RAW Polymarket JSON. balance-allowance only the `balance` is consumed
 * (allowance is not a readiness checkpoint — full-approved at deploy).
 */

import type { Result } from '../../../core/types.js';
import type { ByrealError } from '../../../core/errors.js';
import type { BalanceAllowance } from '../types.js';
import { pmGet, type PmWriteAuth } from './gateway.js';

/**
 * signature_type for balance-allowance — the gateway/CLOB parses this as a
 * NUMBER. POLY_1271 = 3 (Safe/proxy). ⚠️ The string 'POLY_1271' is silently read
 * as a different type → returns the EOA's (empty) balance instead of the proxy's,
 * which manifests as balance=0 + allowances=0. Must send the numeric '3'
 * (matches the frontend, verified live 2026-06-09).
 */
const SIGNATURE_TYPE_POLY_1271 = '3';

/** GET /clob/balance-allowance?asset_type=&signature_type=3(&token_id=). Raw /clob body. */
export function getBalanceAllowance(
  assetType: 'COLLATERAL' | 'CONDITIONAL',
  tokenId: string | undefined,
  auth: PmWriteAuth,
): Promise<Result<BalanceAllowance, ByrealError>> {
  const params: Record<string, string> = { asset_type: assetType, signature_type: SIGNATURE_TYPE_POLY_1271 };
  if (assetType === 'CONDITIONAL' && tokenId) params.token_id = tokenId;
  return pmGet<BalanceAllowance>('clob', '/balance-allowance', params, {
    headers: { Authorization: `Bearer ${auth.token}`, 'x-evm-address': auth.evmAddress },
  });
}

/**
 * GET /clob/balance-allowance/update — triggers a backend balance/allowance cache
 * refresh. Used after a 400 insufficient-balance to re-sync before one
 * retry. Returns are ignored (the call is the side effect).
 */
export function syncBalanceAllowance(
  assetType: 'COLLATERAL' | 'CONDITIONAL',
  tokenId: string | undefined,
  auth: PmWriteAuth,
): Promise<Result<unknown, ByrealError>> {
  const params: Record<string, string> = { asset_type: assetType, signature_type: SIGNATURE_TYPE_POLY_1271 };
  if (assetType === 'CONDITIONAL' && tokenId) params.token_id = tokenId;
  return pmGet<unknown>('clob', '/balance-allowance/update', params, {
    headers: { Authorization: `Bearer ${auth.token}`, 'x-evm-address': auth.evmAddress },
  });
}
