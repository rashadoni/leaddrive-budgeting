import { NextRequest, NextResponse } from "next/server"
import { buildMissingData } from "@/lib/budgeting/missing-data"
import { summarizeProductMargins } from "@/lib/budgeting/product-margin"
import type { Prisma } from "@prisma/client"
import { getOrgId } from "@/lib/api-auth"
// Stage 3 RLS — `prisma` kept for lockedResponse 423-audit + the
// Awaited<ReturnType<...>> row-type helper below; data access rides tx.
import { prisma } from "@/lib/prisma"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import { isContraRevenueCode } from "@/lib/budgeting/coa-role"

type Db = Prisma.TransactionClient

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const planId = searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })
  const compare = searchParams.get("compare") === "1"

  // Stage 3 RLS — all sales-budget reads in one org-scoped tx.
  return withOrgScope(orgId, async (tx) => {
  const current = await loadSalesRows(tx, orgId, planId)
  if (!compare) {
    if (current.source) {
      return NextResponse.json({
        lines: current.lines,
        source: current.source,
        fallbackReason: current.fallbackReason,
      })
    }
    return NextResponse.json(current.lines)
  }

  const activePlan = await tx.budgetPlan.findFirst({
    where: { id: planId, organizationId: orgId, deletedAt: null },
    select: { id: true, name: true, year: true, kind: true },
  })
  if (!activePlan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })

  const counterpartKind = activePlan.kind === "budget" ? "actual" : "budget"
  const counterpartPlan = await tx.budgetPlan.findFirst({
    where: { organizationId: orgId, year: activePlan.year, kind: counterpartKind, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, year: true, kind: true },
  })
  const counterpart = counterpartPlan ? await loadSalesRows(tx, orgId, counterpartPlan.id) : null
  const budgetRows = activePlan.kind === "budget" ? current : counterpart
  const actualRows = activePlan.kind === "actual" ? current : counterpart

  /**
   * 2026-08-18 — gross margin per product, which the owner asked for and the
   * product table could not answer: it knew what was sold and never what it
   * cost, because the `COGS` banner in the client's own sheet went unread.
   *
   * Cost is looked up per product for THIS plan. A product with no cost row
   * stays `undefined` — never 0 — so the summariser returns `marginPct: null`
   * with a reason and the tab can say "no cost data" instead of publishing a
   * 100% margin on wheat, which is what a zero would render as.
   */
  const costRows = await tx.cOGSBudgetLine.findMany({
    where: { organizationId: orgId, planId },
    select: { productLineId: true, totalCost: true },
  })
  const costByProduct = new Map<string, number>()
  for (const c of costRows) {
    costByProduct.set(c.productLineId, (costByProduct.get(c.productLineId) ?? 0) + c.totalCost)
  }
  const revenueByProduct = new Map<
    string,
    { code: string; name: string; revenue: number }
  >()
  for (const line of current.lines) {
    // `SalesRow` is a union: the Prisma row (typed without the include) and
    // the budget-line fallback. Narrow with `in` rather than casting — a cast
    // here would compile happily against a row that has no product at all.
    const pl = "productLine" in line ? line.productLine : undefined
    if (!pl) continue
    const acc = revenueByProduct.get(pl.id) ?? { code: pl.code, name: pl.name, revenue: 0 }
    acc.revenue += line.amount ?? 0
    revenueByProduct.set(pl.id, acc)
  }
  const margins = summarizeProductMargins(
    [...revenueByProduct.entries()].map(([productLineId, v]) => ({
      productCode: v.code,
      productName: v.name,
      revenue: v.revenue,
      ...(costByProduct.has(productLineId)
        ? { cost: costByProduct.get(productLineId)! }
        : {}),
    })),
  )

  return NextResponse.json({
    lines: current.lines,
    source: current.source,
    fallbackReason: current.fallbackReason,
    margins,
    meta: {
      activePlan,
      comparisonPlan: counterpartPlan,
    },
    comparison: {
      budgetLines: budgetRows?.lines ?? [],
      actualLines: actualRows?.lines ?? [],
      budgetSource: budgetRows?.source,
      actualSource: actualRows?.source,
      // 11.90 — codes, not sentences. The locale belongs to the viewer.
      missingData: buildMissingData({
        dataset: "product",
        missingCounterpartKind: counterpartPlan ? null : counterpartKind,
        year: activePlan.year,
        hasBudgetRows: (budgetRows?.lines.length ?? 0) > 0,
        hasActualRows: (actualRows?.lines.length ?? 0) > 0,
      }),
    },
  })
  })
}

type SalesRows = Awaited<ReturnType<typeof prisma.salesBudgetLine.findMany>>
type SalesRow = SalesRows[number] | {
  id: string
  month: number
  quantity: number
  unitPrice: number
  amount: number
  productLine: { id: string; code: string; name: string; unit: string }
  source: "budget_lines"
}

async function loadSalesRows(tx: Db, orgId: string, planId: string): Promise<{
  lines: SalesRow[]
  source?: "budget_lines"
  fallbackReason?: string
}> {
  const lines = await tx.salesBudgetLine.findMany({
    where: { organizationId: orgId, planId },
    include: { productLine: true },
    orderBy: [{ productLine: { sortOrder: "asc" } }, { month: "asc" }],
  })
  if (lines.length > 0) return { lines }

  const fallbackLines = await tx.budgetLine.findMany({
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
  if (fallbackLines.length === 0) return { lines: [] }

  const buckets = new Map<string, Extract<SalesRow, { source: "budget_lines" }>>()
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

  return {
    lines: Array.from(buckets.values()),
    source: "budget_lines",
    fallbackReason: "sales_budget_lines_empty",
  }
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
  // Stage 3 RLS — lock check + upsert batch in one org-scoped tx.
  return withOrgScope(
    orgId,
    async (tx) => {
      const plan = await tx.budgetPlan.findFirst({
        where: { id: planId, organizationId: orgId },
        select: { id: true, periodType: true, year: true, month: true, quarter: true },
      })
      if (!plan) {
        return NextResponse.json({ error: "Plan not found in this organization" }, { status: 404 })
      }
      const lock = await getActivePeriodLock(tx, orgId, derivePeriodKey(plan))
      if (lock)
        return lockedResponse(lock, {
          prisma,
          orgId,
          userId: null,
          route: "POST /api/budgeting/sales-budget",
        })

      // Support bulk upsert (sequential inside the tx).
      if (Array.isArray(body)) {
        const results = []
        for (const item of body as any[]) {
          results.push(
            await tx.salesBudgetLine.upsert({
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
            }),
          )
        }
        return NextResponse.json(results, { status: 201 })
      }

      const line = await tx.salesBudgetLine.create({
        data: { ...body, organizationId: orgId },
      })
      return NextResponse.json(line, { status: 201 })
    },
    { timeoutMs: 15_000 },
  )
}
