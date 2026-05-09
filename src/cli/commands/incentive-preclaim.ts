/**
 * Best-effort incentive preclaim before zap-out close.
 *
 * Mirrors apps/web/src/features/incentive-preclaim/hooks/useBestEffortIncentivePreclaim.ts:
 *  - no unclaimed rewards -> not_needed
 *  - has unclaimed rewards -> reuse the positions claim-rewards pipeline
 *    (encodeReward type=1 -> signTxs -> submitRewardOrder); on failure
 *    return best-effort and let the main flow continue.
 *
 * The CLI signs locally with the user's keypair, so a signing failure is a
 * SYSTEM-level error and surfaces as such (fail-fast, not best-effort).
 */
import chalk from 'chalk';
import type { Keypair, PublicKey } from '@solana/web3.js';

import { api } from '../../api/endpoints.js';
import {
  deserializeTransaction,
  signTransaction,
  serializeTransaction,
} from '../../core/transaction.js';

export type IncentivePreclaimStatus =
  | 'not_needed'
  | 'claimed'
  | 'claim_failed';

export interface IncentivePreclaimResult {
  status: IncentivePreclaimStatus;
  /** Whether the caller may proceed with the main flow. claim_failed still returns true (best-effort). */
  canContinue: boolean;
  unclaimedCount: number;
  orderCode?: string;
  signatures?: string[];
  errorMessage?: string;
}

/**
 * Check whether the given position has unclaimed incentives, and if so submit
 * an incentive-claim transaction first.
 *
 * @param walletAddress    Owner wallet address (base58).
 * @param walletKeypair    Local signing keypair.
 * @param positionAddress  Target position PDA (base58); only this one is checked.
 * @param verbose          When true, print progress (table-mode only).
 */
export async function runIncentivePreclaim(
  walletAddress: string,
  walletKeypair: Keypair,
  positionAddress: string,
  verbose: boolean = true,
): Promise<IncentivePreclaimResult> {
  // 1) Query unclaimed rewards
  const unclaimedResult = await api.getUnclaimedData(walletAddress);
  if (!unclaimedResult.ok) {
    if (verbose) {
      console.log(
        chalk.yellow(
          `\n  [preclaim] Failed to query unclaimed rewards: ${unclaimedResult.error.message}. Skipping preclaim and proceeding with close.`,
        ),
      );
    }
    return {
      status: 'claim_failed',
      canContinue: true,
      unclaimedCount: 0,
      errorMessage: unclaimedResult.error.message,
    };
  }

  const { unclaimedOpenIncentives } = unclaimedResult.value;

  // Filter rewards belonging to this position with non-zero unclaimed amount
  const relevant = unclaimedOpenIncentives.filter((item) => {
    if (item.positionAddress !== positionAddress) return false;
    const unclaimed =
      parseFloat(item.syncedTokenAmount) -
      parseFloat(item.lockedTokenAmount) -
      parseFloat(item.claimedTokenAmount);
    return unclaimed > 0;
  });

  if (relevant.length === 0) {
    return { status: 'not_needed', canContinue: true, unclaimedCount: 0 };
  }

  if (verbose) {
    console.log(
      chalk.cyan(
        `\n  [preclaim] Position has ${relevant.length} unclaimed incentive reward${relevant.length > 1 ? 's' : ''}. Claiming before close...`,
      ),
    );
  }

  // 2) Encode reward claim txs
  const encodeResult = await api.encodeReward({
    walletAddress,
    positionAddresses: [positionAddress],
    type: 1,
  });

  if (!encodeResult.ok) {
    if (verbose) {
      console.log(
        chalk.yellow(
          `  [preclaim] Encode failed: ${encodeResult.error.message}. Continuing with close (best-effort).`,
        ),
      );
    }
    return {
      status: 'claim_failed',
      canContinue: true,
      unclaimedCount: relevant.length,
      errorMessage: encodeResult.error.message,
    };
  }

  const { orderCode, rewardEncodeItems } = encodeResult.value;
  if (rewardEncodeItems.length === 0) {
    return {
      status: 'not_needed',
      canContinue: true,
      unclaimedCount: relevant.length,
      orderCode,
    };
  }

  // 3) Sign + serialize each tx
  const signedPayloads: {
    txCode: string;
    poolAddress: string;
    signedTx: string;
  }[] = [];
  for (const item of rewardEncodeItems) {
    const txResult = deserializeTransaction(item.txPayload);
    if (!txResult.ok) {
      if (verbose) {
        console.log(
          chalk.yellow(
            `  [preclaim] Failed to deserialize claim tx (pool ${item.poolAddress}): ${txResult.error.message}. Continuing with close (best-effort).`,
          ),
        );
      }
      return {
        status: 'claim_failed',
        canContinue: true,
        unclaimedCount: relevant.length,
        orderCode,
        errorMessage: txResult.error.message,
      };
    }
    const signed = signTransaction(txResult.value, walletKeypair);
    signedPayloads.push({
      txCode: item.txCode,
      poolAddress: item.poolAddress,
      signedTx: serializeTransaction(signed),
    });
  }

  // 4) Submit
  const orderResult = await api.submitRewardOrder({
    orderCode,
    walletAddress,
    signedTxPayload: signedPayloads,
  });

  if (!orderResult.ok) {
    if (verbose) {
      console.log(
        chalk.yellow(
          `  [preclaim] Submit failed: ${orderResult.error.message}. Continuing with close (best-effort).`,
        ),
      );
    }
    return {
      status: 'claim_failed',
      canContinue: true,
      unclaimedCount: relevant.length,
      orderCode,
      errorMessage: orderResult.error.message,
    };
  }

  const signatures = orderResult.value.txList
    .map((t) => t.txSignature)
    .filter((s): s is string => !!s);

  if (verbose) {
    console.log(
      chalk.green(
        `  [preclaim] Claimed ${relevant.length} incentive reward${relevant.length > 1 ? 's' : ''} ─ ${signatures.length} tx${signatures.length > 1 ? 's' : ''} sent.`,
      ),
    );
    for (const sig of signatures) {
      console.log(chalk.gray(`    https://solscan.io/tx/${sig}`));
    }
  }

  return {
    status: 'claimed',
    canContinue: true,
    unclaimedCount: relevant.length,
    orderCode,
    signatures,
  };
}

/**
 * Lightweight read-only variant for dry-run preview: only query unclaimed
 * count, do not encode/sign/submit anything.
 */
export async function previewIncentivePreclaim(
  walletAddress: string,
  positionAddress: string,
): Promise<{ unclaimedCount: number; willPreclaim: boolean }> {
  const result = await api.getUnclaimedData(walletAddress);
  if (!result.ok) return { unclaimedCount: 0, willPreclaim: false };
  const { unclaimedOpenIncentives } = result.value;
  const relevant = unclaimedOpenIncentives.filter((item) => {
    if (item.positionAddress !== positionAddress) return false;
    const u =
      parseFloat(item.syncedTokenAmount) -
      parseFloat(item.lockedTokenAmount) -
      parseFloat(item.claimedTokenAmount);
    return u > 0;
  });
  return { unclaimedCount: relevant.length, willPreclaim: relevant.length > 0 };
}
