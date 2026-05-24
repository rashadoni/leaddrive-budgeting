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
