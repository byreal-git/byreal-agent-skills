/**
 * Security utilities for Byreal CLI
 * Path expansion and file utilities
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ============================================
// Path Utilities
// ============================================

/** Expand ~ to os.homedir() */
export function expandTilde(filePath: string): string {
  if (filePath.startsWith('~/') || filePath === '~') {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/** Check if file exists (with tilde expansion) */
export function fileExists(filePath: string): boolean {
  try {
    fs.accessSync(expandTilde(filePath), fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
