import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const planId = searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  const lines = await prisma.salesBudgetLine.findMany({
    where: { organizationId: orgId, planId },
    include: { productLine: true },
    orderBy: [{ productLine: { sortOrder: "asc" } }, { month: "asc" }],
  })
  return NextResponse.json(lines)
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  // Phase L8 — period-lock gate. Both shapes carry planId per item;
  // require a single planId across the array for bulk + check the
  // org's lockedPeriods. Reject with 423 if the resolved period is
  // signed off — prevents back-fill on closed quarters.
  const planId: unknown = Array.isArray(body) ? body[0]?.planId : body?.planId
  if (!planId || typeof planId !== "string") {
    return NextResponse.json({ error: "planId required in body" }, { status: 400 })
  }
  if (Array.isArray(body) && body.some((it: { planId?: unknown }) => it.planId !== planId)) {
    return NextResponse.json(
      { error: "All items in array must share the same planId" },
      { status: 400 },
    )
  }
  const plan = await prisma.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId },
    select: { id: true, periodType: true, year: true, month: true, quarter: true },
  })
  if (!plan) {
    return NextResponse.json({ error: "Plan not found in this organization" }, { status: 404 })
  }
  const lock = await getActivePeriodLock(prisma, orgId, derivePeriodKey(plan))
  if (lock)
    return lockedResponse(lock, {
      prisma,
      orgId,
      userId: null,
      route: "POST /api/budgeting/sales-budget",
    })

  // Support bulk upsert
  if (Array.isArray(body)) {
    const results = await Promise.all(
      body.map((item: any) =>
        prisma.salesBudgetLine.upsert({
          where: {
            planId_productLineId_year_month: {
              planId: item.planId,
              productLineId: item.productLineId,
              year: item.year,
              month: item.month,
            },
          },
          update: { quantity: item.quantity, unitPrice: item.unitPrice, amount: item.amount, notes: item.notes },
          create: { ...item, organizationId: orgId },
        })
      )
    )
    return NextResponse.json(results, { status: 201 })
  }

  const line = await prisma.salesBudgetLine.create({
    data: { ...body, organizationId: orgId },
  })
  return NextResponse.json(line, { status: 201 })
}
