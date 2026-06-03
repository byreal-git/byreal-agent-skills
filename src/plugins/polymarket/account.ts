/**
 * EOA (Polygon) + proxy-wallet resolution for polymarket read commands.
 *
 * EOA comes from --evm-wallet-address or the realclaw-config evm wallet.
 * The proxy wallet is resolved via the PUBLIC /wallet/status (CREATE2, not
 * derived locally). EVM addresses are validated by shape only — never via
 * new PublicKey() (that is a Solana check and throws on hex EOAs).
 */

import { ok, err } from '../../core/types.js';
import type { Result } from '../../core/types.js';
import type { ByrealError } from '../../core/errors.js';
import { validationError, proxyWalletUnavailableError } from '../../core/errors.js';
import { loadEvmWallet } from '../../privy/config.js';
import { getWalletStatus, type WalletStatus } from './api/wallet.js';
import { isEvmAddress } from './formatters.js';

/** Resolve the EVM EOA from the CLI flag or realclaw-config; validate shape. */
export function resolveEoa(evmWalletAddress?: string): Result<string, ByrealError> {
  const addr = evmWalletAddress ?? loadEvmWallet()?.address;
  if (!addr) {
    return err(
      validationError(
        'No EVM wallet address. Pass --evm-wallet-address or configure a type:"evm" wallet in realclaw-config.json',
        'evm-wallet-address',
      ),
    );
  }
  if (!isEvmAddress(addr)) {
    return err(validationError(`Invalid EVM address: ${addr}`, 'evm-wallet-address'));
  }
  return ok(addr);
}

export interface ResolvedProxy {
  eoa: string;
  proxyAddress: string;
  status: WalletStatus;
}

/** Resolve the proxy wallet (READY-or-not) via public /wallet/status. */
export async function resolveProxy(
  evmWalletAddress?: string,
): Promise<Result<ResolvedProxy, ByrealError>> {
  const eoaR = resolveEoa(evmWalletAddress);
  if (!eoaR.ok) return eoaR;
  const eoa = eoaR.value;

  const statusR = await getWalletStatus(eoa);
  if (!statusR.ok) return statusR;
  const { proxyAddress, status } = statusR.value;
  if (!proxyAddress) return err(proxyWalletUnavailableError(eoa));

  return ok({ eoa, proxyAddress, status });
}
