/**
 * Catalog command - capability discovery
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { TABLE_CHARS, VERSION } from '../../core/constants.js';

// ============================================
// Capability Registry
// ============================================

interface Capability {
  id: string;
  name: string;
  description: string;
  category: 'query' | 'analyze' | 'execute';
  auth_required: boolean;
  command: string;
  params: CapabilityParam[];
}

interface CapabilityParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
  enum?: string[];
}

const CAPABILITIES: Capability[] = [
  {
    id: 'dex.pool.list',
    name: 'List Pools',
    description: 'Query available liquidity pools with Est. APR (fee + reward incentive), sorting and filtering',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli pools list',
    params: [
      { name: 'sort-field', type: 'string', required: false, description: 'Sort field', default: 'tvl', enum: ['tvl', 'volumeUsd24h', 'feeUsd24h', 'apr24h'] },
      { name: 'sort-type', type: 'string', required: false, description: 'Sort order', default: 'desc', enum: ['asc', 'desc'] },
      { name: 'page', type: 'integer', required: false, description: 'Page number', default: '1' },
      { name: 'page-size', type: 'integer', required: false, description: 'Results per page', default: '100' },
      { name: 'category', type: 'string', required: false, description: 'Pool category: 1=stable, 2=xStocks, 4=launchpad, 16=normal' },
    ],
  },
  {
    id: 'dex.pool.info',
    name: 'Pool Info',
    description: 'Get detailed information about a specific pool',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli pools info <pool-id>',
    params: [
      { name: 'pool-id', type: 'string', required: true, description: 'Pool address' },
    ],
  },
  {
    id: 'dex.pool.klines',
    name: 'Pool K-Lines',
    description: 'Get K-line (OHLCV) data for a pool',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli pools klines <pool-id>',
    params: [
      { name: 'pool-id', type: 'string', required: true, description: 'Pool address' },
      { name: 'token', type: 'string', required: false, description: 'Token mint address (auto-detects base token if not provided)' },
      { name: 'interval', type: 'string', required: false, description: 'K-line interval', default: '1h', enum: ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '12h', '1d'] },
      { name: 'start', type: 'integer', required: false, description: 'Start time (seconds since epoch)' },
      { name: 'end', type: 'integer', required: false, description: 'End time (seconds since epoch)' },
    ],
  },
  {
    id: 'dex.pool.analyze',
    name: 'Pool Analysis',
    description: 'Comprehensive pool analysis: metrics (fee APR, reward APR, total APR), volatility, multi-range APR comparison, risk assessment, and investment projection',
    category: 'analyze',
    auth_required: false,
    command: 'byreal-cli pools analyze <pool-id>',
    params: [
      { name: 'pool-id', type: 'string', required: true, description: 'Pool address' },
      { name: 'amount', type: 'string', required: false, description: 'Simulated investment amount in USD', default: 'wallet balance or 1000' },
      { name: 'ranges', type: 'string', required: false, description: 'Custom range percentages, comma-separated', default: '1,2,3,5,8,10,15,20,35,50' },
    ],
  },
  {
    id: 'dex.token.list',
    name: 'List Tokens',
    description: 'Query available tokens with search and sorting',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli tokens list',
    params: [
      { name: 'search', type: 'string', required: false, description: 'Search by token address (full address only)' },
      { name: 'sort-field', type: 'string', required: false, description: 'Sort field', default: 'volumeUsd24h', enum: ['tvl', 'volumeUsd24h', 'price', 'priceChange24h', 'apr24h'] },
      { name: 'sort', type: 'string', required: false, description: 'Sort order', default: 'desc', enum: ['asc', 'desc'] },
      { name: 'page', type: 'integer', required: false, description: 'Page number', default: '1' },
      { name: 'page-size', type: 'integer', required: false, description: 'Results per page', default: '100' },
    ],
  },
  {
    id: 'dex.overview.global',
    name: 'Global Overview',
    description: 'Get global DEX statistics (TVL, volume, fees)',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli overview',
    params: [],
  },
  {
    id: 'wallet.balance',
    name: 'Wallet Balance',
    description: 'Query SOL and SPL token balances for a given wallet address',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli wallet balance --wallet-address <address>',
    params: [],
  },
  {
    id: 'config.list',
    name: 'Config List',
    description: 'List all CLI configuration values',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli config list',
    params: [],
  },
  {
    id: 'config.get',
    name: 'Config Get',
    description: 'Get a specific configuration value by dot-path key',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli config get <key>',
    params: [
      { name: 'key', type: 'string', required: true, description: 'Config key (e.g., rpc_url, defaults.slippage_bps)' },
    ],
  },
  {
    id: 'config.set',
    name: 'Config Set',
    description: 'Set a configuration value with type validation',
    category: 'execute',
    auth_required: false,
    command: 'byreal-cli config set <key> <value>',
    params: [
      { name: 'key', type: 'string', required: true, description: 'Config key (e.g., rpc_url, defaults.slippage_bps)' },
      { name: 'value', type: 'string', required: true, description: 'Value to set' },
    ],
  },
  {
    id: 'dex.swap.execute',
    name: 'Swap Execute',
    description: 'Preview (--dry-run) or execute a token swap. Requires --wallet-address global option.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli swap execute --wallet-address <address>',
    params: [
      { name: 'input-mint', type: 'string', required: true, description: 'Input token mint address' },
      { name: 'output-mint', type: 'string', required: true, description: 'Output token mint address' },
      { name: 'amount', type: 'string', required: true, description: 'Amount to swap (UI format, decimals auto-resolved)' },
      { name: 'swap-mode', type: 'string', required: false, description: 'Swap mode', default: 'in', enum: ['in', 'out'] },
      { name: 'slippage', type: 'integer', required: false, description: 'Slippage tolerance in basis points' },
      { name: 'raw', type: 'boolean', required: false, description: 'Amount is already in raw (smallest unit) format' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview the swap without executing' },
    ],
  },
  {
    id: 'dex.position.list',
    name: 'List Positions',
    description: 'List CLMM positions for your wallet or any wallet address. JSON output includes pre-formatted USD display fields (*UsdDisplay). Use --user to query another wallet (read-only, no --wallet-address needed).',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli positions list',
    params: [
      { name: 'user', type: 'string', required: false, description: 'Query positions for a specific wallet address (read-only)' },
      { name: 'page', type: 'integer', required: false, description: 'Page number', default: '1' },
      { name: 'page-size', type: 'integer', required: false, description: 'Page size', default: '20' },
      { name: 'sort-field', type: 'string', required: false, description: 'Sort field' },
      { name: 'sort-type', type: 'string', required: false, description: 'Sort direction', enum: ['asc', 'desc'] },
      { name: 'pool', type: 'string', required: false, description: 'Filter by pool address' },
      { name: 'status', type: 'string', required: false, description: 'Filter by status: 0=closed, 1=active' },
    ],
  },
  {
    id: 'dex.position.analyze',
    name: 'Position Analysis',
    description: 'Analyze existing position: performance (earned, PnL, net return with formatted USD values), range health, pool context, and unclaimed fees with USD values. Requires --wallet-address global option.',
    category: 'analyze',
    auth_required: true,
    command: 'byreal-cli positions analyze <nft-mint> --wallet-address <address>',
    params: [
      { name: 'nft-mint', type: 'string', required: true, description: 'Position NFT mint address' },
    ],
  },
  {
    id: 'dex.position.open',
    name: 'Open Position',
    description: 'Open a new CLMM position. Two modes: --amount (token amount) or --amount-usd (USD budget, auto-splits into tokenA/B). --dry-run checks wallet balance and reports deficit with swap suggestions. Requires --wallet-address global option.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli positions open --wallet-address <address>',
    params: [
      { name: 'pool', type: 'string', required: true, description: 'Pool address' },
      { name: 'price-lower', type: 'string', required: true, description: 'Lower price bound' },
      { name: 'price-upper', type: 'string', required: true, description: 'Upper price bound' },
      { name: 'base', type: 'string', required: false, description: 'Base token (required with --amount)', enum: ['MintA', 'MintB'] },
      { name: 'amount', type: 'string', required: false, description: 'Amount of base token (UI format). Mutually exclusive with --amount-usd.' },
      { name: 'amount-usd', type: 'string', required: false, description: 'Investment in USD. Auto-calculates token A/B split. Mutually exclusive with --amount.' },
      { name: 'slippage', type: 'integer', required: false, description: 'Slippage tolerance in basis points' },
      { name: 'raw', type: 'boolean', required: false, description: 'Amount is already in raw (smallest unit) format' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview the position without opening' },
    ],
  },
  {
    id: 'dex.position.increase',
    name: 'Increase Liquidity',
    description: 'Add liquidity to an existing position. Two modes: --amount (token amount with --base) or --amount-usd (USD budget, auto-splits). --dry-run checks wallet balance. Requires --wallet-address global option.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli positions increase --wallet-address <address>',
    params: [
      { name: 'nft-mint', type: 'string', required: true, description: 'Position NFT mint address' },
      { name: 'base', type: 'string', required: false, description: 'Base token (required with --amount)', enum: ['MintA', 'MintB'] },
      { name: 'amount', type: 'string', required: false, description: 'Amount of base token to add (UI format). Mutually exclusive with --amount-usd.' },
      { name: 'amount-usd', type: 'string', required: false, description: 'Investment in USD. Auto-calculates token A/B split. Mutually exclusive with --amount.' },
      { name: 'slippage', type: 'integer', required: false, description: 'Slippage tolerance in basis points' },
      { name: 'raw', type: 'boolean', required: false, description: 'Amount is already in raw (smallest unit) format' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview without executing' },
    ],
  },
  {
    id: 'dex.position.decrease',
    name: 'Decrease Liquidity',
    description: 'Partially remove liquidity from a position (keeps position NFT open, unlike close which burns it). Two modes: --percentage (by ratio) or --amount-usd (by USD value). Requires --wallet-address global option.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli positions decrease --wallet-address <address>',
    params: [
      { name: 'nft-mint', type: 'string', required: true, description: 'Position NFT mint address' },
      { name: 'percentage', type: 'string', required: false, description: 'Percentage of liquidity to remove (1-100). Mutually exclusive with --amount-usd.' },
      { name: 'amount-usd', type: 'string', required: false, description: 'USD amount of liquidity to remove. Auto-calculates percentage. Mutually exclusive with --percentage.' },
      { name: 'slippage', type: 'integer', required: false, description: 'Slippage tolerance in basis points' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview without executing' },
    ],
  },
  {
    id: 'dex.position.close',
    name: 'Close Position',
    description: 'Close a position (remove all liquidity and burn position NFT). Requires --wallet-address global option.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli positions close --wallet-address <address>',
    params: [
      { name: 'nft-mint', type: 'string', required: true, description: 'Position NFT mint address' },
      { name: 'slippage', type: 'integer', required: false, description: 'Slippage tolerance in basis points' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview the close without executing' },
    ],
  },
  {
    id: 'dex.position.claim',
    name: 'Claim Fees',
    description: 'Claim accumulated fees from one or more positions. Uses NFT mint addresses (same as positions list and close). Requires --wallet-address global option.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli positions claim --wallet-address <address>',
    params: [
      { name: 'nft-mints', type: 'string', required: true, description: 'Comma-separated NFT mint addresses (from positions list)' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview the claim without executing' },
    ],
  },
  {
    id: 'dex.position.claimRewards',
    name: 'Claim Rewards',
    description: 'Claim incentive rewards from positions (operational rewards added to pools). --dry-run previews unclaimed amounts per position. Requires --wallet-address global option.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli positions claim-rewards --wallet-address <address>',
    params: [
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview unclaimed rewards without claiming' },
    ],
  },
  {
    id: 'dex.position.claimBonus',
    name: 'Claim Bonus',
    description: 'Claim CopyFarmer bonus rewards (earned from copying positions). --dry-run shows epoch bonus overview and claimable amount. Requires --wallet-address global option.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli positions claim-bonus --wallet-address <address>',
    params: [
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview claimable bonus without claiming' },
    ],
  },
  {
    id: 'dex.position.submitRewards',
    name: 'Submit Signed Rewards',
    description: 'Submit signed reward/bonus claim transactions to backend for broadcasting. Used after claim-rewards or claim-bonus generates unsigned transactions and the external wallet signs them. Requires --wallet-address global option.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli positions submit-rewards --wallet-address <address>',
    params: [
      { name: 'order-code', type: 'string', required: true, description: 'Order code from claim-rewards or claim-bonus output' },
      { name: 'signed-payloads', type: 'string', required: true, description: 'JSON array of signed transactions: [{"txCode":"...","poolAddress":"...","signedTx":"<base64>"}]' },
    ],
  },
  {
    id: 'dex.position.topPositions',
    name: 'Top Positions',
    description: 'Query top positions in a pool for copy trading. Each position includes inRange status indicating whether it is currently earning fees.',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli positions top-positions',
    params: [
      { name: 'pool', type: 'string', required: true, description: 'Pool address' },
      { name: 'page', type: 'integer', required: false, description: 'Page number', default: '1' },
      { name: 'page-size', type: 'integer', required: false, description: 'Page size', default: '20' },
      { name: 'sort-field', type: 'string', required: false, description: 'Sort field', default: 'liquidity', enum: ['liquidity', 'earned', 'pnl', 'copies', 'bonus', 'closeTime'] },
      { name: 'sort-type', type: 'string', required: false, description: 'Sort order', default: 'desc', enum: ['asc', 'desc'] },
      { name: 'status', type: 'integer', required: false, description: 'Position status: 0=open, 1=closed', default: '0' },
    ],
  },
  {
    id: 'dex.position.copy',
    name: 'Copy Position',
    description: 'Copy an existing position with the same price range. Records a referral on-chain for copy bonus rewards (yield boost + referral fees). Requires --wallet-address global option.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli positions copy --wallet-address <address>',
    params: [
      { name: 'position', type: 'string', required: true, description: 'Position PDA address to copy (from top-positions output)' },
      { name: 'amount-usd', type: 'string', required: true, description: 'Investment amount in USD' },
      { name: 'slippage', type: 'integer', required: false, description: 'Slippage tolerance in basis points' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview the copy without executing' },
    ],
  },
  {
    id: 'cli.stats',
    name: 'Download Stats',
    description: 'Show CLI download statistics from GitHub Releases',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli stats',
    params: [
      { name: 'detail', type: 'boolean', required: false, description: 'Show per-version download breakdown' },
    ],
  },
  {
    id: 'update.check',
    name: 'Update Check',
    description: 'Check for available CLI updates from GitHub Releases',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli update check',
    params: [],
  },
  {
    id: 'update.install',
    name: 'Update Install',
    description: 'Install the latest CLI version from GitHub',
    category: 'execute',
    auth_required: false,
    command: 'byreal-cli update install',
    params: [],
  },
];

// ============================================
// Search Capabilities
// ============================================

function searchCapabilities(keyword: string): Capability[] {
  const lowerKeyword = keyword.toLowerCase();
  return CAPABILITIES.filter(
    (cap) =>
      cap.id.toLowerCase().includes(lowerKeyword) ||
      cap.name.toLowerCase().includes(lowerKeyword) ||
      cap.description.toLowerCase().includes(lowerKeyword)
  );
}

function outputCapabilitiesTable(capabilities: Capability[]): void {
  const table = new Table({
    head: [chalk.cyan.bold('ID'), chalk.cyan.bold('Name'), chalk.cyan.bold('Category'), chalk.cyan.bold('Auth')],
    chars: TABLE_CHARS,
  });

  for (const cap of capabilities) {
    table.push([
      chalk.white(cap.id),
      cap.name,
      cap.category,
      cap.auth_required ? chalk.yellow('Yes') : chalk.green('No'),
    ]);
  }

  console.log(table.toString());
}

function outputCapabilityDetail(cap: Capability): void {
  console.log(chalk.cyan.bold(`\n${cap.name}`));
  console.log(chalk.gray(`ID: ${cap.id}\n`));
  console.log(`${cap.description}\n`);
  console.log(chalk.white(`Category: ${cap.category}`));
  console.log(chalk.white(`Auth Required: ${cap.auth_required ? 'Yes' : 'No'}`));
  console.log(chalk.white(`\nCommand: ${chalk.green(cap.command)}`));

  if (cap.params.length > 0) {
    console.log(chalk.cyan('\nParameters:'));
    const table = new Table({
      head: [chalk.cyan('Name'), chalk.cyan('Type'), chalk.cyan('Required'), chalk.cyan('Default'), chalk.cyan('Description')],
      chars: TABLE_CHARS,
    });

    for (const param of cap.params) {
      table.push([
        chalk.white(`--${param.name}`),
        param.type,
        param.required ? chalk.yellow('Yes') : 'No',
        param.default || '-',
        param.description,
      ]);
    }

    console.log(table.toString());

    // Show enum values if any
    for (const param of cap.params) {
      if (param.enum) {
        console.log(chalk.gray(`  --${param.name} values: ${param.enum.join(', ')}`));
      }
    }
  }

  console.log(chalk.cyan('\nExample:'));
  let example = cap.command;
  if (cap.id === 'dex.pool.info') {
    example = 'byreal-cli pools info 9GTj99g9tbz9U6UYDsX6YeRTgUnkYG6GTnHv3qLa5aXq -o json';
  } else {
    example = `${cap.command} -o json`;
  }
  console.log(chalk.green(`  ${example}`));
}

// ============================================
// Create Catalog Command
// ============================================

export function createCatalogCommand(): Command {
  const catalog = new Command('catalog')
    .description('Discover available capabilities');

  // Search subcommand
  catalog
    .command('search <keyword>')
    .description('Search capabilities by keyword')
    .action((keyword: string, options: unknown, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals();
      const results = searchCapabilities(keyword);

      if (globalOptions.output === 'json') {
        console.log(JSON.stringify({
          success: true,
          meta: { timestamp: new Date().toISOString(), version: VERSION },
          data: { capabilities: results, total: results.length },
        }, null, 2));
      } else {
        if (results.length === 0) {
          console.log(chalk.yellow(`No capabilities found for "${keyword}"`));
        } else {
          console.log(chalk.cyan(`\nFound ${results.length} capabilities:\n`));
          outputCapabilitiesTable(results);
        }
      }
    });

  // Show subcommand
  catalog
    .command('show <capability-id>')
    .description('Show detailed information about a capability')
    .action((capabilityId: string, options: unknown, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals();
      const cap = CAPABILITIES.find((c) => c.id === capabilityId);

      if (!cap) {
        if (globalOptions.output === 'json') {
          console.log(JSON.stringify({
            success: false,
            error: {
              code: 'CAPABILITY_NOT_FOUND',
              type: 'BUSINESS',
              message: `Capability not found: ${capabilityId}`,
              suggestions: [
                { action: 'search', description: 'Search capabilities', command: 'byreal-cli catalog search <keyword>' },
              ],
            },
          }, null, 2));
        } else {
          console.log(chalk.red(`Capability not found: ${capabilityId}`));
          console.log(chalk.gray('Use "byreal-cli catalog search <keyword>" to find capabilities'));
        }
        process.exit(1);
      }

      if (globalOptions.output === 'json') {
        console.log(JSON.stringify({
          success: true,
          meta: { timestamp: new Date().toISOString(), version: VERSION },
          data: cap,
        }, null, 2));
      } else {
        outputCapabilityDetail(cap);
      }
    });

  // List all (default)
  catalog
    .command('list', { isDefault: true })
    .description('List all capabilities')
    .action((options: unknown, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals();

      if (globalOptions.output === 'json') {
        console.log(JSON.stringify({
          success: true,
          meta: { timestamp: new Date().toISOString(), version: VERSION },
          data: { capabilities: CAPABILITIES, total: CAPABILITIES.length },
        }, null, 2));
      } else {
        console.log(chalk.cyan(`\nAvailable Capabilities (${CAPABILITIES.length}):\n`));
        outputCapabilitiesTable(CAPABILITIES);
      }
    });

  return catalog;
}
