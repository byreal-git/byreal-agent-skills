/**
 * Byreal /wallet/* endpoints. Phase A uses only the PUBLIC reads:
 *   /wallet/status  → { walletAddress, proxyAddress, status }
 *   /wallet/address → { walletAddress, proxyAddress } (CREATE2, not derived)
 * deploy/apikey/approve are Phase B (write auth).
 */

import { ok } from '../../../core/types.js';
import type { Result } from '../../../core/types.js';
import type { ByrealError } from '../../../core/errors.js';
import { pmGet, pmWrite, type PmGetOptions, type PmWriteAuth } from './gateway.js';
import { unwrapBusiness, type PmEnvelope } from './envelope.js';

export type WalletStatus =
  | 'UNINITIALIZED'
  | 'API_KEY_CREATING'
  | 'PROXY_DEPLOYING'
  | 'APPROVING'
  | 'READY'
  | 'FAILED'
  | string;

export interface WalletStatusDTO {
  walletAddress: string;
  proxyAddress?: string;
  status: WalletStatus;
}

export interface WalletAddressDTO {
  walletAddress: string;
  proxyAddress?: string;
}

export async function getWalletStatus(
  eoa: string,
  opts?: PmGetOptions,
): Promise<Result<WalletStatusDTO, ByrealError>> {
  const r = await pmGet<PmEnvelope<WalletStatusDTO>>('v1', '/wallet/status', { walletAddress: eoa }, opts);
  if (!r.ok) return r;
  return unwrapBusiness(r.value);
}

export async function getWalletAddress(
  eoa: string,
  opts?: PmGetOptions,
): Promise<Result<WalletAddressDTO, ByrealError>> {
  const r = await pmGet<PmEnvelope<WalletAddressDTO>>('v1', '/wallet/address', { walletAddress: eoa }, opts);
  if (!r.ok) return r;
  return unwrapBusiness(r.value);
}

/**
 * POST /wallet/deploy — async deploy of the proxy/deposit wallet (API key →
 * Safe deploy → approvals). Returns current status; CLI polls /wallet/status to
 * READY. 40901 = "already deploying" → treated as idempotent success (docs/05 §5.2,
 * docs/02 A2). Write auth (Bearer + x-evm-address).
 */
export async function deployWallet(
  auth: PmWriteAuth,
): Promise<Result<WalletStatusDTO, ByrealError>> {
  const r = await pmWrite<PmEnvelope<WalletStatusDTO>>(
    'POST',
    'v1',
    '/wallet/deploy',
    { walletAddress: auth.evmAddress },
    auth,
  );
  if (!r.ok) return r;
  const env = r.value;
  if (env.ret_code === 40901) {
    // Idempotent: a deploy is already in progress — treat as success.
    return ok(env.data ?? { walletAddress: auth.evmAddress, status: 'PROXY_DEPLOYING' });
  }
  return unwrapBusiness(env);
}
