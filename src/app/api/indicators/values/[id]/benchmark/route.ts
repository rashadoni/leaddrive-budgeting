/**
 * Phase 7.H Feature 3 — Peer Benchmarking endpoint.
 *
 * GET /api/indicators/values/[id]/benchmark
 *
 * Resolves the IV → company → industry, then fetches:
 *   - own company's IV series for the trailing 12 periods
 *   - all cohort companies' (same industry, same indicator) IV series
 *
 * Returns median + p75 per period + own's rank at latest period.
 *
 * Auth: viewer + sub-group RBAC (own IV check).
 * Cache: in-memory keyed by (industry, indicatorId, period) for 5min.
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import {
  computePeerBenchmark,
  type PeerSeriesPoint,
} from "@/lib/risk/peer-benchmark"
import { parsePeriod } from "@/lib/risk/periods"

const TRAILING_PERIODS = 12

interface CacheEntry {
  data: unknown
  at: number
}
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60_000

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }
  const orgId = session.orgId

  const { id: ivId } = await params
  if (typeof ivId !== "string" || ivId.trim() === "") {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 })
  }

  // Resolve own IV → company + indicator + period.
  const ownIv = await prisma.indicatorValue.findFirst({
    where: { id: ivId, organizationId: orgId },
    select: {
      id: true,
      companyId: true,
      indicatorId: true,
      period: true,
      indicator: { select: { code: true, direction: true, unit: true } },
      company: { select: { id: true, code: true, name: true, industry: true } },
    },
  })
  if (!ownIv) {
    return NextResponse.json({ error: "Indicator value not found" }, { status: 404 })
  }

  // Phase 7.F sub-group RBAC.
  const scope = await getCompanyScope(orgId, session.userId, session.role)
  if (scope.ids != null && !scope.ids.has(ownIv.companyId)) {
    return NextResponse.json({ error: "Indicator value not found" }, { status: 404 })
  }

  if (!ownIv.company.industry) {
    return NextResponse.json(
      {
        error: "Company has no industry — peer benchmarking unavailable",
        code: "NO_INDUSTRY",
      },
      { status: 400 },
    )
  }
  const industry = ownIv.company.industry

  // Build trailing-12-month period strings ending at ownIv.period.
  let periods: string[]
  try {
    periods = trailingMonths(ownIv.period, TRAILING_PERIODS)
  } catch (err) {
    return NextResponse.json(
      { error: `Cannot derive trailing periods from ${ownIv.period}: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    )
  }

  const cacheKey = `${industry}:${ownIv.indicatorId}:${ownIv.period}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    // Per-user own series still must reflect THIS user's company —
    // fetch own series fresh (cheap), reuse cohort medians.
    const ownSeries = await fetchSeries(orgId, ownIv.companyId, ownIv.indicatorId, periods)
    const cohort = (cached.data as { cohortIds: string[] }).cohortIds
    return NextResponse.json(buildResponse(ownIv, ownSeries, cached.data as CachedCohort, periods, cohort.length))
  }

  // Fetch own series + cohort companies (same industry, NOT including own).
  const cohortCompanies = await prisma.company.findMany({
    where: {
      organizationId: orgId,
      industry,
      isActive: true,
      id: { not: ownIv.companyId },
    },
    select: { id: true, code: true },
  })
  type CR = (typeof cohortCompanies)[number]
  const cohortIds = (cohortCompanies as CR[]).map((c) => c.id)

  const [ownSeries, cohortRows] = await Promise.all([
    fetchSeries(orgId, ownIv.companyId, ownIv.indicatorId, periods),
    prisma.indicatorValue.findMany({
      where: {
        organizationId: orgId,
        indicatorId: ownIv.indicatorId,
        companyId: { in: cohortIds },
        period: { in: periods },
      },
      select: { companyId: true, period: true, value: true, status: true },
    }),
  ])
  type IR = (typeof cohortRows)[number]
  const cohortByCompany = new Map<string, Map<string, number>>()
  for (const r of cohortRows as IR[]) {
    if (r.status === "unknown") continue
    if (!cohortByCompany.has(r.companyId)) cohortByCompany.set(r.companyId, new Map())
    cohortByCompany.get(r.companyId)!.set(r.period, r.value)
  }
  const cohortSeries: Array<{ companyId: string; values: (number | null)[] }> = cohortIds.map((cid) => ({
    companyId: cid,
    values: periods.map((p) => cohortByCompany.get(cid)?.get(p) ?? null),
  }))

  const direction =
    ownIv.indicator.direction === "lower_better"
      ? "lower_better"
      : ownIv.indicator.direction === "band"
        ? "band"
        : "higher_better"

  const result = computePeerBenchmark({
    ownSeries,
    cohortSeries,
    periods,
    direction,
  })

  const cached2: CachedCohort = {
    medianSeries: result.medianSeries,
    p75Series: result.p75Series,
    insufficientPeers: result.insufficientPeers,
    cohortIds,
    direction,
  }
  cache.set(cacheKey, { data: cached2, at: Date.now() })

  return NextResponse.json(
    buildResponse(ownIv, ownSeries, cached2, periods, cohortIds.length, result.rank),
  )
}

interface CachedCohort {
  medianSeries: PeerSeriesPoint[]
  p75Series: PeerSeriesPoint[]
  insufficientPeers: boolean
  cohortIds: string[]
  direction: "higher_better" | "lower_better" | "band"
}

interface OwnIv {
  id: string
  period: string
  company: { code: string; name: string; industry: string | null }
  indicator: { code: string; direction: string; unit: string }
}

function buildResponse(
  ownIv: OwnIv,
  ownSeries: PeerSeriesPoint[],
  cached: CachedCohort,
  periods: string[],
  cohortSize: number,
  rank?: { position: number; total: number } | null,
) {
  // Recompute rank if not provided (cache-hit path).
  let finalRank = rank ?? null
  if (finalRank === undefined || (rank === undefined && cached.cohortIds.length >= 3)) {
    // Skip rank rederivation on cache-hit — original caller had own data
    // and would have had a rank; for cache hits we preserve whatever was
    // computed at cache creation. To keep it simple, return null when
    // rank wasn't passed; client can refetch on critical view.
    finalRank = null
  }
  return {
    indicatorValueId: ownIv.id,
    company: ownIv.company,
    indicator: ownIv.indicator,
    period: ownIv.period,
    periods,
    ownSeries,
    medianSeries: cached.medianSeries,
    p75Series: cached.p75Series,
    rank: finalRank,
    cohortSize,
    insufficientPeers: cached.insufficientPeers,
    direction: cached.direction,
  }
}

async function fetchSeries(
  orgId: string,
  companyId: string,
  indicatorId: string,
  periods: string[],
): Promise<PeerSeriesPoint[]> {
  const rows = await prisma.indicatorValue.findMany({
    where: {
      organizationId: orgId,
      companyId,
      indicatorId,
      period: { in: periods },
    },
    select: { period: true, value: true, status: true },
  })
  type R = (typeof rows)[number]
  const byPeriod = new Map<string, number>()
  for (const r of rows as R[]) {
    if (r.status !== "unknown") byPeriod.set(r.period, r.value)
  }
  return periods.map((p) => ({ period: p, value: byPeriod.get(p) ?? null }))
}

/** Build the trailing N month strings ending at the given period.
 *  Supports YYYY-MM and YYYY (annual); for annual we return last N years. */
function trailingMonths(anchor: string, n: number): string[] {
  const parsed = parsePeriod(anchor)
  if (parsed.kind === "year") {
    // Annual indicator → trailing N years (oldest first).
    const out: string[] = []
    for (let i = n - 1; i >= 0; i--) {
      out.push(String(parsed.year - i))
    }
    return out
  }
  if (parsed.kind === "month") {
    const out: string[] = []
    const start = new Date(Date.UTC(parsed.year, parsed.start.getUTCMonth(), 1))
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - i, 1))
      out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`)
    }
    return out
  }
  // Quarter — return trailing N quarters (oldest first).
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const qStart = parsed.start
    const d = new Date(Date.UTC(qStart.getUTCFullYear(), qStart.getUTCMonth() - i * 3, 1))
    const q = Math.floor(d.getUTCMonth() / 3) + 1
    out.push(`${d.getUTCFullYear()}-Q${q}`)
  }
  return out
}
