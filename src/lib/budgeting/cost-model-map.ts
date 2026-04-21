/**
 * Maps budget category names to cost model result keys.
 *
 * costModelKey format:
 *   "grandTotalG"           → CostModelResult.grandTotalG (grand total expenses)
 *   "grandTotalF"           → CostModelResult.grandTotalF (total without profit markup)
 *   "adminOverhead"         → CostModelResult.adminOverhead
 *   "techInfraTotal"        → CostModelResult.techInfraTotal
 *   "totalOverhead"         → CostModelResult.totalOverhead
 *   "backOfficeCost"        → CostModelResult.backOfficeCost
 *   "coreLabor"             → CostModelResult.coreLabor
 *   "misc"                  → CostModelResult.misc
 *   "riskCost"              → CostModelResult.riskCost
 *   "deptCosts.IT"          → CostModelResult.deptCosts["IT"]
 *   "deptCosts.Finance"     → CostModelResult.deptCosts["Finance"]
 *   "serviceRevenues.total" → sum of all CostModelResult.serviceRevenues values
 *   "serviceCosts.total"    → sum of all CostModelResult.serviceCosts values
 */

import type { CostModelResult } from "@/lib/cost-model/types"

export type CostModelKey = string

/** Extract a numeric value from a CostModelResult given a dotted key path */
export function resolveCostModelKey(result: CostModelResult, key: CostModelKey): number {
  if (!key) return 0

  // Helper: narrow an optional number to 0 when missing (the stub cost model
  // leaves many fields off, so every scalar read must be defensive)
  const num = (v: unknown): number => (typeof v === "number" ? v : 0)
  const r = result as Record<string, unknown>

  if (key === "grandTotalG") return num(r.grandTotalG)
  if (key === "grandTotalF") return num(r.grandTotalF)
  if (key === "adminOverhead") return num(r.adminOverhead)
  if (key === "techInfraTotal") return num(r.techInfraTotal)
  if (key === "totalOverhead") return num(r.totalOverhead)
  if (key === "backOfficeCost") return num(r.backOfficeCost)
  if (key === "coreLabor") return num(r.coreLabor)
  if (key === "misc") return num(r.misc)
  if (key === "riskCost") return num(r.riskCost)
  if (key === "grcDirectCost") return num(r.grcDirectCost)

  const svcRevenues = (result.serviceRevenues ?? {}) as Record<string, number>
  const svcCosts = (result.serviceCosts ?? {}) as Record<string, number>
  const deptCosts = (result.deptCosts ?? {}) as Record<string, number>
  const summary = (result as { summary?: { totalRevenue?: number } }).summary
  const serviceDetails = (result.serviceDetails ?? {}) as Record<string, Record<string, unknown>>

  if (key.startsWith("deptCosts.")) {
    const dept = key.slice("deptCosts.".length)
    return deptCosts[dept] ?? 0
  }

  if (key === "serviceRevenues.total") {
    // Use summary.totalRevenue (from PricingProfile) to match profitability page
    return summary?.totalRevenue ?? 0
  }

  if (key.startsWith("serviceRevenues.")) {
    const svc = key.slice("serviceRevenues.".length)
    const raw = svcRevenues[svc] ?? 0
    // Scale per-service revenue proportionally to match summary.totalRevenue (PricingProfile)
    const rawTotal: number = Object.values(svcRevenues).reduce((s: number, v: number) => s + v, 0)
    if (rawTotal > 0 && (summary?.totalRevenue ?? 0) > 0) {
      return raw * ((summary!.totalRevenue as number) / rawTotal)
    }
    return raw
  }

  if (key === "serviceCosts.total") {
    return Object.values(svcCosts).reduce((s: number, v: number) => s + v, 0)
  }

  if (key.startsWith("serviceCosts.")) {
    const svc = key.slice("serviceCosts.".length)
    return svcCosts[svc] ?? 0
  }

  // serviceDetails.{svc}.{field} → e.g. serviceDetails.permanent_it.directLabor
  if (key.startsWith("serviceDetails.")) {
    const parts = key.split(".")
    if (parts.length === 3) {
      const svc = parts[1]
      const field = parts[2]
      const detail = serviceDetails[svc]
      if (detail && typeof detail === "object" && field in detail) {
        return num((detail as Record<string, unknown>)[field])
      }
    }
    return 0
  }

  return 0
}

/**
 * Resolve a costModelPattern (from BudgetCostType) for a specific department.
 * Replaces `{dept}` placeholder with the department's serviceKey.
 *
 * Example: "serviceDetails.{dept}.directLabor" + serviceKey="permanent_it"
 *   → "serviceDetails.permanent_it.directLabor"
 */
export function resolvePatternForDept(pattern: string, serviceKey: string | null): string | null {
  if (!pattern) return null
  if (!pattern.includes("{dept}")) return pattern // shared cost type — no dept substitution
  if (!serviceKey) return null // department has no serviceKey (e.g. BackOffice)
  return pattern.replace("{dept}", serviceKey)
}

