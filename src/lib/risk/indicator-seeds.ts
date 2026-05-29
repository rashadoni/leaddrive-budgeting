/**
 * Phase 7.C — pure source-of-truth catalog for IndicatorDefinition seeds.
 *
 * Both `scripts/seed-indicators.ts` (the runtime seed script) AND
 * `src/lib/risk/indicator-thresholds.test.ts` (the boundary suite) import
 * from here. Prevents the dual-of-truth drift that surfaced in the round-1
 * architect review (HOSP_SOURCE_HHI / HOSP_FX_EXPOSURE / others) where the
 * test had its own hand-typed copy of the thresholds and slowly diverged
 * from the seed.
 *
 * No DB / no Prisma — pure data. The seed script wraps each entry with
 * `Prisma.InputJsonValue` casts at write time; the test consumes
 * `Thresholds` directly.
 */

// --- Seed types + per-sector packs (extracted to ./seeds/* — Phase 8 D1 2026-05-29) ---
// indicator-seeds.ts is now a thin re-export hub: the 15 sector packs + the
// shared types live in ./seeds/*. Re-exported here so every existing
// 'import { … } from "@/lib/risk/indicator-seeds"' consumer is unaffected.
export type { SeedValueSource, IndicatorSeed } from "./seeds/types";
import type { IndicatorSeed } from "./seeds/types";

import { hospitalityIndicators } from "./seeds/hospitality";
import { agroIndicators } from "./seeds/agro";
import { crossSectorIndicators } from "./seeds/cross-sector";
import { industrialIndicators } from "./seeds/industrial";
import { servicesIndicators } from "./seeds/services";
import { pharmaIndicators } from "./seeds/pharma";
import { realEstateIndicators } from "./seeds/real-estate";
import { entertainmentIndicators } from "./seeds/entertainment";
import { educationIndicators } from "./seeds/education";
import { poultryIndicators } from "./seeds/poultry";
import { foodProcessingIndicators } from "./seeds/food-processing";
import { beverageIndicators } from "./seeds/beverage";
import { retailIndicators } from "./seeds/retail";
import { logisticsIndicators } from "./seeds/logistics";
import { constructionIndicators } from "./seeds/construction";

export {
  hospitalityIndicators,
  agroIndicators,
  crossSectorIndicators,
  industrialIndicators,
  servicesIndicators,
  pharmaIndicators,
  realEstateIndicators,
  entertainmentIndicators,
  educationIndicators,
  poultryIndicators,
  foodProcessingIndicators,
  beverageIndicators,
  retailIndicators,
  logisticsIndicators,
  constructionIndicators,
};

import { esgIndicators } from "./esg-seeds";
import { newsIndicators } from "./news-seeds";
import { phase7kSeeds } from "./phase-7k-seeds";


/**
 * Codes that used to be in the seed but were retired (merged, renamed,
 * dropped). Every seed run deactivates their rows + purges IndicatorValue
 * history so any DB on an older seed version converges. Append-only.
 */
export const RETIRED_CODES: readonly string[] = [
  // 2026-04-24 — renamed to FX_IMPORTED_INPUT (wider industries) and
  // moved to crossSectorIndicators.
  "AGRO_FX_RISK",
  // 2026-04-24 — merged into FX_IMPORTED_INPUT (identical formula).
  "IND_IMPORTED_INPUT",
  // 2026-04-29 sub-27 cont'd Round-7 — architect Round-6 flagged: AZMADE
  // xlsx import doesn't tag `currencyCode` on BudgetLines (then 10169/10169
  // NULL), so the formula structurally returned 0% across all op-cos —
  // a fake green that would mislead demo.
  //
  // Phase 7.G Turn XXXIX (2026-05-05) — RETIRED PERMANENTLY (architectural
  // decision, not parser-fix-pending): IND_FX_INPUT_RISK is functionally
  // identical to the active `FX_IMPORTED_INPUT` cross-sector indicator
  // (same formula `imported_input_cost / total_input_cost * 100`, same
  // resolver path, same data shape). The only difference was the
  // industrial-pack thresholds (green<=30 / amber<=60 / red>60 vs
  // FX_IMPORTED_INPUT's stricter green<=25 / amber<=50 / red>50).
  // Re-enabling would clutter the industrial heatmap with two near-
  // duplicate indicators that always agree on the band — net negative
  // for users. The underlying data fix (BudgetLine.currencyCode tagging
  // via import routes + AI-mapper /apply) benefits the active
  // `FX_IMPORTED_INPUT` indicator, not this retired one. Definition
  // preserved above (formula + thresholds) for institutional memory.
  "IND_FX_INPUT_RISK",
];

/**
 * All active indicator seeds, in the order they should be presented
 * (sortOrder respected per pack; packs run in this top-level order).
 */

export const ALL_INDICATOR_SEEDS: readonly IndicatorSeed[] = [
  ...hospitalityIndicators,
  ...agroIndicators,
  ...industrialIndicators,
  ...servicesIndicators,
  ...pharmaIndicators,
  ...realEstateIndicators,
  ...entertainmentIndicators,
  ...educationIndicators,
  ...poultryIndicators,
  ...foodProcessingIndicators,
  ...beverageIndicators,
  ...retailIndicators,
  ...logisticsIndicators,
  ...constructionIndicators,
  ...crossSectorIndicators,
  // Phase 7.H Feature 4 — ESG / Climate cross-sector pack.
  ...esgIndicators,
  // Phase 7.H Feature B — news-derived indicators (sentiment).
  ...newsIndicators,
  // Phase 7.K Phase 5b — sector-specific indicators powered by the
  // new external data feeds (CBAR FX, EIA, FAO, Yahoo Grains+Metals+
  // Fuel-BDI, WB Indicators, UN Comtrade, USDA NASS, AZ Stat CPI,
  // OpenMeteo Forecast, Google Trends).
  ...phase7kSeeds,
];
