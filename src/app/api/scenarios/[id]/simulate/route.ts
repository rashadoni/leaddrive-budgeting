/**
 * GET /api/scenarios/[id]/simulate
 *
 * Phase 7.N — Live scenario simulation endpoint.
 *
 * Returns a `SimulationResult` showing which indicators change status when
 * the scenario's overrides are applied to the current period's
 * IndicatorValues. No DB writes — read-only, safe for frequent polling.
 *
 * Auth: requireAuth (same as GET /api/scenarios).
 * Rate-limit: none (GET, read-only, fast).
 *
 * Query params:
 *   period  — optional; defaults to currentBakuYear() (e.g. "2026")
 */

// rls-scan-ignore: read-only live-simulation route. Its drivers-mode drives
// a `createPrismaDataSource`-backed simulator that issues its own reads AND
// an optional Anthropic "Crisis Brief" (runCrisisBrief) — neither fits inside
// one 5s interactive withOrgScope tx. It is READ-ONLY and orgId-scoped, so it
// uses the BYPASSRLS `prismaAdmin` client (passed into createPrismaDataSource,
// so the simulator reads are admin too) — app-layer org scoping preserved,
// survives the Stage-3 env-flip without a giant transaction.
import { NextRequest, NextResponse } from 'next/server'
import { prismaAdmin as prisma } from '@/lib/db/prisma-admin'
import { requireAuth, isAuthError } from '@/lib/api-auth'
import { currentBakuYear, parsePeriod } from '@/lib/risk/periods'
import {
  simulateScenario,
  buildDeltaMap,
  type SimulatableOverrides,
} from '@/lib/risk/scenario-simulator'
import { createPrismaDataSource } from '@/lib/risk/recompute'
import { hasShock, readShock, buildDriverNote, COMPANY_DRIVERS } from '@/lib/risk/scenario-shock'
import { resolveFeedShock, resolveFeedContext, FEED_STALE_DAYS, type FeedSnapshot } from '@/lib/risk/scenario-feed-context'
import { simulateByDrivers } from '@/lib/risk/scenario-rederive'
import { aiErrorBody } from '@/lib/ai/ai-error'
import { runCrisisBrief, type BriefLanguage } from '@/lib/risk/scenario-narrative'
import { hasAnthropicKey } from '@/lib/ai/client'
import {
  loadPairApplicabilityResolver,
  type PairApplicabilityDefinition,
  type PairApplicabilityResolver,
} from '@/lib/risk/pair-applicability'
import { getCompanyScope } from '@/lib/rbac/company-scope'
import {
  filterOperationalCompanies,
  isIndicatorApplicableToCompany,
  isRollupIndicator,
  preferOrgScopedDefinitions,
} from '@/lib/risk/targets'

function scenarioVisibleDefinitions<
  I extends {
    id: string
    code: string
    organizationId: string | null
    industries: string[]
    isActive: boolean
    category: string | null
    requiredInputs: string[]
  },
>(definitions: I[]): I[] {
  return preferOrgScopedDefinitions(definitions).filter(
    (definition) =>
      definition.category !== 'internal' || isRollupIndicator(definition),
  )
}

function createScenarioPairPredicate<
  C extends {
    id: string
    industry: string | null
    level: number | null
    parentCompanyId: string | null
  },
