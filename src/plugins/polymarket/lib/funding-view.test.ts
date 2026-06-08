import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  findUsdc,
  buildDepositPreview,
  buildWithdrawPreview,
  buildTransferStatus,
} from './funding-view.js';
import type { BridgeSupportedAsset, BridgeQuote, BridgeOrder } from '../api/bridge.js';

const FX = path.join(__dirname, '..', '__fixtures__');
function load<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FX, name), 'utf-8')) as T;
}

const assets = load<{ data: BridgeSupportedAsset[] }>('bridge-supported-assets.json').data;
const quote = load<{ data: BridgeQuote }>('bridge-quote.json').data;
const orders = load<{ data: BridgeOrder[] }>('bridge-orders.json').data;

describe('findUsdc (real supported-assets fixture)', () => {
  it('finds USDC with min amounts', () => {
    const u = findUsdc(assets);
    expect(u?.symbol).toBe('USDC');
    expect(u?.minDepositAmount).toBe('10');
    expect(u?.minWithdrawAmount).toBe('5');
  });
});

describe('buildDepositPreview', () => {
  it('assembles deposit preview; meets_minimum reflects min', () => {
    const asset = findUsdc(assets);
    const p = buildDepositPreview({
      amount: '20',
      asset,
      quote,
      depositAddress: 'SoLDepositAddr1111111111111111111111111111',
      proxyAddress: '0xPROXY',
    });
    expect(p.direction).toBe('deposit');
    expect(p.min_deposit).toBe('10');
    expect(p.meets_minimum).toBe(true);
    expect(p.from.amount).toBe('20');
    expect(p.to.proxy_wallet).toBe('0xPROXY');
    expect(p.deposit_address).toBe('SoLDepositAddr1111111111111111111111111111');
    expect(p.quote.to_amount).toBe('19.94');
  });

  it('flags below-minimum deposits', () => {
    const p = buildDepositPreview({ amount: '5', asset: findUsdc(assets), quote: null, depositAddress: null, proxyAddress: '0xP' });
    expect(p.meets_minimum).toBe(false);
  });
});

describe('buildWithdrawPreview', () => {
  it('targets a Solana recipient; min from minWithdrawAmount', () => {
    const w = buildWithdrawPreview({
      amount: '10',
      asset: findUsdc(assets),
      quote,
      recipientSolana: 'SoLRecipient1111111111111111111111111111111',
      proxyAddress: '0xPROXY',
    });
    expect(w.direction).toBe('withdraw');
    expect(w.to.chain).toBe('solana');
    expect(w.to.recipient).toBe('SoLRecipient1111111111111111111111111111111');
    expect(w.min_withdraw).toBe('5');
    expect(w.meets_minimum).toBe(true);
  });
});

describe('buildTransferStatus', () => {
  it('maps orders; all_terminal=false when one is still PROCESSING', () => {
    const s = buildTransferStatus('deposit', orders);
    expect(s.count).toBe(2);
    expect(s.orders[0].status).toBe('COMPLETED');
    expect(s.all_terminal).toBe(false); // 2nd order PROCESSING
  });

  it('maps the REAL /bridge/orders field names (amount/createdAt/txHash, not from/to/createTime)', () => {
    const s = buildTransferStatus('deposit', orders);
    const o = s.orders[0];
    expect(o.order_id).toBe('44956f00-11a3-4e1a-b581-86fa93e1a736');
    expect(o.amount).toBe('10.000000');
    expect(o.bridge_status).toBe('COMPLETED');
    expect(o.tx_hash).toBe(
      'SHqKW5JpxrF96bQeXe66mosxBYQuqXQK2yMRqWNrSf17mLYXChwKzvk2KFv2CirT9yNAvNakzJRiQWshg8fja2Q',
    );
    expect(o.created_at).toBe('2026-06-05T03:30:29.583Z');
    expect(o.from_chain_id).toBe('1151111081099710');
  });

  it('all_terminal=true when all COMPLETED/FAILED', () => {
    const s = buildTransferStatus('deposit', [{ orderId: 'x', status: 'COMPLETED' }, { orderId: 'y', status: 'FAILED' }]);
    expect(s.all_terminal).toBe(true);
  });

  it('empty orders → not all_terminal', () => {
    expect(buildTransferStatus('deposit', []).all_terminal).toBe(false);
  });
});
