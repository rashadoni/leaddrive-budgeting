/**
 * POST /api/scenarios/[id]/narrative — Phase 3 latency split.
 *
 * Generates JUST the AI "Crisis Brief" narrative from an already-computed
 * simulation summary (the client gets it from `?mode=drivers&narrative=0`).
 * This lets the HeatMap cascade fire immediately while the slow Anthropic call
 * runs in the background; the client fills the narrative into the brief when it
 * returns. Read-only (no DB writes); always 200 + graceful narrativeError so a
 * narrative failure never breaks the already-rendered brief.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, isAuthError } from '@/lib/api-auth'
import { hasAnthropicKey } from '@/lib/ai/client'
import { runCrisisBrief, type BriefLanguage, type CrisisBriefWorstHit } from '@/lib/risk/scenario-narrative'

interface NarrativeBody {
  language?: BriefLanguage
  holdingBaselineScore?: number | null
  holdingScenarioScore?: number | null
  worstHit?: CrisisBriefWorstHit[]
  changed?: number
  worsened?: number
  improved?: number
  assumptionNote?: string | null
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: 'User has no organization' }, { status: 403 })
  }

  const { id } = await params
  const scenario = await prisma.scenario.findFirst({
    where: { id, organizationId: session.orgId, isActive: true },
    select: { code: true, nameEn: true },
  })
  if (!scenario) {
    return NextResponse.json({ error: 'Scenario not found' }, { status: 404 })
  }

  let body: NarrativeBody
  try {
    body = (await request.json()) as NarrativeBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!hasAnthropicKey()) {
    return NextResponse.json({ narrative: null, mitigations: [], narrativeError: 'No Anthropic API key configured.' })
  }

  try {
    const brief = await runCrisisBrief({
      scenarioCode: scenario.code,
      scenarioNameEn: scenario.nameEn,
      language: body.language ?? 'ru',
      holdingBaselineScore: body.holdingBaselineScore ?? null,
      holdingScenarioScore: body.holdingScenarioScore ?? null,
      worstHit: Array.isArray(body.worstHit) ? body.worstHit : [],
      changed: body.changed ?? 0,
      worsened: body.worsened ?? 0,
      improved: body.improved ?? 0,
      assumptionNote: body.assumptionNote ?? null,
    })
    return NextResponse.json({ narrative: brief.narrative, mitigations: brief.mitigations, narrativeError: null })
  } catch (err) {
    return NextResponse.json({
      narrative: null,
      mitigations: [],
      narrativeError: err instanceof Error ? err.message : String(err),
    })
  }
}
