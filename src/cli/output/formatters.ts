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
  WalletBalance,
  ByrealConfig,
  SwapQuote,
  PositionItem,
  TopPositionItem,
  FeeEncodeEntry,
  PositionRewardItem,
  EpochBonusInfo,
  ProviderOverviewInfo,
  RewardOrderResult,
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
  if (value >= 1) {
    return `$${value.toFixed(2)}`;
  }
  if (value >= 0.01) {
    return `$${value.toFixed(4)}`;
  }
  if (value > 0) {
    // Show enough significant digits for very small prices
    return `$${value.toPrecision(4)}`;
  }
  return '$0.00';
}

function formatPairPrice(raw: string): string {
  const value = parseFloat(raw);
  if (!isFinite(value) || value === 0) return '0';
  if (value >= 1) return value.toPrecision(6);
  // For small prices, show 4 significant digits (like formatUsd for < $0.01)
  return value.toPrecision(4);
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
  const table = createTable(['Pair', 'Pool ID', 'TVL', 'Volume 24h', 'Est. APR', 'Fee Rate']);

  for (const pool of pools) {
    const hasRewards = pool.reward_apr > 0;
    const aprDisplay = formatApr(pool.total_apr) + (hasRewards ? chalk.magenta(' (+R)') : '');

    table.push([
      chalk.white.bold(pool.pair),
      chalk.gray(pool.id),
      formatUsd(pool.tvl_usd),
      formatUsd(pool.volume_24h_usd),
      aprDisplay,
      `${(pool.fee_rate_bps / 100).toFixed(2)}%`,
    ]);
  }

  console.log(table.toString());
  console.log(chalk.gray(`\nShowing ${pools.length} of ${total} pools`));
  const hasAnyRewards = pools.some(p => p.reward_apr > 0);
  if (hasAnyRewards) {
    console.log(chalk.magenta('(+R)') + chalk.gray(' = includes reward incentives'));
  }
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
    ['Fee APR', formatApr(pool.apr)],
    ['Reward APR', pool.reward_apr > 0 ? formatApr(pool.reward_apr) : chalk.gray('None')],
    ['Total APR', chalk.bold(formatApr(pool.total_apr))]
  );

  console.log(table.toString());

  // Active Rewards
  if (pool.rewards && pool.rewards.length > 0) {
    console.log(chalk.cyan('\nActive Rewards:'));
    const rewardsTable = createTable(['Token', 'APR', 'Daily Amount', 'Daily USD', 'Ends']);
    for (const r of pool.rewards) {
      const endDate = r.endTime > 0
        ? new Date(r.endTime * 1000).toISOString().slice(0, 10)
        : 'Ongoing';
      rewardsTable.push([
        chalk.white.bold(r.symbol || r.mint),
        formatApr(r.apr),
        r.daily_amount ? parseFloat(r.daily_amount).toLocaleString() : '-',
        r.daily_amount_usd > 0 ? formatUsd(r.daily_amount_usd) : '-',
        chalk.gray(endDate),
      ]);
    }
    console.log(rewardsTable.toString());
  }

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
    ['Total Pools', overview.pools_count.toString(), '-']
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
    ['rpc_url', config.rpc_url],
    ['cluster', config.cluster],
    ['defaults.priority_fee_micro_lamports', String(config.defaults.priority_fee_micro_lamports)],
    ['defaults.slippage_bps', String(config.defaults.slippage_bps)],
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

export function outputPositionIncreasePreview(data: {
  nftMint: string;
  poolAddress: string;
  priceLower: string;
  priceUpper: string;
  baseAmount: string;
  baseToken: string;
  otherAmount: string;
  otherToken: string;
  currentTokenA?: string;
  currentTokenB?: string;
  symbolA?: string;
  symbolB?: string;
}): void {
  console.log(chalk.cyan.bold('\nIncrease Liquidity Preview\n'));

  const table = createTable(['Field', 'Value']);
  table.push(
    ['NFT Mint', chalk.gray(data.nftMint)],
    ['Pool', chalk.gray(data.poolAddress)],
    ['Price Range', `${data.priceLower} → ${data.priceUpper}`],
  );
  if (data.currentTokenA && data.symbolA) {
    table.push(['Current Token A', `${data.currentTokenA} ${data.symbolA}`]);
  }
  if (data.currentTokenB && data.symbolB) {
    table.push(['Current Token B', `${data.currentTokenB} ${data.symbolB}`]);
  }
  table.push(
    ['Base Amount to Add', `${data.baseAmount} ${data.baseToken}`],
    ['Other Amount to Add', `${data.otherAmount} ${data.otherToken}`],
  );

  console.log(table.toString());
}

