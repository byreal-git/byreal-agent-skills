import { PublicKey } from '@solana/web3.js';

import { SOLMint, WSOLMint } from '../constants.js';

export type PublicKeyish = PublicKey | string;

export function tryParsePublicKey(v: string): PublicKey | string {
  try {
    return new PublicKey(v);
  } catch {
    return v;
  }
}

export function solToWSol(mint: PublicKeyish): PublicKey {
  return validateAndParsePublicKey({ publicKey: mint, solToWSol: true });
}

/**
 * Validate and parse public key
 *
 * @param publicKey Public key
 * @param solToWSol Whether to convert SOL to WSOL
 */
export function validateAndParsePublicKey({
  publicKey: orgPubKey,
  solToWSol,
}: {
  publicKey: PublicKeyish;
  solToWSol?: boolean;
}): PublicKey {
  const publicKey = tryParsePublicKey(orgPubKey.toString());

  if (publicKey instanceof PublicKey) {
    if (solToWSol && publicKey.equals(SOLMint)) return WSOLMint;
    return publicKey;
  }

  if (solToWSol && publicKey.toString() === SOLMint.toBase58()) return WSOLMint;

  if (typeof publicKey === 'string') {
    if (publicKey === PublicKey.default.toBase58()) return PublicKey.default;
    try {
      const key = new PublicKey(publicKey);
      return key;
    } catch {
      throw new Error('invalid public key');
    }
  }

  throw new Error('invalid public key');
}
