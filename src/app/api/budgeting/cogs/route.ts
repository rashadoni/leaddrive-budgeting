import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { findFirstActiveLockInPeriods, derivePeriodKey } from "@/lib/budgeting/period-lock"

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const planId = searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  const [cogsLines, components, details] = await Promise.all([
    prisma.cOGSBudgetLine.findMany({
      where: { organizationId: orgId, planId },
      include: { productLine: true },
      orderBy: [{ productLine: { sortOrder: "asc" } }, { month: "asc" }],
    }),
    prisma.costComponent.findMany({
      where: { organizationId: orgId },
      include: { productLine: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.cOGSCostDetail.findMany({
      where: { organizationId: orgId, planId },
      orderBy: [{ productLineId: "asc" }, { sortOrder: "asc" }, { month: "asc" }],
    }),
  ])

  return NextResponse.json({ cogsLines, components, details })
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const items: any[] = Array.isArray(body) ? body : [body]

  // Phase 7.G Turn LXVIII (Phase 4.2 fan-out). Period-lock guard. cogs
  // mutations span N rows, possibly across N plans; gather unique planIds,
  // load their period fields, derive keys, then single-org-read multi-key
  // check. Reject the whole batch if any period locked (atomic intent).
  const uniquePlanIds = Array.from(
    new Set(items.map((i) => i?.planId).filter((id): id is string => typeof id === "string" && id.length > 0)),
  )
  if (uniquePlanIds.length > 0) {
    const ownedPlans = await prisma.budgetPlan.findMany({
      where: { id: { in: uniquePlanIds }, organizationId: orgId },
      select: { id: true, periodType: true, year: true, month: true, quarter: true },
    })
    if (ownedPlans.length !== uniquePlanIds.length) {
      return NextResponse.json({ error: "One or more plans not found in this organization" }, { status: 404 })
    }
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
  }

  if (Array.isArray(body)) {
    const results = await Promise.all(
      body.map((item: any) =>
        prisma.cOGSBudgetLine.upsert({
          where: {
            planId_productLineId_year_month: {
              planId: item.planId,
              productLineId: item.productLineId,
              year: item.year,
              month: item.month,
            },
          },
          update: { productionQty: item.productionQty, totalCost: item.totalCost, accountCode: item.accountCode, notes: item.notes },
          create: { ...item, organizationId: orgId },
        })
      )
    )
    return NextResponse.json(results, { status: 201 })
  }

  const line = await prisma.cOGSBudgetLine.create({
    data: { ...body, organizationId: orgId },
  })
  return NextResponse.json(line, { status: 201 })
}
