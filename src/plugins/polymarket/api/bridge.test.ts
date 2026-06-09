import { describe, it, expect, vi } from 'vitest';
import { submitWithdraw, type BridgeWithdrawSubmitReq } from './bridge.js';

const auth = { token: 'oc_at_t', evmAddress: '0xEOA' };

function stub(status: number, body: unknown) {
  const f = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  });
  vi.stubGlobal('fetch', f);
  return f;
}

const baseReq: BridgeWithdrawSubmitReq = {
  walletAddress: '0xPROXY',
  toChainId: '1151111081099710',
  toTokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  recipientAddr: 'SoLaNaRecipient111',
  amount: '5',
  quoteId: '0xquote',
};

describe('submitWithdraw', () => {
  it('POSTs the signature-free body with recipientAddr (not recipientAddress) + proxy walletAddress', async () => {
    const f = stub(200, {
      success: true,
      ret_code: 0,
      data: { orderId: 'w1', status: 'SIGNED', transactionId: 't1', recipientAddr: 'SoLaNaRecipient111' },
    });
    const r = await submitWithdraw(baseReq, auth);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.orderId).toBe('w1');

    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain('/bridge/withdraw/submit');
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body as string);
    expect(sent).toEqual(baseReq); // exact shape — no signedTx, no recipientAddress
    expect('recipientAddr' in sent).toBe(true);
    expect('recipientAddress' in sent).toBe(false);
    expect('signedTx' in sent).toBe(false);
    // auth headers (EOA in x-evm-address, agent token bearer)
    expect(init.headers.Authorization).toBe('Bearer oc_at_t');
    expect(init.headers['x-evm-address']).toBe('0xEOA');
    vi.unstubAllGlobals();
  });

  it('surfaces a business rejection (pending bridge order) as an error', async () => {
    stub(200, { success: false, ret_code: 40910, ret_msg: 'You have a pending bridge order', data: null });
    const r = await submitWithdraw(baseReq, auth);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('40910');
    vi.unstubAllGlobals();
  });
});
