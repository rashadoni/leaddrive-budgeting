/**
 * Recompute pipeline — namespace-resolver barrel.
 *
 * Phase 8 D1 (2026-05-29) — the 13 resolvers split into two focused group
 * files plus a shared types module to bring every file under the 1000-LOC
 * mega-file line (the combined module was ~1.26K LOC):
 *   - `recompute-resolver-types.ts` — `BuildState` / `ResolverCtx` /
 *     `NamespaceResolver` interfaces (shared, no resolver deps → no cycle).
 *   - `recompute-resolvers-a.ts` — booking, companySettings, operationalFact,
 *     newsSentiment, weather, commodityPrice, currencyRate.
 *   - `recompute-resolvers-b.ts` — budgetLine, fact, rollup, industryFactor,
 *     counterpartyHhi, balanceSheet (+ the `fact:` / `rollup:` prefixes).
 *
 * This file stays the public entry: it re-exports the three interfaces + the
 * two prefix constants, imports the 13 resolvers, and assembles the
 * `RESOLVERS` registry array `recompute.ts` loops over. Import shape for
 * `recompute.ts` and `targets.ts` is unchanged.
 */

export type {
  BuildState,
  ResolverCtx,
  NamespaceResolver,
} from './recompute-resolver-types';
import type { NamespaceResolver } from './recompute-resolver-types';

import {
  bookingResolver,
  companySettingsResolver,
  operationalFactResolver,
  newsSentimentResolver,
  weatherResolver,
  commodityPriceResolver,
  currencyRateResolver,
} from './recompute-resolvers-a';
import {
  budgetLineResolver,
  factResolver,
  rollupResolver,
  industryFactorResolver,
  counterpartyHhiResolver,
  balanceSheetLineResolver,
} from './recompute-resolvers-b';

export { FACT_INPUT_PREFIX, ROLLUP_INPUT_PREFIX } from './recompute-resolvers-b';

export const RESOLVERS: readonly NamespaceResolver[] = [
  bookingResolver,
  companySettingsResolver,
  operationalFactResolver,
  newsSentimentResolver,
  currencyRateResolver,
  budgetLineResolver,
  factResolver,
  rollupResolver,
  industryFactorResolver,
  // Phase 7.I — AzerSheker pilot. Both pull from IntelDataPoint; degrade
  // to "data not available" cleanly when no rows / no region set.
  weatherResolver,
  commodityPriceResolver,
  // Phase 7.J — Counterparty register HHI for concentration indicators.
  counterpartyHhiResolver,
  // Phase 7.O — Balance-sheet line aggregations (inventory turns etc.).
  balanceSheetLineResolver,
];
