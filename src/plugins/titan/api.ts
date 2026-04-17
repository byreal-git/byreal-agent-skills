/**
 * Titan Exchange API client — WebSocket-based swap quotes
 *
 * Titan streams quote updates via WebSocket. Each quote contains raw Solana
 * instructions + address lookup table addresses (not a pre-built transaction).
 * We build the VersionedTransaction ourselves from those fields.
 */

import {
  PublicKey,
  TransactionMessage,
  TransactionInstruction,
  VersionedTransaction,
  AddressLookupTableAccount,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { V1Client, types as titanTypes } from '@titanexchange/sdk-ts';
import { ByrealError, ErrorCodes } from '../../core/errors.js';
import { TITAN_WS_URL, TITAN_AUTH_TOKEN, DEFAULTS } from '../../core/constants.js';
import { getConnection } from '../../core/solana.js';
import type { Result } from '../../core/types.js';
import type { TitanSwapRoute, TitanSwapQuoteResult } from './types.js';

const TITAN_TIMEOUT_MS = 15_000;
const MAX_STREAM_UPDATES = 5;

// ============================================
// Swap Quote
// ============================================

export async function getSwapQuote(params: {
  inputMint: string;
  outputMint: string;
  amount: string;
  swapMode: 'ExactIn' | 'ExactOut';
  slippageBps: number;
  userPublicKey: string;
}): Promise<Result<TitanSwapQuoteResult, ByrealError>> {
  if (!TITAN_AUTH_TOKEN) {
    return {
      ok: false,
      error: new ByrealError({
        code: ErrorCodes.MISSING_REQUIRED,
        type: 'VALIDATION',
        message: 'Titan requires TITAN_AUTH_TOKEN environment variable. Set it in your shell profile or .env file.',
        retryable: false,
      }),
    };
  }

  const wsUrl = `${TITAN_WS_URL}?auth=${TITAN_AUTH_TOKEN}`;
  let client: InstanceType<typeof V1Client> | null = null;

  try {
    client = await withTimeout(
      V1Client.connect(wsUrl),
      TITAN_TIMEOUT_MS,
      'Titan WebSocket connection timed out',
    );

    const userPubkeyBytes = new PublicKey(params.userPublicKey).toBytes();
    const inputMintBytes = new PublicKey(params.inputMint).toBytes();
    const outputMintBytes = new PublicKey(params.outputMint).toBytes();

    const swapMode = params.swapMode === 'ExactIn'
      ? titanTypes.common.SwapMode.ExactIn
      : titanTypes.common.SwapMode.ExactOut;

    const { stream, streamId } = await withTimeout(
      client.newSwapQuoteStream({
        swap: {
          inputMint: inputMintBytes,
          outputMint: outputMintBytes,
          amount: BigInt(params.amount),
          swapMode,
          slippageBps: params.slippageBps,
        },
        transaction: {
          userPublicKey: userPubkeyBytes,
        },
        update: {
          num_quotes: 3,
        },
      }),
      TITAN_TIMEOUT_MS,
      'Titan quote request timed out',
    );

    // Pick the best route across stream updates.
    // Routes include instructions + ALTs; the pre-built `transaction` field
    // is not populated by the current Titan API, so we build it ourselves.
    let bestRoute: TitanSwapRoute | null = null;
    let updateCount = 0;

    // Redirect console.log → stderr for the entire SDK interaction.
    // The Titan SDK logs "Requested to cancel stream ..." to stdout
    // when the stream is cancelled, which corrupts piped JSON output.
    const origLog = console.log;
    console.log = (...args: unknown[]) => console.error(...args);

    // Wrap stream iteration in its own try-catch — the Titan SDK has known
    // bugs where stopStream / stream cleanup throws (ERR_INVALID_STATE,
    // "Invalid Stream ID"). These are harmless if we already got our data.
    try {
      for await (const quotes of stream) {
        updateCount++;
        const quoteMap = quotes.quotes as Record<string, TitanSwapRoute>;

        for (const [, route] of Object.entries(quoteMap)) {
          if (!route.instructions?.length) continue;

          if (!bestRoute) {
            bestRoute = route;
            continue;
          }

          if (swapMode === titanTypes.common.SwapMode.ExactIn) {
            if (route.outAmount > bestRoute.outAmount) bestRoute = route;
          } else {
            if (route.inAmount < bestRoute.inAmount) bestRoute = route;
          }
        }

        // Got a viable route — break immediately, let client.close() clean up
        if (bestRoute || updateCount >= MAX_STREAM_UPDATES) break;
      }
    } catch {
      // Tolerate SDK cleanup errors if we already collected a route
    }

    // Close connection before doing any on-chain work (fetch ALTs, blockhash)
    client.close().catch(() => {});
    client = null;

    // Restore console.log
    console.log = origLog;

    if (!bestRoute || !bestRoute.instructions?.length) {
      return {
        ok: false,
        error: new ByrealError({
          code: ErrorCodes.API_ERROR,
          type: 'NETWORK',
          message: 'No swap route returned from Titan.',
          retryable: true,
        }),
      };
    }

    // Build the VersionedTransaction from instructions + ALTs
    const transaction = await buildTransaction(
      bestRoute.instructions,
      bestRoute.addressLookupTables,
      params.userPublicKey,
      bestRoute.computeUnitsSafe ?? bestRoute.computeUnits,
    );

    return {
      ok: true,
      value: {
        inAmount: String(bestRoute.inAmount),
        outAmount: String(bestRoute.outAmount),
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        transaction,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown Titan error';
    return {
      ok: false,
      error: new ByrealError({
        code: ErrorCodes.NETWORK_ERROR,
        type: 'NETWORK',
        message: `Titan swap failed: ${message}`,
        retryable: true,
      }),
    };
  } finally {
    if (client) {
      client.close().catch(() => {});
    }
  }
}

// ============================================
// Transaction Builder
// ============================================

/**
 * Build a base64-encoded VersionedTransaction from Titan's compact
 * instruction format and address lookup table addresses.
 */
async function buildTransaction(
  instructions: TitanSwapRoute['instructions'],
  altAddresses: Uint8Array[],
  userPublicKey: string,
  computeUnits?: number,
): Promise<string> {
  const connection = getConnection();
  const payer = new PublicKey(userPublicKey);

  // Prepend compute budget instructions — Titan routes often need far more
  // than the default 200k CU limit (e.g. Titan-DART needs ~1.4M CU).
  const budgetInstructions: TransactionInstruction[] = [];
  if (computeUnits && computeUnits > 200_000) {
    budgetInstructions.push(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
    );
  }
  budgetInstructions.push(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: DEFAULTS.PRIORITY_FEE_MICRO_LAMPORTS }),
  );

  // Convert Titan compact instructions → Solana TransactionInstruction
  const txInstructions: TransactionInstruction[] = instructions.map((ix) => {
    const accounts = (ix.a || []).map((acc) => ({
      pubkey: new PublicKey(acc.p),
      isSigner: acc.s ?? false,
      isWritable: acc.w ?? false,
    }));

    return new TransactionInstruction({
      programId: new PublicKey(ix.p),
      keys: accounts,
      data: Buffer.from(ix.d),
    });
  });

  // Fetch address lookup tables from on-chain
  let lookupTableAccounts: AddressLookupTableAccount[] = [];
  if (altAddresses?.length) {
    const fetched = await Promise.all(
      altAddresses.map(async (addr) => {
        try {
          const result = await connection.getAddressLookupTable(new PublicKey(addr));
          return result.value;
        } catch {
          return null;
        }
      }),
    );
    lookupTableAccounts = fetched.filter(
      (t): t is AddressLookupTableAccount => t !== null,
    );
  }

  // Build VersionedTransaction (V0 with lookup tables)
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const messageV0 = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [...budgetInstructions, ...txInstructions],
  }).compileToV0Message(lookupTableAccounts);

  const tx = new VersionedTransaction(messageV0);
  return Buffer.from(tx.serialize()).toString('base64');
}

// ============================================
// Helpers
// ============================================

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

