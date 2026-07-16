/**
 * Phase 7.E ad-hoc scenario preview endpoint.
 *
 * POST /api/indicators/matrix/preview
 *   body: { period, overrides: Record<string, number> }
 *
 * Recomputes affected indicators (those whose `requiredInputs` reference
 * a namespace that the overrides could plausibly change — e.g. an FX
 * override only affects indicators that depend on `currencyRate`) under
 * the supplied overrides and returns:
 *   {
 *     period, overrides,
 *     cells: Array<{
 *       companyId, companyCode, indicatorId, indicatorCode, unit,
 *       baselineValue, baselineStatus,
 *       scenarioValue,  scenarioStatus,
 *       deltaPct,                  // ((scenario - baseline) / |baseline|) * 100
 *     }>,
 *   }
 *
 * Pure preview — NO DB writes. Existing IndicatorValue rows untouched.
 *
 * Auth: editor (preview burns CPU; viewers read the persisted matrix).
 * Rate limit: 5/min/user — preview is interactive, not bulk.
 */

// rls-scan-ignore: editor-only ad-hoc scenario PREVIEW (maxDuration 30). It
// runs a concurrency-8 recomputeIndicator loop over a `createPrismaDataSource`
// data source (issues many reads over seconds) with NO DB writes — too heavy
// for one 5s interactive withOrgScope tx. Read-only + orgId-scoped in code, so
// it runs on the BYPASSRLS `prismaAdmin` client (also passed into
// createPrismaDataSource, so the simulator reads are admin too).
import { NextRequest, NextResponse } from 'next/server'
import { prismaAdmin as prisma } from '@/lib/db/prisma-admin'
import { requireRole, isAuthError } from '@/lib/api-auth'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { getCompanyScope } from '@/lib/rbac/company-scope'
import {
  recomputeIndicator,
  createPrismaDataSource,
  type IndicatorDefinitionLike,
} from '@/lib/risk/recompute'
import { mapWithConcurrency } from '@/lib/risk/concurrency'
import { parsePeriod, PeriodParseError } from '@/lib/risk/periods'
import {
  filterOperationalCompanies,
  isRollupIndicator,
  preferOrgScopedDefinitions,
} from '@/lib/risk/targets'
import {
  loadPairApplicabilityResolver,
  matchApplicablePairs,
} from '@/lib/risk/pair-applicability'
import type { IndicatorStatus } from '@/lib/risk/formula-engine'

export const maxDuration = 30

const RATE_LIMIT = { name: 'matrix-preview', max: 5, windowMs: 60_000 }

interface BodyShape {
  period?: unknown
  overrides?: unknown
}

function shapeOverrides(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return out
}

/** Decide whether `indicator.requiredInputs` overlaps with the overrides.
 *  Conservative — recompute when in doubt.
 *
 *  Mapping logic:
 *   fx_*         → currencyRate resolver
 *   *_price_latest | *_index_latest | az_cpi_* | fao_* → commodityPrice: resolver
 *   rainfall_* | temp_avg_* → weather: resolver
 *   anything else → direct variable-name hit in requiredInputs
 */
function isAffected(
  indicator: { requiredInputs: string[] },
  overrideKeys: Set<string>,
): boolean {
  const keys = Array.from(overrideKeys)
  const ri = indicator.requiredInputs

  // FX overrides → currencyRate resolver
  if (keys.some((k) => k.startsWith('fx_')) && ri.includes('currencyRate')) return true

  // Commodity / macro price overrides → commodityPrice resolver
  // (brent_price_latest, sugar_price_latest, az_cpi_all_latest, corn_price_latest …)
  if (
    keys.some(
      (k) =>
        k.endsWith('_price_latest') ||
        k.endsWith('_index_latest') ||
        k.startsWith('az_cpi_') ||
        k.startsWith('fao_') ||
        k.startsWith('broiler_') ||
        k.startsWith('egg_'),
    ) &&
    ri.some((r) => r.startsWith('commodityPrice:'))
  )
    return true

  // Trade / tourism overrides → commodityPrice resolver (same alias table)
  if (
    keys.some((k) => k.startsWith('az_trade_') || k.startsWith('az_tourism_')) &&
    ri.some((r) => r.startsWith('commodityPrice:'))
  )
    return true

  // Weather overrides → weather resolver
  if (
    keys.some((k) => k.startsWith('rainfall_') || k.startsWith('temp_avg_')) &&
    ri.some((r) => r.startsWith('weather:'))
  )
    return true

  // Direct variable hits (resolver already produces this exact name in context)
  for (const r of ri) {
    if (overrideKeys.has(r)) return true
  }
  return false
}

