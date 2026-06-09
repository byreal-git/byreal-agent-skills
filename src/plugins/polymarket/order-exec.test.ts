import { describe, it, expect, vi } from 'vitest';
import { runOrderPlace, type PlaceDeps, type PlaceParams } from './order-exec.js';
import { ok, err } from '../../core/types.js';
import { apiError, sourceUnavailableError } from '../../core/errors.js';
import type { OpenOrder, OrderResponse } from './types.js';

const baseParams: PlaceParams = {
  walletAddress: '0xE',
  tokenId: 'tok',
  side: 'BUY',
  signedPrice: '0.66',
  amount: '5',
  negRisk: false,
  pollBudgetMs: 20_000,
  pollIntervalMs: 1_500,
};

/** Fake clock: now starts at 0, sleep advances it. */
function makeDeps(over: Partial<PlaceDeps> & { polls?: Array<ReturnType<typeof ok<OpenOrder>> | ReturnType<typeof err>> }): PlaceDeps {
  let clock = 0;
  const polls = over.polls ?? [ok<OpenOrder>({ id: 'o1', status: 'matched' })];
  let pi = 0;
  return {
    encode: over.encode ?? (async () => ok({ eip712: {} as never, signatureSuffix: 'aa', maker: '0xm', signer: '0xm', owner: '0xo', side: 'BUY' })),
    sign: over.sign ?? (async () => ok('0x' + 'bb'.repeat(65))),
    submit: over.submit ?? (async () => ok<OrderResponse>({ success: true, orderID: 'o1', status: 'live' })),
    syncBalance: over.syncBalance ?? (async () => {}),
    pollOnce: over.pollOnce ?? (async () => polls[Math.min(pi++, polls.length - 1)] as never),
    sleep: over.sleep ?? (async (ms: number) => { clock += ms; }),
    now: over.now ?? (() => clock),
    registerKeepalive: over.registerKeepalive,
  };
}

