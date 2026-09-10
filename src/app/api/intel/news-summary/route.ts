/**
 * Phase 7.H Feature 1 — Today's Brief news-summary endpoint.
 *
 * GET /api/intel/news-summary?language=ru
 * - Reads latest IntelItems for the org (last 24h, filtered by sub-group
 *   RBAC against companyTags), summarizes via LLM, returns 5 bullets.
 * - Cached per (orgId, language, signature-of-item-ids) — repeated calls
 *   within the same crawl cycle hit cache (no LLM call, no audit row).
 * - Audit-logged once per real LLM call (cache hits don't audit).
 * - Auth: viewer + sub-group scope.
 * - Rate limit: 10/min/org/user.
 */

import { NextRequest, NextResponse } from "next/server"
import { createHash } from "node:crypto"
// Stage 3 RLS — `prisma` kept for the fire-and-forget audit write; the item
// + scope-company reads below run inside withOrgScope, the LLM call after.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit"
import { hasAnthropicKeyForOrg } from "@/lib/ai/client"
import { getLogger } from "@/lib/log"
import { aiErrorBody } from "@/lib/ai/ai-error"

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("api:intel:news-summary")
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import {
  runNewsSummary,
  type NewsSummaryLanguage,
} from "@/lib/intel/news-summary"
import { NEWS_SUMMARY_PROMPT_VERSION } from "@/lib/llm/prompts/news-summary-system"

export const maxDuration = 30

const RATE_LIMIT = { name: "news-summary", max: 10, windowMs: 60_000 }
const LANGUAGES: readonly NewsSummaryLanguage[] = ["en", "ru", "az"]
const ITEMS_LOOKBACK_HOURS = 24
const MAX_ITEMS_TO_LLM = 30

interface CacheEntry {
  bullets: string[]
  generatedAt: number
}
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 30 * 60_000 // 30 min

