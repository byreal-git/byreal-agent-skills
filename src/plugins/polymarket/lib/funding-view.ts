/**
 * Pure transforms for funding.deposit.preview / withdraw.preview / transfer.status.
 *
 * Phase A: previews are read-only (quote + address + min). The deposit *submit*
 * (construct → privySignMany → /bridge/deposit/submit) and withdraw submit are
 * Phase B. Bridge polling timeout returns `pending` (not failure) per docs/03 §5.6.
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
    note: 'Source = the embedded Solana wallet in realclaw-config (only it can be signed by the agent token), NOT your main/Phantom wallet. Run `funding deposit --execute` to submit.',
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
    note: 'Funds go to --recipient (any Solana address — your deposit source or main wallet); they do NOT auto-return to the deposit source. CLI does not sign withdrawals; the backend signs via Privy + relays. Run `funding withdraw --execute` to submit.',
  };
}

export interface TransferStatusItem {
  order_id: string | null;
  type: string | null;
  status: string | null;
  bridge_status: string | null;
  /** Bridge order amount (the list view returns a single `amount`, not from/to). */
  amount: string | null;
  from_chain_id: string | null;
  to_chain_id: string | null;
  tx_hash: string | null;
  created_at: string | null; // ISO 8601
  updated_at: string | null; // ISO 8601
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
    order_id: o.orderId ?? null,
    type: o.type ?? null,
    status: o.status ?? null,
    bridge_status: o.bridgeStatus ?? null,
    amount: o.amount ?? null,
    from_chain_id: o.fromChainId ?? null,
    to_chain_id: o.toChainId ?? null,
    tx_hash: o.txHash ?? null,
    created_at: o.createdAt ?? null,
    updated_at: o.updatedAt ?? null,
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
