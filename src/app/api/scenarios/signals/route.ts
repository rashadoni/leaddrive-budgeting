/**
 * GET /api/scenarios/signals — Phase 3 live price/weather signal triggers.
 *
 * Reads the latest live feed (FX spot + 12M forward, Brent, FAO sugar, regional
 * 14d rainfall → min) → `detectSignals` → suggested crisis scenarios. Read-only,
 * auth-gated. News-derived triggers are OUT (raw news = 0 rows — Phase 3b).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, isAuthError } from '@/lib/api-auth'
import { detectSignals } from '@/lib/risk/scenario-signals'
import { FEED_STALE_DAYS, type FeedSnapshot } from '@/lib/risk/scenario-feed-context'

const INTEL_METRICS = ['FX_FORWARD_USD_AZN_12M', 'BRENT_USD_BBL', 'FAO_SUGAR_INDEX']

export async function GET(request: NextRequest) {
  const session = await requireAuth(request)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: 'User has no organization' }, { status: 403 })
  }

  const [fxRows, intelRows] = await Promise.all([
    prisma.currencyRateHistory.findMany({
      where: { organizationId: session.orgId, currencyCode: 'USD' },
      orderBy: [{ currencyCode: 'asc' }, { rateDate: 'desc' }],
      distinct: ['currencyCode'],
      select: { currencyCode: true, rate: true, rateDate: true },
    }),
    prisma.intelDataPoint.findMany({
      where: {
        organizationId: session.orgId,
        OR: [{ metric: { in: INTEL_METRICS } }, { metric: { endsWith: 'RAINFALL_MM_14D_FCST' } }],
      },
      orderBy: [{ metric: 'asc' }, { datetime: 'desc' }],
      distinct: ['metric'],
      select: { metric: true, value: true, datetime: true },
    }),
  ])

  const nowMs = Date.now()
  const staleMs = FEED_STALE_DAYS * 86_400_000
  const stale = (d: Date) => nowMs - d.getTime() > staleMs
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const snapshot: FeedSnapshot = {}
  for (const r of fxRows) {
    if (r.currencyCode === 'USD') snapshot.AZN_USD = { value: r.rate, asOf: iso(r.rateDate), stale: stale(r.rateDate) }
  }

  // Direct intel metrics + the rainfall MIN across regions.
  let rainMin: { value: number; asOf: string; stale: boolean } | null = null
  for (const r of intelRows) {
    if (r.metric.endsWith('RAINFALL_MM_14D_FCST')) {
      const datum = { value: r.value, asOf: iso(r.datetime), stale: stale(r.datetime) }
      if (!rainMin || datum.value < rainMin.value) rainMin = datum
    } else if (INTEL_METRICS.includes(r.metric)) {
      snapshot[r.metric] = { value: r.value, asOf: iso(r.datetime), stale: stale(r.datetime) }
    }
  }
  if (rainMin) snapshot.RAINFALL_14D_MIN = rainMin

  return NextResponse.json({ signals: detectSignals(snapshot) })
}
