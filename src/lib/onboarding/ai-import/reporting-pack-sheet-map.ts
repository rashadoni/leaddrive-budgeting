/**
 * Per-shape sheet-map for the AzerSheker "Reporting 2026" workbook (2026-06-22)
 * — see docs/superpowers/specs/2026-06-22-deterministic-sheet-routing-design.md.
 *
 * This 29-sheet pack keeps budget vs actual in separate NAMED TABS (no ">>>"
 * section separators) and carries many derived/summary views of the same
 * numbers beside the structured sources. The keyword/pattern heuristics in
 * resolveSheetRouting resolve the obvious ones, but several tabs need an
 * explicit deterministic decision (Codex: config > keyword for #1-risk routing).
 *
 * Structure confirmed by inspecting the real workbook (2026-06-22):
 *   SOURCES (account codes × month columns, the canonical data):
 *     Actual PLF (PLF, 1619×45) · Budget PLF (PLF, 1971×29) ·
 *     BS Actual (BS, 969×25) · CF Actual (CF, 321×37) · Budget CF (CF, 401×20)
 *   DERIVED (summaries / pivots / comparisons / eliminations / flat feeds):
 *     Actual + Budget (flat Group/Entity/FS-line feeds — the PLF tabs are the
 *     structured truth) · CONS PL_1/2 (consolidated) · PL EDEN + BU PL
 *     (entity / business-unit summary views) · Marginality · PL Comparison ·
 *     BS + BS EDEN (label-level summaries; BS Actual is the source) ·
 *     BS EDEN EJE (intragroup eliminations) · BS Pivot · BS Data
 *
 * Matching is EXACT sheet-name, so this map is a no-op on any other workbook
 * (e.g. Guvven Fin's "PLF CPC"). The robust follow-up is to move this into
 * Organization.importConfig so each org's recurring shapes are configurable
 * without code; for now it's a code default the route applies.
 */
import type { SheetMap } from "./sheet-routing"

export const REPORTING_PACK_SHEET_MAP: SheetMap = [
  // ── Structured sources (planKind explicit; role source) ─────────────
  { match: "Actual PLF", planKind: "actual", role: "source" },
  { match: "Budget PLF", planKind: "budget", role: "source" },
  { match: "BS Actual", planKind: "actual", role: "source" },
  { match: "CF Actual", planKind: "actual", role: "source" },
  { match: "Budget CF", planKind: "budget", role: "source" },
  // ── Derived / summary / elimination / flat-feed views (skipped) ─────
  { match: "Actual", role: "derived_summary" },
  { match: "Budget", role: "derived_summary" },
  { match: "CONS PL_1", role: "derived_summary" },
  { match: "CONS PL_2", role: "derived_summary" },
  { match: "PL EDEN", role: "derived_summary" },
  { match: "BU PL", role: "derived_summary" },
  { match: "Marginality", role: "derived_summary" },
  { match: "PL Comparison", role: "derived_summary" },
  { match: "BS", role: "derived_summary" },
  { match: "BS EDEN", role: "derived_summary" },
  { match: "BS EDEN EJE", role: "derived_summary" },
  { match: "BS Pivot", role: "derived_summary" },
  { match: "BS Data", role: "derived_summary" },
  // Farming-activity revenue/COGS breakdowns — sub-views of the P&L whose
  // canonical totals live in Actual/Budget PLF. The LLM flip-flops them
  // PLF↔BUDGET_ACTUALS between runs; pinning role=derived skips them
  // deterministically either way (so they can't block or double-count).
  { match: "Farming Revenue", role: "derived_summary" },
  { match: "Farming COGS", role: "derived_summary" },
]

/** Signature tabs that identify the reporting-pack shape — the structured
 *  source PLF tabs. The route applies REPORTING_PACK_SHEET_MAP only when a
 *  workbook carries both, so the map never touches an unrelated upload. */
export function looksLikeReportingPack(sheetNames: readonly string[]): boolean {
  const set = new Set(sheetNames)
  return set.has("Actual PLF") && set.has("Budget PLF")
}
