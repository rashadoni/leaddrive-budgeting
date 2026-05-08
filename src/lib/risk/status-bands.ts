/**
 * Phase 7.G Turn LXIV — shared status-band thresholds + classifier.
 *
 * Closes audit Turn-LXII Tier 2 M3: pre-LXIV the band-color thresholds
 * (red ≥10%, amber 5-10%, green <5%) + class/text colour maps were
 * duplicated across 4 sites:
 *   - VarianceTab (Turn LX) — `VARIANCE_BAND_RED_PCT` etc.
 *   - VarianceExplainerPanel (Phase 7.E)
 *   - alert-rules.ts (sector + company rules)
 *   - matrix route (heatmap cell colour assignment)
 *
 * This module is the single source of truth. Other consumers should
 * migrate when touched (incrementally, not in one mass-rewrite — keeps
 * blast radius small).
 *
 * Why these thresholds:
 *   - 10% / 5% materiality is the project-wide convention (matches
 *     `materialityPct = 5` in WorkspaceTab + PnL components).
 *   - Color mapping uses the canonical Risk Terminal palette
 *     (#FF4757 red / #FFB800 amber / #00D4AA green per chart-theme),
 *     softened to 50/dark-950 backgrounds for table-row highlighting.
 *
 * To override per-feature:
 *   Pass `thresholds` opt to `varianceBand(absPct, { red, amber })`.
 *   Default uses the canonical 10/5 floor.
 *
 * Migration plan:
 *   - Turn LXIV: VarianceTab → consume from this module.
 *   - Future turns: VarianceExplainerPanel + alert-rules + matrix
 *     route migrate when next touched.
 */

export type VarianceBand = "red" | "amber" | "green"

/** Canonical materiality thresholds (percent of plan). */
export const VARIANCE_BAND_THRESHOLDS = {
  /** ≥10% absolute variance → red (significant). */
  red: 10,
  /** 5–10% absolute variance → amber (worth watching). */
  amber: 5,
} as const

export interface VarianceBandThresholds {
  red: number
  amber: number
}

/** Classify an absolute variance percentage into a band. */
export function varianceBand(
  absPct: number,
  thresholds: VarianceBandThresholds = VARIANCE_BAND_THRESHOLDS,
): VarianceBand {
  if (absPct >= thresholds.red) return "red"
  if (absPct >= thresholds.amber) return "amber"
  return "green"
}

/** Tailwind classes for table-row + card backgrounds (border + bg). */
export const VARIANCE_BAND_CLASS: Record<VarianceBand, string> = {
  red: "border-l-4 border-l-red-500 bg-red-50 dark:bg-red-950/20",
  amber: "border-l-4 border-l-amber-500 bg-amber-50 dark:bg-amber-950/20",
  green: "border-l-4 border-l-emerald-500 bg-emerald-50 dark:bg-emerald-950/20",
}

/** Tailwind classes for foreground text (semantic colour). */
export const VARIANCE_BAND_TEXT: Record<VarianceBand, string> = {
  red: "text-red-700 dark:text-red-400",
  amber: "text-amber-700 dark:text-amber-400",
  green: "text-emerald-700 dark:text-emerald-400",
}
