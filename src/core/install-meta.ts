/**
 * Install-source attribution for download channel tracking.
 *
 * The official install script at `https://byreal.io/install/cli?s=<channel>`
 * writes `~/.config/byreal/install.json` with the channel it was invoked with.
 * On first CLI run after install, we read that file, fire a one-time
 * `CliInstalled` event to Sensors Analytics, and mark the record as reported
 * so subsequent runs do not double-count.
 *
 * For users who installed directly (plain `npm i -g`, GitHub release, agent
 * skills registry) the file does not exist — we synthesize a record with
 * `install_method: "direct"` and `source: "unknown"` so the event still fires
 * once per machine and every later event carries the same super property.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONFIG_DIR, FILE_PERMISSIONS } from './constants.js';
import { expandTilde, ensureConfigDir, setFilePermissions } from '../auth/security.js';

const INSTALL_FILE = 'install.json';

export interface InstallMeta {
  source: string;
  campaign: string;
  install_method: 'install_sh' | 'direct';
  installed_at: string;
  reported_at: string | null;
}

let cached: InstallMeta | null = null;

function getInstallPath(): string {
  return path.join(expandTilde(CONFIG_DIR), INSTALL_FILE);
}

function writeMeta(meta: InstallMeta): void {
  const filePath = getInstallPath();
  try {
    ensureConfigDir(CONFIG_DIR);
    fs.writeFileSync(filePath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
    setFilePermissions(filePath, FILE_PERMISSIONS);
  } catch {
    /* silent — telemetry is best-effort */
  }
}

/**
 * Read (or synthesize + persist) the install metadata. Idempotent per run.
 */
export function readInstallMeta(): InstallMeta {
  if (cached) return cached;

  const filePath = getInstallPath();

  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<InstallMeta>;
      cached = {
        source: parsed.source || 'unknown',
        campaign: parsed.campaign || '',
        install_method: parsed.install_method === 'install_sh' ? 'install_sh' : 'direct',
        installed_at: parsed.installed_at || new Date().toISOString(),
        reported_at: parsed.reported_at || null,
      };
      return cached;
    } catch {
      /* corrupted — rewrite below */
    }
  }

  // Synthesize a baseline record for users who did not go through install.sh.
  const synthesized: InstallMeta = {
    source: 'unknown',
    campaign: '',
    install_method: 'direct',
    installed_at: new Date().toISOString(),
    reported_at: null,
  };
  writeMeta(synthesized);
  cached = synthesized;
  return cached;
}

/** Persist reported_at so CliInstalled fires at most once per machine. */
export function markInstallReported(): void {
  const meta = readInstallMeta();
  meta.reported_at = new Date().toISOString();
  writeMeta(meta);
}
