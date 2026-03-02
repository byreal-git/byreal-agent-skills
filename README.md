# Byreal CLI

AI-friendly CLI for [Byreal](https://byreal.io) CLMM DEX on Solana.

## AI Integration

Install as a Skill:

```bash
npx skills add byreal-git/byreal-cli
```

Install cli only:

```bash
npm install -g https://github.com/byreal-git/byreal-cli/releases/latest/download/byreal-cli.tgz
```

## Features

- **Pools** — list, info, K-lines, comprehensive analysis (APR, volatility, risk)
- **Tokens** — list, search, price
- **Swap** — preview and execute token swaps
- **Positions** — open, close, claim fees, analyze performance
- **Wallet** — address, balance, keypair management
- **Config** — RPC URL, slippage, priority fee
- **AI Skill** — `byreal-cli skill` outputs full documentation for LLM consumption

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
```

All commands support `-o json` for structured output.

## Update

```bash
byreal-cli update check
byreal-cli update install
```