>(companies: readonly C[], resolver: PairApplicabilityResolver) {
  const explicitByPair = new Map(
    resolver.overrides.map((override) => [
      `${override.companyId}::${override.indicatorId}`,
      override.enabled,
    ]),
  )
  const childrenByParentId = new Map<string, C[]>()
  for (const company of companies) {
    if (!company.parentCompanyId) continue
    const children = childrenByParentId.get(company.parentCompanyId) ?? []
    children.push(company)
    childrenByParentId.set(company.parentCompanyId, children)
  }

  return (company: C, definition: PairApplicabilityDefinition): boolean => {
    const key = `${company.id}::${definition.id}`
    if (explicitByPair.has(key)) return explicitByPair.get(key) === true
    if (company.level !== 1) return resolver.isApplicable(company, definition)

    // A level-1 subgroup with null taxonomy derives applicability from the
    // operational children visible in this RBAC scope. It must not inherit
    // the base predicate's unknown-industry fail-open and expose every KPI.
    if (
      company.industry &&
      isIndicatorApplicableToCompany(company, definition)
    ) {
      return true
    }
    return (childrenByParentId.get(company.id) ?? []).some((child) =>
      resolver.isApplicable(child, definition),
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(request)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: 'User has no organization' }, { status: 403 })
  }

  const scope = await getCompanyScope(
    session.orgId,
    session.userId,
    session.role,
  )

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const period = searchParams.get('period') ?? currentBakuYear()

  // ── Fetch scenario (tenant-scoped) ─────────────────────────────────────
  const scenario = await prisma.scenario.findFirst({
    where: { id, organizationId: session.orgId, isActive: true },
  })
  if (!scenario) {
    return NextResponse.json({ error: 'Scenario not found' }, { status: 404 })
  }

  const mode = searchParams.get('mode')
  const language = (searchParams.get('lang') as BriefLanguage | null) ?? 'ru'

  // ── Driver re-derivation path (Phase 1 "Crisis Brief", B2) ────────────────
  if (mode === 'drivers') {
    if (!hasShock(scenario.overrides)) {
      return NextResponse.json(
        { error: 'Scenario has no `shock` block — run the default multiplier simulate (omit ?mode=drivers).' },
        { status: 422 },
      )
    }
    const rawShock = readShock(scenario.overrides)!
    // Phase 16.6 — the year the period falls in, for the assumption load below.
    // `parsePeriod` throws on a malformed period; the same period string has
    // already reached `simulateByDrivers` unvalidated on every path here, so a
    // failure to read the year must not be the thing that breaks the request —
    // it only costs the per-company shares.
    let periodYear: number | null = null
    try {
      periodYear = parsePeriod(period).year
    } catch {
      periodYear = null
    }
    const [companiesRaw, indicatorsRaw, baselineRows, fxRows, intelRows, assumptionRows] = await Promise.all([
      prisma.company.findMany({
        where: {
          organizationId: session.orgId,
          isActive: true,
          status: { not: 'pending' },
          role: 'operational',
          ...(scope.ids ? { id: { in: Array.from(scope.ids) } } : {}),
          OR: [
            { level: 1 },
            { level: 2, industry: { not: null } },
          ],
        },
        select: {
          id: true,
          code: true,
          name: true,
          parentCompanyId: true,
          industry: true,
          level: true,
          isActive: true,
          role: true,
          status: true,
        },
      }),
      prisma.indicatorDefinition.findMany({
        where: {
          isActive: true,
          // prismaAdmin bypasses RLS on this long-running read-only path.
          OR: [{ organizationId: null }, { organizationId: session.orgId }],
        },
        select: { id: true, organizationId: true, code: true, formula: true, thresholds: true, requiredInputs: true, industries: true, isActive: true, category: true, weight: true, aggregation: true, unit: true },
      }),
      prisma.indicatorValue.findMany({
        where: {
          organizationId: session.orgId,
          period,
          ...(scope.ids
            ? { companyId: { in: Array.from(scope.ids) } }
            : {}),
          company: {
            organizationId: session.orgId,
            isActive: true,
            status: { not: 'pending' },
            role: 'operational',
            OR: [
              { level: 1 },
              { level: 2, industry: { not: null } },
            ],
          },
          indicator: {
            isActive: true,
            OR: [{ organizationId: null }, { organizationId: session.orgId }],
          },
        },
        select: { companyId: true, indicatorId: true, value: true, status: true, inputs: true },
      }),
      // Phase 2 — latest live feed for shock-target anchoring.
      prisma.currencyRateHistory.findMany({
        where: { organizationId: session.orgId },
        orderBy: [{ currencyCode: 'asc' }, { rateDate: 'desc' }],
        distinct: ['currencyCode'],
        select: { currencyCode: true, rate: true, rateDate: true },
      }),
      prisma.intelDataPoint.findMany({
        where: { organizationId: session.orgId, metric: { in: ['BRENT_USD_BBL', 'FAO_SUGAR_INDEX', 'FAO_CEREAL_INDEX'] } },
        orderBy: [{ metric: 'asc' }, { datetime: 'desc' }],
        distinct: ['metric'],
        select: { metric: true, value: true, datetime: true },
      }),
      // Phase 16.6 — every assumption on any plan for this period's year, both
      // tiers, unresolved. `resolveAssumption` applies precedence per company.
      //
      // Scoped by YEAR rather than by one plan id because `BudgetAssumption` is
      // plan-scoped while a scenario is period-scoped, and an org may hold both
      // an actual and a budget plan for the same year. Taking the union and
      // letting the resolver break ties deterministically is honest about that;
      // picking one plan silently would make the answer depend on which plan
      // happened to be created first.
      periodYear === null
        ? Promise.resolve([])
        : prisma.budgetAssumption.findMany({
            where: {
              organizationId: session.orgId,
              // Phase 16.7 — every driver a scenario lever can read, not just
              // the FX one. Filtered by key rather than loaded whole so a plan
              // with hundreds of documentation-only assumptions costs nothing.
              key: { in: COMPANY_DRIVERS.map((d) => d.key) },
              plan: { is: { year: periodYear, deletedAt: null } },
            },
            select: { id: true, key: true, value: true, unit: true, companyId: true, sortOrder: true, createdAt: true },
          }),
    ])

    // Keep scenario simulation on the same decision surface as the matrix:
    // active/non-pending operational leaves plus operational level-1
    // subgroup rows. Admin, holding and unclassified shells must not enter
    // through taxonomy's intentional unknown-industry fail-open rule.
    const activeCompaniesRaw = companiesRaw.filter(
      (company) =>
        company.status !== 'pending' &&
        (!scope.ids || scope.ids.has(company.id)),
    )
    const companies = [
      ...filterOperationalCompanies(activeCompaniesRaw),
      ...activeCompaniesRaw.filter(
        (company) =>
          company.isActive &&
          company.level === 1 &&
          company.role === 'operational',
      ),
    ]
    // A same-code org definition replaces its global seed everywhere on this
    // surface. Otherwise duplicate baselines would be simulated twice.
    const indicators = scenarioVisibleDefinitions(indicatorsRaw)
    const pairApplicability = await loadPairApplicabilityResolver(prisma, {
      organizationId: session.orgId,
      companies,
      definitions: indicators,
    })
    const isApplicablePair = createScenarioPairPredicate(
      companies,
      pairApplicability,
    )
    const companyById = new Map(companies.map((company) => [company.id, company]))
    const indicatorById = new Map(
      indicators.map((indicator) => [indicator.id, indicator]),
    )
    const applicableBaselineRows = baselineRows.filter((row) => {
      const company = companyById.get(row.companyId)
      const definition = indicatorById.get(row.indicatorId)
      return Boolean(
        company &&
          definition &&
          (company.level === 1
            ? isRollupIndicator(definition)
            : !isRollupIndicator(definition)) &&
          isApplicablePair(company, definition),
      )
    })

    // Build the feed snapshot + resolve any absolute target → its drives fraction.
    const nowMs = Date.now()
    const staleMs = FEED_STALE_DAYS * 86_400_000
    const feedSnapshot: FeedSnapshot = {}
    for (const r of fxRows) {
      feedSnapshot[`AZN_${r.currencyCode}`] = { value: r.rate, asOf: r.rateDate.toISOString().slice(0, 10), stale: nowMs - r.rateDate.getTime() > staleMs }
    }
    for (const r of intelRows) {
      feedSnapshot[r.metric] = { value: r.value, asOf: r.datetime.toISOString().slice(0, 10), stale: nowMs - r.datetime.getTime() > staleMs }
    }
    const resolvedShock = resolveFeedShock(rawShock, feedSnapshot)
    const feedAnchors = resolveFeedContext(rawShock, feedSnapshot)
    // A target-only scenario whose feed metric is missing can't derive a fraction.
    if (!hasShock({ shock: resolvedShock })) {
      return NextResponse.json(
        { error: 'Scenario target metric unavailable in the live feed — cannot derive the shock.' },
        { status: 422 },
      )
    }

    // Revenue per company = MAX(inputs.resolved.revenue) — NO company.revenue column (spec §B).
    const revenueByCompanyId = new Map<string, number>()
    for (const r of applicableBaselineRows) {
      const rev = (r.inputs as { resolved?: { revenue?: unknown } } | null)?.resolved?.revenue
      if (typeof rev === 'number' && Number.isFinite(rev)) {
        const cur = revenueByCompanyId.get(r.companyId) ?? -Infinity
        if (rev > cur) revenueByCompanyId.set(r.companyId, rev)
      }
    }

    // Defense in depth: the simulator also suppresses its writer internally,
    // but the adapter itself must be read-only so a future simulator refactor
    // cannot turn this GET endpoint into an IndicatorValue write path.
    const ds = createPrismaDataSource(prisma, { mode: 'preview' })
    const sim = await simulateByDrivers(ds, {
      organizationId: session.orgId,
      scenario: { code: scenario.code, overrides: { shock: resolvedShock } },
      period,
      companies: companies.map((c) => ({
        id: c.id,
        code: c.code ?? c.id,
        name: c.name,
        parentCompanyId: c.parentCompanyId,
        industry: c.industry,
        revenue: revenueByCompanyId.get(c.id) ?? 0,
      })),
      indicators: indicators.map((i) => ({
        id: i.id,
        code: i.code,
        formula: i.formula,
        thresholds: i.thresholds,
        requiredInputs: i.requiredInputs ?? [],
        // 11.71 — threaded through so the simulator's composite obeys the same
        // scoring gate as every other surface (legal/compliance out).
        category: i.category ?? null,
        weight: i.weight ?? null,
        unit: i.unit ?? null,
      })),
      baselineIVs: applicableBaselineRows.map((iv) => ({
        companyId: iv.companyId,
        indicatorId: iv.indicatorId,
        value: iv.value,
        status: iv.status as never,
      })),
      assumptions: assumptionRows,
    })

    const deltaMap: Record<string, string> = {}
    for (const d of sim.deltas) if (d.changed && d.scenarioStatus) deltaMap[`${d.companyId}:${d.code}`] = d.scenarioStatus

    // Honest FX modelling caveat for the narrative.
    //
    // Phase 16.6 — built from what each company actually supplied, not from the
    // scenario's literal. The old sentence asserted one assumed share for the
    // whole holding, which was true of the model and misleading about the
    // finding. `buildImportShareNote` returns null when there is nothing left to
    // disclose (every company measured), and the simulator returns a null report
    // for a non-FX scenario, so both no-caveat cases collapse here.
    const assumptionNote = buildDriverNote(sim.driverReports)

    // Build worst-hit (cheap, no AI) — ALWAYS returned so the client can render
    // the chips AND post it to the narrative endpoint (the latency split below).
    const deltasByCo = new Map<string, typeof sim.deltas>()
    for (const d of sim.deltas) {
      if (!d.changed) continue
      const l = deltasByCo.get(d.companyId) ?? []
      l.push(d)
      deltasByCo.set(d.companyId, l)
    }
    const worstHit = sim.byCompany
      // Leaves only — a parent/holding score is a revenue-weighted rollup of
      // these same children, so including parents double-presents one shock.
      // `isLeaf !== false` treats a missing flag (legacy payload) as a leaf.
      .filter((b) => b.isLeaf !== false && b.baselineScore != null && b.scenarioScore != null && b.scenarioScore < b.baselineScore)
      .sort((a, b) => a.scenarioScore! - a.baselineScore! - (b.scenarioScore! - b.baselineScore!))
      .slice(0, 3)
      .map((b) => {
        const co = companies.find((c) => c.id === b.companyId)
        const topDeltas = (deltasByCo.get(b.companyId) ?? [])
          .filter((d) => d.baselineValue != null && d.scenarioValue != null)
          .slice(0, 2)
          .map((d) => ({ code: d.code, baselineValue: d.baselineValue!, scenarioValue: d.scenarioValue! }))
        return { companyCode: co?.code ?? b.companyId, companyName: co?.name ?? b.companyId, baselineScore: b.baselineScore, scenarioScore: b.scenarioScore, topDeltas }
      })

    // `?narrative=1` → run the inline AI brief. Omitted or anything else
    // skips it; the client fetches the narrative separately via
    // POST .../narrative when it wants one without blocking the cascade.
    // 2026-08-04 audit — this read `!== '0'`, so a bare GET on this route
    // spent money on a paid Anthropic call by default, at viewer level, with
    // no rate limit. The terminal tells users the opposite in its own words:
    // "LLM calls are user-triggered (Explain / Re-run) — never auto-fired on
    // cell-click navigation." Opt-in now; ScenarioPanel asks for it explicitly.
    const wantNarrative = searchParams.get('narrative') === '1'
    let narrative: string | null = null
    let mitigations: string[] = []
    let narrativeError: string | null = null
    if (wantNarrative && hasAnthropicKey()) {
      try {
        const brief = await runCrisisBrief({
          scenarioCode: scenario.code,
          scenarioNameEn: scenario.nameEn,
          language,
          holdingBaselineScore: sim.holdingBaselineScore,
          holdingScenarioScore: sim.holdingScenarioScore,
          worstHit,
          changed: sim.changed,
          worsened: sim.worsened,
          improved: sim.improved,
          assumptionNote,
          feedAnchors,
        })
        narrative = brief.narrative
        mitigations = brief.mitigations
      } catch (err) {
        // Sanitized — stable code only, never the raw provider message.
        narrativeError = aiErrorBody(err).code
      }
    } else if (wantNarrative) {
      narrativeError = 'No Anthropic API key configured — narrative skipped.'
    }

    return NextResponse.json({
      mode: 'drivers',
      scenarioId: scenario.id,
      scenarioCode: scenario.code,
      scenarioNameRu: scenario.nameRu ?? scenario.nameEn,
      scenarioNameEn: scenario.nameEn,
      period: sim.period,
      deltas: sim.deltas,
      byCompany: sim.byCompany,
      deltaMap,
      holdingBaselineScore: sim.holdingBaselineScore,
      holdingScenarioScore: sim.holdingScenarioScore,
      financialHoldingBaselineScore: sim.financialHoldingBaselineScore,
      financialHoldingScenarioScore: sim.financialHoldingScenarioScore,
      changed: sim.changed,
      worsened: sim.worsened,
      improved: sim.improved,
      driftSummary: sim.driftSummary,
      feedAnchors,
      assumptionNote,
      // Phase 16.6 — the structured evidence behind `assumptionNote`, so a
      // reader can check the prose rather than take it on trust. Null for a
      // non-FX scenario.
      importShare: sim.importShare,
      // Phase 16.7 — the same evidence for every driver, not only the FX share.
      driverReports: sim.driverReports,
      worstHit,
      narrative,
      mitigations,
      narrativeError,
    })
  }

  // Guard: scenario must have simulatable adjustments
  const overrides = scenario.overrides as Record<string, unknown>
  if (!Array.isArray(overrides?.adjustments) || overrides.adjustments.length === 0) {
    return NextResponse.json(
      {
        error:
          'Scenario is not simulatable — no `adjustments` array found in overrides. ' +
          'Re-seed the scenario with Phase 7.N format.',
      },
      { status: 422 },
    )
  }

  // ── Fetch current IndicatorValues ───────────────────────────────────────
  const [rawValues, defaultIndicatorsRaw, defaultCompaniesRaw] = await Promise.all([
    prisma.indicatorValue.findMany({
      where: {
        organizationId: session.orgId,
        period,
        ...(scope.ids
          ? { companyId: { in: Array.from(scope.ids) } }
          : {}),
        company: {
          organizationId: session.orgId,
          isActive: true,
          status: { not: 'pending' },
          role: 'operational',
          OR: [
            { level: 1 },
            { level: 2, industry: { not: null } },
          ],
        },
        indicator: {
          isActive: true,
          OR: [{ organizationId: null }, { organizationId: session.orgId }],
        },
      },
      select: {
        companyId: true,
        indicatorId: true,
        value: true,
        status: true,
        company: {
          select: {
            code: true,
            name: true,
            industry: true,
            level: true,
            isActive: true,
            role: true,
            status: true,
          },
        },
        indicator: {
          select: {
            id: true,
            organizationId: true,
            code: true,
            industries: true,
            isActive: true,
          },
        },
      },
    }),
    // Fetch the catalogue independently of existing values: if an org override
    // exists but has no IV yet, a stale global IV with the same code must not
    // become the simulated definition by default.
    prisma.indicatorDefinition.findMany({
      where: {
        isActive: true,
        OR: [{ organizationId: null }, { organizationId: session.orgId }],
      },
      select: {
        id: true,
        organizationId: true,
        code: true,
        industries: true,
        isActive: true,
        category: true,
        requiredInputs: true,
      },
    }),
    prisma.company.findMany({
      where: {
        organizationId: session.orgId,
        isActive: true,
        status: { not: 'pending' },
        role: 'operational',
        ...(scope.ids ? { id: { in: Array.from(scope.ids) } } : {}),
        OR: [
          { level: 1 },
          { level: 2, industry: { not: null } },
        ],
      },
      select: {
        id: true,
        code: true,
        name: true,
        parentCompanyId: true,
        industry: true,
        level: true,
        isActive: true,
        role: true,
        status: true,
      },
    }),
  ])

  if (rawValues.length === 0) {
    return NextResponse.json(
      {
        error: `No IndicatorValues found for period "${period}". ` +
          'Try a different period or trigger a recompute first.',
      },
      { status: 404 },
    )
  }

  const activeDefaultCompanyCandidates = defaultCompaniesRaw.filter(
    (company) =>
      company.status !== 'pending' &&
      (!scope.ids || scope.ids.has(company.id)),
  )
  const defaultCompanies = [
    ...filterOperationalCompanies(activeDefaultCompanyCandidates),
    ...activeDefaultCompanyCandidates.filter(
      (company) =>
        company.isActive &&
        company.level === 1 &&
        company.role === 'operational',
    ),
  ]
  const defaultDefinitions = scenarioVisibleDefinitions(
    defaultIndicatorsRaw,
  )
  const pairApplicability = await loadPairApplicabilityResolver(prisma, {
    organizationId: session.orgId,
    companies: defaultCompanies,
    definitions: defaultDefinitions,
  })
  const isApplicablePair = createScenarioPairPredicate(
    defaultCompanies,
    pairApplicability,
  )
  const defaultCompanyById = new Map(
    defaultCompanies.map((company) => [company.id, company]),
  )
  const defaultIndicatorById = new Map(
    defaultDefinitions.map((definition) => [definition.id, definition]),
  )
  const applicableRawValues = rawValues.filter((value) => {
    const company = defaultCompanyById.get(value.companyId)
    const definition = defaultIndicatorById.get(value.indicatorId)
    return Boolean(
      company &&
        definition &&
        (company.level === 1
          ? isRollupIndicator(definition)
          : !isRollupIndicator(definition)) &&
        isApplicablePair(company, definition),
    )
  })

  const flat = applicableRawValues.map((v: (typeof rawValues)[number]) => ({
    companyId: v.companyId,
    companyCode: v.company.code,
    companyName: v.company.name,
    code: v.indicator.code,
    value: v.value,
    status: v.status,
  }))

  // ── Run simulation ──────────────────────────────────────────────────────
  const result = simulateScenario(
    overrides as unknown as SimulatableOverrides,
    flat,
    scenario.code,
    period,
  )

  // Build delta map for HeatMap overlay (companyId:code → scenarioStatus)
  const deltaMap = Object.fromEntries(buildDeltaMap(result))

  return NextResponse.json({
    ...result,
    scenarioId: scenario.id,
    scenarioCode: scenario.code,
    scenarioNameRu: scenario.nameRu ?? scenario.nameEn,
    scenarioNameEn: scenario.nameEn,
    deltaMap, // keyed "companyId:code" → status string
  })
}
