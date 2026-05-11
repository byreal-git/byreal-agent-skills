# Auto Swap 上链回归测试报告 — openclaw 分支 — 2026-05-11

本轮针对 `byreal-cli` `openclaw` 分支上的 `--auto-swap`（Zap-In / Zap-Out）
端口完成第一轮回归验证：
- 协议层（endpoints / types / formatters / 41319 重试 / 双层 retCode 解析）
  从 `main:0f1e632` 照搬
- 签名层全部走 openclaw 的 Privy 代签（`privyBroadcastOne` / `privySignMany`），
  本地不再持有 keypair
- 三种执行模式收敛为：`--dry-run`（预览）/ `--execute`（Privy 签 + 广播）。
  默认 `unsigned-tx` 模式对 `--auto-swap` **fail-fast 拒绝**

## 总览

| 维度       | 数量 |
| ---------- | ---- |
| 用例总数   | 12   |
| 上链 tx 数 | 4    |
| 通过       | 12   |
| 失败       | 0    |
| 跳过       | 0    |

四笔 `--execute` mainnet-beta 真实交易（open → increase → decrease → close）
全部上链生效，钱包恢复干净；8 个 dry-run / 校验 / fail-fast 用例
逐一返回预期 JSON。无 41319 quote 过期、无 41318 滑点、无 Privy 上游错误。

## 测试环境

| 字段              | 取值                                                                           |
| ----------------- | ------------------------------------------------------------------------------ |
| CLI 版本          | 0.4.2（含本分支未提交的 auto-swap 改动）                                       |
| 分支              | `feat/openclaw-auto-swap` (based on `openclaw` @ 6c51440)                      |
| 钱包地址          | `8cpAx5kLMhgk6cJcftUrCz1aTL8uA8KZcgkMDKXJ3JgP`（Privy 托管）                   |
| Privy 配置        | `~/.openclaw/agent_token` (legacy single-token) + `~/.openclaw/skills/agent-token/scripts/config.json` |
| Privy 代理路径    | `https://api2.byreal.io/byreal/api/privy-proxy/v1`                             |
| RPC               | `https://jenelle-p85r4h-fast-mainnet.helius-rpc.com`（Helius mainnet-beta）    |
| Swap Provider     | Jupiter（每次 build-tx 后端 `selectedProvider` 都返回 `jupiter`）              |
| 默认滑点          | 100 bps                                                                        |
| 测试覆盖的池子    | TSLAx/USDC `6FQQyf7UcyU86TZC1cmAcfC4a18SJyDggEKtQfTJWmfs`                      |

### 钱包余额对比

| Token | 起始（pre） | 结束（post） | 净变化       |
| ----- | ----------- | ------------ | ------------ |
| SOL   | 0.013075958 | 0.013050958  | **-0.000025**（4 笔 tx 网络费） |
| USDC  | 12.705213   | 12.704651    | **-0.000562**（zap 圈滑点 + 价差） |
| HYPE  | 0.250672915 | 0.250672915  | 0            |
| TSLAx | 0.00020190  | 0.00020287   | **+0.00000097**（zap 残差） |
| Total | $24.50      | $24.55       | **+$0.05**（TSLAx 现价微涨） |

总在链成本（4 个 zap tx）净值变化 < $0.10，包含：
- Solana 网络费 × 4 ≈ 25k lamports（~$0.003）
- Jupiter swap slippage（每次 ≤ 0.005% 价差）
- close 时 NFT 租金回收 + decrease 不回收的零头

钱包结构恢复到几乎和起始一致：用户原有 2 个 TSLAx/USDC 仓位（`FxW283…` /
`AdzHy5o4…`）保持不动，本轮新建的 `F4WQszQS…` 仓位已被同一笔回归关闭。

## 用例总览

