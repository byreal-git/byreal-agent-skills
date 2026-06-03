import { describe, it, expect } from 'vitest';
import { VersionedTransaction, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { buildUnsignedSplTransfer } from './deposit-tx.js';

// Valid mainnet pubkeys (used only as 32-byte keys here).
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const FROM = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const DEPOSIT = 'So11111111111111111111111111111111111111112';
const BLOCKHASH = '11111111111111111111111111111111'; // 32-byte base58

function deserialize(b64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
}

describe('buildUnsignedSplTransfer', () => {
  it('recipient ATA exists → single transferChecked, payer=from, blockhash injected, unsigned', () => {
    const b64 = buildUnsignedSplTransfer({
      fromOwner: FROM,
      depositOwner: DEPOSIT,
      mint: USDC,
      amountRaw: '20000000', // 20 USDC (6 decimals)
      decimals: 6,
      blockhash: BLOCKHASH,
      recipientAtaExists: true,
    });
    const tx = deserialize(b64);
    expect(tx.message.recentBlockhash).toBe(BLOCKHASH);
    // exactly one instruction (transferChecked), no extra (validateSolanaTx is strict)
    expect(tx.message.compiledInstructions).toHaveLength(1);
    // payer is the first static account key
    expect(tx.message.staticAccountKeys[0].toBase58()).toBe(FROM);
    // unsigned: all signatures zeroed
    expect(tx.signatures.every((s) => s.every((b) => b === 0))).toBe(true);
  });

  it('recipient ATA missing → create-ATA prepended (2 instructions)', () => {
    const b64 = buildUnsignedSplTransfer({
      fromOwner: FROM,
      depositOwner: DEPOSIT,
      mint: USDC,
      amountRaw: '20000000',
      decimals: 6,
      blockhash: BLOCKHASH,
      recipientAtaExists: false,
    });
    const tx = deserialize(b64);
    expect(tx.message.compiledInstructions).toHaveLength(2);
  });

  it('transfers to the recipient ATA derived from the deposit owner', () => {
    const b64 = buildUnsignedSplTransfer({
      fromOwner: FROM,
      depositOwner: DEPOSIT,
      mint: USDC,
      amountRaw: '1000000',
      decimals: 6,
      blockhash: BLOCKHASH,
      recipientAtaExists: true,
    });
    const tx = deserialize(b64);
    const expectedRecipientAta = getAssociatedTokenAddressSync(
      new PublicKey(USDC),
      new PublicKey(DEPOSIT),
      true,
      TOKEN_PROGRAM_ID,
    ).toBase58();
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys).toContain(expectedRecipientAta);
  });

  it('is deterministic for fixed inputs', () => {
    const args = {
      fromOwner: FROM, depositOwner: DEPOSIT, mint: USDC,
      amountRaw: '20000000', decimals: 6, blockhash: BLOCKHASH, recipientAtaExists: true,
    };
    expect(buildUnsignedSplTransfer(args)).toBe(buildUnsignedSplTransfer(args));
  });
});
