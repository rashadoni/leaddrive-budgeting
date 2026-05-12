/**
 * Phase 7.E AI Morning Brief — composed CFO narrative endpoint.
 *
 * POST /api/intel/morning-brief
 *   body: { language, worstCells[], topMovers[], activeAlerts[], newsBullets[] }
 *
 * Why POST not GET: the client already computes worst/movers from the
 * loaded matrix + scoped alerts; sending them in the body avoids a
 * server-side re-fetch that would duplicate the client's RBAC-scoping
 * work. Server's only job is LLM call + cache + audit.
 *
 * Cache: 1h TTL keyed by (orgId, language, prompt-version, sha256 of
 * payload). Re-render or 2-min interval re-fetch hits cache.
 *
 * Auth: viewer role.
 * Rate limit: 5/min/user — even cheaper than news-summary since the
 *   user only triggers this on terminal load (no manual refresh).
 */

import { NextRequest, NextResponse } from "next/server"
import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { hasAnthropicKey } from "@/lib/ai/client"
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log"
import {
  runMorningBrief,
  type MorningBriefLanguage,
  type MorningBriefInput,
} from "@/lib/intel/morning-brief"
import { MORNING_BRIEF_PROMPT_VERSION } from "@/lib/llm/prompts/morning-brief-system"

export const maxDuration = 30

const RATE_LIMIT = { name: "morning-brief", max: 5, windowMs: 60_000 }
const LANGUAGES: readonly MorningBriefLanguage[] = ["en", "ru", "az"]

interface CacheEntry {
  headline: string
  narrative: string
  priorityAction: string
  generatedAt: number
}
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 60 * 60_000 // 1 hour

function isLanguage(s: unknown): s is MorningBriefLanguage {
  return typeof s === "string" && (LANGUAGES as readonly string[]).includes(s)
}

interface BodyShape {
  language?: unknown
  worstCells?: unknown
  topMovers?: unknown
  activeAlerts?: unknown
  newsBullets?: unknown
}

function shapeInput(body: BodyShape): MorningBriefInput | { error: string } {
  const language: MorningBriefLanguage = isLanguage(body.language)
    ? body.language
    : "en"

  const worstCells = Array.isArray(body.worstCells)
    ? body.worstCells
        .filter(
          (c): c is { companyCode: string; indicatorCode: string; value: number; unit: string } =>
            !!c &&
            typeof c === "object" &&
            typeof (c as { companyCode?: unknown }).companyCode === "string" &&
            typeof (c as { indicatorCode?: unknown }).indicatorCode === "string" &&
            typeof (c as { value?: unknown }).value === "number" &&
            typeof (c as { unit?: unknown }).unit === "string",
        )
        .slice(0, 20)
    : []

  const topMovers = Array.isArray(body.topMovers)
    ? body.topMovers
        .filter(
          (m): m is { companyCode: string; indicatorCode: string; deltaPct: number } =>
            !!m &&
            typeof m === "object" &&
            typeof (m as { companyCode?: unknown }).companyCode === "string" &&
            typeof (m as { indicatorCode?: unknown }).indicatorCode === "string" &&
            typeof (m as { deltaPct?: unknown }).deltaPct === "number",
        )
        .slice(0, 20)
    : []

  const activeAlerts = Array.isArray(body.activeAlerts)
    ? body.activeAlerts
        .filter(
          (a): a is { severity: "info" | "warning" | "critical"; message: string } =>
            !!a &&
            typeof a === "object" &&
            typeof (a as { message?: unknown }).message === "string" &&
            ["info", "warning", "critical"].includes(
              String((a as { severity?: unknown }).severity),
            ),
        )
        .slice(0, 20)
    : []

  const newsBullets = Array.isArray(body.newsBullets)
    ? body.newsBullets
        .filter((b): b is string => typeof b === "string")
        .slice(0, 20)
    : []

  return { worstCells, topMovers, activeAlerts, newsBullets, language }
}

function payloadHash(input: MorningBriefInput): string {
  const canonical = JSON.stringify({
    w: input.worstCells.map((c) => `${c.companyCode}|${c.indicatorCode}|${c.value.toFixed(2)}`).sort(),
    m: input.topMovers.map((m) => `${m.companyCode}|${m.indicatorCode}|${m.deltaPct.toFixed(2)}`).sort(),
    a: input.activeAlerts.map((a) => `${a.severity}|${a.message}`).sort(),
    n: input.newsBullets.slice().sort(),
  })
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16)
}

export async function POST(request: NextRequest) {
  if (!hasAnthropicKey()) {
    return NextResponse.json(
      { error: "AI Morning Brief unavailable: ANTHROPIC_API_KEY not configured." },
      { status: 503 },
    )
  }

  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
  const orgId = session.orgId

  const rateLimitError = enforceRateLimit(
    `${RATE_LIMIT.name}:${orgId}:${session.userId}:${getClientIp(request)}`,
    RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  let body: BodyShape
  try {
    body = (await request.json()) as BodyShape
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const shaped = shapeInput(body)
  if ("error" in shaped) {
    return NextResponse.json({ error: shaped.error }, { status: 400 })
  }

  // Empty payload — return a graceful "calm morning" message without
  // burning an LLM call.
  const isEmpty =
    shaped.worstCells.length === 0 &&
    shaped.topMovers.length === 0 &&
    shaped.activeAlerts.length === 0 &&
    shaped.newsBullets.length === 0
  if (isEmpty) {
    return NextResponse.json({
      headline: "",
      narrative: "",
      priorityAction: "",
      isEmpty: true,
      fromCache: false,
    })
  }

  const cacheKey = `${orgId}:${shaped.language}:${MORNING_BRIEF_PROMPT_VERSION}:${payloadHash(shaped)}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      headline: cached.headline,
      narrative: cached.narrative,
      priorityAction: cached.priorityAction,
      generatedAt: new Date(cached.generatedAt).toISOString(),
      fromCache: true,
    })
  }

  let result
  try {
    result = await runMorningBrief(shaped)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    )
  }

  const generatedAt = Date.now()
  cache.set(cacheKey, {
    headline: result.headline,
    narrative: result.narrative,
    priorityAction: result.priorityAction,
    generatedAt,
  })

  await logAuditEvent(prisma, {
    organizationId: orgId,
    actorUserId: session.userId,
    event: {
      action: "ai_morning_brief_run",
      entityType: "Organization",
      entityId: orgId,
      metadata: {
        language: shaped.language,
        worstCellsCount: shaped.worstCells.length,
        moversCount: shaped.topMovers.length,
        alertsCount: shaped.activeAlerts.length,
        newsBulletsCount: shaped.newsBullets.length,
        fromCache: false,
        usage: result.usage,
      },
    },
    context: buildAuditContext({
      route: "/api/intel/morning-brief",
      userAgent: request.headers.get("user-agent") ?? undefined,
    }),
  })

  return NextResponse.json({
    headline: result.headline,
    narrative: result.narrative,
    priorityAction: result.priorityAction,
    generatedAt: new Date(generatedAt).toISOString(),
    fromCache: false,
    usage: result.usage,
  })
}
