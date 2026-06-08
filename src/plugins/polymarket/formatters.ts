/**
 * Polymarket plugin output helpers.
 *
 * Reuses the shared helpers in src/cli/output/formatters.ts (outputJson,
 * outputErrorJson, etc.); this file adds polymarket-specific table rendering
 * and small command utilities. Table builders are added per command in C2–C5.
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { TABLE_CHARS } from '../../core/constants.js';
import type { OutputFormat } from '../../core/types.js';
import { outputJson, outputError } from '../../cli/output/formatters.js';
import type { ByrealError } from '../../core/errors.js';
import type { CategoryListItem } from './lib/category-view.js';
import type { EventListItem, EventDetail } from './lib/event-view.js';
import type { Portfolio, FundingBalance } from './lib/portfolio-view.js';
import type { EventCandidate } from './lib/whitelist.js';
import type { OrderPreview } from './lib/order-view.js';
import type { DepositPreview, WithdrawPreview, TransferStatus } from './lib/funding-view.js';

/** Validate an EVM (Polygon) EOA address shape. Never calls new PublicKey(). */
export function isEvmAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

/** Emit a ByrealError as JSON or table and exit(1). */
export function outputPmError(format: OutputFormat, e: ByrealError): never {
  outputError(e.toJSON(), format);
  process.exit(1);
}

/** Emit success data: JSON envelope, or render a table via tableFn. */
export function outputPmSuccess<T>(
  format: OutputFormat,
  data: T,
  tableFn: (d: T) => void,
  startTime?: number,
): void {
  if (format === 'json') outputJson(data, startTime);
  else tableFn(data);
}

// ---- table renderers ---------------------------------------------------

export function renderCategoryList(d: { categories: CategoryListItem[] }): void {
  console.log(chalk.cyan.bold('\n  Polymarket Categories\n'));
  const table = new Table({
    head: [chalk.cyan.bold('ID'), chalk.cyan.bold('Name'), chalk.cyan.bold('Type'), chalk.cyan.bold('Market Types')],
    chars: TABLE_CHARS,
  });
  for (const c of d.categories) {
    table.push([
      c.category_id,
      c.display_name,
      c.category_type ?? '-',
      c.market_types.map((m) => m.name).join(', ') || '-',
    ]);
  }
  console.log(table.toString());
}

export function renderEventList(d: { sort: string; events: EventListItem[] }): void {
  console.log(chalk.cyan.bold(`\n  Polymarket Events (${d.sort})\n`));
  const table = new Table({
    head: [chalk.cyan.bold('Event ID'), chalk.cyan.bold('Title'), chalk.cyan.bold('Volume'), chalk.cyan.bold('End Date')],
    chars: TABLE_CHARS,
  });
  for (const e of d.events) {
    table.push([e.event_id, e.title, e.volume ?? '-', e.endDate ?? '-']);
  }
  console.log(table.toString());
}

export function renderEventDetail(d: EventDetail): void {
  console.log(chalk.cyan.bold(`\n  ${d.event.title}`));
  console.log(
    chalk.gray(
      `  event_id=${d.event.event_id}  kind=${d.event.kind}  negRisk=${d.event.negRisk}  ` +
        `markets ${d.markets_returned}/${d.market_count}${d.markets_truncated ? ' (truncated)' : ''}\n`,
    ),
  );
  const table = new Table({
    head: [
      chalk.cyan.bold('Market ID'),
      chalk.cyan.bold('Outcome / Team'),
      chalk.cyan.bold('YES'),
      chalk.cyan.bold('NO'),
      chalk.cyan.bold('Tick'),
    ],
    chars: TABLE_CHARS,
  });
  for (const m of d.markets) {
    table.push([
      m.market_id,
      m.title,
      m.yes_price ?? '-',
      m.no_price ?? '-',
      m.tick_size ?? '-',
    ]);
  }
  console.log(table.toString());
  if (d.markets.some((m) => m.related_markets.length > 0)) {
    console.log(chalk.gray('\n  related_markets present (same neg-risk group)'));
  }
}

export function renderPortfolio(p: Portfolio): void {
  console.log(chalk.cyan.bold('\n  Polymarket Portfolio\n'));
  console.log(chalk.gray(`  proxy_wallet: ${p.account.proxy_wallet}  (${p.account.proxy_wallet_status})`));
  console.log(
    chalk.gray(
      `  value=${p.summary.current_value_usd ?? '-'}  pnl=${p.summary.pnl_usd ?? '-'}  ` +
        `cash=${p.summary.cash_available_usdc ?? 'n/a (Phase B)'}\n`,
    ),
  );
  const table = new Table({
    head: [
      chalk.cyan.bold('Position ID (token)'),
      chalk.cyan.bold('Market'),
      chalk.cyan.bold('Outcome'),
      chalk.cyan.bold('Size'),
      chalk.cyan.bold('Avg'),
      chalk.cyan.bold('Cur'),
      chalk.cyan.bold('PnL'),
    ],
    chars: TABLE_CHARS,
  });
  for (const pos of p.positions) {
    table.push([
      pos.position_id,
      pos.market_title ?? '-',
      pos.outcome_label ?? '-',
      pos.size,
      pos.avg_price ?? '-',
      pos.current_price ?? '-',
      `${pos.cash_pnl_usd ?? '-'} (${pos.cash_pnl_percent ?? '-'}%)`,
    ]);
  }
  console.log(table.toString());
  if (p.partial) console.log(chalk.gray(`\n  partial: ${p.partial_reason ?? 'some fields require Phase B'}`));
}