| #   | 命令 / 模式 | 类别 | 结果 | 关键签名 / 关键字段 |
| --- | --- | --- | --- | --- |
| D1 | `positions close --auto-swap --dry-run`（AdzHy5o4 → USDC） | dry-run | PASS | `receiveOutputAmount: 5.410409`, `impactLevel: ok`, `unclaimedCount: 0`, `willPreclaim: false` |
| D2 | `positions close --auto-swap --dry-run`（FxW283 with bonusUsd → USDC） | dry-run | PASS | `receiveOutputAmount: 11.312005`, `unclaimedCount: 0`（`bonusUsd ≠ unclaimedOpenIncentives`，与 main 行为一致） |
| D3 | `positions open --auto-swap --dry-run --base <USDC-mint>` | dry-run | PASS（Fix #3 回归）| `inputAmount: 0.5 USDC`, `swapInAmount: 256310`（约 0.256 USDC，按 USDC 6dec 转换正确切半） |
| D4 | `positions increase --auto-swap --dry-run --base MintB` | dry-run | PASS | `inputAmount: 0.3 USDC`, `swapInAmount: 153865`（半 USDC swap → TSLAx，符合区间内拆分） |
| D5 | `positions open --auto-swap` 无 `--base` | 校验 | PASS | exit 1, `MISSING_PARAMS`, msg 完全一致 |
| D6 | `positions decrease --auto-swap` 无 `--output-mint` | 校验 | PASS | exit 1, `MISSING_PARAMS`, msg 完全一致 |
| D7 | **`positions open --auto-swap` 无 `--execute` / `--dry-run`** | 校验（openclaw 专属） | PASS | exit 1, `UNSUPPORTED_MODE`, "requires --execute (or --dry-run for preview)" |
| D8 | `positions open --auto-swap --dry-run --amount 100`（超钱包） | 余额校验 | PASS | `balanceWarnings.deficit > 87 USDC` + `walletBalances`（4 个 token 列出） |
| E1 | `positions open --auto-swap --execute` 0.5 USDC → 新 TSLAx/USDC 仓位 | execute | PASS | `signature: 3BEYqdMT…QNE`, `nftAddress: F4WQszQS…ze42`, `selectedProvider: jupiter` |
| E2 | `positions increase --auto-swap --execute` 0.3 USDC zap-in 到 F4WQszQS | execute | PASS | `signature: 5jCHCgXk…aiXU`, `autoSwap: true` |
| E3 | `positions decrease 25 --auto-swap --execute --output-mint USDC` | execute | PASS | `signature: vDb99RSJ…hiZZ`, `autoSwap: true` |
| E4 | `positions close --auto-swap --execute --output-mint USDC`（清理 F4WQszQS） | execute | PASS | `signature: 4f24r2iQ…EScP`, position 已从 `positions list` 消失 |

新增本分支专属用例：
- **D7（UNSUPPORTED_MODE 拦截）**：main 上的 `--auto-swap` 默认走 `--confirm`，
  openclaw 改为只在 `--dry-run` 或 `--execute` 模式下生效。本用例确认默认
  `unsigned-tx` 模式下 fail-fast，与设计一致（符合 "no silent degradation"
  约束）。
- **E1 多签 partial-sign 路径**：zap-in open 后端返回的 base64 tx 同时需要
  ephemeral `positionNftMint` keypair 与用户钱包签名。CLI 先用本地生成的
  NFT keypair partial-sign，再交 Privy 代签用户 slot 并广播。`E1` 上链
  成功就是这条路径的实证（单测 `tests/zap/openclaw-modes.test.ts:121`
  对应断言信号填槽）。

## 单元测试

```text
$ npx vitest run tests/zap

 ✓ tests/zap/preclaim.test.ts (9 tests)
 ✓ tests/zap/openclaw-modes.test.ts (5 tests)

 Test Files  2 passed (2)
      Tests  14 passed (14)
```

