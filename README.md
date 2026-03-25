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

- **Pools** — List, search, and inspect CLMM pools. View K-line charts, APR, TVL, volume, and run comprehensive pool analysis (risk, volatility, range recommendations).
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
| `positions list`          | List your CLMM positions                       |
| `positions open`          | Open a new CLMM position                       |
| `positions close`         | Close a position                               |
| `positions claim`         | Claim fees and rewards                         |
| `positions analyze`       | Analyze an existing position                   |
| `positions top-positions` | View top positions in a pool                   |
| `positions copy`          | Copy a farmer's position                       |
| `wallet address`          | Show wallet address                            |
| `wallet balance`          | Show wallet balances                           |
| `setup`                   | Interactive first-time setup                   |
| `update check`            | Check for CLI updates                          |

## Update

```bash
byreal-cli update check
byreal-cli update install
```

## License

MIT