export async function POST(request: NextRequest) {
  const session = await requireRole(request, 'editor')
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: 'User has no organization' },
      { status: 403 },
    )
  }

  const rateLimitError = enforceRateLimit(
    `${RATE_LIMIT.name}:${session.orgId}:${session.userId}:${getClientIp(request)}`,
    RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  let body: BodyShape
  try {
    body = (await request.json()) as BodyShape
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const periodRaw = typeof body.period === 'string' ? body.period : null
  if (!periodRaw) {
    return NextResponse.json({ error: 'period is required' }, { status: 400 })
  }
  try {
    parsePeriod(periodRaw)
  } catch (err) {
    if (err instanceof PeriodParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    throw err
  }
  const period = periodRaw

  const overrides = shapeOverrides(body.overrides)
  if (Object.keys(overrides).length === 0) {
    return NextResponse.json(
      { error: 'overrides must be a non-empty Record<string, number>' },
      { status: 400 },
    )
  }
  const overrideKeys = new Set(Object.keys(overrides))

  // Sub-group RBAC scope.
  const scope = await getCompanyScope(
    session.orgId,
    session.userId,
    session.role,
  )

  // Load companies (operational only) + indicators (active globally).
  const [companiesRaw, indicators] = await Promise.all([
    prisma.company.findMany({
      where: {
        organizationId: session.orgId,
        isActive: true,
        status: { not: 'pending' },
        ...(scope.ids ? { id: { in: Array.from(scope.ids) } } : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        // Required by filterOperationalCompanies — same column set as
        // /api/indicators/matrix:90.
        industry: true,
        level: true,
        isActive: true,
        role: true,
        parentCompanyId: true,
        status: true,
      },
    }),
    prisma.indicatorDefinition.findMany({
      where: {
        isActive: true,
        // prismaAdmin bypasses RLS for this CPU-heavy read-only route, so the
        // tenant boundary must stay explicit here. Global seeds are visible
        // to every org; org overrides are visible only to their own org.
        OR: [{ organizationId: null }, { organizationId: session.orgId }],
      },
      select: {
        id: true,
        organizationId: true,
        code: true,
        nameEn: true, // human-readable label for the preview results table
        nameRu: true,
        unit: true,
        formula: true,
        thresholds: true,
        requiredInputs: true,
        industries: true,
        isActive: true,
        category: true,
        aggregation: true, // 2026-05-31 — snapshot/flow → ctx.aggregation
      },
    }),
  ])

  const companies = filterOperationalCompanies(
    companiesRaw.filter((company) => company.status !== 'pending'),
  )
  type IndRow = (typeof indicators)[number]
  // Keep the same definition-selection contract as the canonical recompute
  // path: a tenant override wins over the global seed with the same code.
  const preferredIndicators = preferOrgScopedDefinitions(
    indicators as IndRow[],
  )
  // Quick Preview is an operational-leaf surface. Ordinary internal helpers
  // are hidden by the matrix; rollup-bearing internals are parent-only there.
  // Neither belongs in this leaf preview's pairs/counts/cells.
  const affectedIndicators = preferredIndicators.filter(
    (i: IndRow) =>
      i.category !== 'internal' &&
      !isRollupIndicator(i) &&
      isAffected({ requiredInputs: i.requiredInputs }, overrideKeys),
  )

  if (affectedIndicators.length === 0) {
    return NextResponse.json({
      period,
      overrides,
      cells: [],
      affectedIndicatorCount: 0,
      pairsAttempted: 0,
      pairsErrored: 0,
      lastError: null,
    })
  }

  if (companies.length === 0) {
    return NextResponse.json({
      period,
      overrides,
      cells: [],
      affectedIndicatorCount: 0,
      pairsAttempted: 0,
      pairsErrored: 0,
      lastError: null,
    })
  }

  // Load baseline IVs for the comparison table. They do NOT decide
  // applicability: a persisted calculation is output, not an explicit
  // activity-profile override. The explicit organizationId predicate is
  // defense in depth because this route deliberately uses prismaAdmin.
  const baselineIvs = await prisma.indicatorValue.findMany({
    where: {
      organizationId: session.orgId,
      companyId: { in: companies.map((company) => company.id) },
      indicatorId: {
        in: affectedIndicators.map((indicator: IndRow) => indicator.id),
      },
      period,
    },
    select: { companyId: true, indicatorId: true, value: true, status: true },
  })
  const baselineByKey = new Map<
    string,
    { value: number; status: IndicatorStatus }
  >()
  for (const iv of baselineIvs) {
    baselineByKey.set(`${iv.companyId}:${iv.indicatorId}`, {
      value: iv.value,
      status: iv.status as IndicatorStatus,
    })
  }

  // Applicability is pair-specific, not a catalogue-wide property. Avoid the
  // broad company x affected-indicator product: an agro KPI must not appear
  // on a food-processing company merely because the same shock affects both
  // formula families. Empty `industries` remains universal. Company
  // eligibility itself stays canonical: `filterOperationalCompanies` admits
  // only active, industry-classified level-2 operating entities.
  const pairApplicability = await loadPairApplicabilityResolver(prisma, {
    organizationId: session.orgId,
    companies,
    definitions: affectedIndicators,
  })
  const pairs = matchApplicablePairs(
    companies,
    affectedIndicators,
    pairApplicability,
  )
  const applicableIndicatorIds = [
    ...new Set(pairs.map(({ definition }) => definition.id)),
  ]

  if (pairs.length === 0) {
    return NextResponse.json({
      period,
      overrides,
      cells: [],
      affectedIndicatorCount: 0,
      pairsAttempted: 0,
      pairsErrored: 0,
      lastError: null,
    })
  }

  // Run preview recomputes — NO DB writes. `recomputeIndicator` normally
  // persists unconditionally, so the adapter must be created in preview mode;
  // its single write boundary becomes a no-op while all resolver reads remain
  // canonical.
  const ds = createPrismaDataSource(prisma, { mode: 'preview' })
  const results: Array<{
    companyId: string
    companyCode: string
    indicatorId: string
    indicatorCode: string
    indicatorNameEn: string | null
    indicatorNameRu: string | null
    unit: string
    baselineValue: number | null
    baselineStatus: IndicatorStatus | null
    scenarioValue: number | null
    scenarioStatus: IndicatorStatus | null
    deltaPct: number | null
  }> = []

  // Concurrency-capped (was sequential) — each call is still the canonical
  // recomputeIndicator (no writes in preview); only the loop is parallel, well
  // under the Prisma pool. Per-pair failure → null (skipped), never aborts.
  let perPairErrors = 0
  let lastError: string | null = null
  const mapped = await mapWithConcurrency(
    pairs,
    8,
    async ({ company: co, definition: ind }) => {
      try {
        const def: IndicatorDefinitionLike = {
          id: ind.id,
          code: ind.code,
          formula: ind.formula,
          thresholds: ind.thresholds,
          requiredInputs: ind.requiredInputs,
          aggregation: ind.aggregation, // 2026-05-31 — snapshot/flow
        }
        const r = await recomputeIndicator(ds, {
          organizationId: session.orgId,
          companyId: co.id,
          definition: def,
          period,
          scenarioOverrides: overrides,
        })
        const baseline = baselineByKey.get(`${co.id}:${ind.id}`) ?? null
        const baselineValue = baseline?.value ?? null
        const scenarioValue = r.status === 'unknown' ? null : r.value
        let deltaPct: number | null = null
        if (
          baselineValue !== null &&
          scenarioValue !== null &&
          Math.abs(baselineValue) > 1e-9
        ) {
          deltaPct =
            ((scenarioValue - baselineValue) / Math.abs(baselineValue)) * 100
        }
        return {
          companyId: co.id,
          companyCode: co.code ?? co.id,
          indicatorId: ind.id,
          indicatorCode: ind.code,
          indicatorNameEn: ind.nameEn,
          indicatorNameRu: ind.nameRu,
          unit: ind.unit,
          baselineValue,
          baselineStatus: baseline?.status ?? null,
          scenarioValue,
          scenarioStatus: r.status === 'unknown' ? null : r.status,
          deltaPct,
        }
      } catch (err) {
        // Per-pair failure shouldn't abort the whole preview; skip the pair (the
        // UI renders it as missing). Counted + last-error surfaced for diagnostics.
        perPairErrors++
        lastError = err instanceof Error ? err.message : String(err)
        return null
      }
    },
  )
  for (const m of mapped) if (m) results.push(m)

  return NextResponse.json({
    period,
    overrides,
    affectedIndicatorCount: applicableIndicatorIds.length,
    pairsAttempted: pairs.length,
    pairsErrored: perPairErrors,
    lastError,
    cells: results,
  })
}