- `tests/zap/preclaim.test.ts` 9 例：not_needed / 跨仓位过滤 / encode→privySignMany→submit 全链路 / 各阶段 best-effort 失败语义 / 只读 preview
- `tests/zap/openclaw-modes.test.ts` 5 例：UNSUPPORTED_MODE / dry-run 不触 Privy
  / `--execute` 调 `privyBroadcastOne` / partial-sign 后的 base64 含非空签名
  slot / zap-out 拒绝池外 `--output-mint`

`npx tsc --noEmit` 全量类型检查零错。

## 用例详情

### D1 — Zap-Out close 干跑（无奖励 / AdzHy5o4）

**命令：**

```bash
byreal-cli --wallet-address 8cpAx5kLMhgk6cJcftUrCz1aTL8uA8KZcgkMDKXJ3JgP \
  positions close \
  --nft-mint AdzHy5o4HByMMAhbT1WNtk6H74PKZBPJbGVmfrAC2xbm \
  --auto-swap --output-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --dry-run --output json
```

**关键字段：**

```json
{
  "outputSymbol": "USDC",
  "withdrawTokenA": "0.00652053",
  "withdrawTokenB": "2.637171",
  "receiveOutputAmount": "5.410409",
  "swapProvider": "jupiter",
  "priceImpactBps": 0,
  "impactLevel": "ok",
  "unclaimedIncentives": { "unclaimedCount": 0, "willPreclaim": false }
}
```

---

### D2 — Zap-Out close 干跑（带 bonusUsd / FxW283）

目的：复现 main 报告里的语义差异 — `positions list` 的 `bonusUsd` 字段
（epoch bonus / copyfarmer）与 `unclaimed-data API` 返回的
`unclaimedOpenIncentives` 不是同一回事。FxW283 仓位 `bonusUsd: $0.07` 但
`willPreclaim` 应为 `false`。

**关键字段：**

```json
{
  "receiveOutputAmount": "11.312005",
  "unclaimedIncentives": { "unclaimedCount": 0, "willPreclaim": false }
}
```

✅ 与 main 行为一致；preclaim claimed 分支本轮未真实触发（本钱包无
unclaimed incentive）。

---

### D3 — Zap-In open 干跑：`--base` 用 mint 地址（Fix #3 回归）

**命令：**

```bash
byreal-cli positions open \
  --pool 6FQQyf7UcyU86TZC1cmAcfC4a18SJyDggEKtQfTJWmfs \
  --price-lower 380 --price-upper 480 \
  --base EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --amount 0.5 --auto-swap --dry-run --output json
```

**关键字段：**

```json
{
  "inputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "inputSymbol": "USDC",
  "inputAmount": "0.5",
  "swapInAmount": "256310",
  "estimatedTokenA": "0.0006027",
  "estimatedTokenB": "0.24369"
}
```

`swapInAmount = 256310` ≈ 0.256 USDC（按 USDC 6dec 转换的一半左右），符合
"半 USDC 留作 token B、半 USDC swap 成 token A" 的拆分预期。Fix #3 在
`resolveInputMint` 中处理 mint 地址而非 enum，开源端口完全对齐。

---

### D4 — Zap-In increase 干跑（USDC 端）

**命令：**

```bash
byreal-cli positions increase \
  --nft-mint AdzHy5o4HByMMAhbT1WNtk6H74PKZBPJbGVmfrAC2xbm \
  --base MintB --amount 0.3 --auto-swap --dry-run --output json
```

`personalPosition` 由 CLI 用
`getPdaPersonalPositionAddress(BYREAL_CLMM_PROGRAM_ID, nftMint)` 派生，与
后端期望一致。

**关键字段：**

```json
{
  "inputSymbol": "USDC",
  "swapInAmount": "153865",
  "estimatedTokenA": "0.00036176",
  "estimatedTokenB": "0.146135",
  "personalPosition": "CXbueqBRZpbLkoCL2YnjVGVnaDHXGnMwTfVF5iwgwdkM"
}
```

