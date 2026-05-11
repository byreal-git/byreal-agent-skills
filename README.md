# Byreal Agent Skills

> **Note:** This is the **RealClaw** internal branch (`openclaw`). Write commands emit unsigned transactions by default (back-compat with the pre-Privy CLI); add `--execute` to sign and broadcast on-chain via the Byreal Privy proxy. All write commands require `--wallet-address <address>` (no local keypair setup). Package name: `@byreal-io/byreal-cli-realclaw`.

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
- **DFlow** — Swap tokens via DFlow order-flow aggregator with MEV protection.
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

# Same swap — emit unsigned base64 transaction for an external signer (default, back-compat)
byreal-cli swap execute \
  --wallet-address <your-wallet-address> \
  --input-mint So11111111111111111111111111111111111111112 \
  --output-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --amount 0.1

# Same swap — sign + broadcast on-chain via Privy
byreal-cli swap execute \
  --wallet-address <your-wallet-address> \
  --input-mint So11111111111111111111111111111111111111112 \
  --output-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --amount 0.1 --execute
```

All commands support `-o json` for structured output.

## Execution Modes (write commands)

Write commands (`swap execute`, `positions open/close/...`, plugin write commands) support three modes:

| Flag           | Behavior                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------- |
| (none)         | **Default (back-compat)**: emit `{ unsignedTransactions: [base64] }` for an external signer    |
| `--execute`    | Sign + broadcast via the Byreal Privy proxy → returns `{ signature, ... }`                     |
| `--dry-run`    | Preview only, no transaction generated                                                         |

`--dry-run` and `--execute` are mutually exclusive.

### Privy Setup (required for `--execute`)

The CLI signs transactions via the Byreal Privy proxy. Configure either:

**Option A — multi-wallet config (`~/.openclaw/realclaw-config.json`):**

```json
{
  "baseUrl": "https://api2.byreal.io",
  "apiBasePath": "/byreal/api/privy-proxy/v1",
  "wallets": [
    { "address": "<your-solana-pubkey>", "token": "oc_at_...", "type": "solana" }
  ]
}
```

**Option B — legacy single token:**

```bash
echo "oc_at_..." > ~/.openclaw/agent_token
byreal-cli config set privy_proxy_url https://api2.byreal.io
```

**Option C — environment variables (CI / debug):**

```bash
export AGENT_TOKEN="oc_at_..."
export PRIVY_PROXY_URL="https://api2.byreal.io"
```

If Privy is not configured, `--execute` fails fast with `PRIVY_NOT_CONFIGURED` and actionable suggestions; the CLI never silently degrades. Drop `--execute` to keep the default unsigned-transaction output and sign with an external tool.

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
| `positions open`          | Open a new CLMM position (supports `--auto-swap` Zap-In with `--execute`) |
| `positions increase`      | Add liquidity to an existing position (supports `--auto-swap` Zap-In with `--execute`) |
| `positions decrease`      | Partially remove liquidity from a position (supports `--auto-swap` Zap-Out with `--execute`) |
| `positions close`         | Close a position (supports `--auto-swap` Zap-Out + incentive preclaim with `--execute`) |
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
| `kamino reserves`         | Show Kamino Lend APY for SOL/USDC/USDT (or a specific token) |
| `kamino deposit`          | Deposit tokens into Kamino Lend                 |
| `kamino withdraw`         | Withdraw tokens from Kamino Lend                |
| `kamino status`           | View Kamino lending positions and yield          |
| `rent reclaim`            | Close empty token accounts to recover SOL rent   |
| `sweep execute`           | Consolidate dust tokens into target token        |
| `dflow swap`              | Swap tokens via DFlow order-flow aggregator       |
| `update check`            | Check for CLI updates                          |

## Update

```bash
byreal-cli update check
byreal-cli update install
```

## License

MIT
