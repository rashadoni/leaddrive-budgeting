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
import { withOrgScope } from '@/lib/db/with-org-scope'
import { requireAuth, isAuthError } from '@/lib/api-auth'
import { hasAnthropicKey } from '@/lib/ai/client'
import { aiErrorBody } from '@/lib/ai/ai-error'
import { runCrisisBrief } from '@/lib/risk/scenario-narrative'
import { parseNarrativeBody } from '@/lib/risk/crisis-brief-input'

// Phase 16.10 — the body shape lives in `crisis-brief-input.ts`, which
// validates and bounds it. This route no longer casts an unknown blob into a
// prompt. `assumptionNote` is deliberately NOT part of the accepted body: it is
// regenerated server-side from the structured `driverReports`, so the client
// has no way to put a sentence of its own into an LLM instruction.


export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth(request)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: 'User has no organization' }, { status: 403 })
  }

  const { id } = await params
  const orgId = session.orgId
  // Stage 3 RLS — the single scenario read in a scope tx; the AI narrative
  // (runCrisisBrief) touches no DB and runs after.
  const scenario = await withOrgScope(orgId, (tx) =>
    tx.scenario.findFirst({
      where: { id, organizationId: orgId, isActive: true },
      select: { code: true, nameEn: true },
    }),
  )
  if (!scenario) {
    return NextResponse.json({ error: 'Scenario not found' }, { status: 404 })
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const body = parseNarrativeBody(rawBody)

  if (!hasAnthropicKey()) {
    return NextResponse.json({ narrative: null, mitigations: [], narrativeError: 'No Anthropic API key configured.' })
  }

  try {
    const brief = await runCrisisBrief({
      scenarioCode: scenario.code,
      scenarioNameEn: scenario.nameEn,
      ...body,
    })
    return NextResponse.json({ narrative: brief.narrative, mitigations: brief.mitigations, narrativeError: null })
  } catch (err) {
    // Sanitized — narrativeError carries only a stable code, never the raw
    // provider message (can embed billing text).
    return NextResponse.json({
      narrative: null,
      mitigations: [],
      narrativeError: aiErrorBody(err).code,
    })
  }
}
