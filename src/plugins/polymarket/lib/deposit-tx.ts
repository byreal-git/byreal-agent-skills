/**
 * Build an UNSIGNED Solana SPL transfer (V0 VersionedTransaction, base64) for a
 * Polymarket deposit: USDC from the user's wallet to the bridge deposit address.
 *
 * The backend validateSolanaTx is strict — program whitelist (System /
 * ComputeBudget / Token / ATA), exact recipient (ATA-derived), exact amount, no
 * stray instructions — so this builds the MINIMAL tx: a single transferChecked,
 * with an optional createAssociatedTokenAccount prepended only when the
 * recipient ATA is missing (ATA program is whitelisted). No compute-budget or
 * memo instructions.
 *
 * Pure: blockhash + recipientAtaExists are injected by the caller (the command
 * layer fetches a recent blockhash and checks the ATA on-chain), so the output
 * is deterministic and unit-testable. Signing happens later via privySignMany.
 */

import {
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

export interface BuildSplTransferParams {
  /** Sender wallet (Solana) — fee payer + transfer authority. */
  fromOwner: string;
  /** Bridge deposit address (recipient owner); recipient ATA is derived from it. */
  depositOwner: string;
  mint: string;
  /** Amount in raw smallest units (integer string). */
  amountRaw: string;
  decimals: number;
  /** Recent blockhash (injected; caller fetches it). */
  blockhash: string;
  /** Whether the recipient ATA already exists (injected; caller checks chain). */
  recipientAtaExists: boolean;
  /** SPL token program (default legacy TOKEN_PROGRAM_ID). */
  tokenProgramId?: PublicKey;
}

export function buildUnsignedSplTransfer(params: BuildSplTransferParams): string {
  const tokenProgram = params.tokenProgramId ?? TOKEN_PROGRAM_ID;
  const payer = new PublicKey(params.fromOwner);
  const depositOwner = new PublicKey(params.depositOwner);
  const mint = new PublicKey(params.mint);

  // allowOwnerOffCurve=true so the deposit address may be a PDA.
  const fromAta = getAssociatedTokenAddressSync(mint, payer, true, tokenProgram);
  const toAta = getAssociatedTokenAddressSync(mint, depositOwner, true, tokenProgram);

  const instructions: TransactionInstruction[] = [];

  if (!params.recipientAtaExists) {
    instructions.push(
      createAssociatedTokenAccountInstruction(payer, toAta, depositOwner, mint, tokenProgram),
    );
  }

  instructions.push(
    createTransferCheckedInstruction(
      fromAta,
      mint,
      toAta,
      payer,
      BigInt(params.amountRaw),
      params.decimals,
      [],
      tokenProgram,
    ),
  );

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: params.blockhash,
    instructions,
  }).compileToV0Message([]); // no address lookup tables

  const tx = new VersionedTransaction(message);
  return Buffer.from(tx.serialize()).toString('base64');
}
