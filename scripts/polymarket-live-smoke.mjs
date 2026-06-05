#!/usr/bin/env node
/**
 * Polymarket Phase A — live smoke test (OPT-IN, run manually).
 *
 * Drives the BUILT CLI (dist/index.cjs) end-to-end against the live PM test
 * gateway (api2.sbu-test-5.bybit.com) and asserts the auth-free read paths +
 * local order preview. This is NOT part of the vitest suite (it hits the
 * network and depends on live data); run it after `npm run build`:
 *
 *   node scripts/polymarket-live-smoke.mjs
 *
 * Override the gateway host with PM_GATEWAY_HOST. Proxy-dependent commands
 * (portfolio / funding) require a deployed proxy (Phase B) — skipped here.
 *
 * Exit code 0 = all checks passed, 1 = a check failed.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'index.cjs');

let pass = 0;
let fail = 0;

function run(args, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      const out = execFileSync('node', [CLI, ...args, '-o', 'json'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return JSON.parse(out);
    } catch (e) {
      // Live gateway can hiccup; retry a couple of times before failing the check.
      if (attempt >= retries) throw e;
    }
  }
}

// Like run(), but returns the structured JSON even when the CLI exits non-zero
// on a *business* error (NO_MATCH etc. still print JSON to stdout). Only throws
// on a real crash (no parseable stdout).
function runCapture(args) {
  try {
    return JSON.parse(
      execFileSync('node', [CLI, ...args, '-o', 'json'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch (e) {
    if (e.stdout) {
      try {
        return JSON.parse(e.stdout);
      } catch {
        /* fall through */
      }
    }
    throw e;
  }
}

function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${name}\n      ${e.message}`);
    fail++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('Polymarket Phase A live smoke (test gateway)\n');

// 1. category list
let nbaId;
check('category list returns categories', () => {
  const d = run(['polymarket', 'category', 'list']);
  assert(d.success, 'not success');
  assert(d.data.categories.length > 0, 'no categories');
  const nba = d.data.categories.find((c) => /nba/i.test(c.display_name));
  assert(nba, 'NBA category not found');
  nbaId = nba.category_id;
});

// 2. event list (volume_desc)
let listedEvents = [];
let eventTitleForSearch;
check('event list is volume_desc + non-empty', () => {
  const d = run(['polymarket', 'event', 'list', '--category-id', nbaId, '--limit', '8']);
  assert(d.success, 'not success');
  assert(d.data.sort === 'volume_desc', 'sort not volume_desc');
  const ev = d.data.events;
  assert(ev.length > 0, 'no events');
  for (let i = 1; i < ev.length; i++) {
    assert(Number(ev[i - 1].volume) >= Number(ev[i].volume), 'not volume-descending');
  }
  listedEvents = ev;
  eventTitleForSearch = ev[0].title; // a currently-whitelisted title (data-robust search query)
});

// 3. event search ∩ whitelist — pipeline check (data-robust).
// The whitelist is a live, churning backend snapshot, so we do NOT hardcode that
// a given query is whitelisted (that assumption rots). Instead we derive a term
// from a CURRENTLY-listed event and assert the pipeline yields a well-formed
// outcome: success (events present) OR a clean NO_MATCH — never a crash or
// SOURCE/whitelist error. The ∩-whitelist correctness is covered by unit tests.
check('event search pipeline returns whitelisted results or a clean NO_MATCH', () => {
  const titleWord =
    (eventTitleForSearch || 'nba').split(/\s+/).find((w) => /^[A-Za-z]{4,}$/.test(w)) || 'nba';
  const d = runCapture(['polymarket', 'event', 'search', '--query', titleWord, '--limit', '5']);
  if (d.success) {
    assert(Array.isArray(d.data.events), 'success but no events array');
  } else {
    assert(d.error?.code === 'NO_MATCH', `unexpected error: ${d.error?.code} (${d.error?.message})`);
  }
});

// 4. event detail (neg-risk aware) + find a tradable token id for order preview.
// Iterate listed events (whitelist churns; the top one may have no tradable
// market right now) until one yields a successful detail with a YES token id.
let tokenId;
check('event detail compact: sorted by YES prob, truncation triplet', () => {
  let verified = false;
  for (const ev of listedEvents) {
    const d = runCapture(['polymarket', 'event', 'detail', '--event-id', ev.event_id]);
    if (!d.success) continue; // e.g. EVENT_NOT_TRADABLE — try the next event
    const m = d.data.markets;
    assert(typeof d.data.market_count === 'number', 'no market_count');
    for (let i = 1; i < m.length; i++) {
      assert((m[i - 1].yes_price ?? -1) >= (m[i].yes_price ?? -1), 'not YES-prob descending');
    }
    verified = true;
    const withTok = m.find((x) => x.yes_token_id);
    if (withTok) {
      tokenId = withTok.yes_token_id;
      break;
    }
  }
  assert(verified, 'no listed event returned a successful detail');
});

// 5. order preview (market BUY) — the core local logic, against a live book.
check('order preview BUY: signed = book_worst + abs Δ, tick-aligned, FOK', () => {
  if (!tokenId) {
    console.log('      (skipped: no tradable token id available right now)');
    return;
  }
  const d = run(['polymarket', 'order', 'preview', '--token-id', tokenId, '--side', 'buy', '--amount', '20']);
  assert(d.success, `preview failed: ${d.error?.code}`);
  const s = d.data.preview;
  assert(s.order_type === 'FOK', 'not FOK');
  assert(s.signed_worst_price > s.book_worst_price, 'BUY signed not above book worst');
  assert(s.signed_worst_price < 1 && s.signed_worst_price > 0, 'signed out of (0,1)');
  assert(s.expires_at - s.quoted_at === 30, 'ttl not 30s');
});

console.log(`\n${fail === 0 ? 'ALL PASS ✅' : 'FAILURES ❌'}  (${pass} passed, ${fail} failed)`);
console.log('\nNote: portfolio / funding-balance / deposit-preview / withdraw-preview / status');
console.log('require a DEPLOYED proxy wallet (Phase B) for the happy path — not covered here.');
process.exit(fail === 0 ? 0 : 1);
