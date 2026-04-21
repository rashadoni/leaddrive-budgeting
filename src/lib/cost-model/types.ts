// Placeholder types for the stubbed cost-model computation.
// cost-model/db.ts.loadAndCompute() returns a flexible shape — we expose a
// permissive `CostModelResult` so the resolver in cost-model-map.ts type-checks.
// When the cost model is fully migrated in from the source project, replace
// this with the real structured type.

export interface CostModelResult {
  grandTotalG: number
  grandTotalF?: number
  adminOverhead?: number
  techInfraTotal?: number
  totalOverhead?: number
  backOfficeCost?: number
  coreLabor?: number
  misc?: number
  riskCost?: number
  deptCosts?: Record<string, number>
  serviceRevenues?: Record<string, number>
  serviceCosts?: Record<string, number>
  serviceDetails?: Record<string, unknown>
  // Allow extra keys so existing ad-hoc lookups don't break
  [key: string]: unknown
}
