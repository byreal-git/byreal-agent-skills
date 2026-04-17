# Titan Plugin — Implementation Notes

## Architecture

Titan uses a **WebSocket streaming** API via `@titanexchange/sdk-ts`. Flow:
1. Connect to `wss://partners.api.titan.exchange/api/v1/ws?auth=<JWT>`
2. Open a swap quote stream → receive multiple updates with quotes from different providers
3. Each quote contains `instructions` (compact format) + `addressLookupTables` (Uint8Array[])
4. We build the `VersionedTransaction` ourselves from those fields
5. Close connection, then return the base64-serialized transaction

## Pitfalls

### `transaction` field is NOT populated

The SDK types define `SwapRoute.transaction?: Uint8Array`, and the docs imply it returns ready-to-sign transactions. **In practice, this field is always empty.** The API only returns `instructions` + `addressLookupTables`. You must build the transaction yourself:

```typescript
// Convert compact instructions { p, a, d } → TransactionInstruction
// Fetch AddressLookupTableAccount from on-chain via RPC
// Build TransactionMessage → compileToV0Message → VersionedTransaction
```

See `buildTransaction()` in `api.ts` and the Playground's `simulate.ts` for reference.

### SDK stdout pollution

The SDK logs `"Requested to cancel stream N with reason: undefined"` to **stdout** (not stderr) when a stream is cancelled (via `break` in `for await` or `client.close()`). This corrupts piped JSON output. Workaround: temporarily redirect `console.log → console.error` during SDK stream interaction. See `api.ts` lines ~94-135.

### SDK `stopStream` bug

Calling `client.stopStream(streamId)` often throws `ERR_INVALID_STATE: Controller is already closed` or receives server error `"Invalid Stream ID"`. This is a race condition in the SDK — the stream ends before the stop request arrives. **Do not call `stopStream()`** — just `break` from the for-await loop and call `client.close()`. Wrap the stream iteration in try-catch to tolerate these cleanup errors.

### Stream iteration — don't stop at first batch

The stream delivers multiple update batches. The first batch may not have instructions for all providers. Iterate up to `MAX_STREAM_UPDATES` (5) batches, stop as soon as a viable route with instructions is found.

### Compute Budget — 必须设置 CU limit

Titan 路由的 CU 消耗远超 Solana 默认的 200k（Titan-DART 约 1.4M，Okx 约 435k）。`buildTransaction()` 必须根据 route 返回的 `computeUnits` 字段前置 `ComputeBudgetProgram.setComputeUnitLimit` 指令，否则交易会因 `exceeded CUs meter at BPF instruction` 失败。同时前置 `setComputeUnitPrice` 设置 priority fee。

### Parameter naming

The `update` param uses **snake_case** `num_quotes` (not `numQuotes`), matching the TypeScript type definition. The SDK's own `examples/basic.ts` uses camelCase — that's a bug in their example.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TITAN_AUTH_TOKEN` | **Yes** | — | JWT auth token (272 chars, valid 1 year) |
| `TITAN_WS_URL` | No | `wss://partners.api.titan.exchange/api/v1/ws` | Global endpoint, auto-routes to nearest region |

Regional endpoints (override via `TITAN_WS_URL`):
- `wss://us.partners.api.titan.exchange/api/v1/ws` (Ohio, USA)
- `wss://jp.partners.api.titan.exchange/api/v1/ws` (Tokyo, Japan)
- `wss://de.partners.api.titan.exchange/api/v1/ws` (Frankfurt, Germany)

## References

- **SDK**: https://github.com/Titan-Pathfinder/titan-sdk-ts — TypeScript SDK source and examples (`examples/basic.ts`)
- **Playground**: https://github.com/Titan-Pathfinder/Playground-api — Full demo app with transaction building (`lib/solana/simulate.ts`) and stream handling (`hooks/use-swap-stream.ts`)
- **Claude Skill**: https://www.npmjs.com/package/@titanexchange/titan-api-skill — Includes raw WebSocket and SDK examples (`examples/stream-quotes-sdk.ts`, `examples/stream-quotes-raw-ws.ts`)
- **API Docs**: https://titan-exchange.gitbook.io/titan/developer-doc
- **Fee Collection**: https://titan-exchange.gitbook.io/titan/developer-doc/swap-api/guides/fee-collection (for future revenue integration)
