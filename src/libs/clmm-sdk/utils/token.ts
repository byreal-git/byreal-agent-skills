import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';

/**
 * Check if a mint is Token2022
 * @param mintAddress token mint address
 * @param connection Solana connection
 * @returns
 */
export async function isToken2022(mintAddress: string, connection: Connection): Promise<boolean> {
  const mintPubkey = new PublicKey(mintAddress);
  const info = await connection.getAccountInfo(mintPubkey);
  if (!info) return false;
  return info.owner.toBase58() === TOKEN_2022_PROGRAM_ID.toBase58();
}
