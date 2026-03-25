---
name: byreal-cli
description: "Byreal DEX (Solana) all-in-one CLI: query pools/tokens/TVL, analyze pool APR & risk, open/close/claim CLMM positions, token swap, wallet & balance management. Use when user mentions Byreal, LP, liquidity, pools, DeFi positions, token swap, or Solana DEX operations."
metadata:
  openclaw:
    homepage: https://github.com/byreal-git/byreal-agent-skills
    requires:
      bins:
        - byreal-cli
      config:
        - ~/.config/byreal/keys/
    install:
      - kind: node
        package: "@byreal-io/byreal-cli"
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

# Install
npm install -g @byreal-io/byreal-cli
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
- **Write commands** (swap, position open/close/claim): Require wallet setup via `byreal-cli wallet set` or `byreal-cli setup`
- Private keys are stored locally at `~/.config/byreal/keys/` with strict file permissions (mode 0600)
- The CLI never transmits private keys over the network — keys are only used locally for transaction signing
- AI agents should **never** ask users to paste private keys in chat; always direct them to run `byreal-cli setup` interactively

## Hard Constraints

1. **`-o json` only for parsing** — when showing results to the user, **omit it** and let the CLI's built-in tables/charts render directly. Never fetch JSON then re-draw charts yourself.
2. **Never truncate on-chain data** — always display the FULL string for: transaction signatures (txid), mint addresses, pool addresses, NFT addresses, wallet addresses. Never use `xxx...yyy` abbreviation.
3. **Never display private keys** - use keypair paths only
4. **Preview first** with `--dry-run`, then `--confirm`
5. **Large amounts (>$1000)** require explicit confirmation
6. **High slippage (>200 bps)** must warn user
7. **Check wallet before write ops** — run `wallet address` before any wallet-required command