export function outputPositionDecreasePreview(data: {
  nftMint: string;
  poolAddress: string;
  priceLower: string;
  priceUpper: string;
  percentage: number;
  tokenAmountA: string;
  tokenAmountB: string;
  receiveAmountA: string;
  receiveAmountB: string;
  symbolA: string;
  symbolB: string;
  totalPositionUsd?: string;
  requestedUsd?: string;
}): void {
  console.log(chalk.cyan.bold('\nDecrease Liquidity Preview\n'));

  const table = createTable(['Field', 'Value']);
  table.push(
    ['NFT Mint', chalk.gray(data.nftMint)],
    ['Pool', chalk.gray(data.poolAddress)],
    ['Price Range', `${data.priceLower} → ${data.priceUpper}`],
    ['Current Token A', `${data.tokenAmountA} ${data.symbolA}`],
    ['Current Token B', `${data.tokenAmountB} ${data.symbolB}`],
  );
  if (data.totalPositionUsd) {
    table.push(['Total Position Value', `$${data.totalPositionUsd}`]);
  }
  if (data.requestedUsd) {
    table.push(['Remove Amount', `$${data.requestedUsd}`]);
  }
  table.push(
    ['Remove Percentage', `${data.percentage}%`],
    ['Token A to Receive', `${data.receiveAmountA} ${data.symbolA}`],
    ['Token B to Receive', `${data.receiveAmountB} ${data.symbolB}`],
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

export function outputRewardsPreview(
  items: PositionRewardItem[],
  label: string,
): void {
  if (items.length === 0) {
    console.log(chalk.gray(`\n  No unclaimed ${label}.\n`));
    return;
  }

  console.log(chalk.cyan.bold(`\n${label} Preview\n`));

  // Group by position
  const byPosition = new Map<string, PositionRewardItem[]>();
  for (const item of items) {
    const list = byPosition.get(item.positionAddress) || [];
    list.push(item);
    byPosition.set(item.positionAddress, list);
  }

  for (const [posAddr, rewards] of byPosition) {
    console.log(chalk.white.bold(`  Position: ${posAddr}`));
    for (const r of rewards) {
      const synced = parseFloat(r.syncedTokenAmount);
      const locked = parseFloat(r.lockedTokenAmount);
      const claimed = parseFloat(r.claimedTokenAmount);
      const unclaimed = synced - locked - claimed;
      if (unclaimed <= 0) continue;
      const usdValue = parseFloat(r.price) > 0 ? ` (~$${(unclaimed * parseFloat(r.price)).toFixed(2)})` : '';
      console.log(chalk.gray(`    ${unclaimed.toFixed(r.tokenDecimals > 6 ? 6 : r.tokenDecimals)} ${r.tokenSymbol}${usdValue} (${r.tokenAddress})`));
    }
    console.log();
  }
}

export function outputBonusPreview(
  overview: ProviderOverviewInfo,
  epochs: Record<string, EpochBonusInfo | null>,
): void {
  console.log(chalk.cyan.bold('\nCopyFarmer Bonus Overview\n'));

  const table = createTable(['Field', 'Value']);
  table.push(
    ['Total Bonus', `$${overview.totalBonus}`],
    ['Unclaimed Bonus', `$${overview.unclaimedBonus}`],
    ['Copies Bonus', `$${overview.copiesBonus}`],
    ['Follows Bonus', `$${overview.followsBonus}`],
    ['Copies Count', String(overview.copies)],
    ['Follows Count', String(overview.follows)],
  );
  console.log(table.toString());

  // Epoch details
  const epochLabels: Record<string, string> = {
    '1': 'Accruing',
    '2': 'Pending',
    '3': 'Claimable',
  };

  console.log(chalk.cyan.bold('\nEpoch Details\n'));
  for (const [key, label] of Object.entries(epochLabels)) {
    const epoch = epochs[key];
    if (!epoch) {
      console.log(chalk.gray(`  ${label}: none`));
      continue;
    }
    const amount = `$${epoch.totalBonusUsd}`;
    const claimWindow = key === '3'
      ? ` (claim: ${new Date(epoch.claimTime).toLocaleString()} → ${new Date(epoch.endTime).toLocaleString()})`
      : '';
    console.log(chalk.white(`  ${label}: ${amount}${claimWindow}`));
  }
  console.log();
}

// ============================================
// Top Positions Formatters
// ============================================

function formatAge(ms: number): string {
  if (ms <= 0) return '-';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function outputTopPositionsTable(positions: TopPositionItem[], total: number): void {
  console.log(chalk.cyan.bold('\nTop Positions\n'));

  const table = createTable([
    'Rank',
    'Pair',
    'Position',
    'Liquidity',
    'Earned',
    'PnL',
    'Bonus',
    'Copies',
    'Age',
    'Range',
    'Price Range',
  ]);

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const pnlVal = parseFloat(pos.pnlUsd);
    const pnlColor = pnlVal >= 0 ? chalk.green : chalk.red;
    const pnlPercent = pos.pnlUsdPercent ? `(${(parseFloat(pos.pnlUsdPercent) * 100).toFixed(1)}%)` : '';
    const rangeLabel = pos.inRange === true
      ? chalk.green('In')
      : pos.inRange === false
        ? chalk.red('Out')
        : chalk.gray('-');

    const priceRangeLabel = pos.priceLower && pos.priceUpper
      ? chalk.gray(`${formatPairPrice(pos.priceLower)} → ${formatPairPrice(pos.priceUpper)}`)
      : chalk.gray('-');

    table.push([
      chalk.white.bold(String(i + 1)),
      chalk.white.bold(pos.pair || '?/?'),
      chalk.gray(pos.positionAddress),
      formatUsd(parseFloat(pos.liquidityUsd)),
      formatUsd(parseFloat(pos.earnedUsd)),
      pnlColor(`${formatUsd(Math.abs(pnlVal))} ${pnlPercent}`),
      formatUsd(parseFloat(pos.bonusUsd)),
      String(pos.copies),
      formatAge(pos.positionAgeMs),
      rangeLabel,
      priceRangeLabel,
    ]);
  }

  console.log(table.toString());
  console.log(chalk.gray(`\nShowing ${positions.length} of ${total} positions`));
}

export function outputCopyPositionPreview(data: {
  parentPositionAddress: string;
  poolAddress: string;
  pair: string;
  tickLower: number;
  tickUpper: number;
  priceLower: string;
  priceUpper: string;
  investmentUsd: string;
  tokenA: { symbol: string; amount: string; usd?: string };
  tokenB: { symbol: string; amount: string; usd?: string };
  totalUsd?: string;
}): void {
  console.log(chalk.cyan.bold('\nCopy Position Preview\n'));

  const table = createTable(['Field', 'Value']);
  table.push(
    ['Parent Position', chalk.gray(data.parentPositionAddress)],
    ['Pool', chalk.gray(data.poolAddress)],
    ['Pair', chalk.white.bold(data.pair)],
    ['Tick Range', `${data.tickLower} → ${data.tickUpper}`],
    ['Price Range', `${data.priceLower} → ${data.priceUpper}`],
    ['Investment', `$${data.investmentUsd}`],
    [`${data.tokenA.symbol} Amount`, `${data.tokenA.amount}${data.tokenA.usd ? ` ($${data.tokenA.usd})` : ''}`],
    [`${data.tokenB.symbol} Amount`, `${data.tokenB.amount}${data.tokenB.usd ? ` ($${data.tokenB.usd})` : ''}`],
  );

  if (data.totalUsd) {
    table.push(['Total USD', `$${data.totalUsd}`]);
  }

  table.push(['Copy Bonus', chalk.green('Copy earns yield boost + referral rewards for both parties')]);

  console.log(table.toString());
}

// ============================================
// Pool Analysis Formatter
// ============================================

/* eslint-disable @typescript-eslint/no-explicit-any */
export function outputPoolAnalysisTable(data: any): void {
  // Header
  console.log(chalk.cyan.bold(`\nPool Analysis: ${data.pool.pair}`));
  console.log(chalk.gray(`Address: ${data.pool.address}`));
  console.log(chalk.gray(`Category: ${data.pool.category} | Fee Rate: ${data.pool.feeRate} | Tick Spacing: ${data.pool.tickSpacing}\n`));

  // Metrics
  console.log(chalk.cyan.bold('Metrics'));
  const metricsTable = createTable(['Metric', 'Value']);
  metricsTable.push(
    ['TVL', `$${data.metrics.tvl}`],
    ['Volume (24h)', `$${data.metrics.volume24h}`],
    ['Volume (7d)', `$${data.metrics.volume7d}`],
    ['Fees (24h)', `$${data.metrics.fee24h}`],
    ['Fees (7d)', `$${data.metrics.fee7d}`],
    ['Fee APR (24h)', data.metrics.feeApr24h],
    ['Reward APR', data.metrics.rewardApr || chalk.gray('None')],
    ['Total APR', chalk.bold(data.metrics.totalApr)],
    ['Volume/TVL', data.metrics.volumeToTvl],
  );
  console.log(metricsTable.toString());

  // Volatility
  console.log(chalk.cyan.bold('\nVolatility'));
  const volTable = createTable(['Metric', 'Value']);
  volTable.push(
    ['Day Price Range', `${data.volatility.dayPriceRange.low} — ${data.volatility.dayPriceRange.high}`],
    ['Day Range %', data.volatility.dayPriceRangePercent],
  );
  console.log(volTable.toString());

  // Rewards
  if (data.rewards && data.rewards.length > 0) {
    console.log(chalk.cyan.bold('\nRewards'));
    const rewardsTable = createTable(['Token', 'APR', 'Daily Amount', 'Daily USD', 'End Date']);
    for (const r of data.rewards) {
      rewardsTable.push([
        r.token,
        r.apr || '-',
        r.dailyAmount || '-',
        r.dailyAmountUsd || '-',
        r.endTime,
      ]);
    }
    console.log(rewardsTable.toString());
  }

  // Range Analysis
  console.log(chalk.cyan.bold('\nRange Analysis'));
  const rangeTable = createTable([
    'Range %', 'Price Lower', 'Price Upper', 'Fee APR', 'In-Range', 'Rebalance',
  ]);
  for (const r of data.rangeAnalysis) {
    const likelihood = r.inRangeLikelihood === 'high' ? chalk.green(r.inRangeLikelihood)
      : r.inRangeLikelihood === 'medium' ? chalk.yellow(r.inRangeLikelihood)
      : chalk.red(r.inRangeLikelihood);
    const rebalance = r.rebalanceFrequency === 'low' ? chalk.green(r.rebalanceFrequency)
      : r.rebalanceFrequency === 'medium' ? chalk.yellow(r.rebalanceFrequency)
      : chalk.red(r.rebalanceFrequency);
    rangeTable.push([
      `±${r.rangePercent}%`,
      r.priceLower,
      r.priceUpper,
      r.estimatedFeeApr,
      likelihood,
      rebalance,
    ]);
  }
  console.log(rangeTable.toString());

  // Risk Factors
  console.log(chalk.cyan.bold('\nRisk Assessment'));
  const riskTable = createTable(['Factor', 'Level']);
  const colorRisk = (level: string) => {
    if (level === 'low') return chalk.green(level);
    if (level === 'medium') return chalk.yellow(level);
    return chalk.red(level);
  };
  riskTable.push(
    ['TVL Risk', colorRisk(data.riskFactors.tvlRisk)],
    ['Volatility Risk', colorRisk(data.riskFactors.volatilityRisk)],
  );
  console.log(riskTable.toString());
  for (const line of data.riskFactors.summary) {
    console.log(chalk.gray(`  • ${line}`));
  }

  // Wallet Balance (if available)
  if (data.wallet) {
    console.log(chalk.cyan.bold('\nWallet'));
    const walletTable = createTable(['Metric', 'Value']);
    walletTable.push(
      ['Address', chalk.gray(data.wallet.address)],
      ['Balance', `$${data.wallet.balanceUsd}`],
    );
    console.log(walletTable.toString());
    if (data.wallet.warning) {
      console.log(chalk.yellow(`  ${data.wallet.warning}`));
    }
  }

  // Investment Projection
  console.log(chalk.cyan.bold('\nInvestment Projection'));
  const proj = data.investmentProjection;
  const projTable = createTable(['Metric', 'Value']);
  projTable.push(
    ['Investment', `$${proj.amountUsd}`],
    ['Range', `±${proj.rangePercent}% (${proj.priceLower} — ${proj.priceUpper})`],
    ['Daily Fee Est.', `$${proj.dailyFeeEstimate}`],
    ['Weekly Fee Est.', `$${proj.weeklyFeeEstimate}`],
    ['Monthly Fee Est.', `$${proj.monthlyFeeEstimate}`],
  );
  console.log(projTable.toString());
  console.log(chalk.gray(`  ${proj.note}`));
}

// ============================================
// Position Analysis Formatter
// ============================================

export function outputPositionAnalysisTable(data: any): void {
  // Header
  console.log(chalk.cyan.bold(`\nPosition Analysis: ${data.position.pair}`));
  console.log(chalk.gray(`NFT Mint: ${data.position.nftMint}`));
  console.log(chalk.gray(`Pool: ${data.position.pool}`));

  const statusColor = data.position.status === 'active' ? chalk.green : chalk.gray;
  const rangeColor = data.position.inRange ? chalk.green : chalk.red;
  console.log(statusColor(`Status: ${data.position.status}`) + ' | ' + rangeColor(`In Range: ${data.position.inRange ? 'Yes' : 'No'}`));
  console.log();

  // Performance
  console.log(chalk.cyan.bold('Performance'));
  const perfTable = createTable(['Metric', 'Value']);
  const pnlColor = parseFloat(data.performance.pnlUsd) >= 0 ? chalk.green : chalk.red;
  const netColor = parseFloat(data.performance.netReturnUsd) >= 0 ? chalk.green : chalk.red;
  perfTable.push(
    ['Liquidity', `$${data.performance.liquidityUsd}`],
    ['Earned Fees', `$${data.performance.earnedUsd} (${data.performance.earnedPercent})`],
    ['PnL (IL)', pnlColor(`$${data.performance.pnlUsd} (${data.performance.pnlPercent})`)],
    ['Net Return', netColor(`$${data.performance.netReturnUsd} (${data.performance.netReturnPercent})`)],
  );
  console.log(perfTable.toString());

  // Range Health
  console.log(chalk.cyan.bold('\nRange Health'));
  const rangeTable = createTable(['Metric', 'Value']);
  const riskColor = data.rangeHealth.outOfRangeRisk === 'low' ? chalk.green
    : data.rangeHealth.outOfRangeRisk === 'medium' ? chalk.yellow
    : chalk.red;
  rangeTable.push(
    ['Current Price', data.rangeHealth.currentPrice],
    ['Price Range', `${data.position.priceLower} — ${data.position.priceUpper}`],
    ['Distance to Lower', data.rangeHealth.distanceToLower],
    ['Distance to Upper', data.rangeHealth.distanceToUpper],
    ['Range Width', data.rangeHealth.rangeWidth],
    ['Out-of-Range Risk', riskColor(data.rangeHealth.outOfRangeRisk)],
  );
  console.log(rangeTable.toString());

  // Pool Context
  console.log(chalk.cyan.bold('\nPool Context'));
  const poolTable = createTable(['Metric', 'Value']);
  poolTable.push(
    ['Fee APR (24h)', data.poolContext.feeApr24h],
    ['Volume (24h)', `$${data.poolContext.volume24h}`],
    ['TVL', `$${data.poolContext.tvl}`],
    ['Price Change (24h)', data.poolContext.priceChange24h],
  );
  console.log(poolTable.toString());

  // Unclaimed Fees
  console.log(chalk.cyan.bold('\nUnclaimed Fees'));
  const feeTable = createTable(['Token', 'Amount']);
  feeTable.push(
    [data.unclaimedFees.tokenA.symbol, data.unclaimedFees.tokenA.amount],
    [data.unclaimedFees.tokenB.symbol, data.unclaimedFees.tokenB.amount],
  );
  console.log(feeTable.toString());
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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

// ============================================
// Reward Order Result Formatter
// ============================================

export function outputRewardOrderResult(result: RewardOrderResult): void {
  console.log(chalk.green.bold('\nRewards Claimed\n'));

  if (result.claimTokenList.length > 0) {
    console.log(chalk.white.bold('  Claimed Tokens:'));
    for (const token of result.claimTokenList) {
      console.log(chalk.gray(`    ${token.tokenAmount} ${token.tokenSymbol} (${token.tokenAddress})`));
    }
    console.log();
  }

  if (result.txList.length > 0) {
    console.log(chalk.white.bold('  Transactions:'));
    for (const tx of result.txList) {
      const statusLabel = tx.status === 1 ? chalk.green('Success') : tx.status === 2 ? chalk.red('Failed') : chalk.yellow('Sent');
      console.log(chalk.gray(`    ${tx.txSignature} ${statusLabel}`));
      console.log(chalk.blue(`    https://solscan.io/tx/${tx.txSignature}`));
    }
    console.log();
  }
}
