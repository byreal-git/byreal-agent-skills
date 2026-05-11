/**
 * Verifies the best-effort incentive preclaim helper invoked by
 * runZapOut(closePosition=true) on the openclaw branch: empty unclaimed →
 * not_needed; non-zero unclaimed → encode → privySignMany → submitRewardOrder;
 * pipeline failures stay best-effort.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../../src/privy/index.js', () => ({
  privySignMany: vi.fn(),
  privyBroadcastOne: vi.fn(),
  requirePrivyContext: vi.fn(),
}));

import { api } from '../../src/api/endpoints.js';
import {
  privySignMany,
  privyBroadcastOne,
} from '../../src/privy/index.js';
import {
  runIncentivePreclaim,
  previewIncentivePreclaim,
} from '../../src/cli/commands/incentive-preclaim.js';

const POSITION = 'PoS123abcDEF';
const WALLET = '77a9PjLyLovCVXD8mwRGMwcWSAH2pm3d8WeSSSKQd9Wq';
const PRIVY_CTX = { token: 't', config: { proxyUrl: 'http://x' } as any, caip2: 'solana:x' } as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runIncentivePreclaim', () => {
  it('returns not_needed when no unclaimed rewards exist for this position', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: { unclaimedOpenIncentives: [], unclaimedClosedIncentives: [] },
    });
    const result = await runIncentivePreclaim(WALLET, PRIVY_CTX, POSITION, false);
    expect(result.status).toBe('not_needed');
    expect(result.canContinue).toBe(true);
    expect(api.encodeReward).not.toHaveBeenCalled();
    expect(privySignMany).not.toHaveBeenCalled();
  });

  it('skips positions belonging to other addresses', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        unclaimedOpenIncentives: [
          {
            positionAddress: 'OtherPosition',
            syncedTokenAmount: '100',
            lockedTokenAmount: '0',
            claimedTokenAmount: '0',
          },
        ],
        unclaimedClosedIncentives: [],
      },
    });
    const result = await runIncentivePreclaim(WALLET, PRIVY_CTX, POSITION, false);
    expect(result.status).toBe('not_needed');
    expect(api.encodeReward).not.toHaveBeenCalled();
  });

  it('runs encode → privySignMany → submitRewardOrder when rewards are available', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        unclaimedOpenIncentives: [
          {
            positionAddress: POSITION,
            syncedTokenAmount: '100',
            lockedTokenAmount: '0',
            claimedTokenAmount: '0',
          },
        ],
        unclaimedClosedIncentives: [],
      },
    });
    (api.encodeReward as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        orderCode: 'ORD1',
        rewardEncodeItems: [
          { txCode: 'tx-1', poolAddress: 'PoolA', txPayload: 'unsigned-1' },
        ],
      },
    });
    (privySignMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: { signedTxs: [{ index: 0, signedTx: 'signed-base64-1' }] },
    });
    (api.submitRewardOrder as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: { orderCode: 'ORD1', txList: [{ txSignature: 'sig-1' }], claimTokenList: [] },
    });

    const result = await runIncentivePreclaim(WALLET, PRIVY_CTX, POSITION, false);

    expect(result.status).toBe('claimed');
    expect(result.canContinue).toBe(true);
    expect(result.signatures).toEqual(['sig-1']);
    expect(privySignMany).toHaveBeenCalledWith(PRIVY_CTX, ['unsigned-1']);
    expect(api.submitRewardOrder).toHaveBeenCalledWith({
      orderCode: 'ORD1',
      walletAddress: WALLET,
      signedTxPayload: [{ txCode: 'tx-1', poolAddress: 'PoolA', signedTx: 'signed-base64-1' }],
    });
  });

  it('returns claim_failed (canContinue=true) when encodeReward fails — best-effort', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        unclaimedOpenIncentives: [
          { positionAddress: POSITION, syncedTokenAmount: '100', lockedTokenAmount: '0', claimedTokenAmount: '0' },
        ],
        unclaimedClosedIncentives: [],
      },
    });
    (api.encodeReward as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { message: 'encode boom', toJSON: () => ({}) },
    });
    const result = await runIncentivePreclaim(WALLET, PRIVY_CTX, POSITION, false);
    expect(result.status).toBe('claim_failed');
    expect(result.canContinue).toBe(true);
    expect(result.errorMessage).toBe('encode boom');
    expect(privySignMany).not.toHaveBeenCalled();
  });

  it('returns claim_failed when privySignMany fails — best-effort', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        unclaimedOpenIncentives: [
          { positionAddress: POSITION, syncedTokenAmount: '100', lockedTokenAmount: '0', claimedTokenAmount: '0' },
        ],
        unclaimedClosedIncentives: [],
      },
    });
    (api.encodeReward as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: { orderCode: 'ORD2', rewardEncodeItems: [{ txCode: 'tx', poolAddress: 'P', txPayload: 'u' }] },
    });
    (privySignMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { message: 'privy sign timeout', toJSON: () => ({}) },
    });
    const result = await runIncentivePreclaim(WALLET, PRIVY_CTX, POSITION, false);
    expect(result.status).toBe('claim_failed');
    expect(result.canContinue).toBe(true);
    expect(result.errorMessage).toBe('privy sign timeout');
    expect(api.submitRewardOrder).not.toHaveBeenCalled();
  });

  it('returns claim_failed when submitRewardOrder fails — best-effort', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        unclaimedOpenIncentives: [
          { positionAddress: POSITION, syncedTokenAmount: '100', lockedTokenAmount: '0', claimedTokenAmount: '0' },
        ],
        unclaimedClosedIncentives: [],
      },
    });
    (api.encodeReward as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: { orderCode: 'ORD3', rewardEncodeItems: [{ txCode: 'tx', poolAddress: 'P', txPayload: 'u' }] },
    });
    (privySignMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: { signedTxs: [{ index: 0, signedTx: 'signed' }] },
    });
    (api.submitRewardOrder as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { message: 'submit failed', toJSON: () => ({}) },
    });
    const result = await runIncentivePreclaim(WALLET, PRIVY_CTX, POSITION, false);
    expect(result.status).toBe('claim_failed');
    expect(result.canContinue).toBe(true);
    expect(result.errorMessage).toBe('submit failed');
  });

  it('treats getUnclaimedData failure as best-effort claim_failed', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { message: 'unclaimed query failed', toJSON: () => ({}) },
    });
    const result = await runIncentivePreclaim(WALLET, PRIVY_CTX, POSITION, false);
    expect(result.status).toBe('claim_failed');
    expect(result.canContinue).toBe(true);
    expect(api.encodeReward).not.toHaveBeenCalled();
  });
});

describe('previewIncentivePreclaim (read-only)', () => {
  it('reports willPreclaim=true when the position has unclaimed rewards', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      value: {
        unclaimedOpenIncentives: [
          { positionAddress: POSITION, syncedTokenAmount: '100', lockedTokenAmount: '0', claimedTokenAmount: '0' },
          { positionAddress: POSITION, syncedTokenAmount: '50', lockedTokenAmount: '0', claimedTokenAmount: '0' },
        ],
        unclaimedClosedIncentives: [],
      },
    });
    const result = await previewIncentivePreclaim(WALLET, POSITION);
    expect(result.willPreclaim).toBe(true);
    expect(result.unclaimedCount).toBe(2);
    expect(privySignMany).not.toHaveBeenCalled();
    expect(api.encodeReward).not.toHaveBeenCalled();
  });

  it('reports willPreclaim=false on getUnclaimedData failure', async () => {
    (api.getUnclaimedData as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      error: { message: 'rpc down', toJSON: () => ({}) },
    });
    const result = await previewIncentivePreclaim(WALLET, POSITION);
    expect(result.willPreclaim).toBe(false);
    expect(result.unclaimedCount).toBe(0);
  });
});
