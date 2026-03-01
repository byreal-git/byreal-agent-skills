import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

/**
 * Estimate compute units required for a transaction
 * @param connection - Solana connection instance
 * @param instructions - Instructions to estimate
 * @param payerPublicKey - Payer public key
 * @param _blockhash - Optional blockhash
 * @returns Estimated compute unit count
 */
export async function estimateComputeUnits(
  connection: Connection,
  instructions: TransactionInstruction[],
  payerPublicKey: PublicKey,
  _blockhash?: string
): Promise<number> {
  try {
    const blockhash = _blockhash || (await connection.getLatestBlockhash()).blockhash;

    const filteredInstructions = instructions.filter((ix) => {
      if (!ix.programId.equals(ComputeBudgetProgram.programId)) {
        return true;
      }

      const instructionType = ix.data[0];
      return instructionType !== 2; // Keep if not setComputeUnitLimit
    });

    const simulationInstructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), // Max CU limit
      ...filteredInstructions,
    ];

    const messageV0 = new TransactionMessage({
      payerKey: payerPublicKey,
      recentBlockhash: blockhash,
      instructions: simulationInstructions,
    }).compileToV0Message();

    const simulationTx = new VersionedTransaction(messageV0);

    // Simulate transaction execution with max CU limit
    const simulation = await connection.simulateTransaction(simulationTx);

    if (simulation.value.logs && simulation.value.unitsConsumed) {
      const consumedUnits = simulation.value.unitsConsumed;

      // Calculate final CU limit with safety margin
      const estimatedUnits = Math.min(
        Math.max(
          consumedUnits + 100_000, // 100k buffer for safety
          Math.ceil(consumedUnits * 1.3) // 30% buffer
        ),
        1_400_000 // Solana transaction max CU limit
      );

      return Math.max(estimatedUnits, 100_000); // Ensure at least 100k CU
    }

    return 400_000;
  } catch (error) {
    console.warn('Estimate compute units failed, using default value:', error);
    return 400_000;
  }
}
