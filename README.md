# Byreal Agent Skills

> **Note:** This is the **RealClaw** internal branch (`openclaw`). Write commands output unsigned base64 transactions by default and require `--wallet-address <address>` instead of local keypair setup. Package name: `@byreal-io/byreal-cli-realclaw`.

Agent skills for [Byreal](https://byreal.io) — a concentrated liquidity (CLMM) DEX on Solana. Every command supports structured JSON output, and the built-in skill system lets AI agents discover and use all capabilities automatically.

## AI Integration

Install as an **Agent Skill** so your LLM can discover all capabilities:

```bash
npx skills add https://github.com/byreal-git/byreal-agent-skills/tree/openclaw
```

Or install the CLI only:

```bash
# If @byreal-io/byreal-cli (main branch) is already installed, uninstall first
# to avoid bin name conflict (both packages use the `byreal-cli` binary name):
npm uninstall -g @byreal-io/byreal-cli

npm install -g @byreal-io/byreal-cli-realclaw
```

## Features

- **Pools** — List, search, and inspect CLMM pools. View K-line charts, Est. APR (fee + reward incentive breakdown), TVL, volume, and run comprehensive pool analysis (risk, volatility, range recommendations).
- **Tokens** — List tokens, search by symbol/name, get real-time prices.
- **Swap** — Preview and execute token swaps with slippage control and price impact estimation.
- **Positions** — Open, close, and manage CLMM positions. Claim fees and rewards. Analyze position performance. Copy top farmers' positions with one command.
- **Wallet** — Query wallet balance.
- **Jupiter** — Swap tokens via Jupiter aggregator, get token prices.
- **Kamino** — Deposit and withdraw tokens on Kamino Lend for idle yield.
- **Rent Reclaim** — Close empty SPL token accounts to recover SOL rent.
- **Token Sweep** — Consolidate dust tokens into USDC (or any target) via Jupiter swap + rent reclaim.
- **Config** — Configure RPC URL, slippage tolerance, priority fees.

## Quick Start

```bash
# View top pools by APR
byreal-cli pools list --sort-field apr24h

# Analyze a pool
byreal-cli pools analyze <pool-address>

# Swap 0.1 SOL → USDC (preview)
byreal-cli swap execute \
  --wallet-address <your-wallet-address> \
  --input-mint So11111111111111111111111111111111111111112 \
  --output-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --amount 0.1 --dry-run

# Copy a top farmer's position (outputs unsigned base64 transaction)
byreal-cli positions copy \
  --wallet-address <your-wallet-address> \
  --position <address> --amount-usd 100
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
| `positions open`          | Open a new CLMM position                       |
| `positions increase`      | Add liquidity to an existing position           |
| `positions decrease`      | Partially remove liquidity from a position      |
| `positions close`         | Close a position                               |
| `positions claim`           | Claim trading fees                              |
| `positions claim-rewards`   | Claim incentive rewards from positions           |
| `positions claim-bonus`     | Claim CopyFarmer bonus rewards                  |
| `positions submit-rewards`  | Submit signed reward/bonus transactions to backend |
| `positions analyze`       | Analyze an existing position                   |
| `positions top-positions` | View top positions in a pool                   |
| `positions copy`          | Copy a farmer's position                       |
| `wallet balance`          | Query wallet balance                           |
| `jup swap`                | Swap tokens via Jupiter aggregator              |
| `jup price`               | Get token price from Jupiter                    |
| `kamino deposit`          | Deposit tokens into Kamino Lend                 |
| `kamino withdraw`         | Withdraw tokens from Kamino Lend                |
| `kamino status`           | View Kamino lending positions and yield          |
| `rent reclaim`            | Close empty token accounts to recover SOL rent   |
| `sweep execute`           | Consolidate dust tokens into target token        |
| `update check`            | Check for CLI updates                          |

## Update

```bash
byreal-cli update check
byreal-cli update install
```

## License

MIT
