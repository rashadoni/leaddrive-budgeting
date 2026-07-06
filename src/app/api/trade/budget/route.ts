/**
 * Trade budget pools — `GET | POST /api/trade/budget` (Phase 9.3).
 *
 * GET  ?year=2026 (viewer): the year's monthly pools.
 * POST {year, defaultPct?} (manager): (re)derive pools from the org's
 * monthly revenue plan — BudgetLine rows with lineType=revenue on
 * kind=budget plans of that year, summed per monthIndex. (Deliberate
 * deviation from the original SalesBudgetLine source: that table is
 * empty in every real org; BudgetLine revenue is the populated truth.)
 * Existing per-pool pct survives; manual amount overrides are kept.
 * Also regenerates the org-grain TradePlanDaily rows (pacing feed).
 */
import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/prisma"
import { planPoolUpserts } from "@/lib/trade/budget"
import { spreadMonthlyPlan } from "@/lib/trade/pacing"

const RATE_LIMIT = { name: "trade-budget-derive", max: 20, windowMs: 60_000 }

const POOL_SELECT = {
  id: true,
  year: true,
  month: true,
  grainKey: true,
  salesPlanAmount: true,
  budgetPct: true,
  budgetAmount: true,
  isManualAmount: true,
  currencyCode: true,
  updatedAt: true,
} as const

const deriveSchema = z.object({
  year: z.number().int().min(2020).max(2040),
  defaultPct: z.number().min(0).max(100).optional(),
})

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const year = Number(request.nextUrl.searchParams.get("year") ?? new Date().getUTCFullYear())
  const pools = await prisma.tradeBudgetPool.findMany({
    where: { organizationId: session.orgId, year, grainKey: "org" },
    orderBy: { month: "asc" },
    select: POOL_SELECT,
  })
  return NextResponse.json({ ok: true, year, pools })
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

  let parsed
  try {
    parsed = deriveSchema.parse(await request.json())
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { ok: false, error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }
  const { year } = parsed

  // Monthly revenue plan: BudgetLine revenue rows on the year's budget
  // plans. monthIndex is 0-11 (nullable for legacy rows — skipped).
  const revenue = await prisma.budgetLine.groupBy({
    by: ["monthIndex"],
    where: {
      organizationId: orgId,
      deletedAt: null,
      lineType: "revenue",
      monthIndex: { not: null },
      plan: { year, kind: "budget" },
    },
    _sum: { plannedAmount: true },
  })
  const salesByMonth = new Map<number, number>(
    revenue
      .filter((r) => r.monthIndex != null)
      .map((r) => [(r.monthIndex as number) + 1, r._sum.plannedAmount ?? 0]),
  )

  const existing = await prisma.tradeBudgetPool.findMany({
    where: { organizationId: orgId, year, grainKey: "org" },
    select: { month: true, budgetPct: true, budgetAmount: true, isManualAmount: true },
  })

  const upserts = planPoolUpserts(salesByMonth, existing, parsed.defaultPct)

  const pools = await prisma.$transaction(async (tx) => {
    for (const u of upserts) {
      await tx.tradeBudgetPool.upsert({
        where: {
          organizationId_year_month_grainKey: {
            organizationId: orgId,
            year,
            month: u.month,
            grainKey: "org",
          },
        },
        create: {
          organizationId: orgId,
          year,
          month: u.month,
          grainKey: "org",
          salesPlanAmount: u.salesPlanAmount,
          budgetPct: u.budgetPct,
          budgetAmount: u.budgetAmount,
        },
        update: {
          salesPlanAmount: u.salesPlanAmount,
          budgetPct: u.budgetPct,
          budgetAmount: u.budgetAmount,
        },
      })

      // Regenerate the pacing feed for this month (derived rows — wholesale
      // replace per design; see TradePlanDaily model comment).
      await tx.tradePlanDaily.deleteMany({
        where: { organizationId: orgId, year, month: u.month, grainKey: "org" },
      })
      const salesSpread = spreadMonthlyPlan(year, u.month, u.salesPlanAmount)
      const budgetSpread = spreadMonthlyPlan(year, u.month, u.budgetAmount)
      await tx.tradePlanDaily.createMany({
        data: salesSpread.map((d, i) => ({
          organizationId: orgId,
          date: new Date(Date.UTC(year, u.month - 1, d.day)),
          year,
          month: u.month,
          grainKey: "org",
          plannedSalesAmount: d.amount,
          plannedTradeBudgetAmount: budgetSpread[i]?.amount ?? 0,
          workingDayWeight: d.weight,
        })),
      })
    }
    return tx.tradeBudgetPool.findMany({
      where: { organizationId: orgId, year, grainKey: "org" },
      orderBy: { month: "asc" },
      select: POOL_SELECT,
    })
  })

  return NextResponse.json({
    ok: true,
    year,
    derived: upserts.filter((u) => u.action !== "keep_manual").length,
    keptManual: upserts.filter((u) => u.action === "keep_manual").length,
    pools,
  })
}
