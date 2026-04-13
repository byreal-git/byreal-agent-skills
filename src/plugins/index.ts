/**
 * Plugin registry - exports all DeFi plugins
 */

import type { DefiPlugin } from './types.js';
import { jupiterPlugin } from './jupiter/index.js';
import { kaminoPlugin } from './kamino/index.js';
import { rentPlugin } from './rent/index.js';
import { consolidatePlugin } from './consolidate/index.js';

export const plugins: DefiPlugin[] = [
  jupiterPlugin,
  kaminoPlugin,
  rentPlugin,
  consolidatePlugin,
];
