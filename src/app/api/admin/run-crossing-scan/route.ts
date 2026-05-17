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

// Phase 7.L 2026-05-18 — 3× language passes mean total runtime can
// hit ~3 × 3 min = 9 min worst-case. Set to 10 min ceiling; cache
// hits on repeat clicks make subsequent calls <30s.
export const maxDuration = 600

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

  // Phase 7.L 2026-05-18 — accept languages array in POST body so a
  // single admin click can generate forecasts in all locales at once
  // (~3× tokens vs single-locale but eliminates "switch UI + re-click"
  // friction). Body shape:
  //   { languages: ["en","ru","az"] }   ← preferred, generates all
  //   { language: "ru" }                 ← legacy single-locale
  //   (no body)                          ← defaults to ["en","ru","az"]
  type Lang = "en" | "ru" | "az"
  const ALL_LANGUAGES: readonly Lang[] = ["en", "ru", "az"]
  let languages: Lang[] = [...ALL_LANGUAGES]
  try {
    const body = (await request.json().catch(() => ({}))) as {
      languages?: unknown
      language?: unknown
    }
    if (Array.isArray(body.languages)) {
      const valid = body.languages.filter(
        (l): l is Lang => l === "en" || l === "ru" || l === "az",
      )
      if (valid.length > 0) languages = valid
    } else if (
      body.language === "en" ||
      body.language === "ru" ||
      body.language === "az"
    ) {
      languages = [body.language]
    }
  } catch {
    // ignore — use default (all 3)
  }

  const startedAt = Date.now()
  try {
    // Aggregate per-language results into one summary. Cache layer
    // dedupes within a language (7-day TTL) so this is mostly cost-
    // free on re-runs; first run for a new prompt-version pays full.
    const perLang: Record<Lang, Awaited<ReturnType<typeof runCrossingScan>>> =
      {} as Record<Lang, Awaited<ReturnType<typeof runCrossingScan>>>
    for (const lang of languages) {
      perLang[lang] = await runCrossingScan(orgId, { prisma, language: lang })
    }
    const aggregate = {
      matchesFound: perLang[languages[0]].matchesFound,
      forecastsAttempted: Object.values(perLang).reduce(
        (s, r) => s + r.forecastsAttempted,
        0,
      ),
      forecastsGenerated: Object.values(perLang).reduce(
        (s, r) => s + r.forecastsGenerated,
        0,
      ),
      cacheHits: Object.values(perLang).reduce(
        (s, r) => s + r.cacheHits,
        0,
      ),
      skippedNoFinancials: Object.values(perLang).reduce(
        (s, r) => s + r.skippedNoFinancials,
        0,
      ),
      skippedBudget: Object.values(perLang).reduce(
        (s, r) => s + r.skippedBudget,
        0,
      ),
      errors: Object.values(perLang).flatMap((r) => r.errors),
    }
    const durationMs = Date.now() - startedAt
    return NextResponse.json({
      ...aggregate,
      durationMs,
      languages,
      perLang,
    })
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