/** Human-readable labels for cost model keys (used in dropdowns) */
export const COST_MODEL_KEY_OPTIONS: { value: CostModelKey; label: string; group: string }[] = [
  // Totals
  { value: "grandTotalG", label: "Total expenses (with markup)", group: "Totals" },
  { value: "grandTotalF", label: "Total expenses (without markup)", group: "Totals" },
  { value: "totalOverhead", label: "Overhead (total)", group: "Totals" },

  // Labor
  { value: "coreLabor", label: "Payroll (core staff)", group: "Staff" },
  { value: "backOfficeCost", label: "Back office", group: "Staff" },
  { value: "grcDirectCost", label: "GRC direct costs", group: "Staff" },

  // Overhead
  { value: "adminOverhead", label: "Administrative overhead", group: "Overhead" },
  { value: "techInfraTotal", label: "IT Infrastructure", group: "Overhead" },
  { value: "misc", label: "Miscellaneous", group: "Overhead" },
  { value: "riskCost", label: "Risk reserve", group: "Overhead" },

  // Revenue
  { value: "serviceRevenues.total", label: "Revenue (all services)", group: "Revenue" },

  // Service costs
  { value: "serviceCosts.total", label: "Service costs (total)", group: "Services" },
]

/**
 * Default template: suggested costModelKey per standard budget category.
 * Used by TemplateSeedButton to pre-assign mappings.
 */
export const TEMPLATE_CATEGORY_MAP: Record<string, CostModelKey | undefined> = {
  // Expense categories → cost model keys
  "Payroll": "coreLabor",
  "Back office": "backOfficeCost",
  "IT Infrastructure": "techInfraTotal",
  "Overhead": "adminOverhead",
  "Risk reserve": "riskCost",
  "Miscellaneous": "misc",
  "GRC direct costs": "grcDirectCost",

  // Revenue categories → cost model keys
  "Service revenue": "serviceRevenues.total",
}

/**
 * Calculate month numbers for a plan period.
 * quarterly Q1 → [1,2,3], Q2 → [4,5,6], monthly M3 → [3], annual → [1..12]
 */
export function getPeriodMonths(plan: {
  periodType: string
  year: number
  quarter?: number | null
  month?: number | null
}): { count: number; months: number[] } {
  if (plan.periodType === "monthly" && plan.month) {
    return { count: 1, months: [plan.month] }
  }
  if (plan.periodType === "quarterly" && plan.quarter) {
    const s = (plan.quarter - 1) * 3 + 1
    return { count: 3, months: [s, s + 1, s + 2] }
  }
  if (plan.periodType === "annual") {
    return { count: 12, months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] }
  }
  return { count: 1, months: [] }
}

/**
 * Calculate the planned amount for a single budget line.
 * - Expense: PRIMARY from cost model, FALLBACK from ExpenseForecast
 * - Revenue: PRIMARY from cost model (serviceRevenues), FALLBACK from SalesForecast
 */
export function computePlannedForLine(
  line: { lineType: string; costModelKey: string | null; departmentId: string | null; costTypeId?: string | null },
  costModel: CostModelResult | null,
  salesForecasts: { departmentId: string; month: number; amount: number }[],
  periodMonths: number,
  periodMonthNumbers: number[],
  expenseForecasts?: { costTypeId: string; departmentId: string | null; month: number; amount: number }[],
): number {
  // Expense: PRIMARY from cost model, FALLBACK from ExpenseForecast
  if (line.lineType !== "revenue") {
    // Primary: from cost model × number of period months
    if (line.costModelKey && costModel) {
      const monthly = resolveCostModelKey(costModel, line.costModelKey)
      if (monthly > 0) return monthly * periodMonths
    }
    // Fallback: from ExpenseForecast (for businesses without cost model)
    if (expenseForecasts && line.costTypeId) {
      return expenseForecasts
        .filter(f =>
          f.costTypeId === line.costTypeId &&
          f.departmentId === line.departmentId &&
          periodMonthNumbers.includes(f.month)
        )
        .reduce((sum, f) => sum + f.amount, 0)
    }
    return 0
  }
  // Revenue: PRIMARY from cost model (serviceRevenues), FALLBACK to SalesForecast
  if (line.lineType === "revenue") {
    // Primary: from cost model serviceRevenues (matches profitability page)
    if (line.costModelKey && costModel) {
      const monthly = resolveCostModelKey(costModel, line.costModelKey)
      if (monthly > 0) return monthly * periodMonths
    }
    // Fallback: from SalesForecast (if cost model has no data)
    if (line.departmentId) {
      return salesForecasts
        .filter(f => f.departmentId === line.departmentId && periodMonthNumbers.includes(f.month))
        .reduce((sum, f) => sum + f.amount, 0)
    }
  }
  return 0
}
