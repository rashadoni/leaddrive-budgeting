/**
 * Shared Panel-3 model types — extracted from IndicatorDetail.tsx (Phase 8 D1
 * 2026-05-29) so the component's subsystems (drill-down, forecast, aggregate,
 * badges) can import the contract without the whole component. Pure: no
 * external imports. `STATUS_HEX` (the status→colour map) lives here too since
 * it's keyed on IndicatorValueDetail["status"].
 */

export interface IndicatorMeta {
  id: string;
  code: string;
  nameEn: string;
  nameAz?: string | null;
  nameRu?: string | null;
  unit: string;
  direction: "higher_better" | "lower_better" | "band";
  formula: string;
  thresholds: unknown;
  hintTemplateEn: string | null;
  hintTemplateAz?: string | null;
  hintTemplateRu?: string | null;
  requiredInputs: string[];
}

export interface CompanyMeta {
  id: string;
  code: string;
  name: string;
  industry: string | null;
}

/** Phase 7.H F4.v2.1 — provenance ladder rendered as a Panel-3 badge.
 *  Mirrors `IndicatorValueSource` from prisma/schema.prisma. */
export type ValueSource =
  | "disclosed"
  | "modeled_industry"
  | "modeled_generic"
  | "macro"
  | "computed";

export interface IndicatorValueDetail {
  id: string;
  value: number;
  status: "green" | "amber" | "red" | "unknown";
  period: string;
  computedAt: string;
  inputs: {
    resolved?: Record<string, number>;
    aggregates?: Record<string, unknown>;
    error?: { code: string; reason: string };
  } | null;
  /** Phase B2/B3 — 12-slot trailing-month series; nulls = evaluation gap. */
  sparkline: (number | null)[] | null;
  /** Phase 7.H F4.v2.1 — provenance stamp from `IndicatorValue.valueSource`. */
  valueSource?: ValueSource;
  /** Phase 7.H F4.v2.1 — reserved (`A`|`B`|`C`|`D`) for the v2.2 industry-
   *  factor confidence tier; null until that phase ships. */
  confidence?: string | null;
  /** Phase 7.H F4.v2.4 — SASB-style materiality rating for the
   *  (company.industry × indicator) pair. Null on non-ESG indicators. */
  materiality?: 'material' | 'low_materiality' | 'not_material' | null;
  /** Phase 7.H F4.v2.4 — calibration note explaining why this pair was
   *  rated low/not-material. Null on `material` (default) cells + non-ESG.
   *  `materialityNote` is EN; the Az/Ru twins are picked by active locale
   *  (same contract as hintTemplateEn/Az/Ru). */
  materialityNote?: string | null;
  materialityNoteAz?: string | null;
  materialityNoteRu?: string | null;
  /** Financial-truth-infra Phase B.2 — provenance + reconciliation
   *  metadata. `sourceDocument` is the file/sheet/row pointer the value
   *  was ingested from (e.g. `Consolidated budget 2026.xlsx#PL_EDEN!R3`).
   *  `lastReconciledAt` is the ISO timestamp of the most-recent
   *  audit-company.cjs pass. `reconciledBy` is the user id (or 'cli'
   *  for unattended runs). `sanityBand` is the verdict from the
   *  industry sanity-band classifier. All optional — pre-Phase-A IVs
   *  have null values and render the "not yet reconciled" copy. */
  sourceDocument?: string | null;
  lastReconciledAt?: string | null;
  reconciledBy?: string | null;
  sanityBand?: 'normal' | 'low_extreme' | 'high_extreme' | 'missing_input' | 'no_band' | null;
  indicator: IndicatorMeta;
  company: CompanyMeta;
}

export const STATUS_HEX: Record<IndicatorValueDetail["status"], string> = {
  green: "#00D4AA",
  amber: "#FFB020",
  red: "#FF4757",
  unknown: "#6B7280",
};

/**
 * Phase 7.E phase 2 hardening (sub-40) — per-IV recompute state machine.
 * The "Recompute" button below the status badge POSTs to /api/indicators
 * with `{period, companyId, indicatorCode}` — the only path that hits the
 * route's single-IV branch (`withSparkline=true`), which is in turn the
 * only path that triggers phase-2's inline `computeSparkline`. Without
 * this affordance, phase-2 wiring exists in `recomputeIndicator` but no
 * UI flow ever exercises it.
 */
export type RecomputeState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };
