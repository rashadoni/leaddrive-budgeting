/**
 * Phase 7.L — POST /api/admin/run-crossing-scan
 *
 * Admin-only endpoint that triggers `runCrossingScan` on the caller's
 * organization. Used by the "Run impact scan now" button on the Data
 * Sources admin page + for manual diagnostics from a browser console.
 *
 * Why a POST endpoint vs the CLI: the dev server already has
 * ANTHROPIC_API_KEY in process.env (it's needed for AI Variance
 * Explainer / Morning Brief / News Crawler). The CLI tsx process
 * doesn't inherit that env, so a POST handler is the path of least
 * friction for on-demand scans.
 *
 * Auth: admin role (LLM tokens cost money — gate at the strictest
 * tier). Rate limit: 3/min/org (one scan touches up to MAX_FORECASTS_PER_CYCLE
 * LLM calls = $0.4-1.0 per invocation).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { hasAnthropicKey } from "@/lib/ai/client"
import { runCrossingScan } from "@/lib/intel/crossing-scan-runner"

export const maxDuration = 60

const RATE_LIMIT = { name: "crossing-scan", max: 3, windowMs: 60_000 }

export async function POST(request: NextRequest) {
  if (!hasAnthropicKey()) {
    return NextResponse.json(
      {
        error:
          "Impact forecaster unavailable: ANTHROPIC_API_KEY not configured on the dev server.",
      },
      { status: 503 },
    )
  }

  const session = await requireRole(request, "admin")
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

  // Phase 7.L 2026-05-18 — accept language in POST body so the LLM
  // generates output in the user's UI locale (was hardcoded 'en' in
  // crossing-scan-runner; user reported RU UI showing EN forecasts).
  // Falls back to 'ru' (FO Holding's primary locale) when body absent
  // / language invalid. Cache key includes language so EN + RU forecasts
  // for the same trigger persist independently.
  let language: "en" | "ru" | "az" = "ru"
  try {
    const body = (await request.json().catch(() => ({}))) as {
      language?: unknown
    }
    if (body.language === "en" || body.language === "ru" || body.language === "az") {
      language = body.language
    }
  } catch {
    // ignore — use default
  }

  const startedAt = Date.now()
  try {
    const result = await runCrossingScan(orgId, { prisma, language })
    const durationMs = Date.now() - startedAt
    return NextResponse.json({ ...result, durationMs, language })
  } catch (err) {
    console.error("[crossing-scan POST] failed:", err)
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}
