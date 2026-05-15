/**
 * Phase 7.I — read API for IntelDataPoint rows.
 *
 * GET /api/intel/data-points?sourceCode=...&metric=...&limit=24
 *
 * Used by the terminal's commodity / weather widgets (CommodityTickerPanel,
 * AgroDashboardPanel) to pull a trailing series for display. Org-scoped
 * (every row carries `organizationId`); viewer-allowed read.
 *
 * Graceful degradation: when the `intel_data_points` table doesn't exist
 * (drift migration not yet applied), returns empty array so the UI can
 * render a "no data yet" state rather than throw.
 */

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"

const QuerySchema = z.object({
  sourceCode: z.string().min(1).max(60),
  metric: z.string().min(1).max(80).optional(),
  /** Hard cap to avoid massive series in the wire body. Default 24
   *  (2y monthly fits AgroDashboard / CommodityTicker views). */
  limit: z.coerce.number().int().min(1).max(500).default(24),
})

export async function GET(req: NextRequest) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const parsed = QuerySchema.safeParse({
    sourceCode: searchParams.get("sourceCode") ?? "",
    metric: searchParams.get("metric") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.format() },
      { status: 400 },
    )
  }

  const where: {
    organizationId: string
    sourceCode: string
    metric?: string
  } = {
    organizationId: session.orgId,
    sourceCode: parsed.data.sourceCode,
  }
  if (parsed.data.metric) where.metric = parsed.data.metric

  try {
    const rows = await prisma.intelDataPoint.findMany({
      where,
      orderBy: { datetime: "asc" },
      take: parsed.data.limit,
      select: { metric: true, datetime: true, value: true, unit: true },
    })
    return NextResponse.json({ rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Pre-migration: table doesn't exist yet → empty response, not 500.
    if (
      msg.includes('relation "intel_data_points"') ||
      msg.includes("does not exist") ||
      msg.includes("P2021")
    ) {
      return NextResponse.json({ rows: [], stale: true })
    }
    return NextResponse.json(
      { error: "Failed to fetch intel data points", reason: msg },
      { status: 500 },
    )
  }
}
