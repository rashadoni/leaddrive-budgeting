import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
// Phase 5.2 Stage 2 Tier 3 (2026-05-21) — RLS wrap for balance_sheet_lines + budget_plans reads/writes.
import { withOrgScope } from "@/lib/db/with-org-scope"

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const planId = searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })

  const lines = await withOrgScope(orgId, async (tx) =>
    tx.balanceSheetLine.findMany({
      where: { organizationId: orgId, planId },
      orderBy: [{ lineType: "asc" }, { accountCode: "asc" }, { month: "asc" }],
    })
  )

  // Group by lineType
  type BSRow = (typeof lines)[number]
  const assets = lines.filter((l: BSRow) => l.lineType === "asset")
  const liabilities = lines.filter((l: BSRow) => l.lineType === "liability")
  const equity = lines.filter((l: BSRow) => l.lineType === "equity")

  return NextResponse.json({ assets, liabilities, equity, all: lines })
}

export async function POST(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  // Phase L8 — period-lock gate. Same shape as assumptions/sales-budget.
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
  const plan = await withOrgScope(orgId, async (tx) =>
    tx.budgetPlan.findFirst({
      where: { id: planId, organizationId: orgId },
      select: { id: true, periodType: true, year: true, month: true, quarter: true },
    })
  )
  if (!plan) {
    return NextResponse.json({ error: "Plan not found in this organization" }, { status: 404 })
  }
  const lock = await getActivePeriodLock(prisma, orgId, derivePeriodKey(plan))
  if (lock)
    return lockedResponse(lock, {
      prisma,
      orgId,
      userId: null,
      route: "POST /api/budgeting/balance-sheet",
    })

  if (Array.isArray(body)) {
    const results = await withOrgScope(orgId, async (tx) =>
      tx.balanceSheetLine.createMany({
        data: body.map((item: any) => ({ ...item, organizationId: orgId })),
        skipDuplicates: true,
      })
    )
    return NextResponse.json(results, { status: 201 })
  }

  const line = await withOrgScope(orgId, async (tx) =>
    tx.balanceSheetLine.create({
      data: { ...body, organizationId: orgId },
    })
  )
  return NextResponse.json(line, { status: 201 })
}
