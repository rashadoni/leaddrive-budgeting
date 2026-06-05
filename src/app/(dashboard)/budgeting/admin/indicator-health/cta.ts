import { OPERATIONAL_METRIC_RULES } from "@/lib/risk/metric-validation-rules"
import { resolveFinancialVariableByInput } from "@/lib/risk/financial-variable-rules"

/** A remediation call-to-action: which admin tool resolves the gap + its label. */
export interface CtaTarget {
  href: string
  labelKey: string
}

/** The slice of a gappy-indicator row the CTA builder needs. */
export interface GapForCta {
  indicatorCode: string
  affectedEntities: string[]
  missingVariable: string | null
  category: string
}

/** Operational-KPI metrics a user can actually type into the manual
 *  data-entry form (`/budgeting/admin/data-entry`). The form's metric
 *  dropdown is restricted to this catalog — anything not here cannot be
 *  hand-entered, so offering "enter manually" for it is a dead-end. */
export const MANUAL_METRICS: ReadonlySet<string> = new Set(
  OPERATIONAL_METRIC_RULES.map((r) => r.metric),
)

/** Resolve a missing formula variable to a manually-enterable operational
 *  metric, or `null` when none applies. `null` ⇒ the manual CTA is hidden,
 *  because the data-entry form literally cannot accept that variable (the
 *  honest signal is "import it / connect a feed", not "type it by hand").
 *
 *  Deliberately a DIRECT match only. Derived statistics (`*_stdev`, `*_mean`)
 *  and feed-backed vars (commodity prices, FX, weather, news sentiment) are
 *  produced by resolvers reading IntelDataPoint / external sources — entering
 *  a base metric by hand does NOT feed them, so offering manual entry would be
 *  a dead-end. Those are categorized `external-feed` upstream and never reach
 *  the manual CTA. */
export function resolveManualMetric(missingVar: string | null): string | null {
  if (!missingVar) return null
  return MANUAL_METRICS.has(missingVar) ? missingVar : null
}

/** Resolve a missing formula variable to a hand-enterable FINANCIAL statement
 *  variable (e.g. `"balanceSheetLine.inventory"` → `"inventory"`), or `null`.
 *
 *  The financial counterpart to `resolveManualMetric`: when this matches, the
 *  expanded row renders the inline `FinancialVariableEntry` form, which writes
 *  the statement figure via `POST /api/budgeting/financial-variable` (no
 *  separate data-entry page — the figure is a balance-sheet line, not an
 *  operational KPI). Direct match on the resolver input key only. */
export function resolveFinancialVariable(missingVar: string | null): string | null {
  const rule = resolveFinancialVariableByInput(missingVar)
  return rule ? rule.variable : null
}

/** Build the remediation CTAs for one gappy indicator.
 *
 *  - `ingest-gap` → import only (the data exists in a file, not by hand).
 *  - `no-data`    → manual + import, BUT the manual CTA appears only when the
 *                   missing var maps to an enterable metric, and it deep-links
 *                   the data-entry form with `?company=&metric=` prefilled so
 *                   the user lands ready to type — not on a blank form with the
 *                   wrong KPI preselected (the bug this fixes).
 *  - `external-feed` → connect a data source.
 *  - anything else (formula-edge-case / leaf-rollup / code-bug) → no CTA. */
export function buildCtas(g: GapForCta): CtaTarget[] {
  const importHref = "/budgeting/admin/ai-import"
  switch (g.category) {
    case "ingest-gap":
      return [{ href: importHref, labelKey: "ctaImport" }]
    case "no-data": {
      const out: CtaTarget[] = []
      const manualMetric = resolveManualMetric(g.missingVariable)
      if (manualMetric) {
        const p = new URLSearchParams()
        const entity = g.affectedEntities[0]
        if (entity) p.set("company", entity)
        p.set("metric", manualMetric)
        out.push({
          href: `/budgeting/admin/data-entry?${p.toString()}`,
          labelKey: "ctaManual",
        })
      }
      out.push({ href: importHref, labelKey: "ctaImport" })
      return out
    }
    case "external-feed":
      return [{ href: "/budgeting/admin/data-sources", labelKey: "ctaFeed" }]
    default:
      return []
  }
}
