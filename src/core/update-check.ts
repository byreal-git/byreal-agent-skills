/**
 * Update check mechanism - checks GitHub Releases for new versions
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import chalk from 'chalk';
import { VERSION, GITHUB_REPO } from './constants.js';

// ============================================
// Types
// ============================================

interface UpdateCache {
  lastCheck: number;
  latestVersion: string;
  currentVersion: string;
}

interface UpdateResult {
  updateAvailable: boolean;
  latestVersion: string;
  currentVersion: string;
}

// ============================================
// Constants
// ============================================

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const CACHE_DIR = join(homedir(), '.config', 'byreal');
const CACHE_FILE = join(CACHE_DIR, 'update-check.json');
const RELEASE_URL = `https://github.com/${GITHUB_REPO}/releases`;

function getInstallCommand(version?: string): string {
  if (version) {
    return `npm install -g ${RELEASE_URL}/download/v${version}/byreal-cli.tgz`;
  }
  return `npm install -g ${RELEASE_URL}/latest/download/byreal-cli.tgz`;
}

// ============================================
// Cache Management
// ============================================

function readCache(): UpdateCache | null {
  try {
    const data = readFileSync(CACHE_FILE, 'utf-8');
    return JSON.parse(data) as UpdateCache;
  } catch {
    return null;
  }
}

function writeCache(cache: UpdateCache): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {
    // Silent fail
  }
}

// ============================================
// Version Fetching
// ============================================

function fetchLatestVersion(): string | null {
  try {
    // Use synchronous HTTP via child_process to avoid async complexity
    const { execSync } = require('child_process');
    const result = execSync(
      `curl -sf -H "Accept: application/vnd.github.v3+json" "https://api.github.com/repos/${GITHUB_REPO}/releases/latest"`,
      { timeout: 5000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const data = JSON.parse(result);
    const tagName = data.tag_name as string;
    return tagName.replace(/^v/, '');
  } catch {
    return null;
  }
}

// ============================================
// Version Comparison
// ============================================

function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = latest.split('.').map(Number);
  const currentParts = current.split('.').map(Number);

  for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

// ============================================
// Public API
// ============================================

/**
 * Check for updates. Uses cache if fresh (<4h), otherwise fetches from GitHub.
 * Returns null on any error (silent failure).
 */
export function checkForUpdate(force = false): UpdateResult | null {
  try {
    const cache = readCache();

    // Use cache if fresh and not forced
    if (!force && cache && (Date.now() - cache.lastCheck) < CHECK_INTERVAL_MS) {
      return {
        updateAvailable: isNewerVersion(cache.latestVersion, VERSION),
        latestVersion: cache.latestVersion,
        currentVersion: VERSION,
      };
    }

    // Fetch latest version
    const latestVersion = fetchLatestVersion();
    if (!latestVersion) return null;

    // Update cache
    writeCache({
      lastCheck: Date.now(),
      latestVersion,
      currentVersion: VERSION,
    });

    return {
      updateAvailable: isNewerVersion(latestVersion, VERSION),
      latestVersion,
      currentVersion: VERSION,
    };
  } catch {
    return null;
  }
}

/**
 * Print update notice box if an update is available
 */
export function printUpdateNotice(): void {
  const result = checkForUpdate();
  if (!result || !result.updateAvailable) return;

  const installCmd = getInstallCommand(result.latestVersion);
  const line1 = `Update available: ${result.currentVersion} → ${result.latestVersion}`;
  const line2 = `Run: ${installCmd}`;
  const maxLen = Math.max(line1.length, line2.length);
  const pad = (s: string) => s + ' '.repeat(maxLen - s.length);

  console.log();
  console.log(chalk.yellow(`╭${'─'.repeat(maxLen + 4)}╮`));
  console.log(chalk.yellow(`│  ${pad(line1)}  │`));
  console.log(chalk.yellow(`│  ${pad(line2)}  │`));
  console.log(chalk.yellow(`╰${'─'.repeat(maxLen + 4)}╯`));
  console.log();
}

export { getInstallCommand };
