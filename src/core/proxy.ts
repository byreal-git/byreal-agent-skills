/**
 * Byreal proxy (realclaw-proxy) probe and URL helpers.
 *
 * The proxy sits in front of Jupiter / Titan / DFlow and injects API keys
 * so the CLI does not have to hold them. Default host `api-proxy` is a
 * k8s-internal DNS name: it resolves inside the CI cluster, fails outside.
 *
 * Probe strategy: one TCP connect per CLI invocation, 500ms timeout, cached.
 * Consumers call isProxyAvailable() before building a request URL.
 */

import net from 'node:net';

export const PROXY_URL = process.env.BYREAL_PROXY_URL ?? 'http://api-proxy:8080';
const PROBE_TIMEOUT_MS = 500;

let cached: boolean | null = null;
let inFlight: Promise<boolean> | null = null;

export async function isProxyAvailable(): Promise<boolean> {
  if (cached !== null) return cached;
  if (inFlight) return inFlight;
  inFlight = probe().then((ok) => {
    cached = ok;
    inFlight = null;
    return ok;
  });
  return inFlight;
}

/**
 * Synchronous read of the cached probe result.
 * Returns null if isProxyAvailable() has not resolved yet.
 */
export function getProxyAvailabilitySync(): boolean | null {
  return cached;
}

async function probe(): Promise<boolean> {
  if (!PROXY_URL) return false;
  let host: string;
  let port: number;
  try {
    const u = new URL(PROXY_URL);
    host = u.hostname;
    port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  } catch {
    return false;
  }
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once('error', () => settle(false));
    socket.once('timeout', () => settle(false));
    socket.connect(port, host, () => settle(true));
  });
}