---

### D5 / D6 — MISSING_PARAMS 守卫

| 缺失参数 | 期望 | 实际 |
| --- | --- | --- |
| `open --auto-swap` 无 `--base` | `MISSING_PARAMS` exit 1，msg `--auto-swap requires --base and --amount` | ✅ |
| `decrease --auto-swap` 无 `--output-mint` | `MISSING_PARAMS` exit 1，msg `--auto-swap requires --output-mint <address>` | ✅ |

---

### D7 — **UNSUPPORTED_MODE 拦截（openclaw 专属）**

**命令：**

```bash
byreal-cli positions open --pool ... --price-lower 380 --price-upper 480 \
  --base MintB --amount 0.5 --auto-swap --output json
# 注意：无 --execute 也无 --dry-run；默认是 unsigned-tx 模式
```

**输出：**

```json
{
  "success": false,
  "error": {
    "code": "UNSUPPORTED_MODE",
    "type": "VALIDATION",
    "message": "--auto-swap requires --execute (or --dry-run for preview). The default unsigned-tx mode is not supported because Auto Swap binds quotes to backend-issued signers and cannot survive being handed to an external signer chain.",
    "retryable": false
  }
}
```

✅ 这条 fail-fast 路径是 openclaw 在 main 上的全新拦截 — Auto Swap 30s quote
TTL + ephemeral `positionNftMint` 共签设计无法移交给外部签名链，所以默认
unsigned-tx 模式必须 fail-fast 提示用户加 `--execute`。

---

### D8 — 单边余额检查

故意请求超出钱包余额的 `--amount 100`（USDC 实际仅 12.7），确认 dry-run
在 quote 后会做单边校验并附上 `balanceWarnings` + `walletBalances`，与
双币模式一致。

**关键字段：**

```json
{
  "balanceWarnings": [
    {
      "token": "input",
      "symbol": "USDC",
      "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "required": "100",
      "available": "12.705213",
      "deficit": "87.294787"
    }
  ],
  "walletBalances": { "sol": "0.013075958", "tokens": [/* SOL, USDC, HYPE, TSLAx */] }
}
```

---

### E1 — **Zap-In open `--execute`（多签 partial-sign 上链）**

这是 openclaw 端口最关键的一笔上链验证：
- 后端返回的 base64 tx 同时需要 ephemeral `positionNftMint` 签名 + 用户
  钱包签名
- CLI 本地先用 `VersionedTransaction.sign([positionNftMint])` partial-sign
- 再把含部分签名的 base64 喂给 Privy 代签用户 slot 并广播
- 标准 Solana partial-sign 语义保留所有已填签名

**命令：**

```bash
byreal-cli --wallet-address 8cpAx5kLMhgk6cJcftUrCz1aTL8uA8KZcgkMDKXJ3JgP \
  positions open \
  --pool 6FQQyf7UcyU86TZC1cmAcfC4a18SJyDggEKtQfTJWmfs \
  --price-lower 380 --price-upper 480 \
  --base MintB --amount 0.5 \
  --auto-swap --execute --output json
```

**返回：**

```json
{
  "signature": "3BEYqdMTeCJ6m4qsV6ajZNBw8CTvEPRfTeQP2YQLMXGXaRwrWkRrvXawGasj12FMFA175n6kxZHqeqRJazooxQNE",
  "confirmed": false,
  "nftAddress": "F4WQszQS6A1FT4nm2kxrwbsDs8zVFvNKHpuhL2rsze42",
  "autoSwap": true,
  "selectedProvider": "jupiter"
}
```

