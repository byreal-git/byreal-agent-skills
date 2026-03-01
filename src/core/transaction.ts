/**
 * Transaction utilities for Byreal CLI
 * Handles deserialization, signing, and sending of Solana transactions
 */

import {
  VersionedTransaction,
  type Connection,
  type Keypair,
} from '@solana/web3.js';
import { ok, err } from './types.js';
import type { Result } from './types.js';
import { ByrealError, transactionError, transactionTimeoutError } from './errors.js';

/**
 * Deserialize a Base64-encoded transaction
 */
export function deserializeTransaction(base64Tx: string): Result<VersionedTransaction, ByrealError> {
  try {
    const buffer = Buffer.from(base64Tx, 'base64');
    const tx = VersionedTransaction.deserialize(buffer);
    return ok(tx);
  } catch (e) {
    return err(transactionError(`Failed to deserialize transaction: ${(e as Error).message}`));
  }
}

/**
 * Sign a versioned transaction with a keypair
 */
export function signTransaction(tx: VersionedTransaction, keypair: Keypair): VersionedTransaction {
  tx.sign([keypair]);
  return tx;
}

/**
 * Serialize a versioned transaction to Base64
 */
export function serializeTransaction(tx: VersionedTransaction): string {
  return Buffer.from(tx.serialize()).toString('base64');
}

/**
 * Send and confirm a signed transaction
 */
export async function sendAndConfirmTransaction(
  connection: Connection,
  signedTx: VersionedTransaction,
  options?: {
    skipPreflight?: boolean;
    maxRetries?: number;
    confirmationTimeoutMs?: number;
  }
): Promise<Result<{ signature: string; confirmed: boolean }, ByrealError>> {
  const timeoutMs = options?.confirmationTimeoutMs ?? 60000;

  try {
    const signature = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: options?.skipPreflight ?? false,
      maxRetries: options?.maxRetries ?? 3,
    });

    if (process.env.DEBUG) {
      console.error(`[DEBUG] Transaction sent: ${signature}`);
    }

    // Wait for confirmation
    const startTime = Date.now();
    const result = await connection.confirmTransaction(
      {
        signature,
        blockhash: signedTx.message.recentBlockhash,
        lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
      },
      'confirmed'
    );

    if (result.value.err) {
      return err(transactionError(
        `Transaction confirmed but failed: ${JSON.stringify(result.value.err)}`,
        signature
      ));
    }

    const elapsed = Date.now() - startTime;
    if (process.env.DEBUG) {
      console.error(`[DEBUG] Transaction confirmed in ${elapsed}ms`);
    }

    return ok({ signature, confirmed: true });
  } catch (e) {
    const message = (e as Error).message || 'Unknown error';
    if (message.includes('timeout') || message.includes('Timeout')) {
      return err(transactionTimeoutError());
    }
    return err(transactionError(message));
  }
}
