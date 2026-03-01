import { Connection, PublicKey } from '@solana/web3.js';

import { TickArrayBitmapExtensionLayout } from '../layout.js';
import { getPdaExBitmapAccount } from '../pda.js';

import { TickArrayBitmapExtensionType } from './models';

/**
 * @description Get the tick array bitmap extension
 *
 */
export async function getTickArrayBitmapExtension(
  programId: PublicKey,
  poolId: PublicKey,
  connection: Connection
): Promise<TickArrayBitmapExtensionType> {
  const exBitmapAddress = getPdaExBitmapAccount(programId, new PublicKey(poolId)).publicKey;
  const exBitmapInfo = await connection.getAccountInfo(exBitmapAddress);
  if (!exBitmapInfo) {
    throw new Error('exBitmapInfo not found');
  }
  const exBitmapInfoData = TickArrayBitmapExtensionLayout.decode(exBitmapInfo.data);
  return {
    poolId: new PublicKey(poolId),
    exBitmapAddress,
    positiveTickArrayBitmap: exBitmapInfoData.positiveTickArrayBitmap,
    negativeTickArrayBitmap: exBitmapInfoData.negativeTickArrayBitmap,
  };
}
