/**
 * Plugin registry - exports all DeFi plugins
 */

import type { DefiPlugin } from './types.js';
import { jupiterPlugin } from './jupiter/index.js';
import { kaminoPlugin } from './kamino/index.js';
import { rentPlugin } from './rent/index.js';
import { consolidatePlugin } from './consolidate/index.js';
// Titan is temporarily hidden — requires API key that cannot be safely
// distributed to end users until the backend proxy (DOCS/backend-proxy-proposal.md)
// is ready. Re-enable by restoring the import and array entry below.
// import { titanPlugin } from './titan/index.js';
import { dflowPlugin } from './dflow/index.js';

export const plugins: DefiPlugin[] = [
  jupiterPlugin,
  kaminoPlugin,
  rentPlugin,
  consolidatePlugin,
  // titanPlugin,
  dflowPlugin,
];
