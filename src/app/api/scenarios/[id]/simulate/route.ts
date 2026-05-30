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

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, isAuthError } from '@/lib/api-auth'
import { currentBakuYear } from '@/lib/risk/periods'
import {
  simulateScenario,
  buildDeltaMap,
  type SimulatableOverrides,
} from '@/lib/risk/scenario-simulator'
import { createPrismaDataSource } from '@/lib/risk/recompute'
import { hasShock, readShock } from '@/lib/risk/scenario-shock'
import { resolveFeedShock, resolveFeedContext, FEED_STALE_DAYS, type FeedSnapshot } from '@/lib/risk/scenario-feed-context'
import { simulateByDrivers } from '@/lib/risk/scenario-rederive'
import { runCrisisBrief, type BriefLanguage } from '@/lib/risk/scenario-narrative'
import { hasAnthropicKey } from '@/lib/ai/client'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(request)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: 'User has no organization' }, { status: 403 })
  }

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
    const [companies, indicators, baselineRows, fxRows, intelRows] = await Promise.all([
      prisma.company.findMany({
        where: { organizationId: session.orgId },
        select: { id: true, code: true, name: true, parentCompanyId: true, industry: true },
      }),
      prisma.indicatorDefinition.findMany({
        where: { isActive: true },
        select: { id: true, code: true, formula: true, thresholds: true, requiredInputs: true, weight: true },
      }),
      prisma.indicatorValue.findMany({
        where: { organizationId: session.orgId, period },
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
    ])

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
    for (const r of baselineRows) {
      const rev = (r.inputs as { resolved?: { revenue?: unknown } } | null)?.resolved?.revenue
      if (typeof rev === 'number' && Number.isFinite(rev)) {
        const cur = revenueByCompanyId.get(r.companyId) ?? -Infinity
        if (rev > cur) revenueByCompanyId.set(r.companyId, rev)
      }
    }

    const ds = createPrismaDataSource(prisma)
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
        weight: i.weight ?? null,
      })),
      baselineIVs: baselineRows.map((iv) => ({
        companyId: iv.companyId,
        indicatorId: iv.indicatorId,
        value: iv.value,
        status: iv.status as never,
      })),
    })

    const deltaMap: Record<string, string> = {}
    for (const d of sim.deltas) if (d.changed && d.scenarioStatus) deltaMap[`${d.companyId}:${d.code}`] = d.scenarioStatus

    // Honest FX modeling caveat for the narrative (assumed import share).
    // Use the RESOLVED shock — a target-driven FX scenario gets its fxShock here.
    const assumptionNote =
      resolvedShock.fxShock && resolvedShock.assumedImportShare
        ? `Assumes ${Math.round((resolvedShock.assumedImportShare ?? 0) * 100)}% imported-input share (current data has no tagged imported costs).`
        : null

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
      .filter((b) => b.baselineScore != null && b.scenarioScore != null && b.scenarioScore < b.baselineScore)
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

    // `?narrative=0` → skip the slow AI call so the cascade fires immediately;
    // the client fetches the narrative separately via POST .../narrative.
    // Default (omitted / =1) keeps the inline narrative — back-compat.
    const wantNarrative = searchParams.get('narrative') !== '0'
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
        narrativeError = err instanceof Error ? err.message : String(err)
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
  const rawValues = await prisma.indicatorValue.findMany({
    where: {
      organizationId: session.orgId,
      period,
    },
    select: {
      companyId: true,
      value: true,
      status: true,
      company: { select: { code: true, name: true } },
      indicator: { select: { code: true } },
    },
  })

  if (rawValues.length === 0) {
    return NextResponse.json(
      {
        error: `No IndicatorValues found for period "${period}". ` +
          'Try a different period or trigger a recompute first.',
      },
      { status: 404 },
    )
  }

  const flat = rawValues.map((v: (typeof rawValues)[number]) => ({
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
