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
    description: 'Query available liquidity pools with sorting and filtering',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli pools list',
    params: [
      { name: 'sort-field', type: 'string', required: false, description: 'Sort field', default: 'tvl', enum: ['tvl', 'volumeUsd24h', 'feeUsd24h', 'apr24h'] },
      { name: 'sort-type', type: 'string', required: false, description: 'Sort order', default: 'desc', enum: ['asc', 'desc'] },
      { name: 'page', type: 'integer', required: false, description: 'Page number', default: '1' },
      { name: 'page-size', type: 'integer', required: false, description: 'Results per page', default: '20' },
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
    description: 'Comprehensive pool analysis: metrics, volatility, multi-range APR comparison, risk assessment, and investment projection',
    category: 'analyze',
    auth_required: false,
    command: 'byreal-cli pools analyze <pool-id>',
    params: [
      { name: 'pool-id', type: 'string', required: true, description: 'Pool address' },
      { name: 'amount', type: 'string', required: false, description: 'Simulated investment amount in USD', default: '1000' },
      { name: 'ranges', type: 'string', required: false, description: 'Custom range percentages, comma-separated', default: '1,5,10,20,50' },
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
      { name: 'page-size', type: 'integer', required: false, description: 'Results per page', default: '50' },
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
    id: 'wallet.address',
    name: 'Wallet Address',
    description: 'Show wallet public key address',
    category: 'query',
    auth_required: true,
    command: 'byreal-cli wallet address',
    params: [],
  },
  {
    id: 'wallet.balance',
    name: 'Wallet Balance',
    description: 'Query SOL and SPL token balance',
    category: 'query',
    auth_required: true,
    command: 'byreal-cli wallet balance',
    params: [],
  },
  {
    id: 'wallet.info',
    name: 'Wallet Info',
    description: 'Show detailed wallet information (address, source, config)',
    category: 'query',
    auth_required: true,
    command: 'byreal-cli wallet info',
    params: [],
  },
  {
    id: 'wallet.set',
    name: 'Wallet Set',
    description: 'Set keypair path in configuration',
    category: 'execute',
    auth_required: false,
    command: 'byreal-cli wallet set <keypair-path>',
    params: [
      { name: 'keypair-path', type: 'string', required: true, description: 'Path to Solana keypair JSON file' },
    ],
  },
  {
    id: 'wallet.reset',
    name: 'Wallet Reset',
    description: 'Remove all keypair configuration (one-click cleanup)',
    category: 'execute',
    auth_required: false,
    command: 'byreal-cli wallet reset --confirm',
    params: [
      { name: 'confirm', type: 'boolean', required: true, description: 'Confirm deletion' },
    ],
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
    id: 'setup',
    name: 'Setup',
    description: 'Interactive first-time setup (configure wallet by pasting private key)',
    category: 'execute',
    auth_required: false,
    command: 'byreal-cli setup',
    params: [],
  },
  {
    id: 'dex.swap.execute',
    name: 'Swap Execute',
    description: 'Preview (--dry-run) or execute (--confirm) a token swap',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli swap execute',
    params: [
      { name: 'input-mint', type: 'string', required: true, description: 'Input token mint address' },
      { name: 'output-mint', type: 'string', required: true, description: 'Output token mint address' },
      { name: 'amount', type: 'string', required: true, description: 'Amount to swap (UI format, decimals auto-resolved)' },
      { name: 'swap-mode', type: 'string', required: false, description: 'Swap mode', default: 'in', enum: ['in', 'out'] },
      { name: 'slippage', type: 'integer', required: false, description: 'Slippage tolerance in basis points' },
      { name: 'raw', type: 'boolean', required: false, description: 'Amount is already in raw (smallest unit) format' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview the swap without executing' },
      { name: 'confirm', type: 'boolean', required: false, description: 'Execute the swap' },
    ],
  },
  {
    id: 'dex.position.list',
    name: 'List Positions',
    description: 'List user CLMM positions with filtering and sorting',
    category: 'query',
    auth_required: true,
    command: 'byreal-cli positions list',
    params: [
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
    description: 'Analyze existing position: performance (earned, PnL, net return), range health, pool context, and unclaimed fees',
    category: 'analyze',
    auth_required: true,
    command: 'byreal-cli positions analyze <nft-mint>',
    params: [
      { name: 'nft-mint', type: 'string', required: true, description: 'Position NFT mint address' },
    ],
  },
  {
    id: 'dex.position.open',
    name: 'Open Position',
    description: 'Open a new CLMM position. --dry-run checks wallet balance and reports deficit with swap suggestions. If balanceWarnings present, swap to acquire tokens first via dex.swap.execute',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli positions open',
    params: [
      { name: 'pool', type: 'string', required: true, description: 'Pool address' },
      { name: 'price-lower', type: 'string', required: true, description: 'Lower price bound' },
      { name: 'price-upper', type: 'string', required: true, description: 'Upper price bound' },
      { name: 'base', type: 'string', required: true, description: 'Base token', enum: ['MintA', 'MintB'] },
      { name: 'amount', type: 'string', required: true, description: 'Amount of base token (UI format, decimals auto-resolved)' },
      { name: 'slippage', type: 'integer', required: false, description: 'Slippage tolerance in basis points' },
      { name: 'raw', type: 'boolean', required: false, description: 'Amount is already in raw (smallest unit) format' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview the position without opening' },
      { name: 'confirm', type: 'boolean', required: false, description: 'Open the position' },
    ],
  },
  {
    id: 'dex.position.close',
    name: 'Close Position',
    description: 'Close a position and remove all liquidity',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli positions close',
    params: [
      { name: 'nft-mint', type: 'string', required: true, description: 'Position NFT mint address' },
      { name: 'slippage', type: 'integer', required: false, description: 'Slippage tolerance in basis points' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview the close without executing' },
      { name: 'confirm', type: 'boolean', required: false, description: 'Close the position' },
    ],
  },
  {
    id: 'dex.position.claim',
    name: 'Claim Fees',
    description: 'Claim accumulated fees from one or more positions. Uses NFT mint addresses (same as positions list and close)',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli positions claim',
    params: [
      { name: 'nft-mints', type: 'string', required: true, description: 'Comma-separated NFT mint addresses (from positions list)' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview the claim without executing' },
      { name: 'confirm', type: 'boolean', required: false, description: 'Execute the claim' },
    ],
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
    example = 'byreal-cli pools info 7BqW...abc -o json';
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
