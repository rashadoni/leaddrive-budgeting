import { NextRequest, NextResponse } from "next/server"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { getActivePeriodLock, derivePeriodKey } from "@/lib/budgeting/period-lock"
import { lockedResponse } from "@/lib/budgeting/period-lock-http"
// Phase 5.2 Stage 2 Tier 3 (2026-05-21) — RLS wrap for balance_sheet_lines + budget_plans reads/writes.
import { withOrgScope } from "@/lib/db/with-org-scope"
import { resolveBalanceSheetSourcePlan } from "@/lib/budgeting/statement-plan-fallback"

export async function GET(req: NextRequest) {
  const orgId = await getOrgId(req)
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const planId = searchParams.get("planId")
  if (!planId) return NextResponse.json({ error: "planId required" }, { status: 400 })
  // Consolidated-holding view (2026-06-23): with no companyId requested, if the
  // org's single level-1 holding carries its own consolidated BS lines on this
  // plan, show ONLY those (the official ~253M) — NOT the naive cross-company sum
  // (~339M) that double-counts intercompany "Investments in Joint Ventures".
  // `?companyId=` drills into one entity's standalone balance sheet.
  const requestedCompanyId = searchParams.get("companyId")

  const result = await withOrgScope(orgId, async (tx) => {
    // Source-plan resolution (2026-06-04, Y4 follow-up): budget plans carry
    // ONLY the P&L (the İcmal budget is P&L-only) — they have no balance
    // sheet. So when the page defaults to / the user views a budget plan, the
    // balance sheet comes from the matching-year ACTUAL plan instead of an
    // empty state. Mirrors the analytics Y4 actuals fallback. The Workspace
    // tab is unaffected (it keeps the budget plan for execution %).
    const active = await tx.budgetPlan.findFirst({
      where: { id: planId, organizationId: orgId },
      select: { id: true, year: true, kind: true },
    })
    // Contract: budget plans are P&L-only by construction here (the İcmal
    // budget loads no balance sheet), so a budget plan never has its own BS to
    // override. If a budgeted balance sheet is ever introduced, switch this to
    // fall back only when the budget plan has 0 live BS lines.
    let sourcePlanId = planId
    let fellBack = false
    if (active?.kind === "budget") {
      const actuals = await tx.budgetPlan.findFirst({
        where: { organizationId: orgId, year: active.year, kind: "actual", deletedAt: null },
        select: { id: true, kind: true },
        // Deterministic pick when >1 actuals plan exists for a year — mirrors
        // the analytics Y4 fallback (analytics/route.ts) so both views agree.
        orderBy: { createdAt: "asc" },
      })
      const r = resolveBalanceSheetSourcePlan({ id: active.id, kind: active.kind }, actuals)
      sourcePlanId = r.sourcePlanId
      fellBack = r.fellBack
    }

    // Resolve the single level-1 holding (exactly-one rule, mirrors import
    // routing): it carries the consolidated BS; children carry standalone.
    const level1 = await tx.company.findMany({
      where: { organizationId: orgId, level: 1 },
      select: { id: true, name: true, code: true, baseCurrencyCode: true },
      take: 2,
    })
    const holding = level1.length === 1 ? level1[0] : null
    let companyFilter: { companyId?: string } = {}
    let consolidated = false
    let viewCompanyId: string | null = null
    if (requestedCompanyId) {
      companyFilter = { companyId: requestedCompanyId }
      viewCompanyId = requestedCompanyId
    } else if (holding) {
      const holdingLines = await tx.balanceSheetLine.count({
        where: {
          organizationId: orgId,
          planId: sourcePlanId,
          companyId: holding.id,
          deletedAt: null,
        },
      })
      if (holdingLines > 0) {
        companyFilter = { companyId: holding.id }
        consolidated = true
        viewCompanyId = holding.id
      }
    }

    // deletedAt:null REQUIRED (2026-05-31): BalanceSheetLine uses the
    // soft-delete-then-insert archive pattern on re-import. Without this
    // filter the GET returns superseded (archived) rows alongside live ones,
    // inflating Total Assets/Liabilities/Equity ~2× on re-imported data
    // (measured ×1.92 on AZSEKER 2026 Budget). Matches plans/route.ts.
    const lines = await tx.balanceSheetLine.findMany({
      where: { organizationId: orgId, planId: sourcePlanId, deletedAt: null, ...companyFilter },
      // orderBy account.code via the relation (2026-05-31): the scalar
      // `accountCode` column was DROPPED in Phase 2.1 (2026-05-26, replaced by
      // accountId + account FK), but this orderBy still referenced it → Prisma
      // "Unknown argument accountCode" → 500 → the BS tab silently showed the
      // empty state for every plan since. The handler-test prisma mock ignores
      // orderBy, so it stayed green; only hitting the live route surfaced it.
      orderBy: [{ lineType: "asc" }, { account: { code: "asc" } }, { month: "asc" }],
      // Include the related account so the client can label detail rows —
      // `accountCode`/`accountName` scalars are gone (Phase 2.1); the per-
      // account breakdown is keyed off `account.name`/`account.code` now.
      include: { account: { select: { code: true, name: true } } },
    })
    return {
      lines,
      sourcePlanId,
      fellBack,
      sourceYear: active?.year ?? null,
      consolidated,
      holding,
      viewCompanyId,
      currencyCode: consolidated ? holding?.baseCurrencyCode ?? null : null,
    }
  })

  const { lines, sourcePlanId, fellBack, sourceYear, consolidated, holding, viewCompanyId, currencyCode } = result
  // Group by lineType
  type BSRow = (typeof lines)[number]
  const assets = lines.filter((l: BSRow) => l.lineType === "asset")
  const liabilities = lines.filter((l: BSRow) => l.lineType === "liability")
  const equity = lines.filter((l: BSRow) => l.lineType === "equity")

  return NextResponse.json({
    assets,
    liabilities,
    equity,
    all: lines,
    // Provenance so the client can note "showing the <year> Actuals balance
    // sheet" when a budget plan fell back. Non-breaking additive field.
    meta: { requestedPlanId: planId, sourcePlanId, fellBack, sourceYear, consolidated, holding, viewCompanyId, currencyCode },
  })
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