Solscan: [3BEYqdMT…xQNE](https://solscan.io/tx/3BEYqdMTeCJ6m4qsV6ajZNBw8CTvEPRfTeQP2YQLMXGXaRwrWkRrvXawGasj12FMFA175n6kxZHqeqRJazooxQNE)

> `confirmed: false` 来自 `privyBroadcastOne` 不阻塞确认；后续 E2/E3/E4
> 都依赖 E1 完成，且 E4 后 `positions list` 已不见 `F4WQszQS…`，是这笔
> 多签 tx 实际上链生效的硬证据。

---

### E2 — Zap-In increase `--execute`

**命令：**

```bash
byreal-cli positions increase --nft-mint F4WQszQS6A1FT4nm2kxrwbsDs8zVFvNKHpuhL2rsze42 \
  --base MintB --amount 0.3 --auto-swap --execute --output json
```

**返回：**

```json
{
  "signature": "5jCHCgXkYKZDkuqTL595DurxPUMgn2cmKfsrWvuv5mqB5Y2T4T4rrA9pbZtQ6cMzzZuzUPnAKUiyL8y3SBZtaiXU",
  "confirmed": false,
  "autoSwap": true,
  "selectedProvider": "jupiter"
}
```

Solscan: [5jCHCgXk…aiXU](https://solscan.io/tx/5jCHCgXkYKZDkuqTL595DurxPUMgn2cmKfsrWvuv5mqB5Y2T4T4rrA9pbZtQ6cMzzZuzUPnAKUiyL8y3SBZtaiXU)

---

### E3 — Zap-Out decrease 25% `--execute`

**命令：**

```bash
byreal-cli positions decrease --nft-mint F4WQszQS6A1FT4nm2kxrwbsDs8zVFvNKHpuhL2rsze42 \
  --percentage 25 --auto-swap \
  --output-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --execute --output json
```

**返回：**

```json
{
  "signature": "vDb99RSJgD3Nqj7D95G8DBysDUWbTaQY1rtARXesduoFBM4mY3TYqS2cnn1jDSGPB3raSevfcBx8B1qZhwXhiZZ",
  "confirmed": false,
  "autoSwap": true,
  "selectedProvider": "jupiter"
}
```

Solscan: [vDb99RSJ…hiZZ](https://solscan.io/tx/vDb99RSJgD3Nqj7D95G8DBysDUWbTaQY1rtARXesduoFBM4mY3TYqS2cnn1jDSGPB3raSevfcBx8B1qZhwXhiZZ)

`liquidityToRemove` 由 CLI 用 `rawLiquidity.mul(pct*100).div(10000)` 派生
后传给 backend，仓位保留 75% 的 liquidity（NFT 不烧）。

---

### E4 — Zap-Out close `--execute`（清理 F4WQszQS）

**命令：**

```bash
byreal-cli positions close --nft-mint F4WQszQS6A1FT4nm2kxrwbsDs8zVFvNKHpuhL2rsze42 \
  --auto-swap --output-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --execute --output json
```

**返回：**

```json
{
  "signature": "4f24r2iQVYobnyT48fx6dw8Q3eUJLghJCmuAK5KTCBjp1AuhusR2TwmCDLGZVXVJeP1tTL6sXhSdW6RKB2L6EScP",
  "confirmed": false,
  "autoSwap": true,
  "selectedProvider": "jupiter"
}
```

Solscan: [4f24r2iQ…EScP](https://solscan.io/tx/4f24r2iQVYobnyT48fx6dw8Q3eUJLghJCmuAK5KTCBjp1AuhusR2TwmCDLGZVXVJeP1tTL6sXhSdW6RKB2L6EScP)

**链上效果：**

- `positions list` 已找不到 `F4WQszQS…`（NFT burnt by close）
- 响应中没有 `incentivePreclaim` 字段 —— 新建仓位无累积 incentive，preclaim
  分支返回 `not_needed`，按设计不写入响应（与 main 一致）

---

## 关键发现

1. **多签 partial-sign 与 Privy 兼容性**：openclaw 上 zap-in open 流程依赖
   "CLI 本地 partial-sign + Privy 填用户 slot" 这个组合在 mainnet-beta 真实
   通过（E1 → E4 整链 4 笔 tx）。Privy 代理保留了 ephemeral keypair 写入
   的 signature slot，符合标准 Solana partial-sign 语义。
2. **`personalPosition` PDA 派生在 CLI 端**：openclaw 上 `positions
   increase / decrease / close --auto-swap` 必须把 `personalPosition`
   字符串传给后端 quote。CLI 用 `getPdaPersonalPositionAddress(
   BYREAL_CLMM_PROGRAM_ID, nftMint).publicKey.toBase58()` 派生，回测期间
   pool/position/NFT mint 三者一致，零 INVALID_PARAMS。
3. **`unsigned-tx + --auto-swap` 拒绝是新增加的语义**：D7 用例确认默认
   unsigned-tx 模式遇到 `--auto-swap` 直接 fail-fast，避免了把 quote-bound
   tx 交给外部签名器导致 41319 quote 过期的潜在 footgun。该语义与
   "no silent degradation" 偏好严格对齐。
4. **incentive preclaim claimed 分支本轮仍未真实跑通**：钱包内的两个
   TSLAx/USDC 仓位 `bonusUsd > 0` 但 `unclaimedOpenIncentives = []`
   （epoch bonus 不进 preclaim 入口）；E1 新建仓位短期内无 incentive
   累积。后续若想覆盖 claimed 真实路径，需要先在一个有 incentive 的池子
   accrue 一段时间，再 close。
5. **零 41319 / 41318 触发**：4 笔 execute tx 全部首次 build-tx 成功，未
   触发 quote 过期重试或滑点拒绝。该分支已经单测覆盖（mock 注入），但
   真实 RPC 下的自然触发样本仍缺。

## 未覆盖的 Phase 2 场景

- `incentive preclaim` 的 `claimed` 分支真实上链（需 accrue 真实
  incentive）
- 41319 / 41318 在真实 RPC 下的自然触发
- `impactLevel = warning / blocked` 的端到端展示（需要在波动时段触发或
  后端 mock）
- Token-2022 输入端的全量 zap-in（TSLAx 是 Token-2022 但本轮把它当 token A
  跑通；TSLAx 作为 `--base` 的 zap-in 还没单独跑过 dry-run）
- Privy 代理失败的端到端兜底（PRIVY_TIMEOUT / PRIVY_UPSTREAM_ERROR 已被
  单测覆盖，真实链上未自然触发）

## 文件清单

实现新增 / 修改：
- `src/cli/commands/positions-zap.ts`（新建，~650 行；签名层重写为
  partial-sign + privyBroadcastOne）
- `src/cli/commands/incentive-preclaim.ts`（新建，~210 行；encode →
  privySignMany → submitRewardOrder）
- `src/core/constants.ts`（+6 个 AUTOSWAP_* 端点）
- `src/core/types.ts`（+10 个 autoswap request/response 类型 + 7 个 view 类型）
- `src/api/endpoints.ts`（+6 个 endpoint helper + `unwrapRouter`）
- `src/cli/output/formatters.ts`（+`outputZapInPreview` / `outputZapOutPreview`）
- `src/cli/commands/positions.ts`（4 个 action 头部注入 `--auto-swap` 早返回；
  `fetchWalletBalanceSummary` / `WalletBalanceSummary` / `BalanceWarning`
  改为 export；新增 `checkSingleMintBalance`）
- `src/cli/commands/catalog.ts`（capability 项追加 auto-swap / output-mint
  / execute 参数）
- `src/cli/commands/skill.ts`（capability 表 + workflow 章节）
- `README.md`（Commands 表行追加 auto-swap 注释）

测试：
- `tests/zap/preclaim.test.ts`（9 例）
- `tests/zap/openclaw-modes.test.ts`（5 例）

完整 JSON 输出（D1–D8 + post-state）位于
`/tmp/openclaw-zap-regression/`，本地审计可对照。
