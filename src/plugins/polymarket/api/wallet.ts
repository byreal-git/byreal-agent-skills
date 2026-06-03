/**
 * Byreal /wallet/* endpoints. Phase A uses only the PUBLIC reads:
 *   /wallet/status  → { walletAddress, proxyAddress, status }
 *   /wallet/address → { walletAddress, proxyAddress } (CREATE2, not derived)
 * deploy/apikey/approve are Phase B (write auth).
 */

import type { Result } from '../../../core/types.js';
import type { ByrealError } from '../../../core/errors.js';
import { pmGet, type PmGetOptions } from './gateway.js';
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
