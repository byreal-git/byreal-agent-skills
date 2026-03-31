/**
 * Transaction utilities for Byreal CLI (openclaw branch)
 * Handles deserialization and serialization only — no signing or sending.
 */

import { VersionedTransaction } from '@solana/web3.js';
import { ok, err } from './types.js';
import type { Result } from './types.js';
import { ByrealError, transactionError } from './errors.js';

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
 * Serialize a versioned transaction to Base64
 */
export function serializeTransaction(tx: VersionedTransaction): string {
  return Buffer.from(tx.serialize()).toString('base64');
}
