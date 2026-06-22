/**
 * Deterministic sheet-routing (2026-06-22) — see
 * docs/superpowers/specs/2026-06-22-deterministic-sheet-routing-design.md.
 *
 * Resolves, for one classified sheet, its `planKind` (actual vs budget) and its
 * `role` (source vs derived_summary) using a DETERMINISTIC authority chain. The
 * LLM is advisory only — it never appears here. This is the #1-risk routing
 * (budget/actual plan selection = the "budget-wipe" corruption class), so:
 *
 *   • planKind authority order:  >>> section  >  per-shape config  >
 *     tab-name keyword  >  dataType rule (sales/forecast/budget-actuals → budget)
 *   • when NONE of those fire, planKind is `null` (UNRESOLVED). The caller MUST
 *     apply a safety policy (block a mixed workbook; default actual only for a
 *     pure-actuals workbook). This module never silently picks "actual".
 *   • role: config  >  derived-name pattern  >  source (default). Derived/
 *     summary views (consolidations, pivots, comparisons, margins) are skipped
 *     by the orchestrator so the ~6 same-dataType views can't clean-slate each
 *     other.
 */
import type { SheetDataType } from "./sheet-classifier"

export type PlanKind = "actual" | "budget"
export type SheetRole = "source" | "derived_summary"
export type SectionContext = "actual" | "budget" | "kpi" | "capex" | null

/** One per-shape mapping rule. `match` is an exact sheet name or a pattern. */
export interface SheetMapEntry {
  match: string | RegExp
  dataType?: SheetDataType
  planKind?: PlanKind
  role?: SheetRole
}
export type SheetMap = SheetMapEntry[]

export type PlanKindSignal =
  | "section"
  | "config"
  | "keyword"
  | "dataType"
  | "unresolved"
export type RoleSignal = "config" | "name-pattern" | "default"

export interface RoutingInput {
  dataType: SheetDataType
  sheetName: string
  section: SectionContext
  /** Optional per-shape overrides (Organization.importConfig in the robust version). */
  config?: SheetMap
}

export interface RoutingResult {
  /** Resolved plan kind, or null when no trusted signal fired (caller decides). */
  planKind: PlanKind | null
  role: SheetRole
  planKindSignal: PlanKindSignal
  roleSignal: RoleSignal
}

/**
 * Tab-name keywords. Conservative on purpose — only words that unambiguously
 * mean budget or actual in the workbooks we ingest (EN / AZ / RU). A miss
 * yields `null` (→ caller blocks), never a wrong guess.
 */
const BUDGET_NAME = /\b(budget|büdcə|budcə|бюджет|proqnoz|forecast)\b/i
const ACTUAL_NAME = /\b(actual|faktiki|fakt|факт\w*)\b/i

/**
 * Derived/summary view names: a re-presentation of source numbers, NOT a source
 * of record. Consolidations, pivots, comparisons, margin analyses, dashboards.
 * These are skipped on write so they don't collide with the source sheet.
 */
const DERIVED_NAME =
  /(consolidat|\bcons\b|консолид|icmal|İcmal|məcmu|pivot|свод|comparison|müqayis|сравн|marginalit|mənfəət|маржинал|dashboard|\bsummary\b|обзор|сводка|\bBU\b|\bdata\b)/i

/** dataTypes that are inherently forward plans (route to the budget plan). */
const BUDGET_DATATYPES = new Set<SheetDataType>([
  "SALES",
  "SALES_FORECAST",
  "BUDGET_ACTUALS",
])

function matchEntry(entry: SheetMapEntry, sheetName: string): boolean {
  return typeof entry.match === "string"
    ? entry.match === sheetName
    : entry.match.test(sheetName)
}

function resolveRole(input: RoutingInput): {
  role: SheetRole
  roleSignal: RoleSignal
} {
  const cfg = input.config?.find(
    (e) => e.role !== undefined && matchEntry(e, input.sheetName),
  )
  if (cfg?.role) return { role: cfg.role, roleSignal: "config" }
  if (DERIVED_NAME.test(input.sheetName))
    return { role: "derived_summary", roleSignal: "name-pattern" }
  return { role: "source", roleSignal: "default" }
}

function resolvePlanKind(input: RoutingInput): {
  planKind: PlanKind | null
  planKindSignal: PlanKindSignal
} {
  // 1. Explicit workbook section separator (">>> Actual" etc.) — highest authority.
  if (input.section === "budget" || input.section === "actual")
    return { planKind: input.section, planKindSignal: "section" }

  // 2. Per-shape config override.
  const cfg = input.config?.find(
    (e) => e.planKind !== undefined && matchEntry(e, input.sheetName),
  )
  if (cfg?.planKind)
    return { planKind: cfg.planKind, planKindSignal: "config" }

  // 3. Unambiguous tab-name keyword.
  if (BUDGET_NAME.test(input.sheetName))
    return { planKind: "budget", planKindSignal: "keyword" }
  if (ACTUAL_NAME.test(input.sheetName))
    return { planKind: "actual", planKindSignal: "keyword" }

  // 4. dataType rule — sales/forecast/budget-actuals are forward plans.
  if (BUDGET_DATATYPES.has(input.dataType))
    return { planKind: "budget", planKindSignal: "dataType" }

  // 5. No trusted signal. NEVER default to "actual" here — the caller applies
  //    the workbook-aware safety policy.
  return { planKind: null, planKindSignal: "unresolved" }
}

export function resolveSheetRouting(input: RoutingInput): RoutingResult {
  const { role, roleSignal } = resolveRole(input)
  const { planKind, planKindSignal } = resolvePlanKind(input)
  return { planKind, role, planKindSignal, roleSignal }
}
