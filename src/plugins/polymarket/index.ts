/**
 * Polymarket plugin — Phase A (auth-free reads + local previews).
 *
 * Command tree: byreal-cli polymarket <category|event|portfolio|funding|order>
 * See docs/polymarket-cli/06-cli-development-plan.md and
 * docs/polymarket-cli/07-phase-a-implementation-and-test.md.
 *
 * Capabilities are filled in as each command lands (C2–C5); the catalog merges
 * them at runtime via getAllCapabilities().
 */

import { Command } from 'commander';
import type { DefiPlugin, Capability } from '../types.js';
import { createCategoryCommand } from './commands/category.js';
import { createEventCommand } from './commands/event.js';
import { createPortfolioCommand } from './commands/portfolio.js';
import { createFundingCommand } from './commands/funding.js';
import { createOrderCommand } from './commands/order.js';
import { createAccountCommand } from './commands/account.js';

const capabilities: Capability[] = [
  {
    id: 'pm.category.list',
    name: 'Polymarket Category List',
    description: 'List Byreal-configured Polymarket categories and their market types',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli polymarket category list',
    params: [],
  },
  {
    id: 'pm.event.list',
    name: 'Polymarket Event List',
    description: 'List active tradable events under a category (volume_desc)',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli polymarket event list --category-id <id>',
    params: [
      { name: 'category-id', type: 'string', required: true, description: 'Byreal category id' },
      { name: 'limit', type: 'integer', required: false, description: 'Max events (default 10)' },
    ],
  },
  {
    id: 'pm.event.detail',
    name: 'Polymarket Event Detail',
    description: 'Event detail (compact/full, neg-risk aware, related_markets)',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli polymarket event detail --event-id <id>',
    params: [
      { name: 'event-id', type: 'string', required: true, description: 'Event id' },
      { name: 'market-id', type: 'string', required: false, description: 'Expand a single market' },
      { name: 'full', type: 'boolean', required: false, description: 'Return all tradable markets' },
      { name: 'compact-markets', type: 'integer', required: false, description: 'Compact top-N (default 5)' },
    ],
  },
  {
    id: 'pm.event.search',
    name: 'Polymarket Event Search',
    description: 'Search whitelisted events by title-like query (Gamma public-search ∩ whitelist)',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli polymarket event search --query <q>',
    params: [
      { name: 'query', type: 'string', required: true, description: 'Title-like English query (rewritten by Skill)' },
      { name: 'limit', type: 'integer', required: false, description: 'Max candidates (default 10)' },
      { name: 'refresh-whitelist', type: 'boolean', required: false, description: 'Force-rebuild the whitelist cache' },
    ],
  },
  {
    id: 'pm.portfolio.read',
    name: 'Polymarket Portfolio Read',
    description: 'Read positions / value / pnl (public parts; L2 cash/orders are Phase B)',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli polymarket portfolio read --evm-wallet-address <addr>',
    params: [
      { name: 'evm-wallet-address', type: 'string', required: false, description: 'EVM EOA (defaults to realclaw-config evm wallet)' },
      { name: 'position-id', type: 'string', required: false, description: 'Read a single position (token id)' },
      { name: 'category-id', type: 'string', required: false, description: 'Filter by category (Phase B routing)' },
    ],
  },
  {
    id: 'pm.order.preview',
    name: 'Polymarket Order Preview',
    description: 'Local order preview: book-sweep worstPrice + absolute slippage + freshness snapshot (read-only)',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli polymarket order preview --token-id <id> --side <buy|sell> --amount <usd>',
    params: [
      { name: 'token-id', type: 'string', required: true, description: 'CLOB outcome token id (asset_id)' },
      { name: 'side', type: 'string', required: true, description: 'buy | sell', enum: ['buy', 'sell'] },
      { name: 'amount', type: 'string', required: false, description: 'BUY: USD to spend (market)' },
      { name: 'size', type: 'string', required: false, description: 'SELL: shares, or limit size' },
      { name: 'order-type', type: 'string', required: false, description: 'market (FOK) | limit (GTC)', default: 'market', enum: ['market', 'limit'] },
      { name: 'price', type: 'string', required: false, description: 'Limit price (limit only)' },
      { name: 'slippage-bps', type: 'integer', required: false, description: 'Absolute Δ market slippage (default 100=0.01)' },
    ],
  },
  {
    id: 'pm.order.place',
    name: 'Polymarket Order Place',
    description: 'Place a market (FOK) order: re-quote → Privy sign → submit → terminal poll',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli polymarket order place --token-id <id> --side <buy|sell> --amount <usd> --execute',
    params: [
      { name: 'token-id', type: 'string', required: true, description: 'CLOB outcome token id (asset_id)' },
      { name: 'side', type: 'string', required: true, description: 'buy | sell', enum: ['buy', 'sell'] },
      { name: 'amount', type: 'string', required: false, description: 'BUY market: USD to spend' },
      { name: 'size', type: 'string', required: false, description: 'SELL market: shares to sell' },
      { name: 'condition-id', type: 'string', required: false, description: 'Market conditionId (readiness market checks)' },
      { name: 'slippage-bps', type: 'integer', required: false, description: 'Absolute Δ market slippage (default 100=0.01)' },
      { name: 'preview', type: 'string', required: false, description: 'Preview snapshot JSON for PREVIEW_EXPIRED check' },
      { name: 'evm-wallet-address', type: 'string', required: false, description: 'EVM EOA (defaults to realclaw-config evm wallet)' },
      { name: 'execute', type: 'boolean', required: false, description: 'Sign + submit (real order); default emits unsigned typed-data' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview signed price + readiness only' },
    ],
  },
  {
    id: 'pm.account.deploy',
    name: 'Polymarket Account Deploy',
    description: 'Deploy the proxy/deposit wallet (POST /wallet/deploy → poll READY)',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli polymarket account deploy --execute',
    params: [
      { name: 'evm-wallet-address', type: 'string', required: false, description: 'EVM EOA (defaults to realclaw-config evm wallet)' },
      { name: 'execute', type: 'boolean', required: false, description: 'Trigger the deploy; default reports status only' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Report current wallet status only' },
    ],
  },
  {
    id: 'pm.account.readiness',
    name: 'Polymarket Account Readiness',
    description: 'Pre-trade gate: proxy READY + balance (BUY/SELL) + market state (L2)',
    category: 'query',
    auth_required: true,
    command: 'byreal-cli polymarket account readiness --token-id <id> --side <buy|sell>',
    params: [
      { name: 'token-id', type: 'string', required: true, description: 'CLOB outcome token id (asset_id)' },
      { name: 'side', type: 'string', required: true, description: 'buy | sell', enum: ['buy', 'sell'] },
      { name: 'amount', type: 'string', required: false, description: 'BUY: USD needed (COLLATERAL)' },
      { name: 'size', type: 'string', required: false, description: 'SELL: shares needed (CONDITIONAL)' },
      { name: 'condition-id', type: 'string', required: false, description: 'Market conditionId (enables market-state checks)' },
      { name: 'evm-wallet-address', type: 'string', required: false, description: 'EVM EOA (defaults to realclaw-config evm wallet)' },
    ],
  },
  {
    id: 'pm.funding.balance',
    name: 'Polymarket Funding Balance',
    description: 'Read Polymarket available balance (public parts)',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli polymarket funding balance --evm-wallet-address <addr>',
    params: [
      { name: 'evm-wallet-address', type: 'string', required: false, description: 'EVM EOA (defaults to realclaw-config evm wallet)' },
    ],
  },
  {
    id: 'pm.funding.deposit.preview',
    name: 'Polymarket Deposit Preview',
    description: 'Preview a Solana USDC → Polymarket deposit (read-only; submit is Phase B)',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli polymarket funding deposit-preview --amount <usdc>',
    params: [
      { name: 'amount', type: 'string', required: true, description: 'Amount in USDC (UI)' },
      { name: 'evm-wallet-address', type: 'string', required: false, description: 'EVM EOA (proxy wallet target)' },
    ],
  },
  {
    id: 'pm.funding.deposit.execute',
    name: 'Polymarket Deposit Execute',
    description: 'Deposit Solana USDC → Polymarket proxy (build SPL transfer → Privy sign → bridge submit → poll)',
    category: 'execute',
    auth_required: true,
    command: 'byreal-cli polymarket funding deposit --amount <usdc> --execute',
    params: [
      { name: 'amount', type: 'string', required: true, description: 'Amount in USDC' },
      { name: 'evm-wallet-address', type: 'string', required: false, description: 'EVM EOA (proxy wallet target)' },
      { name: 'wallet-address', type: 'string', required: false, description: 'Solana source wallet (defaults to realclaw-config solana wallet)' },
      { name: 'execute', type: 'boolean', required: false, description: 'Sign + submit (real transfer); default emits unsigned tx' },
      { name: 'dry-run', type: 'boolean', required: false, description: 'Preview quote + deposit address only' },
    ],
  },
  {
    id: 'pm.funding.withdraw.preview',
    name: 'Polymarket Withdraw Preview',
    description: 'Preview a Polymarket → Solana USDC withdraw (read-only; submit is Phase B)',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli polymarket funding withdraw-preview --amount <usdc> --recipient <solanaAddr>',
    params: [
      { name: 'amount', type: 'string', required: true, description: 'Amount in USDC (UI)' },
      { name: 'recipient', type: 'string', required: true, description: 'Destination Solana wallet' },
      { name: 'evm-wallet-address', type: 'string', required: false, description: 'EVM EOA (proxy wallet source)' },
    ],
  },
  {
    id: 'pm.transfer.status',
    name: 'Polymarket Transfer Status',
    description: 'Read deposit/withdraw bridge transfer status',
    category: 'query',
    auth_required: false,
    command: 'byreal-cli polymarket funding status --type <deposit|withdraw>',
    params: [
      { name: 'type', type: 'string', required: true, description: 'deposit | withdraw', enum: ['deposit', 'withdraw'] },
      { name: 'order-id', type: 'string', required: false, description: 'Bridge order id (optional)' },
      { name: 'evm-wallet-address', type: 'string', required: false, description: 'EVM EOA / proxy wallet' },
    ],
  },
];

export const polymarketPlugin: DefiPlugin = {
  id: 'polymarket',
  name: 'Polymarket',
  createCommand() {
    const cmd = new Command('polymarket').description(
      'Polymarket prediction markets — discover, preview, fund (Phase A)',
    );
    cmd.addCommand(createCategoryCommand());
    cmd.addCommand(createEventCommand());
    cmd.addCommand(createPortfolioCommand());
    cmd.addCommand(createFundingCommand());
    cmd.addCommand(createOrderCommand());
    cmd.addCommand(createAccountCommand());
    return cmd;
  },
  capabilities,
};
