/**
 * Phase 1 "Crisis Brief" — driver re-derivation engine (B2).
 *
 * Pure orchestration over buildContext + recomputeIndicator (both injectable
 * for unit tests). Per company: read baseline resolved scalars, run the B2
 * P&L recompute (resolveShockOverrides) into a flat scenarioOverrides map,
 * re-derive every indicator under it (NO PERSIST), emit deltas. Holding swing
 * uses computeCompositeByCompany + deriveParentComposites — the SAME helpers
 * the live terminal uses, so the demo number matches the real screen.
 *
 * NO DB WRITES.
 */

import {
  buildContext as realBuildContext,
  recomputeIndicator as realRecompute,
  type IndicatorDefinitionLike,
} from './recompute'
import type { RecomputeDataSource } from './recompute-types'
import type { IndicatorStatus } from './formula-engine'
import { parsePeriod } from './periods'
import { hasShock, readShock, resolveShockOverrides, type ResolvedScalars } from './scenario-shock'
import { computeCompositeByCompany, deriveParentComposites } from './composite-score'
import type { HeatMapCell } from './heatmap-matrix'

export interface SimulateByDriversCompany {
  id: string
  code: string
  name: string
  parentCompanyId?: string | null
  industry?: string | null
  revenue?: number | null
}
export interface SimulateByDriversIndicator {
  id: string
  code: string
  formula: string
  thresholds: unknown
  requiredInputs: string[]
  weight?: number | null
}
export interface SimulateByDriversBaselineIV {
  companyId: string
  indicatorId: string
  value: number
  status: IndicatorStatus
}
export interface SimulateByDriversInput {
  organizationId: string
  scenario: { code: string; overrides: unknown }
  period: string
  companies: SimulateByDriversCompany[]
  indicators: SimulateByDriversIndicator[]
  baselineIVs: SimulateByDriversBaselineIV[]
}
export interface SimulateByDriversDeps {
  buildContext?: typeof realBuildContext
  recomputeIndicator?: typeof realRecompute
}
export interface DriverIndicatorDelta {
  companyId: string
  companyCode: string
  companyName: string
  indicatorId: string
  code: string
  baselineValue: number | null
  baselineStatus: IndicatorStatus | null
  scenarioValue: number | null
  scenarioStatus: IndicatorStatus | null
  changed: boolean
  deltaPct: number | null
}
export interface DriverCompositeSwing {
  companyId: string
  companyCode: string
  baselineScore: number | null
  scenarioScore: number | null
}
export interface DriverSimulationResult {
  scenarioCode: string
  period: string
  deltas: DriverIndicatorDelta[]
  byCompany: DriverCompositeSwing[]
  holdingBaselineScore: number | null
  holdingScenarioScore: number | null
  changed: number
  worsened: number
  improved: number
  driftSummary: { pairsAttempted: number; pairsErrored: number; lastError: string | null }
}

const STATUS_ORDER: Record<IndicatorStatus, number> = { green: 3, amber: 2, red: 1, unknown: 0 }

function readScalars(ctx: Record<string, unknown>): ResolvedScalars {
  const g = (k: string): number => (typeof ctx[k] === 'number' ? (ctx[k] as number) : NaN)
  return {
    revenue: g('revenue'),
    cogs: g('cogs'),
    opex: g('opex'),
    gross_profit: g('gross_profit'),
    ebitda: g('ebitda'),
    net_income: g('net_income'),
    da_total: g('da_total'),
    total_input_cost: g('total_input_cost'),
    imported_input_cost: g('imported_input_cost'),
    yield_per_ha: g('yield_per_ha'),
  }
}

