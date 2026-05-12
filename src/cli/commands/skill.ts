/**
 * Skill command - outputs full documentation for AI consumption
 * 参数与前端 API 保持一致
 */

import { Command } from "commander";
import { VERSION } from "../../core/constants.js";

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

# If @byreal-io/byreal-cli (main branch) is installed, uninstall first (bin name conflict):
npm uninstall -g @byreal-io/byreal-cli

# Install
npm install -g @byreal-io/byreal-cli-realclaw
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
| dex.position.list | List positions for your wallet or any wallet via --user |
| dex.position.analyze | Analyze existing position |
| dex.position.open | Open a new CLMM position |
| dex.position.increase | Add liquidity to an existing position |
| dex.position.decrease | Partially remove liquidity from a position |
| dex.position.close | Close a position (remove all liquidity + burn NFT) |
| dex.position.claim | Claim accumulated fees |
| dex.position.claimRewards | Claim incentive rewards from positions |
| dex.position.claimBonus | Claim CopyFarmer bonus rewards |
| dex.position.topPositions | Query top positions in a pool for copy trading |
| dex.position.copy | Copy an existing position with referral bonus |
| wallet.balance | Query wallet balance |
| config.list | List all config values |
| config.get | Get a specific config value |
| config.set | Set a config value |
| cli.stats | Show CLI download statistics |
| update.check | Check for CLI updates |
| update.install | Install latest CLI version |
| defi.jup.swap | Swap tokens via Jupiter aggregator |
| defi.jup.price | Get token prices from Jupiter |
| defi.kamino.reserves | Show Kamino Lend APY for SOL/USDC/USDT (or a specific --token) |
| defi.kamino.deposit | Deposit to Kamino Lend |
| defi.kamino.withdraw | Withdraw from Kamino Lend |
| defi.kamino.status | View Kamino positions and APY |
| defi.rent.reclaim | Close empty accounts to reclaim SOL rent |
| defi.sweep.execute | Consolidate dust tokens into USDC |
| defi.dflow.swap | Swap tokens via DFlow order-flow aggregator |

## Global Options

| Option | Description |
|--------|-------------|
| -o, --output | Output format: json, table |
| --wallet-address \<addr\> | Wallet public key (required for all write commands) |
| --debug | Show debug information |
| -v, --version | Show version |
| -h, --help | Show help |

## Three Execution Modes (write commands)

