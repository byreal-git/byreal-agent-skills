/**
 * Polymarket data-api passthrough (raw JSON) via the gateway /data route.
 * Phase A public reads: /positions, /value (keyed by the proxy wallet).
 * Shapes follow the public Polymarket data-api (docs/polymarket-cli/03).
 */

import type { Result } from '../../../core/types.js';
import type { ByrealError } from '../../../core/errors.js';
import { pmGet, type PmGetOptions } from './gateway.js';

export interface DataPosition {
  proxyWallet?: string;
  asset?: string; // outcome token id (the sell handle)
  conditionId?: string;
  size?: number;
  avgPrice?: number;
  initialValue?: number;
  currentValue?: number;
  cashPnl?: number;
  percentPnl?: number;
  curPrice?: number;
  redeemable?: boolean;
  title?: string;
  slug?: string;
  eventSlug?: string;
  outcome?: string;
  outcomeIndex?: number;
  endDate?: string;
  negativeRisk?: boolean;
}

export interface DataValue {
  user?: string;
  value?: number;
}

export async function getPositions(
  proxyWallet: string,
  opts?: PmGetOptions,
): Promise<Result<DataPosition[], ByrealError>> {
  return pmGet<DataPosition[]>('data', '/positions', { user: proxyWallet }, opts);
}

/** /value?user= → either an array [{user,value}] or a bare { value }. */
export async function getValue(
  proxyWallet: string,
  opts?: PmGetOptions,
): Promise<Result<DataValue | DataValue[], ByrealError>> {
  return pmGet<DataValue | DataValue[]>('data', '/value', { user: proxyWallet }, opts);
}
