/**
 * DeFi Plugin interface for third-party protocol integrations
 */

import type { Command } from 'commander';

// ============================================
// Capability Types (shared with catalog.ts)
// ============================================

export interface CapabilityParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
  enum?: string[];
}

export interface Capability {
  id: string;
  name: string;
  description: string;
  category: 'query' | 'analyze' | 'execute';
  auth_required: boolean;
  command: string;
  params: CapabilityParam[];
}

// ============================================
// Plugin Interface
// ============================================

export interface DefiPlugin {
  /** Unique plugin identifier, e.g. 'jupiter', 'kamino', 'rent' */
  id: string;
  /** Human-readable name */
  name: string;
  /** Create the Commander.js command (or command group) */
  createCommand(): Command;
  /** Capability entries contributed to the catalog registry */
  capabilities: Capability[];
}