describe('runOrderPlace', () => {
  it('settles when poll returns matched', async () => {
    const r = await runOrderPlace(baseParams, makeDeps({ polls: [ok<OpenOrder>({ id: 'o1', status: 'matched' })] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.outcome).toBe('settled');
      expect(r.value.orderID).toBe('o1');
      expect(r.value.status).toBe('matched');
      expect(r.value.order_type).toBe('FOK'); // execute result carries order_type (matches dry-run)
    }
  });

  it('keeps polling through live then settles on matched', async () => {
    const r = await runOrderPlace(baseParams, makeDeps({
      polls: [
        ok<OpenOrder>({ id: 'o1', status: 'live' }),
        ok<OpenOrder>({ id: 'o1', status: 'live' }),
        ok<OpenOrder>({ id: 'o1', status: 'matched' }),
      ],
    }));
    expect(r.ok && r.value.outcome).toBe('settled');
  });

  it('returns pending when poll never terminal within budget', async () => {
    const r = await runOrderPlace(
      { ...baseParams, pollBudgetMs: 3000, pollIntervalMs: 1500 },
      makeDeps({ polls: [ok<OpenOrder>({ id: 'o1', status: 'live' })] }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.outcome).toBe('pending');
  });

  it('retries on 425 then succeeds', async () => {
    let calls = 0;
    const submit = vi.fn(async () => {
      calls++;
      if (calls === 1) return err(sourceUnavailableError('HTTP 425: too early', true));
      return ok<OrderResponse>({ success: true, orderID: 'o1', status: 'matched' });
    });
    const r = await runOrderPlace(baseParams, makeDeps({ submit, polls: [ok<OpenOrder>({ id: 'o1', status: 'matched' })] }));
    expect(r.ok).toBe(true);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('on 400 insufficient balance, syncs then retries once', async () => {
    let calls = 0;
    const submit = vi.fn(async () => {
      calls++;
      if (calls === 1) return err(apiError('PM gateway 400: not enough balance', 400));
      return ok<OrderResponse>({ success: true, orderID: 'o1', status: 'matched' });
    });
    const syncBalance = vi.fn(async () => {});
    const r = await runOrderPlace(baseParams, makeDeps({ submit, syncBalance, polls: [ok<OpenOrder>({ id: 'o1', status: 'matched' })] }));
    expect(r.ok).toBe(true);
    expect(syncBalance).toHaveBeenCalledWith('COLLATERAL', undefined);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('SELL balance sync passes CONDITIONAL + token_id', async () => {
    let calls = 0;
    const submit = vi.fn(async () => {
      calls++;
      if (calls === 1) return err(apiError('PM gateway 400: insufficient', 400));
      return ok<OrderResponse>({ success: true, orderID: 'o1', status: 'matched' });
    });
    const syncBalance = vi.fn(async () => {});
    const r = await runOrderPlace({ ...baseParams, side: 'SELL' }, makeDeps({ submit, syncBalance, polls: [ok<OpenOrder>({ id: 'o1', status: 'matched' })] }));
    expect(r.ok).toBe(true);
    expect(syncBalance).toHaveBeenCalledWith('CONDITIONAL', 'tok');
  });

  it('fatal 400 (non-balance) does not retry', async () => {
    const submit = vi.fn(async () => err(apiError('PM gateway 400: bad tick size', 400)));
    const r = await runOrderPlace(baseParams, makeDeps({ submit }));
    expect(r.ok).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('enriches an "invalid taker amount" rejection with a minimum-order-size hint', async () => {
    const submit = vi.fn(async () =>
      err(apiError('PM gateway 400: {"error":"invalid taker amount"}', 400)),
    );
    const r = await runOrderPlace({ ...baseParams, side: 'SELL' }, makeDeps({ submit }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toMatch(/minimum order size/i);
      expect(r.error.message).toMatch(/invalid taker amount/i); // keeps the original reason
    }
    expect(submit).toHaveBeenCalledTimes(1); // not a retryable/balance error
  });

  it('propagates encode error without signing/submitting', async () => {
    const sign = vi.fn();
    const submit = vi.fn();
    const r = await runOrderPlace(baseParams, makeDeps({
      encode: async () => err(apiError('encode 500')),
      sign,
      submit,
    }));
    expect(r.ok).toBe(false);
    expect(sign).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('success:false balance rejection triggers one sync+retry', async () => {
    let calls = 0;
    const submit = vi.fn(async () => {
      calls++;
      if (calls === 1) return ok<OrderResponse>({ success: false, errorMsg: 'not enough balance' });
      return ok<OrderResponse>({ success: true, orderID: 'o1', status: 'matched' });
    });
    const syncBalance = vi.fn(async () => {});
    const r = await runOrderPlace(baseParams, makeDeps({ submit, syncBalance, polls: [ok<OpenOrder>({ id: 'o1', status: 'matched' })] }));
    expect(r.ok).toBe(true);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('market order does NOT register keepalive', async () => {
    const registerKeepalive = vi.fn(async () => {});
    const r = await runOrderPlace(baseParams, makeDeps({ registerKeepalive, polls: [ok<OpenOrder>({ id: 'o1', status: 'matched' })] }));
    expect(r.ok).toBe(true);
    expect(registerKeepalive).not.toHaveBeenCalled();
  });
});

describe('runOrderPlace — limit (GTC)', () => {
  const limitParams: PlaceParams = { ...baseParams, kind: 'limit', signedPrice: '0.62', amount: '62' };

  it('is accepted on submit (no settlement poll) and registers keepalive', async () => {
    const pollOnce = vi.fn(async () => ok<OpenOrder>({ id: 'o1', status: 'live' }));
    const registerKeepalive = vi.fn(async () => {});
    const r = await runOrderPlace(
      limitParams,
      makeDeps({
        submit: async () => ok<OrderResponse>({ success: true, orderID: 'o1', status: 'live' }),
        pollOnce,
        registerKeepalive,
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.outcome).toBe('accepted');
      expect(r.value.orderID).toBe('o1');
      expect(r.value.status).toBe('live');
      expect(r.value.order_type).toBe('GTC');
    }
    expect(pollOnce).not.toHaveBeenCalled(); // limit: acceptance is terminal, no settlement poll
    expect(registerKeepalive).toHaveBeenCalledWith('o1');
  });

  it('encode + submit use orderType GTC', async () => {
    let encReq: { orderType?: string } | undefined;
    let subBody: { orderType?: string } | undefined;
    const r = await runOrderPlace(
      limitParams,
      makeDeps({
        encode: async (req) => {
          encReq = req;
          return ok({ eip712: {} as never, signatureSuffix: 'aa', maker: '0xm', side: 'BUY' });
        },
        submit: async (body) => {
          subBody = body;
          return ok<OrderResponse>({ success: true, orderID: 'o1', status: 'live' });
        },
        registerKeepalive: async () => {},
      }),
    );
    expect(r.ok).toBe(true);
    expect(encReq?.orderType).toBe('GTC');
    expect(subBody?.orderType).toBe('GTC');
  });

  it('keepalive failure does NOT fail the placed order', async () => {
    const registerKeepalive = vi.fn(async () => {
      throw new Error('keepalive 500');
    });
    const r = await runOrderPlace(
      limitParams,
      makeDeps({
        submit: async () => ok<OrderResponse>({ success: true, orderID: 'o1', status: 'live' }),
        registerKeepalive,
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.outcome).toBe('accepted');
    expect(registerKeepalive).toHaveBeenCalled();
  });
});
