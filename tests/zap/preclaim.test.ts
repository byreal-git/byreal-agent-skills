/**
 * Verifies the best-effort incentive preclaim helper invoked by
 * runZapOut(closePosition=true): empty unclaimed → not_needed; non-zero
 * unclaimed → encode + sign + submit; pipeline failures stay best-effort.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@solana/web3.js';

vi.mock('../../src/api/endpoints.js', () => ({
  api: {
    getUnclaimedData: vi.fn(),
    encodeReward: vi.fn(),
    submitRewardOrder: vi.fn(),
    getPoolInfo: vi.fn(),
    quoteZapOut: vi.fn(),
    buildTxZapOut: vi.fn(),
  },
}));

vi.mock('../../src/core/transaction.js', () => ({
  deserializeTransaction: vi.fn(() => ({
    ok: true,
    value: { sign: () => undefined, message: { recentBlockhash: 'x' } },
  })),
  signTransaction: vi.fn((tx) => tx),
  sendAndConfirmTransaction: vi.fn(() => ({
    ok: true,
    value: { signature: 'main-zap-sig', confirmed: true },
  })),
  serializeTransaction: vi.fn(() => 'signed-base64'),
}));

vi.mock('../../src/core/solana.js', () => ({
  getConnection: vi.fn(() => ({})),
  getSlippageBps: vi.fn(() => 100),
}));

vi.mock('../../src/core/telemetry.js', () => ({
  trackEvent: vi.fn(),
}));

import { api } from '../../src/api/endpoints.js';
import {
  runIncentivePreclaim,
  previewIncentivePreclaim,
} from '../../src/cli/commands/incentive-preclaim.js';
import { runZapOut } from '../../src/cli/commands/positions-zap.js';

const POSITION = 'PoS123abcDEF';
const WALLET = '77a9PjLyLovCVXD8mwRGMwcWSAH2pm3d8WeSSSKQd9Wq';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runIncentivePreclaim', () => {
  it('returns not_needed when no unclaimed rewards exist for this position', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: { unclaimedOpenIncentives: [], unclaimedClosedIncentives: [] },
    });

    const r = await runIncentivePreclaim(WALLET, Keypair.generate(), POSITION, false);

    expect(r.status).toBe('not_needed');
    expect(r.canContinue).toBe(true);
    expect(r.unclaimedCount).toBe(0);
    expect(api.encodeReward).not.toHaveBeenCalled();
    expect(api.submitRewardOrder).not.toHaveBeenCalled();
  });

  it('skips positions belonging to other addresses', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        unclaimedOpenIncentives: [
          {
            positionAddress: 'OTHER_POS',
            tokenAddress: 't', tokenSymbol: 'X',
            syncedTokenAmount: '100', lockedTokenAmount: '0', claimedTokenAmount: '0',
            price: '1', tokenDecimals: 6,
          },
        ],
        unclaimedClosedIncentives: [],
      },
    });

    const r = await runIncentivePreclaim(WALLET, Keypair.generate(), POSITION, false);
    expect(r.status).toBe('not_needed');
    expect(api.encodeReward).not.toHaveBeenCalled();
  });

  it('runs the full encode → sign → submit pipeline when rewards are available', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        unclaimedOpenIncentives: [
          {
            positionAddress: POSITION,
            tokenAddress: 't', tokenSymbol: 'BONK',
            syncedTokenAmount: '100', lockedTokenAmount: '0', claimedTokenAmount: '0',
            price: '1', tokenDecimals: 6,
          },
        ],
        unclaimedClosedIncentives: [],
      },
    });
    (api.encodeReward as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        orderCode: 'ORDER_1',
        rewardEncodeItems: [
          { poolAddress: 'pool1', txPayload: 'AQAAAA==', txCode: 'tx1', rewardClaimInfo: [] },
        ],
      },
    });
    (api.submitRewardOrder as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        orderCode: 'ORDER_1',
        txList: [{ poolAddress: 'pool1', txSignature: 'sigA', status: 1 }],
        claimTokenList: [],
      },
    });

    const r = await runIncentivePreclaim(WALLET, Keypair.generate(), POSITION, false);
    expect(r.status).toBe('claimed');
    expect(r.canContinue).toBe(true);
    expect(r.unclaimedCount).toBe(1);
    expect(r.signatures).toEqual(['sigA']);
    expect(api.encodeReward).toHaveBeenCalledTimes(1);
    expect(api.submitRewardOrder).toHaveBeenCalledTimes(1);
  });

  it('returns claim_failed (canContinue=true) when encodeReward fails — best-effort', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        unclaimedOpenIncentives: [
          {
            positionAddress: POSITION,
            tokenAddress: 't', tokenSymbol: 'BONK',
            syncedTokenAmount: '100', lockedTokenAmount: '0', claimedTokenAmount: '0',
            price: '1', tokenDecimals: 6,
          },
        ],
        unclaimedClosedIncentives: [],
      },
    });
    (api.encodeReward as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: 'API_ERROR', type: 'NETWORK', message: 'encode boom', retryable: true, toJSON: () => ({}) },
    });

    const r = await runIncentivePreclaim(WALLET, Keypair.generate(), POSITION, false);
    expect(r.status).toBe('claim_failed');
    expect(r.canContinue).toBe(true);
    expect(r.errorMessage).toContain('encode boom');
    expect(api.submitRewardOrder).not.toHaveBeenCalled();
  });

  it('returns claim_failed when submitRewardOrder fails — best-effort', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        unclaimedOpenIncentives: [
          {
            positionAddress: POSITION,
            tokenAddress: 't', tokenSymbol: 'BONK',
            syncedTokenAmount: '100', lockedTokenAmount: '0', claimedTokenAmount: '0',
            price: '1', tokenDecimals: 6,
          },
        ],
        unclaimedClosedIncentives: [],
      },
    });
    (api.encodeReward as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        orderCode: 'O',
        rewardEncodeItems: [{ poolAddress: 'p', txPayload: 'AQAA', txCode: 'c', rewardClaimInfo: [] }],
      },
    });
    (api.submitRewardOrder as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: 'API_ERROR', type: 'NETWORK', message: 'submit boom', retryable: true, toJSON: () => ({}) },
    });

    const r = await runIncentivePreclaim(WALLET, Keypair.generate(), POSITION, false);
    expect(r.status).toBe('claim_failed');
    expect(r.canContinue).toBe(true);
  });

  it('treats getUnclaimedData failure as best-effort claim_failed', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: 'API_ERROR', type: 'NETWORK', message: 'rpc down', retryable: true, toJSON: () => ({}) },
    });
    const r = await runIncentivePreclaim(WALLET, Keypair.generate(), POSITION, false);
    expect(r.status).toBe('claim_failed');
    expect(r.canContinue).toBe(true);
    expect(api.encodeReward).not.toHaveBeenCalled();
  });
});

describe('previewIncentivePreclaim (read-only)', () => {
  it('reports willPreclaim=true when the position has unclaimed rewards', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        unclaimedOpenIncentives: [
          {
            positionAddress: POSITION,
            tokenAddress: 't', tokenSymbol: 'BONK',
            syncedTokenAmount: '50', lockedTokenAmount: '0', claimedTokenAmount: '0',
            price: '1', tokenDecimals: 6,
          },
          {
            positionAddress: POSITION,
            tokenAddress: 't2', tokenSymbol: 'XYZ',
            syncedTokenAmount: '10', lockedTokenAmount: '0', claimedTokenAmount: '0',
            price: '1', tokenDecimals: 6,
          },
        ],
        unclaimedClosedIncentives: [],
      },
    });
    const r = await previewIncentivePreclaim(WALLET, POSITION);
    expect(r.willPreclaim).toBe(true);
    expect(r.unclaimedCount).toBe(2);
  });

  it('reports willPreclaim=false on getUnclaimedData failure', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { code: 'X', type: 'NETWORK', message: 'fail', retryable: false, toJSON: () => ({}) },
    });
    const r = await previewIncentivePreclaim(WALLET, POSITION);
    expect(r.willPreclaim).toBe(false);
    expect(r.unclaimedCount).toBe(0);
  });
});

describe('runZapOut close preclaim integration', () => {
  it('rejects zap-out output mints outside the pool tokens before quoting', async () => {
    const wallet = Keypair.generate();
    const mintA = 'So11111111111111111111111111111111111111112';
    const mintB = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

    (api.getPoolInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        token_a: { mint: mintA, symbol: 'SOL', decimals: 9, price_usd: 100 },
        token_b: { mint: mintB, symbol: 'USDC', decimals: 6, price_usd: 1 },
      },
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(((code?: string | number | null) => {
        throw new Error(`exit:${code}`);
      }) as typeof process.exit);

    try {
      await expect(
        runZapOut({
          poolAddress: 'pool',
          personalPosition: POSITION,
          outputMint: 'ThirdPartyMint111111111111111111111111111',
          closePosition: true,
          slippageBps: 100,
          nftMint: 'nft',
          ctx: {
            format: 'json',
            mode: 'dry-run',
            publicKey: wallet.publicKey,
            startTime: Date.now(),
          },
        }),
      ).rejects.toThrow('exit:1');
    } finally {
      logSpy.mockRestore();
      exitSpy.mockRestore();
    }

    expect(api.quoteZapOut).not.toHaveBeenCalled();
  });

  it('refreshes zap-out quote after incentive preclaim succeeds before build-tx', async () => {
    const wallet = Keypair.generate();
    const mintA = 'So11111111111111111111111111111111111111112';
    const mintB = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

    (api.getPoolInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        token_a: { mint: mintA, symbol: 'SOL', decimals: 9, price_usd: 100 },
        token_b: { mint: mintB, symbol: 'USDC', decimals: 6, price_usd: 1 },
      },
    });
    (api.quoteZapOut as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        value: {
          result: { retCode: 0 },
          quoteId: 'stale-quote',
          quoteContext: {
            flowType: 'zap-out',
            intent: {},
            swapInAmount: '1',
            expireAtMs: Date.now() + 30_000,
          },
          preview: {
            estimatedWithdrawToken0Amount: '1000000',
            estimatedWithdrawToken1Amount: '1000000',
            estimatedReceiveOutputAmount: '1100000',
            swapQuote: null,
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          result: { retCode: 0 },
          quoteId: 'fresh-quote',
          quoteContext: {
            flowType: 'zap-out',
            intent: {},
            swapInAmount: '2',
            expireAtMs: Date.now() + 30_000,
          },
          preview: {
            estimatedWithdrawToken0Amount: '1000000',
            estimatedWithdrawToken1Amount: '1000000',
            estimatedReceiveOutputAmount: '1100000',
            swapQuote: null,
          },
        },
      });
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        unclaimedOpenIncentives: [
          {
            positionAddress: POSITION,
            tokenAddress: 'reward',
            tokenSymbol: 'BONK',
            syncedTokenAmount: '1',
            lockedTokenAmount: '0',
            claimedTokenAmount: '0',
            price: '1',
            tokenDecimals: 6,
          },
        ],
        unclaimedClosedIncentives: [],
      },
    });
    (api.encodeReward as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        orderCode: 'ORDER_1',
        rewardEncodeItems: [
          { poolAddress: 'pool1', txPayload: 'AQAAAA==', txCode: 'tx1', rewardClaimInfo: [] },
        ],
      },
    });
    (api.submitRewardOrder as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        orderCode: 'ORDER_1',
        txList: [{ poolAddress: 'pool1', txSignature: 'preclaim-sig', status: 1 }],
        claimTokenList: [],
      },
    });
    (api.buildTxZapOut as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        result: { retCode: 0 },
        transaction: 'AQAAAA==',
        selectedProvider: 'jupiter',
      },
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await runZapOut({
        poolAddress: 'pool',
        personalPosition: POSITION,
        outputMint: mintB,
        closePosition: true,
        slippageBps: 100,
        nftMint: 'nft',
        ctx: {
          format: 'json',
          mode: 'confirm',
          publicKey: wallet.publicKey,
          keypair: wallet,
          startTime: Date.now(),
        },
      });
    } finally {
      logSpy.mockRestore();
    }

    expect(api.quoteZapOut).toHaveBeenCalledTimes(2);
    expect(api.buildTxZapOut).toHaveBeenCalledWith({
      quoteId: 'fresh-quote',
      quoteContext: expect.objectContaining({ swapInAmount: '2' }),
    });
  });
});
