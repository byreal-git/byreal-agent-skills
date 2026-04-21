# Titan Plugin — Implementation Notes

## Architecture

Titan uses a **REST Gateway** with a single msgpack-encoded response. Flow:
1. `GET https://partners.api.titan.exchange/api/v1/quote/swap?inputMint=&outputMint=&amount=&userPublicKey=&slippageBps=&swapMode=` with `Authorization: Bearer <JWT>` and `Accept: application/vnd.msgpack`
2. Server returns a msgpack blob decoding to `{ id, quotes: Record<providerName, SwapRoute>, metadata? }`
3. Each `SwapRoute` carries `instructions` (compact format) + `addressLookupTables` (Uint8Array[]) — the pre-built `transaction` field is NOT populated
4. Pick the best route across providers (max `outAmount` for ExactIn, min `inAmount` for ExactOut), then build the `VersionedTransaction` ourselves from instructions + ALTs

## Pitfalls

### `transaction` field is NOT populated

`SwapRoute.transaction` is declared as `Uint8Array`, but the Gateway leaves it empty — you must build the V0 transaction yourself from `instructions` + `addressLookupTables`. See `buildTransaction()` in `api.ts`.

```typescript
// Convert compact instructions { p, a, d } → TransactionInstruction
// Fetch AddressLookupTableAccount from on-chain via RPC (getAddressLookupTable)
// Build TransactionMessage → compileToV0Message(lookupTableAccounts) → VersionedTransaction
```

### Compute Budget — 必须设置 CU limit

Titan 路由的 CU 消耗远超 Solana 默认的 200k（Titan-DART 约 1.4M，Okx 约 435k）。`buildTransaction()` 必须根据 route 返回的 `computeUnits` 字段前置 `ComputeBudgetProgram.setComputeUnitLimit` 指令，否则交易会因 `exceeded CUs meter at BPF instruction` 失败。同时前置 `setComputeUnitPrice` 设置 priority fee。

### Auth failure modes

- `Authorization: Bearer <expired-or-bad-jwt>` → **403 "JWT is invalid"** (token was parsed but rejected)
- Missing `Authorization` header, or wrong header name (`x-api-key`, `Titan-Auth`, raw token without `Bearer`) → **401 "Missing authentication token"**

Use the 401 vs 403 distinction to diagnose: 401 = our request shape is wrong; 403 = token itself is bad. Decode the JWT payload (`exp` claim) before blaming the server.

### JWT lifetime varies by token type

Observed partner tokens (`iss: titan_partners`, `sub: api:byreal`) come in two flavors:

- **Short-lived** (7 days) — likely for evaluation / initial onboarding
- **Long-lived** (5 years) — issued on request for production partner integrations

There is **no documented refresh endpoint**. When a token expires, contact the Titan partner team for a replacement. Long-term, this client should not hold the partner JWT directly — see `DOCS/backend-proxy-proposal.md`.

### msgpack decoding

`@msgpack/msgpack`'s `decode()` returns plain JS objects (not `Map`) by default, so `quotes` comes out as a plain `Record<string, SwapRoute>`. Fields that were `Uint8Array` on the wire stay `Uint8Array` — `PublicKey`/`TransactionInstruction` constructors accept them directly. `inAmount` / `outAmount` decode as `number`, but they may exceed `Number.MAX_SAFE_INTEGER` for large notional swaps; the code wraps them in `BigInt()` before comparing routes.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TITAN_AUTH_TOKEN` | **Yes** | — | JWT auth token (272 chars; lifetime depends on partner tier — see "JWT lifetime varies by token type" above) |
| `TITAN_API_URL` | No | `https://partners.api.titan.exchange` | Global endpoint, auto-routes to nearest region |

Regional endpoints (override via `TITAN_API_URL`):
- `https://us.partners.api.titan.exchange` (Ohio, USA)
- `https://jp.partners.api.titan.exchange` (Tokyo, Japan)
- `https://de.partners.api.titan.exchange` (Frankfurt, Germany)

## References

- **API Docs**: https://titan-exchange.gitbook.io/titan/developer-doc
- **Fee Collection**: https://titan-exchange.gitbook.io/titan/developer-doc/swap-api/guides/fee-collection (for future revenue integration)
- **Playground**: https://github.com/Titan-Pathfinder/Playground-api — Demo app with a reference transaction builder (`lib/solana/simulate.ts`) — still useful as a reference even though it targets the WS SDK