Every write command (\`swap execute\`, \`positions open/close/increase/decrease/claim/claim-rewards/claim-bonus/copy\`, all plugin write commands like \`jup swap\` / \`dflow swap\` / \`titan swap\` / \`kamino deposit/withdraw\` / \`rent reclaim\` / \`sweep execute\`) supports three modes:

| Mode | Flag | What it does | Output |
|------|------|--------------|--------|
| **unsigned-tx** (default) | (none) | Emit base64 unsigned transaction(s) so an external signer can take over | \`{ unsignedTransactions: [...] }\` (identical to the pre-Privy CLI) |
| **execute** | \`--execute\` | Sign + broadcast on-chain via Privy proxy | \`{ signature: "<txid>", explorer: "https://solscan.io/tx/<txid>" }\` (single tx) or \`{ results: [{index, signature?, error?}], successCount, failCount }\` (multi-tx) |
| **dry-run** | \`--dry-run\` | Preview only — no transaction generated, no signing | Preview JSON / table |

\`--dry-run\` and \`--execute\` are mutually exclusive (CLI errors on both).

**Backward-compatible default**: every write command still emits unsigned transactions by default. To sign + broadcast through the Byreal Privy proxy, add \`--execute\` explicitly.

### Privy Configuration

\`--execute\` requires a Privy agent token + proxy URL. Sources (highest precedence first):

1. Env vars: \`AGENT_TOKEN\`, \`PRIVY_PROXY_URL\`, \`PRIVY_API_BASE_PATH\`
2. \`~/.openclaw/realclaw-config.json\` — \`{ baseUrl, apiBasePath?, wallets: [{ address, token, type: "solana" | "evm" }] }\`. The CLI picks the wallet whose \`address\` matches \`--wallet-address\` and whose \`type === "solana"\`.
3. Legacy: \`~/.openclaw/agent_token\` (single-token file) plus \`~/.config/byreal/config.json#privy_proxy_url\` (or \`byreal-cli config set privy_proxy_url <url>\`).

If Privy is not configured, \`--execute\` fails with \`PRIVY_NOT_CONFIGURED\` and includes actionable suggestions (configure realclaw / configure legacy / drop \`--execute\` to keep the default unsigned output). The CLI never silently degrades.

If \`--wallet-address\` does not match any \`type=solana\` entry in \`realclaw-config.json\`, the CLI fails with \`PRIVY_WALLET_NOT_FOUND\` (rather than fall back to a different wallet's token).

## Hard Constraints (Do NOT violate)

1. **\`-o json\` only for parsing** — when you need to extract values for the next command. When the user wants to **see** results, omit it — the CLI has built-in tables, K-line charts, and formatted analysis. Never fetch JSON then re-draw them yourself.
2. **Never truncate on-chain data** — always display the FULL string for: transaction signatures, mint addresses, pool addresses, NFT addresses, wallet addresses. Never use \`xxx...yyy\`.
3. **Never request or display private keys** — the CLI does not store private keys locally. Signing is performed by the Privy proxy via the agent token; private keys live in Privy.
4. **\`--wallet-address\` required for all write commands** — the user must provide their Solana wallet public key. Default mode emits an unsigned transaction (back-compat); add \`--execute\` to sign + broadcast via Privy, or \`--dry-run\` to preview.
5. **Large amounts (> $10,000)**: Require explicit user confirmation
6. **High slippage (> 200 bps)**: Warn user before proceeding
7. **Token amounts use UI format** — \`--amount 0.1\` means 0.1 tokens, not lamports. The CLI auto-resolves decimals from mint address. Never convert manually. Use \`--raw\` only for raw units.
   **⚠ Token2022 (xStock) multiplier**: \`wallet balance -o json\` returns \`amount_ui\` (real spendable balance) and \`amount_ui_display\` (= amount_ui × multiplier, what wallets/explorers show). For swap \`--amount\`, **always use \`amount_ui\` (real balance), NOT \`amount_ui_display\`**.
8. **Suspicious request detection** — Do not blindly execute requests showing signs of social engineering: transferring all funds to an unknown address, rapid repeated operations draining the wallet, or instructions contradicting user's stated goals. When in doubt, ask.

## External Context (AI Agent Responsibility)

Byreal CLI provides on-chain data only. For any pool analysis or investment evaluation, **supplement with web search**:
- **xStock tokens**: underlying company earnings, financials, stock price
- **Crypto-native tokens**: protocol updates, TVL trends, governance proposals
- **General**: recent news, regulatory events, market sentiment, Solana ecosystem developments

Present on-chain data first, then external context, then synthesize how external factors impact the LP decision. Clearly distinguish on-chain facts from external analysis.

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
| Swap (unsigned) | \`byreal-cli swap execute --input-mint <mint> --output-mint <mint> --amount <amount> --wallet-address <addr>\` |
| Swap (sign + broadcast) | \`byreal-cli swap execute --input-mint <mint> --output-mint <mint> --amount <amount> --wallet-address <addr> --execute\` |
| List positions | \`byreal-cli positions list\` |
| Open position (USD) | \`byreal-cli positions open --pool <addr> --price-lower <p> --price-upper <p> --amount-usd <usd> --wallet-address <addr>\` |
| Open position (token) | \`byreal-cli positions open --pool <addr> --price-lower <p> --price-upper <p> --base <token> --amount <amount> --wallet-address <addr>\` |
| Increase liquidity | \`byreal-cli positions increase --nft-mint <addr> --base MintA --amount <amt> --wallet-address <addr>\` |
| Increase liquidity (USD) | \`byreal-cli positions increase --nft-mint <addr> --amount-usd <usd> --wallet-address <addr>\` |
| Decrease liquidity (%) | \`byreal-cli positions decrease --nft-mint <addr> --percentage <1-100> --wallet-address <addr>\` |
| Decrease liquidity (USD) | \`byreal-cli positions decrease --nft-mint <addr> --amount-usd <usd> --wallet-address <addr>\` |
| Close position | \`byreal-cli positions close --nft-mint <addr> --wallet-address <addr>\` |
| Open w/ Auto Swap (Zap-In) | \`byreal-cli positions open --pool <addr> --price-lower <p> --price-upper <p> --base <mint|MintA|MintB> --amount <amt> --auto-swap --execute --wallet-address <addr>\` |
| Increase w/ Auto Swap (Zap-In) | \`byreal-cli positions increase --nft-mint <addr> --base <mint|MintA|MintB> --amount <amt> --auto-swap --execute --wallet-address <addr>\` |
| Decrease w/ Auto Swap (Zap-Out) | \`byreal-cli positions decrease --nft-mint <addr> --percentage <1-100> --auto-swap --output-mint <mint> --execute --wallet-address <addr>\` |
| Close w/ Auto Swap (Zap-Out + preclaim) | \`byreal-cli positions close --nft-mint <addr> --auto-swap --output-mint <mint> --execute --wallet-address <addr>\` |
| Claim fees | \`byreal-cli positions claim --nft-mints <addrs> --wallet-address <addr>\` |
| Claim incentive rewards | \`byreal-cli positions claim-rewards --wallet-address <addr>\` |
| Claim copy bonus | \`byreal-cli positions claim-bonus --wallet-address <addr>\` |
| Analyze position | \`byreal-cli positions analyze <nft-mint>\` |
| Top positions in pool | \`byreal-cli positions top-positions --pool <addr>\` |
| Copy a position | \`byreal-cli positions copy --position <addr> --amount-usd <usd> --wallet-address <addr>\` |
| Wallet balance | \`byreal-cli wallet balance --wallet-address <addr>\` |
| Config list | \`byreal-cli config list\` |
| Config get | \`byreal-cli config get <key>\` |
| Config set | \`byreal-cli config set <key> <value>\` |
| Check for updates | \`byreal-cli update check\` |
| Install update | \`byreal-cli update install\` |
| Download stats | \`byreal-cli stats\` |
| Detailed download stats | \`byreal-cli stats --detail\` |
| Jupiter swap preview | \`byreal-cli jup swap --input-mint <mint> --output-mint <mint> --amount <amt> --dry-run --wallet-address <addr>\` |
| Jupiter swap execute | \`byreal-cli jup swap --input-mint <mint> --output-mint <mint> --amount <amt> --wallet-address <addr>\` |
| Jupiter token price | \`byreal-cli jup price --mint <mint>\` |
| Kamino APY (SOL/USDC/USDT) | \`byreal-cli kamino reserves\` |
| Kamino APY (specific token) | \`byreal-cli kamino reserves --token <symbol|mint>\` |
| Kamino deposit | \`byreal-cli kamino deposit --amount <amt> --wallet-address <addr>\` |
| Kamino withdraw | \`byreal-cli kamino withdraw --amount <amt> --wallet-address <addr>\` |
| Kamino status | \`byreal-cli kamino status --wallet-address <addr>\` |
| Rent reclaim scan | \`byreal-cli rent reclaim --dry-run --wallet-address <addr>\` |
| Rent reclaim execute | \`byreal-cli rent reclaim --wallet-address <addr>\` |
| DFlow swap preview | \`byreal-cli dflow swap --input-mint <mint> --output-mint <mint> --amount <amt> --dry-run --wallet-address <addr>\` |
| DFlow swap execute | \`byreal-cli dflow swap --input-mint <mint> --output-mint <mint> --amount <amt> --wallet-address <addr>\` |
| Sweep dust preview | \`byreal-cli sweep execute --dry-run --wallet-address <addr>\` |
| Sweep dust execute | \`byreal-cli sweep execute --wallet-address <addr>\` |

## Command Notes

For detailed parameter info on any command, run: \`byreal-cli catalog show <capability-id>\`

### Pool Analysis Response
\`pools analyze\` returns: pool info, metrics (TVL/volume/fees/feeApr), volatility, active rewards (token, APR, daily amount, end date), rangeAnalysis (per range: price bounds, estimated fee APR, in-range likelihood), riskFactors, wallet info, investmentProjection.

### Position Analysis Response
\`positions analyze\` returns: position info (NFT, pool, pair, range, status, inRange), performance (liquidityUsd, earnedUsd/%, pnlUsd/%, netReturnUsd/% — all USD values pre-formatted with $ prefix like "$0.0065"), rangeHealth (distance to bounds, outOfRangeRisk), poolContext, unclaimedFees (each token has symbol, amount, amountUsd; plus totalUsd).
\`positions list\` JSON includes *UsdDisplay fields (e.g. earnedUsdDisplay: "$0.0065") for LLM-friendly reading.

### Position Lifecycle: decrease vs close
- \`decrease --percentage 100\`: Removes all liquidity but **keeps the position NFT**. Can add liquidity again later with \`increase\`.
- \`close\`: Removes all liquidity AND **burns the NFT**. Permanent.

### Three Types of Position Earnings
- **Trading fees** → \`positions claim\` (earned from swap activity in your range)
- **Incentive rewards** → \`positions claim-rewards\` (team-added pool incentives)
- **Copy bonus** → \`positions claim-bonus\` (referral rewards from copy trading)

### Claim Rewards / Bonus: One-Shot Atomic Command (with --execute)

When \`--execute\` is set, \`claim-rewards\` and \`claim-bonus\` are atomic. The CLI internally does encode → Privy sign → backend submit, returns the final order result. **Do not chain skills or call \`submit-rewards\` manually when running with \`--execute\`.**

\`\`\`
byreal-cli positions claim-rewards --wallet-address <addr> --execute -o json
# → { orderCode, txList: [...], claimTokenList: [...] }
\`\`\`

\`txList\` contains the on-chain signatures the backend broadcast. \`claimTokenList\` shows which tokens were claimed.

**Default multi-step flow** (no \`--execute\` flag — back-compat for external signers):
1. \`positions claim-rewards --wallet-address <addr> -o json\` → returns \`{ orderCode, unsignedTransactions: [{ poolAddress, txPayload, txCode, tokens }] }\`
2. External signer signs each \`txPayload\`
3. \`positions submit-rewards --order-code <orderCode> --signed-payloads '[{"txCode":"...","poolAddress":"...","signedTx":"<base64>"}]' --wallet-address <addr>\`

The multi-step flow is the default for backward compatibility; if Privy is configured, prefer \`--execute\` for the one-shot atomic command.

### Copy Bonus Epochs
- **Accruing**: Current epoch, bonus accumulating
- **Pending**: Settlement period, not yet claimable
- **Claimable**: Ready to claim within time window

### Balance Check on Dry-run
\`positions open --dry-run\` and \`positions increase --dry-run\` automatically check wallet balance. If insufficient, response includes \`balanceWarnings\` (deficit) and \`walletBalances\` (all available tokens) — no need to run \`wallet balance\` separately.

**Important caveat:** the dry-run balance check does NOT subtract the SOL fee/rent buffer (see "SOL Buffer for CLMM Position Ops" below). When SOL is one of the deposit tokens, dry-run reporting "sufficient" is necessary-but-not-sufficient — always size the SOL leg against \`sol_balance − buffer\`, not the full balance.

### SOL Buffer for CLMM Position Ops
Opening or increasing a CLMM position consumes SOL **on top of** the SOL you deposit, to pay for account rent + tx + priority fee. The dry-run balance check does not deduct this for you — you must size the deposit yourself.

| Operation                  | Reserve at least | What the buffer pays for                                            |
| -------------------------- | ---------------- | ------------------------------------------------------------------- |
| \`positions open\`         | **0.03 SOL**     | Position NFT mint + position account rent + tick-array init + fees  |
| \`positions increase\`     | **0.01 SOL**     | Tx + priority fee only (no new accounts)                            |
| \`swap execute\`           | **0.01 SOL**     | Tx + priority fee (+ ATA creation if first time for output mint)    |

When SOL is one of the deposit tokens, compute \`usable_sol = sol_balance − buffer\` and size the SOL leg against \`usable_sol\`. For \`--amount-usd\`, cap so the SOL leg's USD value ≤ \`usable_sol × sol_price\`. **Never put 100% of SOL into a position.**

### Config Keys
Supported keys for \`config get/set\`: rpc_url, cluster, defaults.slippage_bps, defaults.priority_fee_micro_lamports, privy_proxy_url, privy_api_base_path

## Workflow: Finding Investment Opportunities

When the user asks about investment opportunities, potential pools, or yield farming options:

1. **List top pools**: \`byreal-cli pools list --sort-field apr24h -o json\` — get candidates sorted by APR
2. **Analyze top candidates**: For the top 2-3 pools, run \`byreal-cli pools analyze <pool-id> -o json\` to get detailed metrics (APR, volatility, risk, range analysis). **Do NOT skip this step** — \`pools list\` only shows basic info; \`pools analyze\` provides the detailed evaluation needed for informed recommendations.
3. **Compare and recommend**: Use the analysis data (feeApr, risk summary, rangeAnalysis) to compare pools and give the user concrete recommendations with reasoning.

## Workflow: Open Position

1. **Analyze pool**: \`byreal-cli pools analyze <pool-id> -o json\`
2. **Choose range** from rangeAnalysis (Conservative ±30%, Balanced ±15%, Aggressive ±5%)
3. **Reserve SOL buffer FIRST**: read SOL balance, compute \`usable_sol = sol_balance − 0.03\`. If the pool's token pair includes SOL, size the SOL leg against \`usable_sol\`, never against the full balance. For \`--amount-usd\`, cap so the SOL leg ≤ \`usable_sol × sol_price\`. (See "SOL Buffer for CLMM Position Ops".)
4. **Preview**:
   - USD budget: \`positions open --pool <id> --price-lower <p> --price-upper <p> --amount-usd <usd> --dry-run -o json\`
   - Token amount: \`positions open --pool <id> --price-lower <p> --price-upper <p> --base MintA --amount <amt> --dry-run -o json\`
5. **If insufficient balance**: dry-run response includes \`balanceWarnings\` (deficit) + \`walletBalances\` (all tokens). Pick a swap source from ANY token in the wallet (prefer highest USD balance, stablecoins/SOL for lower slippage), swap to cover the deficit. **Wait 3-5 seconds** after swap before re-running dry-run (RPC propagation delay). **Do not swap repeatedly — recompute the position math first** (see "Position Math Sanity Check" in Troubleshooting).
6. **Run for real**: drop \`--dry-run\` (keep \`--wallet-address <addr>\`). The default emits an unsigned base64 transaction \`{ unsignedTransactions: [...] }\` for an external signer (back-compat). Add \`--execute\` to sign + broadcast via Privy directly → \`{ signature, explorer }\`.

## Workflow: Increase/Decrease Liquidity

When user wants to add more liquidity to an existing position or partially withdraw:

**Increase liquidity**:
1. \`byreal-cli positions list -o json\` — find the position's NFT mint address
2. Reserve **0.01 SOL** buffer; if the pool includes SOL, size the SOL leg against \`sol_balance − 0.01\`.
3. \`byreal-cli positions increase --nft-mint <nft-mint> --amount-usd <usd> --dry-run -o json\` — preview (includes balance check; remember it does NOT deduct the SOL buffer)
4. If insufficient balance → swap to get required tokens (see "Insufficient Balance" workflow). Re-run dry-run after the swap settles — don't assume the prior deficit number still applies.
5. \`byreal-cli positions increase --nft-mint <nft-mint> --amount-usd <usd> --wallet-address <addr> -o json\` — emit unsigned tx (default). Add \`--execute\` to sign + broadcast via Privy.

**Decrease liquidity** (partial withdrawal):
1. \`byreal-cli positions list -o json\` — find the position's NFT mint address
2. \`byreal-cli positions decrease --nft-mint <nft-mint> --percentage 50 --dry-run -o json\` — preview how much you'll receive
3. \`byreal-cli positions decrease --nft-mint <nft-mint> --percentage 50 --wallet-address <addr> -o json\` — emit unsigned tx (default). Add \`--execute\` to sign + broadcast via Privy.

**Key distinction**: Use \`decrease\` to partially withdraw while keeping the position open. Use \`close\` to fully exit and burn the NFT.

## Workflow: Auto Swap (Zap In / Zap Out)

\`--auto-swap\` lets users open / add / remove / close positions using a **single token** instead of pre-splitting into the pool's two tokens. The Byreal router quotes + builds a transaction that swaps part of the input on Jupiter (or other aggregators) and atomically deposits/withdraws into the CLMM position.

**Constraints unique to openclaw**: \`--auto-swap\` ONLY runs in two modes:
- \`--dry-run\` — preview the quote (no signing, no Privy needed)
- \`--execute\` — sign + broadcast via Privy proxy

The default \`unsigned-tx\` mode is rejected (\`code: UNSUPPORTED_MODE\`) because Auto Swap quotes are bound to backend-issued signers and have a 30s TTL — they cannot be handed off to an external signer chain.

**Zap-In (open / increase)**:
1. \`positions open --pool <id> --price-lower <p> --price-upper <p> --base <mint|MintA|MintB> --amount <amt> --auto-swap --dry-run -o json\` — preview the split + swap quote (priceImpact, slippage, expiry).
2. Drop \`--dry-run\` and add \`--execute\`: \`positions open ... --auto-swap --execute -o json\` — Privy signs + broadcasts. Response contains \`signature\`, \`nftAddress\`, \`autoSwap: true\`, \`selectedProvider\`.

**Zap-Out (decrease / close)**:
1. \`positions close --nft-mint <addr> --auto-swap --output-mint <mint> --dry-run -o json\` — preview withdrawn amounts + final \`receiveOutputAmount\`. \`unclaimedIncentives\` reports any pending incentive rewards that will be preclaimed.
2. \`positions close ... --auto-swap --output-mint <mint> --execute -o json\` — runs preclaim (if needed) and zap-out as two sequential mainnet-beta tx; response contains \`signature\` + \`incentivePreclaim.signatures\`.
3. For partial: \`positions decrease ... --percentage <1-100> --auto-swap --output-mint <mint> --execute\`.

\`--output-mint\` must equal one of the pool's two mints (validated by both CLI and backend).

## Workflow: Copy a Top Position

When user wants to copy/follow a position:
1. Analyze pool: \`byreal-cli pools analyze <pool-id> -o json\`
2. List top positions: \`byreal-cli positions top-positions --pool <pool-id> -o json\`
3. Choose a position based on: **inRange=true** (critical — out-of-range positions earn zero fees, never recommend them unless user explicitly asks), high PnL, high earned fees, high copies count, reasonable age
4. Preview: \`byreal-cli positions copy --position <addr> --amount-usd <usd> --dry-run -o json\`
5. Execute: \`byreal-cli positions copy --position <addr> --amount-usd <usd> --wallet-address <addr> -o json\`

Copy Bonus: Both the original position creator and copiers earn extra yield boost (5-10%) and referral rewards (2.5-5% of followers' LP fees).

## Workflow: Discover Copy Opportunities (Vague Intent)

When user asks vague questions like "有什么仓位可以 copy？", "最近有什么好的仓位？" — they don't specify a pool. Follow this multi-step discovery flow:

1. **Check wallet**: \`byreal-cli wallet balance --wallet-address <addr> -o json\` — understand available funds and token holdings
2. **List top pools**: \`byreal-cli pools list --sort-field volumeUsd24h --sort-type desc --page-size 10 -o json\` — find active pools with high volume/TVL
3. **Filter pools by user context**:
   - If user holds specific tokens → prefer pools containing those tokens (avoid unnecessary swaps)
   - If user wants stable/low-risk → prefer stablecoin pools (category=1)
   - If user wants high yield → prefer high-APR pools
   - Default: pick 2-3 pools with highest volume and reasonable TVL (>$50K)
4. **Query top positions** for each selected pool: \`byreal-cli positions top-positions --pool <pool-id> -o json\`
5. **Cross-pool comparison**: Rank all positions across pools, prioritize:
   - **inRange=true** (mandatory — skip out-of-range positions)
   - High earned fees % (indicates consistent fee generation)
   - Positive PnL (net profitable after IL)
   - Multiple copies (social proof)
   - Reasonable age (>1d, positions that have survived market moves)
6. **Present top 3-5 recommendations** with reasoning, then ask user which one to copy and how much to invest
7. **Execute copy** following the "Copy a Top Position" workflow above

**Tips**:
- Always explain WHY you recommend a position (e.g., "高手续费收益 + 低无常损失 + 在区间内")
- If user's balance is low (<$20), suggest starting with a single position to minimize gas cost
- If all positions in a pool are out-of-range, skip that pool and explain why
- To inspect a specific LP's full portfolio: \`byreal-cli positions list --user <wallet-address> -o json\`

## Swap Routing Priority

Default to \`byreal-cli swap execute\`. Fall back to \`jup swap\` / \`dflow swap\` only if Byreal returns no route, or the user names an aggregator explicitly.

## Workflow: Jupiter / Titan / DFlow Swap

\`\`\`
byreal-cli jup swap   --input-mint <mint> --output-mint <mint> --amount <amt> [--dry-run|--execute] --wallet-address <addr>
byreal-cli titan swap --input-mint <mint> --output-mint <mint> --amount <amt> [--dry-run|--execute] --wallet-address <addr>
byreal-cli dflow swap --input-mint <mint> --output-mint <mint> --amount <amt> [--dry-run|--execute] --wallet-address <addr>
\`\`\`

Default (no flag) emits \`{ unsignedTransactions: [base64] }\` for back-compat. \`--execute\` signs + broadcasts via Privy → output \`{ signature, explorer }\`. DFlow optionally reads \`DFLOW_API_KEY\`. Titan reads \`TITAN_AUTH_TOKEN\` if proxy unreachable.

## Workflow: Idle Yield with Kamino

When user wants to earn yield on idle tokens (e.g. USDC):
1. **Check APY**: \`byreal-cli kamino reserves\` — shows the supply/borrow APY for SOL, USDC, USDT. For any other token, pass \`--token <symbol|mint>\` (e.g. \`--token JitoSOL\`). This is an aid, not a browser — do not attempt to list every reserve.
2. **Check status**: \`byreal-cli kamino status --wallet-address <addr>\` — view current positions and APY
3. **Deposit**: \`byreal-cli kamino deposit --amount <amt> --wallet-address <addr>\` — deposit USDC (default) or specify \`--mint <mint>\` for other tokens
4. **Withdraw**: \`byreal-cli kamino withdraw --amount <amt> --wallet-address <addr>\` — withdraw back to wallet

Default market: Kamino Main Market. Use \`--market <address>\` for a different market.

## Workflow: Sweep Dust Tokens

When user wants to consolidate small token balances:
1. **Preview**: \`byreal-cli sweep execute --dry-run --wallet-address <addr>\` — see which tokens will be swept, estimated USD values, and skip reasons
2. **Execute**: \`byreal-cli sweep execute --wallet-address <addr>\` — generates Jupiter swap transactions for each dust token + close empty account transactions
3. **Options**: \`--target-mint <mint>\` (default: USDC), \`--min-value-usd <amt>\` (default: $0.50), \`--exclude <mints>\` (comma-separated)

## Workflow: Rent Reclaim

When user wants to recover SOL from empty token accounts:
1. **Scan**: \`byreal-cli rent reclaim --dry-run --wallet-address <addr>\` — see how many empty accounts and estimated SOL recovery
2. **Execute**: \`byreal-cli rent reclaim --wallet-address <addr>\` — generates close transactions
3. **Options**: \`--include-token2022\` to include Token-2022 accounts, \`--exclude <mints>\` to keep specific accounts

Each empty account holds ~0.002 SOL in rent. Closing many empty accounts can recover meaningful SOL.

## Error Handling

All JSON errors include \`error.suggestions\` with recovery commands — always check it. Common codes: \`POOL_NOT_FOUND\` (list pools), \`INSUFFICIENT_BALANCE\` (swap or reduce amount), \`NETWORK_ERROR\` (retry).

## Troubleshooting

Always read \`error.message\` carefully — it contains the specific cause. Do NOT retry blindly.

### Swap
1. **Check balance**: Run \`wallet balance --wallet-address <addr> -o json\` — confirm input token's \`amount_ui\` (real balance) ≥ swap amount. For Token2022 tokens (xStock), do NOT use \`amount_ui_display\` — that is the multiplied display value, not the real spendable balance. Reserve ~0.01 SOL for tx fees.
2. **Switch swap-mode**: \`--swap-mode out\` may find a different route than the default \`in\`
3. **Intermediate token**: Split A→B into A→SOL→B or A→USDC→B (SOL: \`So11111111111111111111111111111111111111112\`, USDC: \`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\`, USDT: \`Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB\`)
4. **Increase slippage**: \`--slippage 300\` for volatile tokens

### Positions
1. **Insufficient balance** (dry-run): \`deficit\` is the **slippage-padded upper bound** (non-base leg uses \`otherAmountMax = otherAmount × (1 + slippage)\`), not the exact amount that will be consumed. Before swapping, **first try a tighter \`--slippage\` and re-run dry-run** — the warning often disappears. If you still must swap, do not over-swap the full \`deficit\`; re-run dry-run after the swap settles.
2. **Insufficient funds at \`--execute\` despite dry-run "sufficient"**: this is **almost always a missing SOL buffer**, not a stale RPC / cache / indexer issue. The dry-run check does NOT deduct the ~0.03 SOL needed for new-position rent + fees (see "SOL Buffer for CLMM Position Ops"). Resize the SOL leg against \`sol_balance − 0.03\` and retry. **Do not** start swapping to "balance" the wallet before doing this math — that path burned real money in past incidents.
3. **Position Math Sanity Check** (before any swap to "cover a deficit"): for a CLMM position at current price \`p\`, lower \`pL\`, upper \`pU\`, the deposit split is **not 50/50**. Required amounts: \`USDC ∝ √p − √pL\`, \`SOL ∝ (√pU − √p) / (√p · √pU)\`. Always recompute from a fresh \`--dry-run\` after any swap; do not assume the previous deficit number still applies. Ping-ponging swaps without re-running dry-run is the failure mode that wastes gas.
4. **Slippage exceeded**: Price moved during execution. Increase \`--slippage\` (e.g., 200-300 bps) or re-run \`--dry-run\` to get updated prices.
5. **Position already closed**: Check \`positions list --status 0\` — the NFT is burned after close.
6. **No fees to claim**: Position may be out-of-range (not earning fees) or fees already claimed.
7. **Wrong NFT mint**: Ensure you use the NFT mint address from \`positions list\`, not the pool address or position PDA.
8. **Stale state after tx**: After any on-chain operation, wait 3-5 seconds before the next query — RPC propagation delay (seconds, not minutes).

### What \`--execute\` actually does (don't misdiagnose)
\`--execute\` flow: CLI builds unsigned tx → Privy proxy → \`signAndBroadcast\` → Solana RPC \`simulateTransaction\` against **live chain state**. There is **no Privy indexer and no cached balance** in this path. If you see "insufficient funds" from \`--execute\`, treat it as a real on-chain shortfall (almost always the SOL buffer — see Positions #2), not as stale data. RPC nodes can lag by **seconds** after a fresh swap, not minutes — if a retry is needed, one 3-5s wait is enough. If three retries still fail, **stop** and re-run the math; do not keep retrying.

`;

// ============================================
// Create Skill Command
// ============================================

export function createSkillCommand(): Command {
  const skill = new Command("skill")
    .description("Output full documentation for AI consumption")
    .action(() => {
      console.log(SKILL_DOC);
    });

  return skill;
}
