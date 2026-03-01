import { PublicKey } from '@solana/web3.js';

export function findProgramAddress(
  seeds: Array<Buffer | Uint8Array>,
  programId: PublicKey
): {
  publicKey: PublicKey;
  nonce: number;
} {
  const [publicKey, nonce] = PublicKey.findProgramAddressSync(seeds, programId);
  return { publicKey, nonce };
}

export * from './binaryUtils.js';
export * from './liquidityMath.js';
export * from './mathUtils.js';
export * from './poolUtils.js';
export * from './sqrtPriceMath.js';
export * from './tickMath.js';
export * from './tick.js';
export * from './tickarrayBitmap.js';
export * from './transfer.js';
export * from './position.js';
export * from './getTickArrayInfo.js';
export * from './swapMath.js';
export * from './getTickArrayBitmapExtension.js';
export * from './tickArrayUtils.js';
export * from './models.js';
