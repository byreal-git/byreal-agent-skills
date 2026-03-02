/**
 * Skill command - outputs full documentation for AI consumption
 * 参数与前端 API 保持一致
 */

import { Command } from 'commander';
import { VERSION } from '../../core/constants.js';

// ============================================
// Full SKILL Documentation
// ============================================

const SKILL_DOC = `# Byreal CLI - Full Documentation (v${VERSION})

## Overview

Byreal DEX (Solana) all-in-one CLI: query pools/tokens/TVL, analyze pool APR & risk, open/close/claim CLMM positions, token swap, wallet & balance management. Use when user mentions Byreal, LP, liquidity, pools, DeFi positions, token swap, or Solana DEX operations.

## Installation

\`\`\`bash
# Check if already installed
which byreal-cli && byreal-cli --version

# Install (one-time)
npm install -g https://github.com/byreal-git/byreal-cli/releases/latest/download/byreal-cli.tgz
\`\`\`

## Check for Updates

\`\`\`bash
byreal-cli update check
\`\`\`

If an update is available:
\`\`\`bash
byreal-cli update install
\`\`\`

## Capability Discovery

Use \`byreal-cli catalog\` to discover capabilities:

\`\`\`bash
# List all capabilities
byreal-cli catalog list

# Search capabilities
byreal-cli catalog search pool

# Show capability details with full parameter info
byreal-cli catalog show dex.pool.list
\`\`\`

| Capability ID | Description |
|---------------|-------------|
| dex.pool.list | Query pool list with sorting/filtering |
| dex.pool.info | Get pool details |
| dex.pool.klines | Get K-line data |
| dex.pool.analyze | Comprehensive pool analysis |
| dex.token.list | Query tokens with search |
| dex.overview.global | Global statistics |
| dex.swap.execute | Preview or execute a token swap |
| dex.position.list | List user's CLMM positions |
| dex.position.analyze | Analyze existing position |
| dex.position.open | Open a new CLMM position |
| dex.position.close | Close a position |
| dex.position.claim | Claim accumulated fees |
| wallet.address | Show wallet address |
| wallet.balance | Query wallet balance |
| wallet.info | Detailed wallet info |
| wallet.set | Set keypair path |
| wallet.reset | Remove keypair config |
| config.list | List all config values |
| config.get | Get a specific config value |
| config.set | Set a config value |
| setup | Interactive first-time setup |
| update.check | Check for CLI updates |
| update.install | Install latest CLI version |

## Global Options

| Option | Description |
|--------|-------------|
| -o, --output | Output format: json, table |
| --keypair-path | Path to keypair file (overrides config) |
| --non-interactive | Disable interactive prompts |
| --debug | Show debug information |
| -v, --version | Show version |
| -h, --help | Show help |

## Output Format Rule

- **\`-o json\`**: Use ONLY when you need to parse the result for further logic (e.g., extract pool address to feed into the next command, compare values programmatically).
- **No \`-o json\`** (default table/chart): Use when the user wants to **see** results. The CLI has built-in tables, K-line charts, and formatted analysis output — do NOT fetch JSON and re-draw them yourself.

## Wallet Check

Before executing any command that requires a wallet (swap, positions, wallet balance, etc.), **always check wallet configuration first**:

\`\`\`bash
byreal-cli wallet address
\`\`\`

- If it returns an address → wallet is configured, proceed.
- If it returns \`WALLET_NOT_CONFIGURED\` → tell the user to run \`byreal-cli setup\` first.

Do NOT attempt wallet-required operations without confirming the wallet is configured.

## Amount Handling

**All token amounts (--amount) use UI format by default.** For example, \`--amount 0.1\` means 0.1 tokens, not 0.1 lamports. The CLI automatically resolves token decimals based on the mint address:
- Common tokens (SOL, USDC, USDT, etc.) are resolved instantly from built-in registry
- Uncommon tokens are resolved via on-chain RPC lookup

You do NOT need to pass token decimals or convert amounts manually. Use \`--raw\` only if you explicitly need to pass raw (smallest unit) amounts.

## Hard Constraints (Do NOT violate)

1. **\`-o json\` only for parsing** — when showing results to the user (charts, tables, analysis), **omit it** and let the CLI render directly. Never fetch JSON then re-draw charts/tables yourself.
2. **Never truncate on-chain data** — always display the FULL string for: transaction signatures (txid), mint addresses, pool addresses, NFT addresses, wallet addresses. Never use \`xxx...yyy\` abbreviation.
3. **Never request or display private keys** - use keypair file paths only
4. **For write operations**: Always preview with --dry-run first, then --confirm
5. **Large amounts (> $10,000)**: Require explicit user confirmation
6. **High slippage (> 200 bps)**: Warn user before proceeding
7. **Token amounts use UI format** - pass amounts as human-readable values (e.g., 0.1 for 0.1 SOL). Never manually convert to raw/lamport units. The CLI handles all decimals internally.
8. **No need to pass token decimals** - the CLI auto-resolves decimals from mint address
9. **Check wallet before write ops** — run \`wallet address\` before any wallet-required command

## Quick Reference

| User Intent | Command |
|-------------|---------|
| List pools | \`byreal-cli pools list\` |
| Pool details | \`byreal-cli pools info <pool-id>\` |
| Pool analysis | \`byreal-cli pools analyze <pool-id>\` |
| K-line / price trend | \`byreal-cli pools klines <pool-id>\` |
| List tokens | \`byreal-cli tokens list\` |
| Global stats | \`byreal-cli overview\` |
| Swap preview | \`byreal-cli swap execute --input-mint <mint> --output-mint <mint> --amount <amount> --dry-run\` |
| Swap execute | \`byreal-cli swap execute --input-mint <mint> --output-mint <mint> --amount <amount> --confirm\` |
| List positions | \`byreal-cli positions list\` |
| Open position (USD) | \`byreal-cli positions open --pool <addr> --price-lower <p> --price-upper <p> --amount-usd <usd> --confirm\` |
| Open position (token) | \`byreal-cli positions open --pool <addr> --price-lower <p> --price-upper <p> --base <token> --amount <amount> --confirm\` |
| Close position | \`byreal-cli positions close --nft-mint <addr> --confirm\` |
| Claim fees | \`byreal-cli positions claim --nft-mints <addrs> --confirm\` |
| Analyze position | \`byreal-cli positions analyze <nft-mint>\` |
| Wallet address | \`byreal-cli wallet address\` |
| Wallet balance | \`byreal-cli wallet balance\` |
| Set keypair | \`byreal-cli wallet set <keypair-path>\` |
| Config list | \`byreal-cli config list\` |
| Config get | \`byreal-cli config get <key>\` |
| Config set | \`byreal-cli config set <key> <value>\` |
| First-time setup | \`byreal-cli setup\` |
| Check for updates | \`byreal-cli update check\` |
| Install update | \`byreal-cli update install\` |

## Commands

### pools list
Query available liquidity pools with sorting and filtering.

\`\`\`bash
byreal-cli pools list [options]

Options:
  --sort-field <field>  Sort by: tvl, volumeUsd24h, feeUsd24h, apr24h (default: tvl)
  --sort-type <type>    Sort order: asc, desc (default: desc)
  --page <n>            Page number (default: 1)
  --page-size <n>       Results per page (default: 20)
  --category <cat>      Pool category: 1=stable, 2=xStocks, 4=launchpad, 16=normal
  -o, --output <fmt>    Output format: json, table (default: table)
\`\`\`

Examples:
\`\`\`bash
# Top pools by TVL
byreal-cli pools list --sort-field tvl --page-size 10 -o json

# Top pools by APR
byreal-cli pools list --sort-field apr24h -o json

# Stable pools only
byreal-cli pools list --category 1 -o json
\`\`\`

### pools info
Get detailed information about a specific pool.

\`\`\`bash
byreal-cli pools info <pool-id> -o json
\`\`\`

### pools klines
Get K-line (OHLCV) data for a pool.

\`\`\`bash
byreal-cli pools klines <pool-id> [options]

Options:
  --token <address>     Token mint address (auto-detects base token if not provided)
  --interval <type>     K-line interval: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 12h, 1d (default: 1h)
  --start <timestamp>   Start time (seconds since epoch)
  --end <timestamp>     End time (seconds since epoch, default: now)
\`\`\`

Examples:
\`\`\`bash
# Auto-detect base token
byreal-cli pools klines 9GTj99g9tbz9U6UYDsX6YeRTgUnkYG6GTnHv3qLa5aXq --interval 1h -o json

# Specify token explicitly
byreal-cli pools klines 9GTj99g9tbz9U6UYDsX6YeRTgUnkYG6GTnHv3qLa5aXq --token So11111111111111111111111111111111111111112 --interval 15m -o json
\`\`\`

### tokens list
Query available tokens with search and sorting.

\`\`\`bash
byreal-cli tokens list [options]

Options:
  --search <keyword>    Search by token address (full address only, symbol search not supported)
  --sort-field <field>  Sort by: tvl, volumeUsd24h, price, priceChange24h, apr24h (default: volumeUsd24h)
  --sort <order>        Sort order: asc, desc (default: desc)
  --page <n>            Page number (default: 1)
  --page-size <n>       Results per page (default: 50)
  --category <cat>      Token category filter
  -o, --output <fmt>    Output format: json, table
\`\`\`

Examples:
\`\`\`bash
# Search by token address
byreal-cli tokens list --search EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v -o json

# Top tokens by volume
byreal-cli tokens list --sort-field volumeUsd24h -o json
\`\`\`

### overview
Get global DEX statistics.

\`\`\`bash
byreal-cli overview -o json
\`\`\`

Response includes:
- TVL and 24h change
- Volume (24h and all-time)
- Fees (24h and all-time)

### wallet address
Show wallet public key address.

\`\`\`bash
byreal-cli wallet address -o json
\`\`\`

### wallet balance
Query SOL and SPL token balance.

\`\`\`bash
byreal-cli wallet balance -o json
\`\`\`

### wallet set
Set keypair path in configuration. The keypair file is copied to ~/.config/byreal/keys/ for isolation.

\`\`\`bash
byreal-cli wallet set <keypair-path>
\`\`\`

### wallet info
Show detailed wallet information (address, source, config path).

\`\`\`bash
byreal-cli wallet info -o json
\`\`\`

### wallet reset
Remove all keypair configuration (one-click cleanup).

\`\`\`bash
byreal-cli wallet reset --confirm
\`\`\`

### config list
List all configuration values.

\`\`\`bash
byreal-cli config list -o json
\`\`\`

### config get
Get a specific configuration value by dot-path key.

\`\`\`bash
byreal-cli config get <key>
\`\`\`

Supported keys: keypair_path, rpc_url, cluster, defaults.slippage_bps, defaults.priority_fee_micro_lamports, defaults.require_confirmation, defaults.auto_confirm_threshold_usd

### config set
Set a configuration value with type validation.

\`\`\`bash
byreal-cli config set <key> <value>
\`\`\`

### setup
Interactive first-time setup. Prompts user to paste their private key (JSON byte array or Base58) and saves it to ~/.config/byreal/keys/id.json.

\`\`\`bash
byreal-cli setup
\`\`\`

### swap execute
Preview or execute a token swap. **All amounts use UI format** (e.g., 0.1 means 0.1 tokens) — decimals are auto-resolved by the CLI based on token mint.

\`\`\`bash
byreal-cli swap execute [options]

Options:
  --input-mint <address>   Input token mint address (required)
  --output-mint <address>  Output token mint address (required)
  --amount <amount>        Amount to swap, UI format (required). Decimals auto-resolved.
  --swap-mode <mode>       Swap mode: in or out (default: in)
  --slippage <bps>         Slippage tolerance in basis points
  --raw                    Amount is already in raw (smallest unit) format
  --dry-run                Preview the swap without executing
  --confirm                Execute the swap
\`\`\`

Examples:
\`\`\`bash
# Preview swap: 0.1 SOL → USDC
byreal-cli swap execute --input-mint So11111111111111111111111111111111111111112 \\
  --output-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \\
  --amount 0.1 --dry-run -o json

# Execute swap
byreal-cli swap execute --input-mint So11111111111111111111111111111111111111112 \\
  --output-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \\
  --amount 0.1 --confirm -o json
\`\`\`

### positions list
List user's CLMM positions.

\`\`\`bash
byreal-cli positions list [options]

Options:
  --page <n>             Page number (default: 1)
  --page-size <n>        Page size (default: 20)
  --sort-field <field>   Sort field
  --sort-type <type>     Sort direction: asc or desc
  --pool <address>       Filter by pool address
  --status <status>      Filter by status: 0=closed, 1=active
\`\`\`

### positions open
Open a new CLMM position. Supports two modes: specify token amount (--amount) or USD investment (--amount-usd).

\`\`\`bash
byreal-cli positions open [options]

Options:
  --pool <address>         Pool address (required)
  --price-lower <price>    Lower price bound (required)
  --price-upper <price>    Upper price bound (required)
  --base <token>           Base token: MintA or MintB (required with --amount)
  --amount <amount>        Amount of base token, UI format. Decimals auto-resolved.
  --amount-usd <usd>       Investment amount in USD. Auto-calculates token A/B split.
                           Mutually exclusive with --amount and --base.
  --slippage <bps>         Slippage tolerance in basis points
  --raw                    Amount is already in raw (smallest unit) format
  --dry-run                Preview the position without opening
  --confirm                Open the position
\`\`\`

**Two modes**:
- \`--amount + --base\`: You specify exact token amount. CLI calculates the paired token.
- \`--amount-usd\`: You specify USD budget. CLI auto-splits into tokenA + tokenB based on current price and range. Response includes USD breakdown per token.

**Balance Check**: \`--dry-run\` automatically checks if your wallet has sufficient balance for both tokens. If balance is insufficient, the response includes \`balanceWarnings\` (JSON) or a red warning (table) with the deficit amount and a suggested \`swap execute\` command.

Examples:
\`\`\`bash
# By USD amount (recommended for "开价值 100U 的仓位" scenarios)
byreal-cli positions open --pool <pool-address> \\
  --price-lower 4000 --price-upper 7000 --amount-usd 100 --dry-run -o json

# By token amount (existing behavior)
byreal-cli positions open --pool <pool-address> \\
  --price-lower 100 --price-upper 200 --base MintA --amount 10 --dry-run -o json

# Execute open
byreal-cli positions open --pool <pool-address> \\
  --price-lower 4000 --price-upper 7000 --amount-usd 100 --confirm -o json
\`\`\`

### positions close
Close a position (remove all liquidity).

\`\`\`bash
byreal-cli positions close [options]

Options:
  --nft-mint <address>     Position NFT mint address (required)
  --slippage <bps>         Slippage tolerance in basis points
  --dry-run                Preview the close without executing
  --confirm                Close the position
\`\`\`

### positions claim
Claim accumulated fees from one or more positions.

\`\`\`bash
byreal-cli positions claim [options]

Options:
  --nft-mints <addresses>  Comma-separated NFT mint addresses (required, from positions list)
  --dry-run                Preview the claim without executing
  --confirm                Execute the claim
\`\`\`

### pools analyze
Comprehensive pool analysis: metrics, volatility, multi-range APR comparison, risk assessment, and investment projection.

\`\`\`bash
byreal-cli pools analyze <pool-id> [options]

Options:
  --amount <usd>       Simulated investment amount in USD (default: wallet balance, fallback 1000)
  --ranges <percents>  Custom range percentages, comma-separated (default: 1,2,3,5,8,10,15,20,35,50)
\`\`\`

Response includes:
- **pool**: Basic info (address, pair, category, currentPrice, feeRate, tickSpacing)
- **metrics**: TVL, volume (24h/7d), fees (24h/7d), feeApr24h, volumeToTvl ratio
- **volatility**: 24h price range (low/high) and dayPriceRangePercent
- **rewards**: Active reward programs (token, endTime)
- **rangeAnalysis**: For each range %, shows priceLower/Upper, estimated fee APR, in-range likelihood, rebalance frequency
- **riskFactors**: TVL risk, volatility risk, and human-readable summary
- **wallet**: Wallet address, balanceUsd, and optional low-balance warning (omitted if wallet not configured)
- **investmentProjection**: amountUsd, rangePercent, priceLower/priceUpper, daily/weekly/monthly fee estimates

Examples:
\`\`\`bash
# Default analysis (wallet balance or 1000 USD, ranges: 1,2,3,5,8,10,15,20,35,50)
byreal-cli pools analyze 9GTj99g9tbz9U6UYDsX6YeRTgUnkYG6GTnHv3qLa5aXq -o json

# Custom amount and ranges
byreal-cli pools analyze 9GTj99g9tbz9U6UYDsX6YeRTgUnkYG6GTnHv3qLa5aXq --amount 5000 --ranges 2,5,15 -o json
\`\`\`

### positions analyze
Analyze an existing position: performance, range health, pool context, and unclaimed fees.

\`\`\`bash
byreal-cli positions analyze <nft-mint> -o json
\`\`\`

Response includes:
- **position**: NFT mint, pool, pair, price range, status, inRange
- **performance**: liquidityUsd, earnedUsd/%, pnlUsd/%, netReturnUsd/%
- **rangeHealth**: currentPrice, distance to lower/upper bounds, rangeWidth, outOfRangeRisk
- **poolContext**: feeApr24h, volume24h, tvl, priceChange24h
- **unclaimedFees**: tokenA and tokenB unclaimed fee amounts

## Workflow: Finding Investment Opportunities

When the user asks about investment opportunities, potential pools, or yield farming options:

1. **List top pools**: \`byreal-cli pools list --sort-field apr24h -o json\` — get candidates sorted by APR
2. **Analyze top candidates**: For the top 2-3 pools, run \`byreal-cli pools analyze <pool-id> -o json\` to get detailed metrics (APR, volatility, risk, range analysis). **Do NOT skip this step** — \`pools list\` only shows basic info; \`pools analyze\` provides the detailed evaluation needed for informed recommendations.
3. **Compare and recommend**: Use the analysis data (feeApr, risk summary, rangeAnalysis) to compare pools and give the user concrete recommendations with reasoning.

## Workflow: Open Position by USD Amount (Recommended)

When the user specifies a USD budget (e.g., "开价值 100U 的仓位", "invest $500"):

1. **Analyze pool**: \`byreal-cli pools analyze <pool-id> -o json\` — get full analysis
2. **Choose range** from rangeAnalysis (Conservative ±30%, Balanced ±15%, Aggressive ±5%)
3. **Preview**: \`byreal-cli positions open --pool <id> --price-lower <p> --price-upper <p> --amount-usd <usd> --dry-run -o json\`
   - CLI auto-calculates how much of each token is needed
   - Response includes: tokenA/B amounts, USD breakdown per token, balance warnings
4. **If insufficient balance**: Check \`wallet balance\`, swap from ANY available token (SOL, USDC, etc.)
5. **Execute**: \`byreal-cli positions open ... --amount-usd <usd> --confirm -o json\`

## Workflow: Open Position by Token Amount

When the user specifies an exact token amount:

1. **Analyze pool**: \`byreal-cli pools analyze <pool-id> -o json\`
2. **Choose range**: Conservative → larger range (20-50%), Aggressive → smaller range (1-5%)
3. **Check wallet balance**: \`byreal-cli wallet balance -o json\` — see ALL available tokens
4. **Plan funding**: Swap from ANY token in the wallet (SOL, USDC, USDT, etc.) — not just the pool's own tokens.
5. **Preview position**: \`byreal-cli positions open --pool <id> --price-lower <p> --price-upper <p> --base MintA --amount <amt> --dry-run -o json\`
6. **Execute**: \`byreal-cli positions open ... --confirm -o json\`

## Workflow: Open Position with Insufficient Balance

When \`positions open --dry-run\` reports insufficient balance (\`balanceWarnings\` in JSON), follow this workflow:

1. **Check full wallet**: \`byreal-cli wallet balance -o json\` — see ALL tokens and their balances
2. **Read the deficit**: Check which token(s) are insufficient and the exact deficit amount
3. **Decide swap source**: Choose which token to swap FROM. **Consider ALL tokens in the wallet**, not just the pool's own tokens:
   - Any token with sufficient balance can be used: SOL, USDC, USDT, or any other SPL token
   - Prefer swapping from the token with the highest USD-equivalent balance
   - Prefer stablecoins (USDC, USDT) or SOL as source for lower slippage
   - If the user has SOL but not USDT, swap SOL → needed token (do NOT tell the user they need USDT first)
   - If unsure which token to use, ask the user
4. **Execute swap**: \`byreal-cli swap execute --input-mint <source-mint> --output-mint <deficit-token-mint> --amount <deficit-amount> --dry-run -o json\` to preview, then \`--confirm\`
   - If swap fails with default mode (\`--swap-mode in\`), try \`--swap-mode out\` instead — it may find a different route (e.g., single-pool AMM route) that succeeds.
5. **Wait after swap**: After swap confirms, **wait 3-5 seconds** before checking wallet balance or proceeding. On-chain state and RPC nodes have propagation delay — querying immediately may return stale balances.
6. **Re-run open**: After waiting, re-run \`positions open --dry-run\` to verify balances, then \`--confirm\`

**Important**: The swap source can be ANY token in the wallet. Do NOT default to only using the pool's own tokens. Always check \`wallet balance\` to see what's available.

## Output Format

All commands support \`-o json\` for structured output:

\`\`\`json
{
  "success": true,
  "meta": {
    "timestamp": "2026-02-28T10:30:00Z",
    "version": "${VERSION}",
    "execution_time_ms": 245
  },
  "data": { ... }
}
\`\`\`

Error responses:
\`\`\`json
{
  "success": false,
  "error": {
    "code": "POOL_NOT_FOUND",
    "type": "BUSINESS",
    "message": "Pool not found: xxx",
    "suggestions": [
      {
        "action": "list",
        "description": "List available pools",
        "command": "byreal-cli pools list -o json"
      }
    ]
  }
}
\`\`\`


## Error Handling

When an error occurs, check \`error.suggestions\` for recovery actions:

- \`POOL_NOT_FOUND\` → List available pools
- \`INSUFFICIENT_BALANCE\` → Suggest Swap or reduce amount
- \`NETWORK_ERROR\` → Retry (error is retryable)
- \`WALLET_NOT_CONFIGURED\` → Run \`byreal-cli setup\` or \`wallet set <keypair-path>\`
- \`INVALID_KEYPAIR\` → Check keypair file format (64-byte JSON array)

## Sort Fields Reference

### Pool Sort Fields (--sort-field)
| Field | Description |
|-------|-------------|
| tvl | Total Value Locked (USD) |
| volumeUsd24h | 24-hour trading volume |
| feeUsd24h | 24-hour fee revenue |
| apr24h | 24-hour APR |

### Token Sort Fields (--sort-field)
| Field | Description |
|-------|-------------|
| tvl | Total Value Locked |
| volumeUsd24h | 24-hour trading volume |
| price | Current price (USD) |
| priceChange24h | 24-hour price change % |
| apr24h | 24-hour APR |

## Pool Categories

| Category | Description |
|----------|-------------|
| 1 | Stable pools (e.g., USDC/USDT) |
| 2 | xStocks pools |
| 4 | Launchpad/Reset pools |
| 16 | Normal pools |
`;

// ============================================
// Create Skill Command
// ============================================

export function createSkillCommand(): Command {
  const skill = new Command('skill')
    .description('Output full documentation for AI consumption')
    .action(() => {
      console.log(SKILL_DOC);
    });

  return skill;
}