function isLanguage(s: string | null): s is NewsSummaryLanguage {
  return s != null && (LANGUAGES as readonly string[]).includes(s)
}

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
  const orgId = session.orgId

  const url = new URL(request.url)
  // Cost-safety gate: a terminal render, locale change or pop-out must never
  // spend paid LLM budget. Only explicit Generate / Refresh handlers add this
  // query flag. Stale auto-fetching clients fail before key lookup,
  // rate-limit consumption, DB reads or provider use.
  if (url.searchParams.get("userInitiated") !== "1") {
    return NextResponse.json(
      { error: "Explicit user action required to generate an AI News Summary." },
      { status: 428 },
    )
  }

  if (!(await hasAnthropicKeyForOrg(prisma, session.orgId))) {
    return NextResponse.json(
      {
        error:
          "AI News Summary unavailable: ANTHROPIC_API_KEY not configured.",
      },
      { status: 503 },
    )
  }

  const rateLimitError = enforceRateLimit(
    `${RATE_LIMIT.name}:${orgId}:${session.userId}:${getClientIp(request)}`,
    RATE_LIMIT,
  )
  if (rateLimitError) return rateLimitError

  const language: NewsSummaryLanguage = isLanguage(url.searchParams.get("language"))
    ? (url.searchParams.get("language") as NewsSummaryLanguage)
    : "en"

  // Fetch recent intel items (org-scoped). Stage 3 RLS — scope tx.
  const since = new Date(Date.now() - ITEMS_LOOKBACK_HOURS * 60 * 60 * 1000)
  const items = await withOrgScope(orgId, (tx) =>
    tx.intelItem.findMany({
      where: {
        organizationId: orgId,
        fetchedAt: { gte: since },
        relevanceScore: { gte: 0.4 },
      },
      select: {
        id: true,
        title: true,
        summary: true,
        url: true,
        sourceLabel: true,
        relevanceScore: true,
        industryTags: true,
        companyTags: true,
        publishedAt: true,
      },
      orderBy: [{ relevanceScore: "desc" }, { fetchedAt: "desc" }],
      take: MAX_ITEMS_TO_LLM,
    }),
  )

  // Phase 7.F sub-group RBAC — drop items whose companyTags only point
  // outside the user's scope. Items with no companyTags (pure macro) pass
  // through. Items tagged with at least one in-scope company keep visible.
  const scope = await getCompanyScope(orgId, session.userId, session.role)
  let scopedItems = items
  if (scope.ids != null) {
    // Resolve company codes → ids for the user's scope companies, since
    // companyTags carry codes (AAC, ATL) not ids.
    const scopeCompanies = await withOrgScope(orgId, (tx) =>
      tx.company.findMany({
        where: { id: { in: Array.from(scope.ids!) }, organizationId: orgId },
        select: { code: true },
      }),
    )
    type C = (typeof scopeCompanies)[number]
    const allowedCodes = new Set(
      (scopeCompanies as C[]).map((c) => c.code),
    )
    type Row = (typeof items)[number]
    scopedItems = (items as Row[]).filter((it: Row) => {
      if (!it.companyTags || it.companyTags.length === 0) return true
      return it.companyTags.some((code: string) => allowedCodes.has(code))
    })
  }

  // Cache key — orgId + lang + sha256 of item ids consumed.
  type SItem = (typeof scopedItems)[number]
  const itemIds = (scopedItems as SItem[]).map((i) => i.id).sort().join(",")
  const cacheKey = `${orgId}:${language}:${NEWS_SUMMARY_PROMPT_VERSION}:${createHash("sha256").update(itemIds).digest("hex").slice(0, 16)}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      bullets: cached.bullets,
      language,
      generatedAt: new Date(cached.generatedAt).toISOString(),
      itemsConsumed: scopedItems.length,
      fromCache: true,
    })
  }

  let result: { bullets: string[]; usage: { inputTokens: number; outputTokens: number } }
  try {
    result = await runNewsSummary({
      items: (scopedItems as SItem[]).map((i) => ({
        title: i.title,
        summary: i.summary,
        url: i.url,
        sourceLabel: i.sourceLabel,
        relevanceScore: i.relevanceScore,
        industryTags: i.industryTags,
        companyTags: i.companyTags,
        publishedAt: i.publishedAt ? i.publishedAt.toISOString() : null,
      })),
      language,
    })
  } catch (err) {
    // LLM errors (non-JSON response, API errors, rate limits) should not
    // crash the panel with HTTP 500 — return 200 with empty bullets so
    // NewsSummarySection renders the "нет актуальных новостей" fallback
    // instead of showing a raw error code to the CFO.
    log.error("LLM error", {
      err: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({
      bullets: [],
      language,
      generatedAt: new Date().toISOString(),
      itemsConsumed: scopedItems.length,
      fromCache: false,
      // Sanitized — never the raw provider message (can carry billing text).
      ...aiErrorBody(err),
    })
  }

  const generatedAt = Date.now()
  cache.set(cacheKey, { bullets: result.bullets, generatedAt })

  // Audit log failure must not surface as HTTP 500 — fire-and-forget.
  logAuditEvent(prisma, {
    organizationId: orgId,
    actorUserId: session.userId,
    event: {
      action: "ai_news_summary_run",
      entityType: "Organization",
      entityId: orgId,
      metadata: {
        language,
        itemsConsumed: scopedItems.length,
        bulletsProduced: result.bullets.length,
        fromCache: false,
        usage: result.usage,
      },
    },
    context: buildAuditContext({
      route: "/api/intel/news-summary",
      userAgent: request.headers.get("user-agent") ?? undefined,
    }),
  }).catch((e: unknown) => {
    log.error("audit log failed", {
      err: e instanceof Error ? e.message : String(e),
    })
  })

  return NextResponse.json({
    bullets: result.bullets,
    language,
    generatedAt: new Date(generatedAt).toISOString(),
    itemsConsumed: scopedItems.length,
    fromCache: false,
    usage: result.usage,
  })
}
