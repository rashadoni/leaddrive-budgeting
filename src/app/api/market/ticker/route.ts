/**
 * Tier 2 #9 — Market ticker data feed.
 *
 * Returns a flat list of {metric, current, previous, unit, source}
 * entries for the terminal's market-ticker strip. Currently:
 *   - FX rates from Currency table (current) + CurrencyRateHistory
 *     (penultimate) for delta computation
 *   - Commodity / macro series from IntelDataPoint when the table
 *     exists (skipped silently if migration hasn't run)
 *
 * Auth: viewer + org-scoped.
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"

interface TickerEntry {
  metric: string
  label: string
  current: number
  previous: number | null
  unit: string
  source: string
}

const COMMODITY_METRICS = [
  "BRENT_USD_BBL",
  "WHEAT_USD_TON",
  "CORN_USD_TON",
  "AZ_CPI_YOY",
] as const

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

  const entries: TickerEntry[] = []

  // ---- FX rates ----
  const currencies = await prisma.currency.findMany({
    where: { organizationId: orgId, isActive: true, isBase: false },
    select: { code: true, exchangeRate: true, symbol: true },
  })
  // Penultimate (yesterday-ish) rate per currency for delta.
  type PrevRow = { currencyCode: string; rate: number }
  const prevByCurrency = new Map<string, number>()
  if (currencies.length > 0) {
    const prevRows = await prisma.$queryRaw<PrevRow[]>`
      SELECT DISTINCT ON ("currencyCode") "currencyCode", "rate"
      FROM "currency_rate_history"
      WHERE "organizationId" = ${orgId}
        AND "currencyCode" = ANY(${currencies.map((c: { code: string }) => c.code)})
      ORDER BY "currencyCode", "rateDate" DESC
      OFFSET 1
    `
    for (const r of prevRows) prevByCurrency.set(r.currencyCode, r.rate)
  }
  for (const c of currencies) {
    entries.push({
      metric: `${c.code}_AZN`,
      label: `${c.code}/AZN`,
      current: c.exchangeRate,
      previous: prevByCurrency.get(c.code) ?? null,
      unit: "₼",
      source: "fx",
    })
  }

  // ---- Commodity / macro from IntelDataPoint (if table exists) ----
  try {
    const points = await prisma.intelDataPoint.findMany({
      where: {
        organizationId: orgId,
        metric: { in: [...COMMODITY_METRICS] },
      },
      select: { metric: true, value: true, unit: true, datetime: true, sourceCode: true },
      orderBy: [{ metric: "asc" }, { datetime: "desc" }],
    })
    // Bucket by metric, take the two most-recent.
    const byMetric = new Map<string, typeof points>()
    for (const p of points) {
      if (!byMetric.has(p.metric)) byMetric.set(p.metric, [])
      const arr = byMetric.get(p.metric)!
      if (arr.length < 2) arr.push(p)
    }
    for (const [metric, pair] of byMetric) {
      const latest = pair[0]
      if (!latest) continue
      entries.push({
        metric,
        label: metric.replace(/_/g, " "),
        current: latest.value,
        previous: pair[1]?.value ?? null,
        unit: latest.unit ?? "",
        source: latest.sourceCode,
      })
    }
  } catch {
    // IntelDataPoint table not migrated yet — silently skip, FX rates
    // alone still produce a useful ticker.
  }

  return NextResponse.json({ entries, generatedAt: new Date().toISOString() })
}
