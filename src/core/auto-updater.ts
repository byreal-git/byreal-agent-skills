/**
 * Seamless background auto-update for Byreal CLI
 *
 * After a command completes, if a newer version is available and auto_update
 * is enabled, spawns a detached child process to install the update.
 * On the next CLI run, displays a one-time "Updated to vX.Y.Z" notice.
 */

import { readFileSync, writeFileSync, unlinkSync, statSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { spawn } from "child_process";
import chalk from "chalk";
import { VERSION } from "./constants.js";
import { NPM_PACKAGE } from "./update-check.js";
import { loadConfig } from "../auth/config.js";

// ============================================
// Constants
// ============================================

const CACHE_DIR = join(homedir(), ".config", "byreal");
const LOCK_FILE = join(CACHE_DIR, "update.lock");
const RESULT_FILE = join(CACHE_DIR, "update-result.json");
const LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes

// ============================================
// Types
// ============================================

interface UpdateResultFile {
  success: boolean;
  version: string;
  previousVersion: string;
  timestamp: number;
  error?: string;
}

// ============================================
// Skip flag — set by `update install` to suppress post-command auto-update
// ============================================

let skipAutoUpdate = false;

export function suppressAutoUpdate(): void {
  skipAutoUpdate = true;
}

export function isAutoUpdateSuppressed(): boolean {
  return skipAutoUpdate;
}

// ============================================
// Public API
// ============================================

/**
 * Check if auto-update is enabled in user config.
 * Defaults to true if config is missing or unreadable.
 */
export function isAutoUpdateEnabled(): boolean {
  const result = loadConfig();
  if (!result.ok) return true;
  return result.value.auto_update !== false;
}

/**
 * Display a one-time notice if a previous background update succeeded.
 * Deletes the result file after reading. All errors are silent.
 */
export function showPreviousUpdateResult(): void {
  try {
    const data = readFileSync(RESULT_FILE, "utf-8");
    unlinkSync(RESULT_FILE);

    const result = JSON.parse(data) as UpdateResultFile;
    if (result.success) {
      console.error(
        chalk.green(`  Updated to v${result.version} (from v${result.previousVersion})`)
      );
    }
  } catch {
    // No result file or read error — nothing to show
  }
}

/**
 * Spawn a detached child process to install the given version.
 * The main process can exit immediately after calling this.
 */
export function triggerBackgroundUpdate(targetVersion: string): void {
  try {
    // Fix #1: Validate semver to prevent command injection
    if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(targetVersion)) return;

    // Check lock file
    if (isLocked()) return;

    // Ensure cache directory exists
    mkdirSync(CACHE_DIR, { recursive: true });

    // Write lock in parent process to prevent race between concurrent CLI invocations
    writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, timestamp: Date.now() }));

    // Build the inline update script
    const script = buildUpdateScript(targetVersion);

    // Spawn detached child process
    try {
      const child = spawn(process.execPath, ["-e", script], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      });
      child.unref();
    } catch {
      // Spawn failed — clean up lock so future auto-updates aren't blocked
      try { unlinkSync(LOCK_FILE); } catch {}
      return;
    }

    console.error(
      chalk.gray(`  Updating to v${targetVersion} in background...`)
    );
  } catch {
    // Silent failure — user can always run `update install` manually
  }
}

// ============================================
// Internal Helpers
// ============================================

function isLocked(): boolean {
  try {
    const stat = statSync(LOCK_FILE);
    const age = Date.now() - stat.mtimeMs;
    if (age < LOCK_STALE_MS) {
      return true; // Fresh lock — another update is in progress
    }
    // Stale lock — proceed (previous process likely died)
    return false;
  } catch {
    return false; // No lock file
  }
}

function buildUpdateScript(targetVersion: string): string {
  // Use JSON.stringify for safe embedding — handles backslashes, quotes, newlines, etc.
  const vars = JSON.stringify({
    resultFile: RESULT_FILE,
    lockFile: LOCK_FILE,
    package: NPM_PACKAGE,
    targetVersion,
    previousVersion: VERSION,
  });

  return `
var v = ${vars};
var execSync = require('child_process').execSync;
var fs = require('fs');
var path = require('path');

try {
  fs.mkdirSync(path.dirname(v.resultFile), { recursive: true });
  execSync('npm install -g ' + v.package + '@' + v.targetVersion, {
    timeout: 120000,
    stdio: 'ignore',
  });
  fs.writeFileSync(v.resultFile, JSON.stringify({
    success: true,
    version: v.targetVersion,
    previousVersion: v.previousVersion,
    timestamp: Date.now(),
  }));
} catch (e) {
  fs.writeFileSync(v.resultFile, JSON.stringify({
    success: false,
    version: v.targetVersion,
    previousVersion: v.previousVersion,
    timestamp: Date.now(),
    error: e.message,
  }));
} finally {
  try { fs.unlinkSync(v.lockFile); } catch {}
}
`.trim();
}
