/**
 * Amount conversion utilities for Byreal CLI
 * Converts between UI amounts (e.g., "1.5") and raw on-chain amounts (e.g., "1500000000")
 */

/**
 * Convert UI amount to raw on-chain amount
 * e.g., uiToRaw("1.5", 9) → "1500000000"
 */
export function uiToRaw(uiAmount: string, decimals: number): string {
  const parts = uiAmount.split('.');
  const whole = parts[0] || '0';
  const frac = (parts[1] || '').padEnd(decimals, '0').slice(0, decimals);
  const raw = whole + frac;
  // Remove leading zeros but keep at least "0"
  return raw.replace(/^0+/, '') || '0';
}

/**
 * Convert raw on-chain amount to UI amount
 * e.g., rawToUi("1500000000", 9) → "1.5"
 */
export function rawToUi(rawAmount: string, decimals: number): string {
  if (decimals === 0) return rawAmount;
  const padded = rawAmount.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals);
  // Remove trailing zeros from fraction
  const trimmedFrac = frac.replace(/0+$/, '');
  return trimmedFrac ? `${whole}.${trimmedFrac}` : whole;
}