export function renderEventSearch(d: { query: string; events: EventCandidate[] }): void {
  console.log(chalk.cyan.bold(`\n  Polymarket Search: "${d.query}"  (${d.events.length} whitelisted)\n`));
  const table = new Table({
    head: [chalk.cyan.bold('Event ID'), chalk.cyan.bold('Title'), chalk.cyan.bold('Volume'), chalk.cyan.bold('End Date')],
    chars: TABLE_CHARS,
  });
  for (const e of d.events) {
    table.push([e.event_id, e.title, e.volume ?? '-', e.endDate ?? '-']);
  }
  console.log(table.toString());
}

export function renderOrderPreview(o: OrderPreview): void {
  const s = o.preview;
  console.log(chalk.cyan.bold(`\n  Order Preview — ${s.side.toUpperCase()} ${s.order_type}\n`));
  const table = new Table({ chars: TABLE_CHARS });
  table.push(
    [chalk.gray('Token ID'), s.token_id],
    [chalk.gray('Side / Type'), `${s.side} / ${s.order_type}`],
    [chalk.gray(s.side === 'buy' ? 'Amount (USD)' : 'Size (shares)'), s.amount ?? s.size ?? '-'],
    [chalk.gray('Book Worst Price'), String(s.book_worst_price)],
    [chalk.gray('Signed Worst Price'), String(s.signed_worst_price)],
    [chalk.gray('Avg Price'), String(s.avg_price)],
    [chalk.gray('Slippage (bps abs)'), `${s.slippage_bps} (Δ=${s.slippage_bps / 10000})`],
    [chalk.gray('Tick / negRisk'), `${s.tick_size} / ${s.neg_risk}`],
    [chalk.gray('Quoted / Expires'), `${s.quoted_at} / ${s.expires_at}`],
    [chalk.gray('Fully Fills'), String(o.fully_fills)],
  );
  console.log(table.toString());
  if (o.warning) console.log(chalk.yellow(`\n  ⚠ ${o.warning}`));
  console.error(
    chalk.gray('\n  [preview] round-trip this snapshot to order.place (Phase B); it re-quotes + checks PREVIEW_EXPIRED.'),
  );
}

export function renderDepositPreview(p: DepositPreview): void {
  console.log(chalk.cyan.bold('\n  Deposit Preview — Solana USDC → Polymarket\n'));
  const table = new Table({ chars: TABLE_CHARS });
  table.push(
    [chalk.gray('From'), `${p.from.amount} ${p.from.token} (solana)`],
    [chalk.gray('To proxy wallet'), `${p.to.proxy_wallet} (polygon ${p.to.token})`],
    [chalk.gray('Min deposit'), p.min_deposit ?? '-'],
    [chalk.gray('Meets minimum'), String(p.meets_minimum)],
    [chalk.gray('Deposit address'), p.deposit_address ?? 'n/a (quote/address unavailable)'],
    [chalk.gray('Quote → amount'), p.quote.to_amount ?? '-'],
    [chalk.gray('Est. time (ms)'), p.quote.est_time_ms != null ? String(p.quote.est_time_ms) : '-'],
  );
  console.log(table.toString());
  console.error(chalk.gray(`\n  ${p.note}`));
}

export function renderWithdrawPreview(p: WithdrawPreview): void {
  console.log(chalk.cyan.bold('\n  Withdraw Preview — Polymarket → Solana USDC\n'));
  const table = new Table({ chars: TABLE_CHARS });
  table.push(
    [chalk.gray('From proxy wallet'), `${p.from.proxy_wallet} (polygon)`],
    [chalk.gray('To recipient'), `${p.to.recipient} (solana ${p.to.token})`],
    [chalk.gray('Min withdraw'), p.min_withdraw ?? '-'],
    [chalk.gray('Meets minimum'), String(p.meets_minimum)],
    [chalk.gray('Quote → amount'), p.quote.to_amount ?? '-'],
  );
  console.log(table.toString());
  console.error(chalk.gray(`\n  ${p.note}`));
}

export function renderTransferStatus(s: TransferStatus): void {
  console.log(chalk.cyan.bold(`\n  Transfer Status — ${s.type} (${s.count})\n`));
  const table = new Table({
    head: [
      chalk.cyan.bold('Order ID'),
      chalk.cyan.bold('Type'),
      chalk.cyan.bold('Status'),
      chalk.cyan.bold('Amount'),
      chalk.cyan.bold('Created'),
      chalk.cyan.bold('Tx Hash'),
    ],
    chars: TABLE_CHARS,
  });
  for (const o of s.orders) {
    // Tx hash is an on-chain identifier — shown in full (never truncated; CLAUDE.md).
    table.push([
      o.order_id ?? '-',
      o.type ?? '-',
      o.status ?? '-',
      o.amount ?? '-',
      o.created_at ?? '-',
      o.tx_hash ?? '-',
    ]);
  }
  console.log(table.toString());
  console.error(chalk.gray(`\n  ${s.note}`));
}

export function renderFundingBalance(b: FundingBalance): void {
  console.log(chalk.cyan.bold('\n  Polymarket Balance\n'));
  const table = new Table({ chars: TABLE_CHARS });
  table.push(
    [chalk.gray('Proxy Wallet'), b.proxy_wallet],
    [chalk.gray('Current Value (USD)'), b.current_value_usd ?? '-'],
    [chalk.gray('Cash Available (USDC)'), b.cash_available_usdc ?? 'n/a (Phase B)'],
  );
  console.log(table.toString());
}
