/**
 * Indicator-seed shared types — extracted from indicator-seeds.ts (Phase 8 D1
 * 2026-05-29) so the per-sector seed packs in this dir can import the contract
 * without pulling the whole catalog. Pure types; re-exported by
 * indicator-seeds.ts so existing consumers are unaffected.
 */

import type { Direction, Thresholds } from "../formula-engine";

/**
 * Phase 7.H F4.v2.1 — provenance ladder mirrored from the Prisma enum
 * `IndicatorValueSource`. Kept as a string-literal union here to keep
 * the seed catalog Prisma-free (the seed module is loaded by both the
 * runtime seeder AND the boundary test suite, which has no DB).
 *
 * Semantics:
 *  - `disclosed`        — company-reported fact (manual entry / import)
 *  - `modeled_industry` — industry-specific intensity factor (v2.2+)
 *  - `modeled_generic`  — v1 placeholder formula (revenue × constant)
 *  - `macro`            — single-value macro context (same across cos)
 *  - `computed`         — derived from real BudgetLine / OperationalFact /
 *                         Booking data; financial / operational default
 *
 * Seeds omit the field when the default `computed` applies.
 */
export type SeedValueSource =
  | "disclosed"
  | "modeled_industry"
  | "modeled_generic"
  | "macro"
  | "computed";

export interface IndicatorSeed {
  code: string;
  nameEn: string;
  nameAz?: string;
  nameRu?: string;
  /** fx | commodity | operational | geopolitical | macro | regulatory | composite | esg */
  category: string;
  industries: string[];
  unit: string;
  direction: Direction;
  formula: string;
  sparklineFormula?: string;
  thresholds: Thresholds;
  hintTemplateEn?: string;
  /**
   * Phase 7.G Turn VIII — locale-aware hint templates. The render path
   * at `IndicatorDetail.tsx:315` picks the field matching the user's
   * locale; falls back to `hintTemplateEn` when the locale-specific
   * field is null/empty. Status-token substitution `{status}` is localized
   * via `tStatus()` at render time (architect Turn-VII Round-1 sub-task).
   */
  hintTemplateAz?: string;
  hintTemplateRu?: string;
  requiredInputs: string[];
  sortOrder: number;
  /**
   * Phase 7.H F4.v2.1 — provenance stamp inherited by every IV produced
   * from this seed. Optional; omitted seeds inherit the Prisma default
   * (`computed`) via `IndicatorDefinition.defaultValueSource`. ESG v1
   * placeholders set this to `modeled_generic`; macro literal indicators
   * set `macro`.
   */
  defaultValueSource?: SeedValueSource;
  /**
   * Phase 7.N C5 v2 — per-indicator composite weight (default 1.0 if omitted).
   * Controls how strongly this indicator influences the 0-100 health score.
   * Scale: 0.7 (ESG/sentiment) → 1.0 (default) → 1.5 (profitability/liquidity).
   * See composite-score.ts for the full weight scheme rationale.
   */
  weight?: number;
}
