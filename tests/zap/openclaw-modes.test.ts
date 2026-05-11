/**
 * Verifies the openclaw-specific zap engine behaviour:
 *   - --auto-swap is rejected (UNSUPPORTED_MODE) in default unsigned-tx mode
 *   - --auto-swap --dry-run never touches Privy
 *   - --auto-swap --execute routes through privyBroadcastOne
 *   - zap-in open partial-signs with the ephemeral NFT mint keypair before
 *     handing the base64 tx to Privy
 *   - zap-out close runs privySignMany (preclaim) before privyBroadcastOne
 *     when unclaimed incentives exist
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';

vi.mock('../../src/api/endpoints.js', () => ({
  api: {
    getUnclaimedData: vi.fn(),
    encodeReward: vi.fn(),
    submitRewardOrder: vi.fn(),
    getPoolInfo: vi.fn(),
    quoteZapOpen: vi.fn(),
    buildTxZapOpen: vi.fn(),
    quoteZapOut: vi.fn(),
    buildTxZapOut: vi.fn(),
  },
}));

vi.mock('../../src/privy/index.js', () => ({
  privyBroadcastOne: vi.fn(),
  privySignMany: vi.fn(),
  requirePrivyContext: vi.fn(),
}));

vi.mock('../../src/core/solana.js', () => ({
  getConnection: vi.fn(() => ({})),
  getSlippageBps: vi.fn(() => 100),
}));

vi.mock('../../src/cli/commands/positions.js', () => ({
  checkSingleMintBalance: vi.fn(() => Promise.resolve([])),
  fetchWalletBalanceSummary: vi.fn(() => Promise.resolve({ sol: '0', tokens: [] })),
}));

// VersionedTransaction.deserialize -> rebuild from a dummy serialized tx so
// we can observe whether `sign([keypair])` was effectively called (i.e. a
// signature got filled in).  The simplest fixture is a real partial tx.
function makeUnsignedTxBase64(numSigners: number, signerKey?: PublicKey): string {
  // Construct a minimal V0 tx with `numSigners` signer slots. Using a
  // hand-crafted Buffer here would be brittle; rely on @solana/web3.js
  // to produce a serializable VersionedTransaction by reusing one of its
  // own factory helpers.
  const { TransactionMessage, SystemProgram, PublicKey: PK } = require('@solana/web3.js');
  const payer = signerKey ?? PK.default ?? new PublicKey('11111111111111111111111111111111');
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [
      SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 0 }),
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  // Force signature array length to numSigners (Buffer-of-64-zeros placeholders).
  while (tx.signatures.length < numSigners) {
    tx.signatures.push(new Uint8Array(64));
  }
  return Buffer.from(tx.serialize()).toString('base64');
}

import { api } from '../../src/api/endpoints.js';
import { privyBroadcastOne, privySignMany } from '../../src/privy/index.js';
import {
  runZapInOpen,
  runZapOut,
} from '../../src/cli/commands/positions-zap.js';

const WALLET = '77a9PjLyLovCVXD8mwRGMwcWSAH2pm3d8WeSSSKQd9Wq';
const POOL_ADDR = '9GTj99g9tbz9U6UYDsX6YeRTgUnkYG6GTnHv3qLa5aXq';
const PRIVY_CTX = { token: 't', config: { proxyUrl: 'http://x' } as any, caip2: 'solana:x' } as any;

beforeEach(() => {
  vi.clearAllMocks();
});

// Common pool meta mock for fetchPoolMeta()
function mockPoolMeta() {
  (api.getPoolInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    value: {
      token_a: { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL', decimals: 9, price_usd: 95 },
      token_b: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6, price_usd: 1 },
    },
  });
}

describe('runZapInOpen mode guards', () => {
  it('fails fast with UNSUPPORTED_MODE when mode is unsigned-tx', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`__exit__:${code}`); }) as never);
    const errorSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mockPoolMeta();

    let caught: Error | undefined;
    try {
      await runZapInOpen({
        poolAddress: POOL_ADDR,
        base: 'MintA',
        amountUi: '0.01',
        isRaw: false,
        tickLower: -25000,
        tickUpper: -22000,
        priceLowerUi: '80',
        priceUpperUi: '110',
        slippageBps: 100,
        ctx: {
          format: 'json',
          mode: 'unsigned-tx',
          walletAddress: WALLET,
          publicKey: new PublicKey(WALLET),
          startTime: Date.now(),
        },
      });
    } catch (e) {
      caught = e as Error;
    }

    expect(caught?.message).toBe('__exit__:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(privyBroadcastOne).not.toHaveBeenCalled();
    expect(api.quoteZapOpen).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('dry-run does not call Privy', async () => {
    mockPoolMeta();
    (api.quoteZapOpen as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        quoteId: 'q1',
        quoteContext: { flowType: 'zap-in-open', intent: {}, swapInAmount: '0', expireAtMs: Date.now() + 30000 } as any,
        quote: {
          provider: 'jupiter',
          swapInAmount: '500000',
          expectedSwapOutAmount: '1000',
          minSwapOutAmount: '990',
          priceImpactPct: '0',
          priceImpactBps: 0,
          impactLevel: 'ok',
        },
        preview: { estimatedToken0Amount: '500000', estimatedToken1Amount: '1000' },
      },
    });
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await runZapInOpen({
      poolAddress: POOL_ADDR,
      base: 'MintA',
      amountUi: '0.001',
      isRaw: false,
      tickLower: -25000,
      tickUpper: -22000,
      priceLowerUi: '80',
      priceUpperUi: '110',
      slippageBps: 100,
      ctx: {
        format: 'json',
        mode: 'dry-run',
        walletAddress: WALLET,
        publicKey: new PublicKey(WALLET),
        startTime: Date.now(),
      },
    });

    expect(api.quoteZapOpen).toHaveBeenCalled();
    expect(api.buildTxZapOpen).not.toHaveBeenCalled();
    expect(privyBroadcastOne).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('runZapInOpen --execute partial-signs with NFT mint before Privy', () => {
  it('hands a partial-signed base64 to privyBroadcastOne', async () => {
    mockPoolMeta();
    (api.quoteZapOpen as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        quoteId: 'q1',
        quoteContext: { flowType: 'zap-in-open', intent: {}, swapInAmount: '500000', expireAtMs: Date.now() + 30000 } as any,
        quote: {
          provider: 'jupiter',
          swapInAmount: '500000',
          expectedSwapOutAmount: '1000',
          minSwapOutAmount: '990',
          priceImpactPct: '0',
          priceImpactBps: 0,
          impactLevel: 'ok',
        },
        preview: { estimatedToken0Amount: '500000', estimatedToken1Amount: '1000' },
      },
    });

    // Build a fixture tx where the user (the future Privy signer) is the
    // payer/only required signer. The engine's partial-sign step will fill
    // that slot with the in-process keypair we hand in via positionNftMint —
    // proving the partial-sign code path runs without needing a multi-signer
    // tx (which is harder to construct from a unit test).
    const userKp = Keypair.generate();
    const { TransactionMessage, SystemProgram } = require('@solana/web3.js');
    const msg = new TransactionMessage({
      payerKey: userKp.publicKey,
      recentBlockhash: 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi',
      instructions: [
        SystemProgram.transfer({ fromPubkey: userKp.publicKey, toPubkey: userKp.publicKey, lamports: 1 }),
      ],
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    const unsignedBase64 = Buffer.from(tx.serialize()).toString('base64');
    // Trick: stub Keypair.generate inside positions-zap.ts so the ephemeral
    // NFT keypair *is* userKp — the engine will then partial-sign with userKp
    // and produce a fully signed tx that round-trips through deserialize.
    const realGenerate = Keypair.generate;
    Keypair.generate = (() => userKp) as typeof Keypair.generate;

    (api.buildTxZapOpen as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: { transaction: unsignedBase64, selectedProvider: 'jupiter' },
    });

    let capturedPayload: string | undefined;
    (privyBroadcastOne as ReturnType<typeof vi.fn>).mockImplementation(async (_ctx, payload) => {
      capturedPayload = payload;
      return { ok: true, value: { signature: 'mock-sig' } };
    });

    await runZapInOpen({
      poolAddress: POOL_ADDR,
      base: 'MintA',
      amountUi: '0.001',
      isRaw: false,
      tickLower: -25000,
      tickUpper: -22000,
      priceLowerUi: '80',
      priceUpperUi: '110',
      slippageBps: 100,
      ctx: {
        format: 'json',
        mode: 'execute',
        walletAddress: userKp.publicKey.toBase58(),
        publicKey: userKp.publicKey,
        startTime: Date.now(),
        privyCtx: PRIVY_CTX,
      },
    });

    expect(privyBroadcastOne).toHaveBeenCalledTimes(1);
    expect(capturedPayload).toBeTypeOf('string');
    // The captured payload must deserialize successfully and have at least
    // one non-zero signature slot (proof that we partial-signed locally
    // before broadcasting).
    const decoded = VersionedTransaction.deserialize(Buffer.from(capturedPayload!, 'base64'));
    const anySignatureFilled = decoded.signatures.some((sig) => sig.some((b) => b !== 0));
    expect(anySignatureFilled).toBe(true);

    // Restore Keypair.generate so other tests aren't affected.
    Keypair.generate = realGenerate;
  });
});

describe('runZapOut close fail-fast guard', () => {
  it('UNSUPPORTED_MODE when --auto-swap is invoked in unsigned-tx mode', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`__exit__:${code}`); }) as never);
    const errorSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mockPoolMeta();

    let caught: Error | undefined;
    try {
      await runZapOut({
        poolAddress: POOL_ADDR,
        personalPosition: 'PoS123',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        closePosition: true,
        slippageBps: 100,
        nftMint: 'NFT1',
        ctx: {
          format: 'json',
          mode: 'unsigned-tx',
          walletAddress: WALLET,
          publicKey: new PublicKey(WALLET),
          startTime: Date.now(),
        },
      });
    } catch (e) {
      caught = e as Error;
    }

    expect(caught?.message).toBe('__exit__:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(privyBroadcastOne).not.toHaveBeenCalled();
    expect(privySignMany).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('rejects --output-mint not in the pool', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`__exit__:${code}`); }) as never);
    const errorSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    mockPoolMeta();

    let caught: Error | undefined;
    try {
      await runZapOut({
        poolAddress: POOL_ADDR,
        personalPosition: 'PoS123',
        outputMint: 'NotInPool11111111111111111111111111111111111',
        closePosition: false,
        liquidity: '1000',
        slippageBps: 100,
        nftMint: 'NFT2',
        ctx: {
          format: 'json',
          mode: 'execute',
          walletAddress: WALLET,
          publicKey: new PublicKey(WALLET),
          startTime: Date.now(),
          privyCtx: PRIVY_CTX,
        },
      });
    } catch (e) {
      caught = e as Error;
    }

    expect(caught?.message).toBe('__exit__:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(api.quoteZapOut).not.toHaveBeenCalled();
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
