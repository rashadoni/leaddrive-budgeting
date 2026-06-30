import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import { isContraRevenueCode } from "@/lib/budgeting/coa-role"

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
  if (lines.length === 0) {
    const fallbackLines = await prisma.budgetLine.findMany({
      where: { organizationId: orgId, planId, lineType: "revenue", deletedAt: null },
      select: {
        id: true,
        department: true,
        plannedAmount: true,
        unitPrice: true,
        quantity: true,
        monthIndex: true,
        sortOrder: true,
        account: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ sortOrder: "asc" }],
    })
    if (fallbackLines.length > 0) {
      const buckets = new Map<string, {
        id: string
        month: number
        quantity: number
        unitPrice: number
        amount: number
        productLine: { id: string; code: string; name: string; unit: string }
        source: "budget_lines"
      }>()
      for (const line of fallbackLines) {
        const month = resolveBudgetLineMonth(line.monthIndex, line.sortOrder)
        if (month == null) continue
        const code = line.account.code
        const name = line.account.name || line.department || code
        const productId = `budget-line:${line.account.id}:${line.department || ""}`
        const bucketKey = `${productId}:${month}`
        const amount = (isContraRevenueCode(code) ? -1 : 1) * (line.plannedAmount || 0)
        const quantity = line.quantity ?? 0
        const current = buckets.get(bucketKey)
        if (current) {
          current.amount += amount
          current.quantity += quantity
          current.unitPrice = current.quantity > 0 ? current.amount / current.quantity : 0
        } else {
          buckets.set(bucketKey, {
            id: `budget-line-revenue:${bucketKey}`,
            month,
            quantity,
            unitPrice: line.unitPrice ?? 0,
            amount,
            productLine: {
              id: productId,
              code,
              name,
              unit: quantity > 0 ? "unit" : "AZN",
            },
            source: "budget_lines",
          })
        }
      }
      return NextResponse.json({
        lines: Array.from(buckets.values()),
        source: "budget_lines",
        fallbackReason: "sales_budget_lines_empty",
      })
    }
  }
  return NextResponse.json(lines)
}

function resolveBudgetLineMonth(monthIndex: number | null, sortOrder: number): number | null {
  if (monthIndex != null && monthIndex >= 0 && monthIndex < 12) return monthIndex + 1
  const fromSort = sortOrder % 100
  if (fromSort >= 0 && fromSort < 12) return fromSort + 1
  return null
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
