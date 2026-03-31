---
name: byreal-cli-realclaw
description: "RealClaw edition of Byreal DEX CLI (Solana): query pools/tokens/TVL, analyze pool APR & risk, open/close/claim CLMM positions, token swap, wallet balance. Outputs unsigned base64 transactions for hosted wallet signing. Use when user mentions Byreal, LP, liquidity, pools, DeFi positions, token swap, or Solana DEX operations."
metadata:
  openclaw:
    homepage: https://github.com/byreal-git/byreal-agent-skills
    requires:
      bins:
        - byreal-cli
      config: []
    install:
      - kind: node
        package: "@byreal-io/byreal-cli-realclaw"
        global: true
---

# Byreal LP Management

## Get Full Documentation

Always run these commands first to get complete, up-to-date documentation:

```bash
# Complete documentation (commands, parameters, workflows, constraints)
byreal-cli skill

# Structured capability discovery (all capabilities with params)
byreal-cli catalog list

# Detailed parameter info for a specific capability
byreal-cli catalog show <capability-id>
```

## Installation

```bash
# Check if already installed
which byreal-cli && byreal-cli --version

# If @byreal-io/byreal-cli (main branch version) is already installed,
# uninstall it first to avoid bin name conflict:
npm uninstall -g @byreal-io/byreal-cli

# Install
npm install -g @byreal-io/byreal-cli-realclaw
```

## Check for Updates

```bash
byreal-cli update check
```

If an update is available:

```bash
byreal-cli update install
```

## Credentials & Permissions

- **Read-only commands** (pool, token, tvl, stats): No wallet required
- **Write commands** (swap, position open/close/claim): All write commands require `--wallet-address <address>` global option. No local keypair is needed.

## Hard Constraints

1. **`-o json` only for parsing** — when showing results to the user, **omit it** and let the CLI's built-in tables/charts render directly. Never fetch JSON then re-draw charts yourself.
2. **Never truncate on-chain data** — always display the FULL string for: transaction signatures (txid), mint addresses, pool addresses, NFT addresses, wallet addresses. Never use `xxx...yyy` abbreviation.
3. **Default mode outputs unsigned base64 transactions.** Use `--dry-run` for preview.
4. **Large amounts (>$1000)** require explicit confirmation
5. **High slippage (>200 bps)** must warn user
