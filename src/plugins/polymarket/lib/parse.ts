/**
 * Parse Gamma's JSON-string fields (`outcomes`, `outcomePrices`, `clobTokenIds`
 * are stringified JSON arrays) and derive Yes/No price + token id pairs.
 *
 * Pure, total functions — malformed input returns [] / nulls, never throws.
 */

/** Parse a stringified JSON array of strings; non-array / malformed → []. */
export function parseStringArray(s: string | undefined | null): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x));
  } catch {
    return [];
  }
}

/** Parse a stringified JSON array of numbers; malformed entries → NaN dropped. */
export function parseNumberArray(s: string | undefined | null): number[] {
  return parseStringArray(s)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));
}

export interface YesNo {
  yesPrice: number | null;
  noPrice: number | null;
  yesTokenId: string | null;
  noTokenId: string | null;
}

export interface MarketStringFields {
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
}

/**
 * Align Yes/No price + token id by the index of the "Yes"/"No" labels in
 * `outcomes` (case-insensitive). Polymarket binary markets always carry two
 * outcomes; order is not guaranteed, so we look up by label rather than assume
 * index 0 = Yes.
 */
export function deriveYesNo(m: MarketStringFields): YesNo {
  const outcomes = parseStringArray(m.outcomes);
  const prices = parseStringArray(m.outcomePrices);
  const tokens = parseStringArray(m.clobTokenIds);

  const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === 'yes');
  const noIdx = outcomes.findIndex((o) => o.toLowerCase() === 'no');

  const priceAt = (i: number): number | null => {
    if (i < 0 || i >= prices.length) return null;
    const n = Number(prices[i]);
    return Number.isFinite(n) ? n : null;
  };
  const tokenAt = (i: number): string | null =>
    i >= 0 && i < tokens.length ? tokens[i] : null;

  return {
    yesPrice: priceAt(yesIdx),
    noPrice: priceAt(noIdx),
    yesTokenId: tokenAt(yesIdx),
    noTokenId: tokenAt(noIdx),
  };
}
