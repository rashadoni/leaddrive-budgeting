import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { getOrgId } from "@/lib/api-auth"
import { prisma, logBudgetChange } from "@/lib/prisma"
import { findFirstActiveLockInPeriods, derivePeriodKey } from "@/lib/budgeting/period-lock"

const forecastEntrySchema = z.object({
  planId: z.string().min(1).max(100),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2050),
  category: z.string().min(1).max(500),
  lineType: z.string().max(50).optional(),
  forecastAmount: z.number().min(0).max(999999999),
})

const forecastBodySchema = z.object({
  entries: z.array(forecastEntrySchema).optional(),
  planId: z.string().min(1).max(100).optional(),
  month: z.number().int().min(1).max(12).optional(),
  year: z.number().int().min(2020).max(2050).optional(),
  category: z.string().min(1).max(500).optional(),
  lineType: z.string().max(50).optional(),
  forecastAmount: z.number().min(0).max(999999999).optional(),
})

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const planId = req.nextUrl.searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  const entries = await prisma.budgetForecastEntry.findMany({
    where: { planId, organizationId: orgId },
    orderBy: [{ year: "asc" }, { month: "asc" }, { category: "asc" }],
  })

  return NextResponse.json({ success: true, data: entries })
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  let data
  try {
    data = forecastBodySchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: e.flatten().fieldErrors }, { status: 400 })
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  // Supports bulk upsert: body.entries = [{ planId, month, year, category, lineType, forecastAmount }]
  const entries: Array<{ planId: string; month: number; year: number; category: string; lineType?: string; forecastAmount: number }> =
    Array.isArray(data.entries) ? data.entries : [data as any]

  // Verify EVERY unique planId belongs to caller's org (prevents cross-tenant writes)
  const uniquePlanIds = Array.from(new Set(entries.map(e => e?.planId).filter(Boolean)))
  if (uniquePlanIds.length === 0) {
    return NextResponse.json({ error: "No planId in request" }, { status: 400 })
  }
  const ownedPlans = await prisma.budgetPlan.findMany({
    where: { id: { in: uniquePlanIds }, organizationId: orgId },
    select: { id: true, status: true, periodType: true, year: true, month: true, quarter: true },
  })
  if (ownedPlans.length !== uniquePlanIds.length) {
    return NextResponse.json({ error: "One or more plans not found in this organization" }, { status: 404 })
  }
  if (ownedPlans.some((p: { status: string }) => p.status === "approved")) {
    return NextResponse.json({ error: "Plan is approved — changes are not allowed" }, { status: 403 })
  }

  // Phase 7.G Turn LXVIII (Phase 4.2 fan-out). Period-lock guard for bulk
  // forecast upsert. If ANY of the unique plans' periods is locked, reject
  // the entire batch (atomic semantics: the user's intent is a single bulk
  // submit, partial commits would surprise). Single Org read, N period
  // matches client-side via findFirstActiveLockInPeriods.
  const uniquePeriodKeys: string[] = Array.from(
    new Set(
      ownedPlans.map((p: { periodType: string | null; year: number; month: number | null; quarter: number | null }) =>
        derivePeriodKey(p),
      ),
    ),
  )
  const lock = await findFirstActiveLockInPeriods(prisma, orgId, uniquePeriodKeys)
  if (lock) {
    return NextResponse.json(
      {
        error: "Period locked — mutations rejected",
        lock: {
          period: lock.period,
          lockedAt: lock.lockedAt,
          lockedBy: lock.lockedBy,
          reason: lock.reason,
        },
      },
      { status: 423 },
    )
  }

  const results = []
  for (const entry of entries) {
    const { planId, month, year, category, lineType, forecastAmount } = entry
    if (!planId || !month || !year || !category) continue
    const lt = lineType || "expense"

    const existing = await prisma.budgetForecastEntry.findUnique({
      where: { planId_year_month_category_lineType: { planId, year, month, category, lineType: lt } },
    })

    const upserted = await prisma.budgetForecastEntry.upsert({
      where: { planId_year_month_category_lineType: { planId, year, month, category, lineType: lt } },
      update: { forecastAmount: Number(forecastAmount) ?? 0 },
      create: {
        organizationId: orgId,
        planId,
        month,
        year,
        category,
        lineType: lt,
        forecastAmount: Number(forecastAmount) ?? 0,
      },
    })

    logBudgetChange({
      orgId,
      planId,
      entityType: "forecast",
      entityId: upserted.id,
      action: existing ? "update" : "create",
      field: existing ? "forecastAmount" : undefined,
      oldValue: existing?.forecastAmount ?? undefined,
      newValue: upserted.forecastAmount,
      snapshot: upserted,
    })

    results.push(upserted)
  }

  return NextResponse.json({ success: true, data: results }, { status: 201 })
}
