# Byreal Agent Skills

Agent skills for [Byreal](https://byreal.io) — a concentrated liquidity (CLMM) DEX on Solana. Every command supports structured JSON output, and the built-in skill system lets AI agents discover and use all capabilities automatically.

## AI Integration

Install as an **Agent Skill** so your LLM can discover all capabilities:

```bash
npx skills add byreal-git/byreal-agent-skills
```

Or install the CLI only:

```bash
npm install -g @byreal-io/byreal-cli
```

## Features

- **Pools** — List, search, and inspect CLMM pools. View K-line charts, Est. APR (fee + reward incentive breakdown), TVL, volume, and run comprehensive pool analysis (risk, volatility, range recommendations).
- **Tokens** — List tokens, search by symbol/name, get real-time prices.
- **Swap** — Preview and execute token swaps with slippage control and price impact estimation.
- **Positions** — Open, close, and manage CLMM positions. Claim fees and rewards. Analyze position performance. Copy top farmers' positions with one command.
- **Wallet** — View address and balances, manage keypairs.
- **Config** — Configure RPC URL, slippage tolerance, priority fees.

## Quick Start

```bash
# First-time setup (configure wallet)
byreal-cli setup

# View top pools by APR
byreal-cli pools list --sort-field apr24h

# Analyze a pool
byreal-cli pools analyze <pool-address>

# Swap 0.1 SOL → USDC (preview)
byreal-cli swap execute \
  --input-mint So11111111111111111111111111111111111111112 \
  --output-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --amount 0.1 --dry-run

# Copy a top farmer's position
byreal-cli positions copy --position <address> --amount-usd 100 --confirm
```

All commands support `-o json` for structured output.

## Commands

| Command                   | Description                                    |
| ------------------------- | ---------------------------------------------- |
| `overview`                | Global DEX statistics (TVL, volume, fees)      |
| `pools list`              | List pools with sorting and filtering          |
| `pools info`              | Detailed pool information                      |
| `pools klines`            | K-line / candlestick chart                     |
| `pools analyze`           | Comprehensive pool analysis (APR, risk, range) |
| `tokens list`             | List available tokens                          |
| `swap execute`            | Preview or execute a token swap                |
| `positions list`          | List positions (own wallet or any via --user)   |
| `positions open`          | Open a new CLMM position (Auto Swap supported) |
| `positions increase`      | Add liquidity to an existing position (Auto Swap supported) |
| `positions decrease`      | Partially remove liquidity from a position (Auto Swap supported) |
| `positions close`         | Close a position (Auto Swap supported)         |
| `positions claim`           | Claim trading fees                              |
| `positions claim-rewards`   | Claim incentive rewards from positions           |
| `positions claim-bonus`     | Claim CopyFarmer bonus rewards                  |
| `positions analyze`       | Analyze an existing position                   |
| `positions top-positions` | View top positions in a pool                   |
| `positions copy`          | Copy a farmer's position                       |
| `wallet address`          | Show wallet address                            |
| `wallet balance`          | Show wallet balances                           |
| `setup`                   | Interactive first-time setup                   |
| `update check`            | Check for CLI updates                          |

## Auto Swap (Zap)

The `--auto-swap` flag lets you open / increase / decrease / close positions
with a single token. The Byreal router-service computes the optimal split,
runs an on-chain swap, and atomically deposits or withdraws liquidity in one
transaction.

```bash
# Open a SOL/USDC position with only USDC; backend swaps half into SOL
byreal-cli positions open \
  --pool <POOL> --price-lower 140 --price-upper 180 \
  --base MintB --amount 10 --auto-swap --confirm

# Add liquidity using only the base token
byreal-cli positions increase \
  --nft-mint <NFT> --base MintA --amount 0.05 --auto-swap --confirm

# Decrease 50% of liquidity, receive everything as USDC
byreal-cli positions decrease \
  --nft-mint <NFT> --percentage 50 \
  --auto-swap --output-mint <USDC_MINT> --confirm

# Close position, receive proceeds as USDC
byreal-cli positions close \
  --nft-mint <NFT> --auto-swap --output-mint <USDC_MINT> --confirm
```

Use `--dry-run` first to preview the swap quote (provider, price impact,
estimated token A/B amounts) before sending. Quotes are HMAC-signed with a
30s TTL — if a build-tx call fails because the quote expired, the CLI
re-fetches the quote and retries once automatically.

## Update

```bash
byreal-cli update check
byreal-cli update install
```

## License

MIT
