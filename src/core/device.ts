/**
 * Anonymous device identity for telemetry.
 *
 * Generates and persists a UUID v4 at `~/.config/byreal/device.json` on first
 * access. Used as the Sensors Analytics `distinct_id` so that events can be
 * attributed pre-wallet-connect (and so the wallet address becomes a normal
 * event property rather than the primary identity).
 *
 * Independent from `config.json` on purpose — users should never need to edit
 * or reset this file through `byreal config`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG_DIR, FILE_PERMISSIONS } from './constants.js';
import { expandTilde, ensureConfigDir, setFilePermissions } from '../auth/security.js';

const DEVICE_FILE = 'device.json';

interface DeviceRecord {
  device_id: string;
  created_at: string;
}

let cached: string | null = null;

function getDevicePath(): string {
  return path.join(expandTilde(CONFIG_DIR), DEVICE_FILE);
}

/**
 * Return the anonymous device_id, creating it on first call.
 * Never throws — on any I/O failure, falls back to an in-memory UUID so
 * telemetry can still function (but will not persist across runs).
 */
export function getDeviceId(): string {
  if (cached) return cached;

  const filePath = getDevicePath();

  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<DeviceRecord>;
      if (parsed.device_id && typeof parsed.device_id === 'string') {
        cached = parsed.device_id;
        return cached;
      }
    }
  } catch {
    /* fall through to regeneration */
  }

  const record: DeviceRecord = {
    device_id: randomUUID(),
    created_at: new Date().toISOString(),
  };

  try {
    ensureConfigDir(CONFIG_DIR);
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n', 'utf-8');
    setFilePermissions(filePath, FILE_PERMISSIONS);
  } catch {
    /* persistence failed; keep the id in memory for this run */
  }

  cached = record.device_id;
  return cached;
}
