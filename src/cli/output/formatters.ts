/**
 * Output formatters for Byreal CLI
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { TABLE_CHARS, VERSION } from '../../core/constants.js';
import type {
  OutputFormat,
  Pool,
  PoolDetail,
  Token,
  GlobalOverview,
  CliError,
  Kline,
  WalletInfo,
  WalletBalance,
  ByrealConfig,
  SwapQuote,
  PositionItem,
  FeeEncodeEntry
} from '../../core/types.js';
import { rawToUi } from '../../core/amounts.js';

// ============================================
// Success Response Wrapper
// ============================================

interface SuccessResponse<T> {
  success: true;
  meta: {
    timestamp: string;
    version: string;
    execution_time_ms?: number;
  };
  data: T;
}

function wrapSuccess<T>(data: T, startTime?: number): SuccessResponse<T> {
  return {
    success: true,
    meta: {
      timestamp: new Date().toISOString(),
      version: VERSION,
      execution_time_ms: startTime ? Date.now() - startTime : undefined,
    },
    data,
  };
}

// ============================================
// JSON Output
// ============================================

export function outputJson<T>(data: T, startTime?: number): void {
  const response = wrapSuccess(data, startTime);
  console.log(JSON.stringify(response, null, 2));
}

export function outputErrorJson(error: CliError): void {
  console.log(JSON.stringify({ success: false, error }, null, 2));
}

// ============================================
// Table Helpers
// ============================================

function createTable(headers: string[]): Table.Table {
  return new Table({
    head: headers.map((h) => chalk.cyan.bold(h)),
    chars: TABLE_CHARS,
    style: {
      head: [],
      border: [],
      'padding-left': 1,
      'padding-right': 1,
    },
  });
}

function formatUsd(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  }
  return `$${value.toFixed(2)}`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  const color = value >= 0 ? chalk.green : chalk.red;
  return color(`${sign}${value.toFixed(2)}%`);
}

function formatApr(value: number): string {
  const color = value >= 10 ? chalk.green : value >= 5 ? chalk.yellow : chalk.white;
  return color(`${value.toFixed(2)}%`);
}

// ============================================
// Pool Formatters
// ============================================

export function outputPoolsTable(pools: Pool[], total: number): void {
  const table = createTable(['Pair', 'Pool ID', 'TVL', 'Volume 24h', 'APR', 'Fee Rate']);

  for (const pool of pools) {
    table.push([
      chalk.white.bold(pool.pair),
      chalk.gray(pool.id),
      formatUsd(pool.tvl_usd),
      formatUsd(pool.volume_24h_usd),
      formatApr(pool.apr),
      `${(pool.fee_rate_bps / 100).toFixed(2)}%`,
    ]);
  }

  console.log(table.toString());
  console.log(chalk.gray(`\nShowing ${pools.length} of ${total} pools`));
}

export function outputPoolDetail(pool: PoolDetail): void {
  console.log(chalk.cyan.bold(`\n${pool.pair}`));
  console.log(chalk.gray(`Pool ID: ${pool.id}\n`));

  const table = createTable(['Metric', 'Value']);
  table.push(
    ['TVL', formatUsd(pool.tvl_usd)],
    ['Volume (24h)', formatUsd(pool.volume_24h_usd)],
    ['Volume (7d)', formatUsd(pool.volume_7d_usd)],
    ['Fees (24h)', formatUsd(pool.fee_24h_usd)],
    ['Fee Rate', `${(pool.fee_rate_bps / 100).toFixed(2)}%`],
    ['APR', formatApr(pool.apr)]
  );

  console.log(table.toString());

  // 价格信息
  console.log(chalk.cyan('\nPrices:'));
  const priceTable = createTable(['Token', 'Price (USD)', 'Mint']);
  priceTable.push(
    [chalk.bold(pool.token_a.symbol), formatUsd(pool.token_a.price_usd || 0), chalk.gray(pool.token_a.mint)],
    [chalk.bold(pool.token_b.symbol), formatUsd(pool.token_b.price_usd || 0), chalk.gray(pool.token_b.mint)]
  );
  console.log(priceTable.toString());

  // 池子价格
  console.log(chalk.cyan('\nPool Price:'));
  console.log(`  1 ${pool.token_a.symbol} = ${pool.current_price.toFixed(8)} ${pool.token_b.symbol}`);

  // 24h 价格范围
  if (pool.price_range_24h && (pool.price_range_24h.low > 0 || pool.price_range_24h.high > 0)) {
    console.log(chalk.cyan('\n24h Price Range:'));
    console.log(`  Low:  ${pool.price_range_24h.low.toFixed(8)}`);
    console.log(`  High: ${pool.price_range_24h.high.toFixed(8)}`);
  }
}

// ============================================
// Token Formatters
// ============================================

export function outputTokensTable(tokens: Token[], total: number): void {
  const table = createTable(['Symbol', 'Name', 'Price', 'Change 24h', 'Volume 24h', 'Mint']);

  for (const token of tokens) {
    table.push([
      chalk.white.bold(token.symbol),
      token.name,
      formatUsd(token.price_usd),
      formatPercent(token.price_change_24h),
      formatUsd(token.volume_24h_usd),
      chalk.gray(token.mint),
    ]);
  }

  console.log(table.toString());
  console.log(chalk.gray(`\nShowing ${tokens.length} of ${total} tokens`));
}

// ============================================
// Overview Formatter
// ============================================

export function outputOverviewTable(overview: GlobalOverview): void {
  console.log(chalk.cyan.bold('\nByreal DEX Overview\n'));

  const table = createTable(['Metric', 'Value', 'Change (24h)']);

  table.push(
    ['TVL', formatUsd(overview.tvl), formatPercent(overview.tvl_change_24h)],
    ['Volume (24h)', formatUsd(overview.volume_24h_usd), formatPercent(overview.volume_change_24h)],
    ['Volume (All Time)', formatUsd(overview.volume_all), '-'],
    ['Fees (24h)', formatUsd(overview.fee_24h_usd), formatPercent(overview.fee_change_24h)],
    ['Fees (All Time)', formatUsd(overview.fee_all), '-'],
    ['Total Pools', overview.pools_count.toString(), '-'],
    ['Active Positions', overview.active_positions.toString(), '-']
  );

  console.log(table.toString());
}

// ============================================
// K-Line Chart Formatter
// ============================================

export function outputKlineChart(klines: Kline[], poolId: string, token: string): void {
  if (klines.length === 0) {
    console.log(chalk.yellow('No K-line data available'));
    return;
  }

  // 按时间正序排列（API 返回的是倒序）
  const sortedKlines = [...klines].sort((a, b) => a.timestamp - b.timestamp);

  // 取最近的数据点（最多 60 个点，适合终端宽度）
  const maxPoints = Math.min(60, sortedKlines.length);
  const data = sortedKlines.slice(-maxPoints);

  // 获取收盘价序列
  const closes = data.map(k => k.close);
  const minPrice = Math.min(...closes);
  const maxPrice = Math.max(...closes);
  const priceRange = maxPrice - minPrice || 1;

  // 图表高度
  const chartHeight = 12;

  // 构建图表
  const chart: string[][] = Array.from({ length: chartHeight }, () =>
    Array.from({ length: data.length }, () => ' ')
  );

  // 填充数据点
  for (let i = 0; i < data.length; i++) {
    const normalizedPrice = (closes[i] - minPrice) / priceRange;
    const row = chartHeight - 1 - Math.round(normalizedPrice * (chartHeight - 1));
    chart[row][i] = '█';

    // 填充柱状（从底部到数据点）
    for (let r = row + 1; r < chartHeight; r++) {
      chart[r][i] = '│';
    }
  }

  // 输出标题
  const firstTime = new Date(data[0].timestamp * 1000);
  const lastTime = new Date(data[data.length - 1].timestamp * 1000);
  console.log(chalk.cyan.bold(`\nK-Line Chart: ${poolId.slice(0, 8)}...`));
  console.log(chalk.gray(`Token: ${token}`));
  console.log(chalk.gray(`Time: ${firstTime.toISOString().slice(0, 16)} → ${lastTime.toISOString().slice(0, 16)}`));
  console.log();

  // 输出图表
  for (let row = 0; row < chartHeight; row++) {
    // 价格标签（左侧）
    const priceAtRow = maxPrice - (row / (chartHeight - 1)) * priceRange;
    const priceLabel = priceAtRow.toPrecision(4).padStart(10);

    // 根据位置着色
    const rowData = chart[row].join('');
    const coloredRow = row < chartHeight / 2
      ? chalk.green(rowData)
      : chalk.red(rowData);

    console.log(`${chalk.gray(priceLabel)} │${coloredRow}│`);
  }

  // 底部边框
  console.log(`${' '.repeat(10)} └${'─'.repeat(data.length)}┘`);

  // 统计信息
  const firstClose = data[0].close;
  const lastClose = data[data.length - 1].close;
  const change = ((lastClose - firstClose) / firstClose) * 100;
  const changeStr = change >= 0
    ? chalk.green(`+${change.toFixed(2)}%`)
    : chalk.red(`${change.toFixed(2)}%`);

  console.log();
  console.log(chalk.white(`  Open:  ${firstClose.toPrecision(6)}  →  Close: ${lastClose.toPrecision(6)}  (${changeStr})`));
  console.log(chalk.white(`  High:  ${maxPrice.toPrecision(6)}      Low:   ${minPrice.toPrecision(6)}`));
  console.log(chalk.gray(`  Points: ${data.length}`));
}

// ============================================
// Wallet Formatters
// ============================================

export function outputWalletAddress(address: string, source: string): void {
  console.log(chalk.cyan.bold('\nWallet Address\n'));
  console.log(chalk.white.bold(`  ${address}`));
  console.log(chalk.gray(`  Source: ${source}`));
}

export function outputWalletInfo(info: WalletInfo): void {
  console.log(chalk.cyan.bold('\nWallet Information\n'));

  const table = createTable(['Field', 'Value']);
  table.push(
    ['Address', chalk.white.bold(info.address)],
    ['Source', info.source_label],
  );

  if (info.keypair_path) {
    table.push(['Keypair Path', chalk.gray(info.keypair_path)]);
  }
  if (info.config_path) {
    table.push(['Config Path', chalk.gray(info.config_path)]);
  }
  console.log(table.toString());
}

export function outputWalletBalance(balance: WalletBalance, address: string): void {
  console.log(chalk.cyan.bold(`\nBalance: ${address}\n`));

  // SOL balance
  const table = createTable(['Mint', 'Balance', 'Program']);
  table.push([
    chalk.gray('native'),
    `${balance.sol.amount_sol.toFixed(9)} SOL${balance.sol.amount_usd ? ` (${formatUsd(balance.sol.amount_usd)})` : ''}`,
    'spl-token',
  ]);

  // SPL token balances
  for (const token of balance.tokens) {
    table.push([
      chalk.gray(token.mint),
      token.amount_ui,
      token.is_token_2022 ? 'token-2022' : 'spl-token',
    ]);
  }

  console.log(table.toString());
  console.log(chalk.gray(`\n  ${balance.tokens.length} SPL token(s)`));
}

export function outputConfigList(config: ByrealConfig): void {
  console.log(chalk.cyan.bold('\nConfiguration\n'));

  const table = createTable(['Key', 'Value']);
  table.push(
    ['keypair_path', config.keypair_path || chalk.gray('(not set)')],
    ['rpc_url', config.rpc_url],
    ['cluster', config.cluster],
    ['defaults.priority_fee_micro_lamports', String(config.defaults.priority_fee_micro_lamports)],
    ['defaults.slippage_bps', String(config.defaults.slippage_bps)],
    ['defaults.require_confirmation', String(config.defaults.require_confirmation)],
    ['defaults.auto_confirm_threshold_usd', String(config.defaults.auto_confirm_threshold_usd)],
  );

  console.log(table.toString());
}

export function outputConfigValue(key: string, value: unknown): void {
  console.log(chalk.cyan(`${key}`) + ': ' + chalk.white(value === undefined ? '(not set)' : String(value)));
}

// ============================================
// Error Formatter
// ============================================

export function outputErrorTable(error: CliError): void {
  console.error(chalk.red.bold(`\nError: ${error.code}`));
  console.error(chalk.red(error.message));

  if (error.details) {
    console.error(chalk.gray('\nDetails:'));
    for (const [key, value] of Object.entries(error.details)) {
      console.error(chalk.gray(`  ${key}: ${JSON.stringify(value)}`));
    }
  }

  if (error.suggestions && error.suggestions.length > 0) {
    console.error(chalk.yellow('\nSuggestions:'));
    for (const suggestion of error.suggestions) {
      console.error(chalk.yellow(`  - ${suggestion.description}`));
      if (suggestion.command) {
        console.error(chalk.gray(`    $ ${suggestion.command}`));
      }
    }
  }
}

// ============================================
// Swap Formatters
// ============================================

export function outputSwapQuoteTable(quote: SwapQuote, uiInAmount: string, uiOutAmount: string): void {
  console.log(chalk.cyan.bold('\nSwap Quote\n'));

  const table = createTable(['Field', 'Value']);
  table.push(
    ['Input Mint', chalk.gray(quote.inputMint)],
    ['Output Mint', chalk.gray(quote.outputMint)],
    ['Input Amount', `${uiInAmount} ${chalk.gray(`(${quote.inAmount} raw)`)}`],
    ['Output Amount', chalk.green.bold(uiOutAmount) + ` ${chalk.gray(`(${quote.outAmount} raw)`)}`],
    ['Router Type', quote.routerType],
  );

  if (quote.priceImpactPct) {
    const impact = parseFloat(quote.priceImpactPct);
    const color = impact > 1 ? chalk.red : impact > 0.5 ? chalk.yellow : chalk.green;
    table.push(['Price Impact', color(`${impact.toFixed(4)}%`)]);
  }

  if (quote.poolAddresses.length > 0) {
    table.push(['Pool(s)', quote.poolAddresses.map(a => chalk.gray(a)).join('\n')]);
  }

  if (quote.orderId) {
    table.push(['Order ID', chalk.gray(quote.orderId)]);
  }
  if (quote.quoteId) {
    table.push(['Quote ID', chalk.gray(quote.quoteId)]);
  }

  console.log(table.toString());
}

export function outputSwapResultTable(
  data: { signatures?: string[]; txSignature?: string; state?: string },
  uiInAmount?: string,
  uiOutAmount?: string,
  priceImpactPct?: string,
): void {
  console.log(chalk.green.bold('\nSwap Executed Successfully\n'));

  const table = createTable(['Field', 'Value']);

  if (uiInAmount) {
    table.push(['Input Amount', uiInAmount]);
  }
  if (uiOutAmount) {
    table.push(['Output Amount', chalk.green.bold(uiOutAmount)]);
  }
  if (priceImpactPct) {
    const impact = parseFloat(priceImpactPct);
    const color = impact > 1 ? chalk.red : impact > 0.5 ? chalk.yellow : chalk.green;
    table.push(['Price Impact', color(`${impact.toFixed(4)}%`)]);
  }

  const sigs = data.signatures || (data.txSignature ? [data.txSignature] : []);
  for (let i = 0; i < sigs.length; i++) {
    const label = sigs.length > 1 ? `Signature ${i + 1}` : 'Signature';
    table.push([label, chalk.gray(sigs[i])]);
    table.push(['Explorer', chalk.blue(`https://solscan.io/tx/${sigs[i]}`)]);
  }

  if (data.state) {
    table.push(['State', data.state]);
  }

  console.log(table.toString());
}

// ============================================
// Position Formatters
// ============================================

export function outputPositionsTable(positions: PositionItem[], total: number): void {
  console.log(chalk.cyan.bold('\nPositions\n'));

  const table = createTable([
    'Pair',
    'NFT Mint',
    'Pool',
    'Liquidity',
    'Earned',
    'PnL',
    'APR',
    'Status',
  ]);

  for (const pos of positions) {
    const statusLabel = pos.status === 0 ? chalk.green('Active') : chalk.gray('Closed');
    const pnlColor = pos.pnlUsd && parseFloat(pos.pnlUsd) >= 0 ? chalk.green : chalk.red;

    table.push([
      chalk.white.bold(pos.pair || '?/?'),
      chalk.gray(pos.nftMintAddress),
      chalk.gray(pos.poolAddress),
      pos.liquidityUsd ? formatUsd(parseFloat(pos.liquidityUsd)) : '-',
      pos.earnedUsd ? formatUsd(parseFloat(pos.earnedUsd)) : '-',
      pos.pnlUsd ? pnlColor(formatUsd(parseFloat(pos.pnlUsd))) : '-',
      pos.apr ? `${parseFloat(pos.apr).toFixed(2)}%` : '-',
      statusLabel,
    ]);
  }

  console.log(table.toString());
  console.log(chalk.gray(`\nShowing ${positions.length} of ${total} positions`));
}

export function outputPositionOpenPreview(data: {
  poolAddress: string;
  tickLower: number;
  tickUpper: number;
  priceLower: string;
  priceUpper: string;
  baseAmount: string;
  baseToken: string;
  otherAmount: string;
  otherToken: string;
}): void {
  console.log(chalk.cyan.bold('\nOpen Position Preview\n'));

  const table = createTable(['Field', 'Value']);
  table.push(
    ['Pool', chalk.gray(data.poolAddress)],
    ['Tick Range', `${data.tickLower} → ${data.tickUpper}`],
    ['Price Range', `${data.priceLower} → ${data.priceUpper}`],
    ['Base Amount', `${data.baseAmount} ${data.baseToken}`],
    ['Other Amount', `${data.otherAmount} ${data.otherToken}`],
  );

  console.log(table.toString());
}

export function outputPositionClosePreview(data: {
  nftMint: string;
  poolAddress: string;
  priceLower: string;
  priceUpper: string;
  tokenAmountA: string;
  tokenAmountB: string;
  feeAmountA: string;
  feeAmountB: string;
  symbolA: string;
  symbolB: string;
}): void {
  console.log(chalk.cyan.bold('\nClose Position Preview\n'));

  const table = createTable(['Field', 'Value']);
  table.push(
    ['NFT Mint', chalk.gray(data.nftMint)],
    ['Pool', chalk.gray(data.poolAddress)],
    ['Price Range', `${data.priceLower} → ${data.priceUpper}`],
    ['Token A to Receive', `${data.tokenAmountA} ${data.symbolA}`],
    ['Token B to Receive', `${data.tokenAmountB} ${data.symbolB}`],
    ['Fee A to Claim', `${data.feeAmountA} ${data.symbolA}`],
    ['Fee B to Claim', `${data.feeAmountB} ${data.symbolB}`],
  );

  console.log(table.toString());
}

export function outputPositionClaimPreview(entries: FeeEncodeEntry[]): void {
  console.log(chalk.cyan.bold('\nFee Claim Preview\n'));

  for (const entry of entries) {
    console.log(chalk.white.bold(`  Position: ${entry.positionAddress}`));
    for (const token of entry.tokens) {
      const uiAmount = rawToUi(String(token.tokenAmount), token.tokenDecimals);
      console.log(chalk.gray(`    ${uiAmount} ${token.tokenSymbol} (${token.tokenAddress})`));
    }
    console.log();
  }

  console.log(chalk.gray(`  ${entries.length} position(s) to claim`));
}

export function outputTransactionResult(title: string, data: {
  signature: string;
  confirmed: boolean;
  nftAddress?: string;
}): void {
  console.log(chalk.green.bold(`\n${title}\n`));

  const table = createTable(['Field', 'Value']);
  table.push(
    ['Signature', chalk.gray(data.signature)],
    ['Explorer', chalk.blue(`https://solscan.io/tx/${data.signature}`)],
    ['Confirmed', data.confirmed ? chalk.green('Yes') : chalk.yellow('Pending')],
  );

  if (data.nftAddress) {
    table.push(['NFT Address', chalk.gray(data.nftAddress)]);
  }

  console.log(table.toString());
}

// ============================================
// Generic Output
// ============================================

export function output<T>(
  data: T,
  format: OutputFormat,
  tableFormatter: (data: T) => void,
  startTime?: number
): void {
  if (format === 'json') {
    outputJson(data, startTime);
  } else {
    tableFormatter(data);
  }
}

export function outputError(error: CliError, format: OutputFormat): void {
  if (format === 'json') {
    outputErrorJson(error);
  } else {
    outputErrorTable(error);
  }
}
