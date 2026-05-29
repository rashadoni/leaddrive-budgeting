/**
 * Recompute pipeline — pure numeric / string helpers.
 *
 * Phase 8 D1 (2026-05-29) — extracted from `recompute.ts` to shrink the core
 * engine file and give the namespace resolvers a shared helper module to
 * import from (prerequisite for the later resolver-subsystem extraction).
 * All three are pure: no DB, no side effects, no module state.
 *   - toSnakeCase  : camelCase → snake_case (company-settings key mapping)
 *   - revenueInBase: FX-convert a booking's revenue to the base currency
 *   - computeHhi   : Herfindahl-Hirschman concentration index (0..10000)
 */

import type { BookingRow } from './recompute-types';

export function toSnakeCase(camel: string): string {
  return camel
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

export function revenueInBase(b: BookingRow): number {
  if (b.currencyCode == null) return b.revenue;
  const rate = b.exchangeRate ?? 1;
  return b.revenue * rate;
}

export function computeHhi(
  countryToRevenue: Map<string, number>,
  total: number,
): number {
  if (total <= 0 || countryToRevenue.size === 0) return 0;
  let hhi = 0;
  for (const rev of countryToRevenue.values()) {
    const pct = (rev / total) * 100;
    hhi += pct * pct;
  }
  return hhi;
}
