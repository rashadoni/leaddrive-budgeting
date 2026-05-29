import { NextRequest, NextResponse } from "next/server"
import { getOrgId, getSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { findFirstActiveLockInPeriods, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
import { resolveAccountId } from "@/lib/budgeting/chart-of-accounts"

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
  const session = await getSession(req)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { orgId, userId } = session

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
    if (lock) return lockedResponse(lock, { prisma, orgId, userId, route: "POST /api/budgeting/cogs" })
  }

  // Phase 8 D3 final (2026-05-29) — COGSBudgetLine.accountId is a REQUIRED
  // ChartOfAccount FK since Phase 2.1 dropped the legacy `accountCode`
  // String column. Resolve every item's FK up front and reject the batch
  // when any code is free-text / unmatched: a COGS line cannot exist
  // without an account. The retired `prisma: any` masked two runtime
  // breaks here — a null `accountId` hit the NOT NULL FK, and writing the
  // dropped `accountCode` (or spreading it via `...item`) threw a
  // PrismaClientValidationError on a column the model no longer has.
  const cogsItems: Array<Record<string, unknown>> = Array.isArray(body) ? body : [body]
  const resolved = await Promise.all(
    cogsItems.map(async (item) => ({
      item,
      accountId: await resolveAccountId(prisma, orgId, (item.accountCode as string) ?? ""),
    })),
  )
  const unmatched = resolved.filter((r) => !r.accountId)
  if (unmatched.length > 0) {
    return NextResponse.json(
      {
        error: "Unmatched account codes — every COGS line needs a Chart-of-Accounts code",
        codes: unmatched.map((r) => (r.item.accountCode as string) ?? "(missing)"),
      },
      { status: 400 },
    )
  }

  if (Array.isArray(body)) {
    const results = await Promise.all(
      resolved.map(({ item, accountId }) =>
        prisma.cOGSBudgetLine.upsert({
          where: {
            planId_productLineId_year_month: {
              planId: item.planId as string,
              productLineId: item.productLineId as string,
              year: item.year as number,
              month: item.month as number,
            },
          },
          update: {
            productionQty: item.productionQty as number | undefined,
            totalCost: item.totalCost as number | undefined,
            notes: item.notes as string | undefined,
            accountId: accountId!,
          },
          create: {
            organizationId: orgId,
            planId: item.planId as string,
            productLineId: item.productLineId as string,
            accountId: accountId!,
            year: item.year as number,
            month: item.month as number,
            productionQty: item.productionQty as number | undefined,
            totalCost: item.totalCost as number | undefined,
            notes: item.notes as string | undefined,
          },
        }),
      ),
    )
    return NextResponse.json(results, { status: 201 })
  }

  // Single-create path — accountId guaranteed resolved by the gate above.
  const { item, accountId } = resolved[0]
  const line = await prisma.cOGSBudgetLine.create({
    data: {
      organizationId: orgId,
      planId: item.planId as string,
      productLineId: item.productLineId as string,
      accountId: accountId!,
      year: item.year as number,
      month: item.month as number,
      productionQty: item.productionQty as number | undefined,
      totalCost: item.totalCost as number | undefined,
      notes: item.notes as string | undefined,
    },
  })
  return NextResponse.json(line, { status: 201 })
}
