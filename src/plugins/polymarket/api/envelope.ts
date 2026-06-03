/**
 * Byreal business-endpoint envelope: { success, ret_code, ret_msg, data }.
 * Gamma/CLOB passthrough endpoints return raw Polymarket JSON (no envelope).
 */

import { ok, err } from '../../../core/types.js';
import type { Result } from '../../../core/types.js';
import type { ByrealError } from '../../../core/errors.js';
import { sourceUnavailableError } from '../../../core/errors.js';

export interface PmEnvelope<T> {
  success?: boolean;
  ret_code?: number;
  ret_msg?: string | null;
  data: T;
}

/** Unwrap a business envelope; error if success!=true or ret_code!=0. */
export function unwrapBusiness<T>(env: PmEnvelope<T>): Result<T, ByrealError> {
  if (env.success === false || (env.ret_code !== undefined && env.ret_code !== 0)) {
    return err(sourceUnavailableError(`gateway ret_code=${env.ret_code} ${env.ret_msg ?? ''}`, false));
  }
  if (env.data === undefined || env.data === null) {
    return err(sourceUnavailableError('empty data in gateway response', false));
  }
  return ok(env.data);
}