export async function simulateByDrivers(
  ds: RecomputeDataSource,
  input: SimulateByDriversInput,
  deps: SimulateByDriversDeps = {},
): Promise<DriverSimulationResult> {
  const buildContext = deps.buildContext ?? realBuildContext
  const recomputeIndicator = deps.recomputeIndicator ?? realRecompute
  const { organizationId, scenario, period, companies, indicators, baselineIVs } = input

  if (!hasShock(scenario.overrides)) {
    throw new Error(`Scenario ${scenario.code} has no shock — use the legacy multiplier path.`)
  }
  const shock = readShock(scenario.overrides)!
  const parsedPeriod = parsePeriod(period)

  const baselineByKey = new Map<string, SimulateByDriversBaselineIV>()
  for (const iv of baselineIVs) baselineByKey.set(`${iv.companyId}:${iv.indicatorId}`, iv)

  const requiredUnion = Array.from(new Set(indicators.flatMap((i) => i.requiredInputs ?? [])))

  // Leaf = a company nobody else points to as parent. Only leaves contribute
  // cells to the composite; parents (incl. the holding root) get a
  // revenue-weighted roll-up via deriveParentComposites — mirroring the live
  // terminal, where a parent's own sparse/rollup cells never override the
  // children's weighted composite.
  const parentIds = new Set<string>()
  for (const c of companies) if (c.parentCompanyId) parentIds.add(c.parentCompanyId)
  const isLeaf = (id: string): boolean => !parentIds.has(id)

  const deltas: DriverIndicatorDelta[] = []
  let pairsErrored = 0
  let lastError: string | null = null
  const scenarioCells: HeatMapCell[] = []
  const baselineCells: HeatMapCell[] = []

  for (const co of companies) {
    let overrides: Record<string, number> = {}
    try {
      const baseCtx = await buildContext(ds, {
        organizationId,
        companyId: co.id,
        period: parsedPeriod,
        requiredInputs: requiredUnion,
        industry: co.industry ?? null,
      })
      overrides = resolveShockOverrides(shock, readScalars(baseCtx.context as Record<string, unknown>))
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }

    for (const ind of indicators) {
      const key = `${co.id}:${ind.id}`
      const baseline = baselineByKey.get(key) ?? null
      const def: IndicatorDefinitionLike = {
        id: ind.id,
        code: ind.code,
        formula: ind.formula,
        thresholds: ind.thresholds,
        requiredInputs: ind.requiredInputs,
      }
      let scenarioValue: number | null = baseline?.value ?? null
      let scenarioStatus: IndicatorStatus | null = baseline?.status ?? null
      try {
        const rr = await recomputeIndicator(ds, {
          organizationId,
          companyId: co.id,
          definition: def,
          period,
          industry: co.industry ?? null,
          scenarioOverrides: overrides,
        })
        scenarioValue = rr.status === 'unknown' ? null : rr.value
        scenarioStatus = rr.status
      } catch (err) {
        pairsErrored++
        lastError = err instanceof Error ? err.message : String(err)
      }
      const baselineValue = baseline?.value ?? null
      const baselineStatus = baseline?.status ?? null
      let deltaPct: number | null = null
      if (baselineValue !== null && scenarioValue !== null && Math.abs(baselineValue) > 1e-9) {
        deltaPct = ((scenarioValue - baselineValue) / Math.abs(baselineValue)) * 100
      }
      const changed = baselineStatus !== null && scenarioStatus !== null && baselineStatus !== scenarioStatus
      deltas.push({
        companyId: co.id,
        companyCode: co.code,
        companyName: co.name,
        indicatorId: ind.id,
        code: ind.code,
        baselineValue,
        baselineStatus,
        scenarioValue,
        scenarioStatus,
        changed,
        deltaPct,
      })
      const w = ind.weight ?? undefined
      if (isLeaf(co.id)) {
        if (baselineStatus) {
          baselineCells.push({ companyId: co.id, indicatorId: ind.id, value: baselineValue ?? 0, status: baselineStatus, weight: w })
        }
        if (scenarioStatus) {
          scenarioCells.push({ companyId: co.id, indicatorId: ind.id, value: scenarioValue ?? 0, status: scenarioStatus, weight: w })
        }
      }
    }
  }

  const ids = companies.map((c) => c.id)
  const baseLeaf = computeCompositeByCompany(baselineCells, ids)
  const scenLeaf = computeCompositeByCompany(scenarioCells, ids)
  const compArg = companies.map((c) => ({ id: c.id, parentCompanyId: c.parentCompanyId ?? null, revenue: c.revenue ?? null }))
  const baseAll = deriveParentComposites(compArg, baseLeaf)
  const scenAll = deriveParentComposites(compArg, scenLeaf)

  const byCompany: DriverCompositeSwing[] = companies.map((c) => ({
    companyId: c.id,
    companyCode: c.code,
    baselineScore: baseAll.get(c.id)?.score ?? null,
    scenarioScore: scenAll.get(c.id)?.score ?? null,
  }))

  const roots = companies.filter((c) => !c.parentCompanyId)
  const holdingId = roots.sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0))[0]?.id ?? null
  const holdingBaselineScore = holdingId ? baseAll.get(holdingId)?.score ?? null : null
  const holdingScenarioScore = holdingId ? scenAll.get(holdingId)?.score ?? null : null

  let worsened = 0
  let improved = 0
  let changed = 0
  for (const d of deltas) {
    if (!d.changed || d.baselineStatus == null || d.scenarioStatus == null) continue
    changed++
    if (STATUS_ORDER[d.scenarioStatus] < STATUS_ORDER[d.baselineStatus]) worsened++
    else improved++
  }

  return {
    scenarioCode: scenario.code,
    period,
    deltas,
    byCompany,
    holdingBaselineScore,
    holdingScenarioScore,
    changed,
    worsened,
    improved,
    driftSummary: { pairsAttempted: companies.length * indicators.length, pairsErrored, lastError },
  }
}
