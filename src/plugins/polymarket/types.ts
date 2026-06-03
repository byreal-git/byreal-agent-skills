/**
 * Shared types for the Polymarket plugin.
 *
 * Response/preview shapes grow as commands land in C2–C5. Kept minimal here.
 */

import type { GlobalOptions } from '../../core/types.js';

export type { GlobalOptions };

export type Side = 'buy' | 'sell';
export type OrderType = 'FOK' | 'GTC' | 'GTD';
