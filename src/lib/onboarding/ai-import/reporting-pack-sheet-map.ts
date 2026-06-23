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
import { HOLDING_ENTITY_SENTINEL, type SheetMap } from "./sheet-routing"

export const REPORTING_PACK_SHEET_MAP: SheetMap = [
  // ── Structured sources (planKind explicit; role source) ─────────────
  // Actuals stay null-entity → 0-row no-ops here (per-company actuals come from
  // the per-entity file, e.g. Guvven). Only the BUDGET is consolidated/holding-
  // level → routed to the holding entity. Budget≠actual, so no double-count with
  // the children's per-company actuals.
  { match: "Actual PLF", planKind: "actual", role: "source" },
  // `Budget PLF` is NOT a single consolidated P&L — it is 5 vertically-stacked
  // per-entity blocks (EDEN/AZSF/ProMalt/CPC + a holding VAT block). Routing it
  // whole to the holding stacked every entity onto AZSEKER and left each
  // operating entity's budget EMPTY — the recurring "delete→AI-import wrong" bug
  // (memory project_budget_plf_five_blocks). The route now PRE-SPLITS it into one
  // virtual per-entity sheet each (applyBudgetPlfSplit, keyed by
  // REPORTING_PACK_BUDGET_PLF_BLOCK_ENTITIES) and REMOVES this raw sheet before
  // classification. This entry is the SAFE FALLBACK for when the split can't run
  // (block count changed): skip the raw sheet rather than re-introduce stacking.
  { match: "Budget PLF", role: "derived_summary" },
  { match: "BS Actual", planKind: "actual", role: "source" },
  { match: "CF Actual", planKind: "actual", role: "source" },
  // Budget CF skipped (2026-06-23): the İcmal budget is P&L-ONLY by design — a
  // budget plan carries no balance sheet and no cash flow. Routing this
  // consolidated CF to the holding wrote a hierarchical (parent+child) layer
  // with no dedup into CashFlowEntry (no companyId/planId), inflating the
  // holding CF ~10× (873 rows / 988M vs the correct per-company ~95M). The real
  // cash flow is the per-entity Guvven CF; the budget stays P&L-only.
  { match: "Budget CF", role: "derived_summary" },
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

/**
 * Ordered block→entity mapping for the `Budget PLF` sheet's stacked per-entity
 * blocks, IN DOCUMENT ORDER. Verified 2026-06-23 against the live DB +
 * _import-baseline.json by exact annual-revenue signature:
 *   block#1 EDEN 31,986,950 · block#2 AZSF 250,000 · block#3 ProMalt 8,308,790 ·
 *   block#4 CPC 18,334,363 · block#5 holding (group VAT only, 0 revenue).
 * Σ = 58,880,103 = the verified consolidated Budget PLF revenue (58.88M).
 *
 * `HOLDING_ENTITY_SENTINEL` is resolved to the org's level-1 company at apply
 * time. The split aborts (and the raw sheet is skipped) unless the detected
 * block count equals this list's length, so a reshaped file fails LOUDLY rather
 * than silently mis-mapping. Block ORDER is the only in-file signal (no per-block
 * entity label exists), so this is positional + count-guarded by design.
 */
export const REPORTING_PACK_BUDGET_PLF_BLOCK_ENTITIES: readonly string[] = [
  "AZSEKER-EDEN",
  "AZSEKER-AZSF",
  "AZSEKER-PROMALT",
  "AZSEKER-CPC",
  HOLDING_ENTITY_SENTINEL,
]

/** Signature tabs that identify the reporting-pack shape — the structured
 *  source PLF tabs. The route applies REPORTING_PACK_SHEET_MAP only when a
 *  workbook carries both, so the map never touches an unrelated upload. */
export function looksLikeReportingPack(sheetNames: readonly string[]): boolean {
  const set = new Set(sheetNames)
  return set.has("Actual PLF") && set.has("Budget PLF")
}
