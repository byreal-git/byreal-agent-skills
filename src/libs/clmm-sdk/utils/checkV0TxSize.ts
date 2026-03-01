import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

export const MAX_BASE64_SIZE = 1644;

export function checkV0TxSize({
  instructions,
  payer,
  recentBlockhash = Keypair.generate().publicKey.toString(),
}: {
  instructions: TransactionInstruction[];
  payer: PublicKey;
  recentBlockhash?: string;
}): boolean {
  const transactionMessage = new TransactionMessage({
    payerKey: payer,
    recentBlockhash,
    instructions,
  });

  const messageV0 = transactionMessage.compileToV0Message();
  try {
    const buildLength = Buffer.from(new VersionedTransaction(messageV0).serialize()).toString(
      'base64'
    ).length;
    return buildLength < MAX_BASE64_SIZE;
  } catch {
    return false;
  }
}
