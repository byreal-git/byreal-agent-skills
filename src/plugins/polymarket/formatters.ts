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

/**
 * Transient stub for subcommands not yet wired in the current checkpoint.
 * Replaced by the real handler when each command lands (C2–C5).
 */
export function emitNotImplemented(format: OutputFormat, command: string): never {
  const message = `polymarket ${command} is not implemented yet (Phase A build in progress)`;
  if (format === 'json') {
    console.log(
      JSON.stringify(
        { success: false, error: { code: 'NOT_IMPLEMENTED', type: 'SYSTEM', message, retryable: false } },
        null,
        2,
      ),
    );
  } else {
    console.error(chalk.yellow(`\n${message}\n`));
  }
  process.exit(1);
}

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
