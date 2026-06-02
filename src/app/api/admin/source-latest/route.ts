/**
 * GET /api/admin/source-latest — the REAL latest value per data-source.
 *
 * The Data Sources catalog card used to show a hardcoded `sampleLatest.value`
 * ("$105.88") labelled "СВЕЖИЙ ПРИМЕР", which drifted from the actual feed
 * (real Brent was 110.53). This endpoint returns the genuine latest
 * IntelDataPoint value + its observation date for each catalog source's
 * display metric, so the card can show a real, dated, source-attributed
 * number (or honestly "no data") instead of a frozen illustration.
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { DATA_SOURCES_CATALOG } from "@/lib/intel/sources-catalog"

export interface SourceLatest {
  value: number
  unit: string | null
  datetime: string // ISO — the observation date (NOT the fetch date)
}

export async function GET(req: NextRequest) {
  const session = await requireRole(req, "manager")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  // Only the display metric per source (the one the card surfaces).
  const pairs = DATA_SOURCES_CATALOG.map((s) => ({
    sourceCode: s.sourceCode,
    metric: s.sampleLatest.metric,
  }))

  const points = await prisma.intelDataPoint.findMany({
    where: { organizationId: session.orgId, OR: pairs },
    select: {
      sourceCode: true,
      metric: true,
      value: true,
      unit: true,
      datetime: true,
    },
    orderBy: { datetime: "desc" },
  })

  // First row per `sourceCode:metric` is the latest (desc order).
  const latest: Record<string, SourceLatest> = {}
  for (const p of points) {
    const key = `${p.sourceCode}:${p.metric}`
    if (!latest[key]) {
      latest[key] = {
        value: p.value,
        unit: p.unit ?? null,
        datetime: p.datetime.toISOString(),
      }
    }
  }

  return NextResponse.json({ latest })
}
