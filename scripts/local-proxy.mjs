#!/usr/bin/env node
/**
 * Local simulator of realclaw-proxy (Byreal's reverse proxy).
 *
 * Why: the real proxy lives in a k8s cluster with DNS-resolvable `api-proxy`.
 * To exercise the CLI's proxy path on a dev machine, we run this stand-in
 * locally and point the CLI at it via BYREAL_PROXY_URL.
 *
 * Usage:
 *   JUPITER_API_KEY=xxx \
 *   TITAN_AUTH_TOKEN=xxx \
 *   DFLOW_API_KEY=xxx \
 *     node scripts/local-proxy.mjs
 *
 *   # In another terminal:
 *   BYREAL_PROXY_URL=http://127.0.0.1:8080 \
 *     npx tsx src/index.ts jup price --mint So11111111111111111111111111111111111111112
 *
 * Routes match DOCS/realclaw-proxy-trd.md:
 *   /jup/**   → https://api.jup.ag/**                   (x-api-key injected)
 *   /titan/** → https://partners.api.titan.exchange/**  (Authorization: Bearer injected)
 *   /dflow/** → https://quote-api.dflow.net/**          (x-api-key injected)
 *
 * Bodies are piped byte-for-byte — Titan msgpack passes through unchanged.
 */

import http from 'node:http';
import https from 'node:https';

const ROUTES = [
  {
    prefix: '/jup',
    target: 'https://api.jup.ag',
    inject: { name: 'x-api-key', value: process.env.JUPITER_API_KEY || process.env.JUP_API_KEY || '' },
  },
  {
    prefix: '/titan',
    target: 'https://partners.api.titan.exchange',
    inject: {
      name: 'authorization',
      value: process.env.TITAN_AUTH_TOKEN ? `Bearer ${process.env.TITAN_AUTH_TOKEN}` : '',
    },
  },
  {
    prefix: '/dflow',
    target: 'https://quote-api.dflow.net',
    inject: { name: 'x-api-key', value: process.env.DFLOW_API_KEY || '' },
  },
];

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8080);

function matchRoute(urlPath) {
  for (const r of ROUTES) {
    if (urlPath === r.prefix || urlPath.startsWith(r.prefix + '/') || urlPath.startsWith(r.prefix + '?')) {
      return r;
    }
  }
  return null;
}

function ts() {
  return new Date().toISOString().slice(11, 19);
}

const server = http.createServer((req, res) => {
  const route = matchRoute(req.url);
  if (!route) {
    console.error(`[${ts()}] 404 ${req.method} ${req.url}`);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`[local-proxy] no route for ${req.url}\nAvailable: ${ROUTES.map((r) => r.prefix).join(', ')}\n`);
    return;
  }

  const upstreamPath = req.url.slice(route.prefix.length) || '/';
  const upstream = new URL(route.target + upstreamPath);

  // Copy request headers, strip auth the client may have sent, inject proxy auth
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['x-api-key'];
  delete headers.authorization;
  if (route.inject.value) {
    headers[route.inject.name] = route.inject.value;
  }
  headers.host = upstream.host;

  const t0 = Date.now();
  const upReq = https.request(
    {
      method: req.method,
      host: upstream.host,
      path: upstream.pathname + upstream.search,
      headers,
    },
    (upRes) => {
      console.error(
        `[${ts()}] ${req.method} ${req.url} → ${upstream.origin}${upstream.pathname} → ${upRes.statusCode} (${Date.now() - t0}ms)`,
      );
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
    },
  );
  upReq.on('error', (e) => {
    console.error(`[${ts()}] upstream error ${req.url}: ${e.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    res.end(`[local-proxy] upstream error: ${e.message}\n`);
  });
  req.pipe(upReq);
});

server.on('error', (e) => {
  console.error(`[local-proxy] server error: ${e.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.error(`\n[local-proxy] listening on http://${HOST}:${PORT}`);
  console.error(`  point CLI at this proxy:  BYREAL_PROXY_URL=http://${HOST}:${PORT}\n`);
  for (const r of ROUTES) {
    const injected = !!r.inject.value;
    const status = injected ? `(${r.inject.name} injected ✓)` : `(⚠ no ${r.inject.name} — set env var)`;
    console.error(`  ${r.prefix.padEnd(7)}/* → ${r.target.padEnd(45)} ${status}`);
  }
  console.error('');
});
