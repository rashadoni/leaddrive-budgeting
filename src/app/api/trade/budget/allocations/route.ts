/**
 * Channel budget allocations — `PUT /api/trade/budget/allocations`
 * (T9, audit §1.1; Codex-designed 2026-07-07).
 *
 * Body: { year, month, allocations: [{ channelId, allocationPct }] }
 *
 * Percentage split of the month's ORG pool across channels (sum ≤ 100).
 * Channel budgets are stored as TradeBudgetPool rows with
 * grainKey="channel:<id>" — budgetPct carries the ALLOCATION % while no
 * channel-level sales plan exists (salesPlanAmount stays 0). Omitted
 * channels are cleared in the same transaction; TradePlanDaily rows are
 * regenerated per channel grain. 409 when the org pool for the month
 * has not been derived yet.
 */
import { NextRequest, NextResponse } from "next/server"
import { z, ZodError } from "zod"
import { requireRole, isAuthError } from "@/lib/api-auth"
import { enforceRateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/prisma"
import { planChannelAllocations, CHANNEL_GRAIN_PREFIX } from "@/lib/trade/budget"
import { spreadMonthlyPlan } from "@/lib/trade/pacing"

const RATE_LIMIT = { name: "trade-budget-allocations", max: 30, windowMs: 60_000 }

const bodySchema = z.object({
  year: z.number().int().min(2020).max(2040),
  month: z.number().int().min(1).max(12),
  allocations: z
    .array(
      z.object({
        channelId: z.string().min(1),
        allocationPct: z.number(),
      }),
    )
    .max(50),
})

export async function PUT(request: NextRequest) {
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
    parsed = bodySchema.parse(await request.json())
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json(
        { ok: false, error: "Validation failed", details: e.flatten().fieldErrors },
        { status: 400 },
      )
    }
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 })
  }
  const { year, month } = parsed

  const orgPool = await prisma.tradeBudgetPool.findUnique({
    where: {
      organizationId_year_month_grainKey: { organizationId: orgId, year, month, grainKey: "org" },
    },
    select: { budgetAmount: true },
  })
  if (!orgPool) {
    return NextResponse.json(
      { ok: false, error: "Derive the org budget for this month first" },
      { status: 409 },
    )
  }

  const channels = await prisma.tradeChannel.findMany({
    where: { organizationId: orgId, isActive: true, deletedAt: null },
    select: { id: true },
  })
  const { plans, errors } = planChannelAllocations(
    orgPool.budgetAmount,
    parsed.allocations,
    new Set(channels.map((c) => c.id)),
  )
  if (errors.length > 0) {
    return NextResponse.json({ ok: false, error: "Allocation validation failed", errors }, { status: 400 })
  }

  const keepGrains = new Set(plans.map((p) => p.grainKey))
  await prisma.$transaction(async (tx) => {
    // Clear channel pools not present in this split (and their plan-daily).
    const stale = await tx.tradeBudgetPool.findMany({
      where: {
        organizationId: orgId,
        year,
        month,
        grainKey: { startsWith: CHANNEL_GRAIN_PREFIX },
        NOT: { grainKey: { in: [...keepGrains] } },
      },
      select: { grainKey: true },
    })
    if (stale.length > 0) {
      await tx.tradeBudgetPool.deleteMany({
        where: {
          organizationId: orgId,
          year,
          month,
          grainKey: { in: stale.map((s) => s.grainKey) },
        },
      })
      await tx.tradePlanDaily.deleteMany({
        where: {
          organizationId: orgId,
          year,
          month,
          grainKey: { in: stale.map((s) => s.grainKey) },
        },
      })
    }

    for (const p of plans) {
      await tx.tradeBudgetPool.upsert({
        where: {
          organizationId_year_month_grainKey: {
            organizationId: orgId,
            year,
            month,
            grainKey: p.grainKey,
          },
        },
        create: {
          organizationId: orgId,
          year,
          month,
          grainKey: p.grainKey,
          salesPlanAmount: 0, // no channel-level sales plan yet (Mars answers pending)
          budgetPct: p.allocationPct, // ALLOCATION % while salesPlanAmount=0
          budgetAmount: p.budgetAmount,
        },
        update: { budgetPct: p.allocationPct, budgetAmount: p.budgetAmount },
      })
      await tx.tradePlanDaily.deleteMany({
        where: { organizationId: orgId, year, month, grainKey: p.grainKey },
      })
      const budgetSpread = spreadMonthlyPlan(year, month, p.budgetAmount)
      await tx.tradePlanDaily.createMany({
        data: budgetSpread.map((d) => ({
          organizationId: orgId,
          date: new Date(Date.UTC(year, month - 1, d.day)),
          year,
          month,
          grainKey: p.grainKey,
          plannedSalesAmount: 0,
          plannedTradeBudgetAmount: d.amount,
          workingDayWeight: d.weight,
        })),
      })
    }
  })

  const pools = await prisma.tradeBudgetPool.findMany({
    where: { organizationId: orgId, year, month, grainKey: { startsWith: CHANNEL_GRAIN_PREFIX } },
    orderBy: { grainKey: "asc" },
    select: { grainKey: true, budgetPct: true, budgetAmount: true },
  })
  const allocated = pools.reduce((s, p) => s + p.budgetAmount, 0)
  return NextResponse.json({
    ok: true,
    year,
    month,
    pools,
    allocated: Math.round(allocated * 100) / 100,
    unallocated: Math.round((orgPool.budgetAmount - allocated) * 100) / 100,
  })
}

/** Convenience: GET current month's split. */
export async function GET(request: NextRequest) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 })
  }
  const now = new Date()
  const year = Number(request.nextUrl.searchParams.get("year") ?? now.getUTCFullYear())
  const month = Number(request.nextUrl.searchParams.get("month") ?? now.getUTCMonth() + 1)

  const [orgPool, channelPools] = await Promise.all([
    prisma.tradeBudgetPool.findUnique({
      where: {
        organizationId_year_month_grainKey: {
          organizationId: session.orgId,
          year,
          month,
          grainKey: "org",
        },
      },
      select: { budgetAmount: true },
    }),
    prisma.tradeBudgetPool.findMany({
      where: {
        organizationId: session.orgId,
        year,
        month,
        grainKey: { startsWith: CHANNEL_GRAIN_PREFIX },
      },
      select: { grainKey: true, budgetPct: true, budgetAmount: true },
    }),
  ])
  const allocated = channelPools.reduce((s, p) => s + p.budgetAmount, 0)
  return NextResponse.json({
    ok: true,
    year,
    month,
    orgBudget: orgPool?.budgetAmount ?? 0,
    pools: channelPools,
    allocated: Math.round(allocated * 100) / 100,
    unallocated: Math.round(((orgPool?.budgetAmount ?? 0) - allocated) * 100) / 100,
  })
}
