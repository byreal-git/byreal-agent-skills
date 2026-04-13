/**
 * Rent reclaim — scan empty token accounts and build close instructions
 */

import {
  AccountLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createCloseAccountInstruction,
} from '@solana/spl-token';
import {
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { getConnection } from '../../core/solana.js';

// Accounts to never close (even if empty)
const ACCOUNT_EXCEPTIONS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'So11111111111111111111111111111111111111112',     // wSOL
]);

// ~0.00203928 SOL per token account rent
const RENT_PER_ACCOUNT_SOL = 0.00203928;
const MAX_INSTRUCTIONS_PER_TX = 5;

export interface EmptyAccountInfo {
  pubkey: string;
  mint: string;
  programId: string;
}

export interface ReclaimScanResult {
  emptyAccounts: EmptyAccountInfo[];
  estimatedRentSol: number;
  splCount: number;
  token2022Count: number;
}

/**
 * Scan wallet for empty token accounts
 */
export async function scanEmptyAccounts(
  walletAddress: string,
  options: {
    includeToken2022?: boolean;
    excludeMints?: string[];
  } = {},
): Promise<ReclaimScanResult> {
  const connection = getConnection();
  const owner = new PublicKey(walletAddress);
  const exceptions = new Set([...ACCOUNT_EXCEPTIONS, ...(options.excludeMints ?? [])]);

  // Scan SPL Token accounts
  const splAccounts = await findEmptyAccounts(connection, owner, TOKEN_PROGRAM_ID, exceptions);

  // Optionally scan Token-2022 accounts
  let token2022Accounts: EmptyAccountInfo[] = [];
  if (options.includeToken2022) {
    token2022Accounts = await findEmptyAccounts(connection, owner, TOKEN_2022_PROGRAM_ID, exceptions);
  }

  const allEmpty = [...splAccounts, ...token2022Accounts];

  return {
    emptyAccounts: allEmpty,
    estimatedRentSol: allEmpty.length * RENT_PER_ACCOUNT_SOL,
    splCount: splAccounts.length,
    token2022Count: token2022Accounts.length,
  };
}

/**
 * Build unsigned transactions to close empty accounts
 */
export async function buildCloseTransactions(
  walletAddress: string,
  emptyAccounts: EmptyAccountInfo[],
): Promise<string[]> {
  if (emptyAccounts.length === 0) return [];

  const connection = getConnection();
  const owner = new PublicKey(walletAddress);
  const { blockhash } = await connection.getLatestBlockhash();

  const transactions: string[] = [];

  // Batch into multiple transactions
  for (let i = 0; i < emptyAccounts.length; i += MAX_INSTRUCTIONS_PER_TX) {
    const batch = emptyAccounts.slice(i, i + MAX_INSTRUCTIONS_PER_TX);
    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = owner;

    for (const account of batch) {
      const programId = new PublicKey(account.programId);
      tx.add(
        createCloseAccountInstruction(
          new PublicKey(account.pubkey),
          owner, // destination: rent goes back to wallet
          owner, // authority
          [],
          programId,
        ),
      );
    }

    // Serialize unsigned
    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    transactions.push(serialized.toString('base64'));
  }

  return transactions;
}

// ============================================
// Internal helpers
// ============================================

async function findEmptyAccounts(
  connection: ReturnType<typeof getConnection>,
  owner: PublicKey,
  programId: PublicKey,
  exceptions: Set<string>,
): Promise<EmptyAccountInfo[]> {
  const result: EmptyAccountInfo[] = [];

  const response = await connection.getTokenAccountsByOwner(
    owner,
    { programId },
    'confirmed',
  );

  for (const { pubkey, account } of response.value) {
    const data = AccountLayout.decode(account.data);
    if (data.amount === BigInt(0) && !exceptions.has(data.mint.toString())) {
      result.push({
        pubkey: pubkey.toString(),
        mint: data.mint.toString(),
        programId: programId.toString(),
      });
    }
  }

  return result;
}
