/**
 * Trade pacing — `GET | POST /api/trade/pacing` (Phase 9.7 + T9).
 *
 * POST (manager): full recompute — org grain + every channel grain with
 * a budget or attributed spend, snapshot upserts + alert-inbox sync
 * (shared lib: src/lib/trade/pacing-recompute.ts — the same routine
 * fires automatically after every ledger posting/void, R1).
 * GET (viewer): latest snapshots for the period + live cascade.
 */
import { NextRequest, NextResponse } from "next/server"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/prisma"
import { computePacing, type PacingInput } from "@/lib/trade/pacing"
import { CHANNEL_GRAIN_PREFIX, parseChannelGrain } from "@/lib/trade/budget"
import {
  buildPacingInput,
  recomputeTradePacing,
  ORG_GRAIN,
} from "@/lib/trade/pacing-recompute"

const RATE_LIMIT = { name: "trade-pacing-recompute", max: 30, windowMs: 60_000 }

function parsePeriod(raw: string | null): { year: number; month: number; period: string } {
  const now = new Date()
  const fallback = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
  const m = raw?.match(/^(\d{4})-(\d{2})$/)
  const year = m ? Number(m[1]) : fallback.year
  const month = m ? Number(m[2]) : fallback.month
  return { year, month, period: `${year}-${String(month).padStart(2, "0")}` }
}

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const { year, month, period } = parsePeriod(request.nextUrl.searchParams.get("period"))

  const snapshot = await prisma.tradePacingSnapshot.findFirst({
    where: { organizationId: session.orgId, period, grainKey: ORG_GRAIN },
    orderBy: { asOfDate: "desc" },
  })
  const { cascade } = await buildPacingInput(prisma, session.orgId, year, month)

  const channelSnaps = await prisma.tradePacingSnapshot.findMany({
    where: {
      organizationId: session.orgId,
      period,
      grainKey: { startsWith: CHANNEL_GRAIN_PREFIX },
    },
    orderBy: { asOfDate: "desc" },
  })
  const latestByGrain = new Map<string, (typeof channelSnaps)[number]>()
  for (const s of channelSnaps) {
    if (!latestByGrain.has(s.grainKey)) latestByGrain.set(s.grainKey, s)
  }
  const channelIds = [...latestByGrain.keys()]
    .map((g) => parseChannelGrain(g))
    .filter((v): v is string => !!v)
  const channelRows = await prisma.tradeChannel.findMany({
    where: { id: { in: channelIds }, organizationId: session.orgId },
    select: { id: true, name: true },
  })
  const channelName = new Map(channelRows.map((c) => [c.id, c.name]))
  const channels = [...latestByGrain.entries()].map(([grainKey, snap]) => ({
    grainKey,
    channelId: parseChannelGrain(grainKey),
    name: channelName.get(parseChannelGrain(grainKey) ?? "") ?? grainKey,
    result: computePacing(snap.math as unknown as PacingInput),
  }))

  if (!snapshot) {
    return NextResponse.json({ ok: true, period, snapshot: null, result: null, cascade, channels })
  }
  const result = computePacing(snapshot.math as unknown as PacingInput)
  return NextResponse.json({
    ok: true,
    period,
    snapshot: { asOfDate: snapshot.asOfDate, generatedAt: snapshot.generatedAt },
    result,
    cascade,
    channels,
  })
}

export async function POST(request: NextRequest) {
  const session = await requireRole(request, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const orgId = session.orgId

  const rateLimitError = enforceRateLimit(`${RATE_LIMIT.name}:${orgId}:${session.userId}`, RATE_LIMIT)
  if (rateLimitError) return rateLimitError

  const { year, month, period } = parsePeriod(request.nextUrl.searchParams.get("period"))
  const outcome = await recomputeTradePacing(prisma, orgId, year, month)

  return NextResponse.json({
    ok: true,
    period,
    result: outcome.org.result,
    cascade: outcome.org.cascade,
    channels: outcome.channels,
    alerts: outcome.alerts,
  })
}
