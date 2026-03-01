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

Byreal CLI is an AI-friendly tool for managing CLMM liquidity positions on Byreal DEX (Solana).

## Setup

\`\`\`bash
# First-time installation (run once per session)
npm install -g @byreal/byreal-cli

# Verify installation
byreal-cli --version
\`\`\`

## Quick Reference

**Important**: Use \`-o json\` to get structured JSON output for programmatic/LLM consumption. Without \`-o json\`, output is human-readable (tables, charts).

| User Intent | Command |
|-------------|---------|
| List pools | \`byreal-cli pools list -o json\` |
| Pool details | \`byreal-cli pools info <pool-id> -o json\` |
| List tokens | \`byreal-cli tokens list -o json\` |
| Global stats | \`byreal-cli overview -o json\` |
| K-line data | \`byreal-cli pools klines <pool-id> -o json\` |
| Swap preview | \`byreal-cli swap execute --input-mint <mint> --output-mint <mint> --amount <amount> --dry-run -o json\` |
| Swap execute | \`byreal-cli swap execute --input-mint <mint> --output-mint <mint> --amount <amount> --confirm -o json\` |
| List positions | \`byreal-cli positions list -o json\` |
| Open position | \`byreal-cli positions open --pool <addr> --price-lower <p> --price-upper <p> --base <token> --amount <amount> --confirm -o json\` |
| Close position | \`byreal-cli positions close --nft-mint <addr> --confirm -o json\` |
| Claim fees | \`byreal-cli positions claim --nft-mints <addrs> --confirm -o json\` |
| Wallet address | \`byreal-cli wallet address -o json\` |
| Wallet balance | \`byreal-cli wallet balance -o json\` |
| Set keypair | \`byreal-cli wallet set <keypair-path>\` |
| Config list | \`byreal-cli config list -o json\` |
| First-time setup | \`byreal-cli setup\` |

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
byreal-cli pools klines 86zmTi...xVkt --interval 1h -o json

# Specify token explicitly
byreal-cli pools klines 86zmTi...xVkt --token D6xWgR...pump --interval 15m -o json
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
Open a new CLMM position. **All amounts use UI format** — decimals are auto-resolved.

\`\`\`bash
byreal-cli positions open [options]

Options:
  --pool <address>         Pool address (required)
  --price-lower <price>    Lower price bound (required)
  --price-upper <price>    Upper price bound (required)
  --base <token>           Base token: MintA or MintB (required)
  --amount <amount>        Amount of base token, UI format (required). Decimals auto-resolved.
  --slippage <bps>         Slippage tolerance in basis points
  --raw                    Amount is already in raw (smallest unit) format
  --dry-run                Preview the position without opening
  --confirm                Open the position
\`\`\`

**Balance Check**: \`--dry-run\` automatically checks if your wallet has sufficient balance for both tokens. If balance is insufficient, the response includes \`balanceWarnings\` (JSON) or a red warning (table) with the deficit amount and a suggested \`swap execute\` command.

Examples:
\`\`\`bash
# Preview opening a position (includes balance check)
byreal-cli positions open --pool <pool-address> \\
  --price-lower 100 --price-upper 200 --base MintA --amount 10 --dry-run -o json

# Execute open
byreal-cli positions open --pool <pool-address> \\
  --price-lower 100 --price-upper 200 --base MintA --amount 10 --confirm -o json
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

## Amount Handling

**All token amounts (--amount) use UI format by default.** For example, \`--amount 0.1\` means 0.1 tokens, not 0.1 lamports. The CLI automatically resolves token decimals based on the mint address:
- Common tokens (SOL, USDC, USDT, etc.) are resolved instantly from built-in registry
- Uncommon tokens are resolved via on-chain RPC lookup

You do NOT need to pass token decimals or convert amounts manually. Use \`--raw\` only if you explicitly need to pass raw (smallest unit) amounts.

## Workflow: Open Position with Insufficient Balance

When \`positions open --dry-run\` reports insufficient balance (\`balanceWarnings\` in JSON), follow this workflow:

1. **Read the deficit**: Check which token(s) are insufficient and the exact deficit amount
2. **Decide swap source**: Choose which token to swap FROM. Recommended strategy:
   - Prefer swapping from the token with the highest available balance
   - Prefer stablecoins (USDC, USDT) as source when possible
   - If unsure, ask the user which token to use as source
3. **Execute swap**: Use \`byreal-cli swap execute --input-mint <source-mint> --output-mint <deficit-token-mint> --amount <deficit-amount> --dry-run\` to preview, then \`--confirm\` to execute
4. **Re-run open**: After swap completes, re-run \`positions open --dry-run\` to verify balances, then \`--confirm\`

**Important**: The CLI only reports the deficit — the LLM must decide the swap strategy (source token, amount, slippage). Do NOT assume a fixed swap path.

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

## Capability Discovery

Use \`byreal-cli catalog\` to discover capabilities:

\`\`\`bash
# List all capabilities
byreal-cli catalog list -o json

# Search capabilities
byreal-cli catalog search pool

# Show capability details with full parameter info
byreal-cli catalog show dex.pool.list -o json
\`\`\`

| Capability ID | Description |
|---------------|-------------|
| dex.pool.list | Query pool list with sorting/filtering |
| dex.pool.info | Get pool details |
| dex.pool.klines | Get K-line data |
| dex.token.list | Query tokens with search |
| dex.overview.global | Global statistics |
| dex.swap.execute | Preview or execute a token swap |
| dex.position.list | List user's CLMM positions |
| dex.position.open | Open a new CLMM position |
| dex.position.close | Close a position |
| dex.position.claim | Claim accumulated fees |
| wallet.address | Show wallet address |
| wallet.balance | Query wallet balance |
| wallet.info | Detailed wallet info |
| wallet.set | Set keypair path |
| wallet.reset | Remove keypair config |
| config.list | List all config values |
| setup | Interactive first-time setup |

## Global Options

| Option | Description |
|--------|-------------|
| -o, --output | Output format: json, table |
| --keypair-path | Path to keypair file (overrides config) |
| --non-interactive | Disable interactive prompts |
| --debug | Show debug information |
| -v, --version | Show version |
| -h, --help | Show help |

## Hard Constraints (Do NOT violate)

1. **Always use -o json** when processing data programmatically
2. **Never request or display private keys** - use keypair file paths only
3. **For write operations**: Always preview with --dry-run first, then --confirm
4. **Large amounts (> $10,000)**: Require explicit user confirmation
5. **High slippage (> 200 bps)**: Warn user before proceeding
6. **Token amounts use UI format** - pass amounts as human-readable values (e.g., 0.1 for 0.1 SOL). Never manually convert to raw/lamport units. The CLI handles all decimals internally.
7. **No need to pass token decimals** - the CLI auto-resolves decimals from mint address

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
