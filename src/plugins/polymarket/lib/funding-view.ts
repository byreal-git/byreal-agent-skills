/**
 * Pure transforms for funding.deposit.preview / withdraw.preview / transfer.status.
 *
 * Phase A: previews are read-only (quote + address + min). The deposit *submit*
 * (construct → privySignMany → /bridge/deposit/submit) and withdraw submit are
 * Phase B. Bridge polling timeout returns `pending` (not failure) per docs/05 §5.6.
 */

import type { BridgeSupportedAsset, BridgeQuote, BridgeOrder } from '../api/bridge.js';

export function findUsdc(assets: BridgeSupportedAsset[]): BridgeSupportedAsset | null {
  return assets.find((a) => (a.symbol ?? '').toUpperCase() === 'USDC') ?? null;
}

function meetsMin(amount: string, min: string | undefined): boolean {
  const a = Number(amount);
  const m = Number(min ?? '0');
  return Number.isFinite(a) && a >= m;
}

interface NormQuote {
  quote_id: string | null;
  from_amount: string | null;
  to_amount: string | null;
  fee: Record<string, unknown> | null;
  est_time_ms: number | null;
}

function normQuote(q: BridgeQuote | null): NormQuote {
  if (!q) return { quote_id: null, from_amount: null, to_amount: null, fee: null, est_time_ms: null };
  return {
    quote_id: q.quoteId ?? null,
    from_amount: q.fromAmount ?? null,
    to_amount: q.toAmount ?? null,
    fee: q.fee ?? null,
    est_time_ms: q.estTimeMs ?? null,
  };
}

export interface DepositPreview {
  direction: 'deposit';
  from: { chain: 'solana'; token: 'USDC'; token_address: string | null; amount: string };
  to: { chain: 'polygon'; proxy_wallet: string; token: 'pUSD' };
  min_deposit: string | null;
  meets_minimum: boolean;
  deposit_address: string | null;
  quote: NormQuote;
  note: string;
}

export function buildDepositPreview(params: {
  amount: string;
  asset: BridgeSupportedAsset | null;
  quote: BridgeQuote | null;
  depositAddress: string | null;
  proxyAddress: string;
}): DepositPreview {
  const min = params.asset?.minDepositAmount;
  return {
    direction: 'deposit',
    from: { chain: 'solana', token: 'USDC', token_address: params.asset?.tokenAddress ?? null, amount: params.amount },
    to: { chain: 'polygon', proxy_wallet: params.proxyAddress, token: 'pUSD' },
    min_deposit: min ?? null,
    meets_minimum: meetsMin(params.amount, min),
    deposit_address: params.depositAddress,
    quote: normQuote(params.quote),
    note: 'Phase A preview only. Submit (construct Solana tx → Privy sign → /bridge/deposit/submit) is Phase B.',
  };
}

export interface WithdrawPreview {
  direction: 'withdraw';
  from: { chain: 'polygon'; proxy_wallet: string };
  to: { chain: 'solana'; recipient: string; token: 'USDC' };
  min_withdraw: string | null;
  meets_minimum: boolean;
  quote: NormQuote;
  note: string;
}

export function buildWithdrawPreview(params: {
  amount: string;
  asset: BridgeSupportedAsset | null;
  quote: BridgeQuote | null;
  recipientSolana: string;
  proxyAddress: string;
}): WithdrawPreview {
  const min = params.asset?.minWithdrawAmount;
  return {
    direction: 'withdraw',
    from: { chain: 'polygon', proxy_wallet: params.proxyAddress },
    to: { chain: 'solana', recipient: params.recipientSolana, token: 'USDC' },
    min_withdraw: min ?? null,
    meets_minimum: meetsMin(params.amount, min),
    quote: normQuote(params.quote),
    note: 'Phase A preview only. CLI does not sign withdrawals; submit is Phase B (gateway encode → Privy → Relayer).',
  };
}

export interface TransferStatusItem {
  order_id: string | null;
  type: string | null;
  status: string | null;
  from_amount: string | null;
  to_amount: string | null;
  create_time: number | null;
}

const TERMINAL = new Set(['COMPLETED', 'FAILED']);

export interface TransferStatus {
  type: string;
  count: number;
  orders: TransferStatusItem[];
  all_terminal: boolean;
  note: string;
}

export function buildTransferStatus(type: string, orders: BridgeOrder[]): TransferStatus {
  const items: TransferStatusItem[] = orders.map((o) => ({
    order_id: (o.orderId as string) ?? null,
    type: (o.type as string) ?? null,
    status: (o.status as string) ?? null,
    from_amount: (o.fromAmount as string) ?? null,
    to_amount: (o.toAmount as string) ?? null,
    create_time: (o.createTime as number) ?? null,
  }));
  const allTerminal = items.length > 0 && items.every((i) => TERMINAL.has((i.status ?? '').toUpperCase()));
  return {
    type,
    count: items.length,
    orders: items,
    all_terminal: allTerminal,
    note: 'COMPLETED / FAILED are terminal; other states are still in flight — poll /bridge/orders again later.',
  };
}
