/**
 * Phase 7.N — Post-import IFRS structural-conformance check.
 *
 * GET /api/companies/[id]/ifrs-check
 *   → { company: {id, code, name}, period: "YYYY-MM" | null, report }
 *
 * Read-only. Loads the company's imported balance sheet (latest period) and
 * income statement (budget lines joined to the chart of accounts), then runs
 * the structural IFRS checks in `src/lib/audit/ifrs-checks.ts`. No DB writes,
 * no fabricated numbers — `skip` is returned for statements with no data.
 *
 * Auth: any authenticated org member; tenant-scoped (404 cross-tenant to avoid
 * leaking company existence) + sub-group RBAC, mirroring the GET on
 * `/api/companies/[id]/reconciliation`.
 */

import { NextRequest, NextResponse } from "next/server"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import {
  buildIfrsInput,
  runIfrsChecks,
  type RawBsLine,
  type RawPlLine,
} from "@/lib/audit/ifrs-checks"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const { id: companyId } = await params
  const orgId = session.orgId

  // Tenant scope first — 404 (not 403) for cross-tenant to avoid leaking existence.
  const company = await withOrgScope(orgId, (tx) =>
    tx.company.findFirst({
      where: { id: companyId, organizationId: orgId },
      select: { id: true, code: true, name: true },
    }),
  )
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  // Sub-group RBAC (getCompanyScope uses prismaAdmin, self-contained).
  const scope = await getCompanyScope(orgId, session.userId, session.role)
  if (scope.ids != null && !scope.ids.has(companyId)) {
    return NextResponse.json({ error: "Access denied to this company" }, { status: 403 })
  }

  // Stage 3 RLS — the two statement reads run in one org-scoped tx; the
  // pure IFRS aggregation (small arrays) stays in the closure.
  return withOrgScope(orgId, async (tx) => {
  // ── Balance sheet: load all (non-deleted), keep one latest-plan period ──
  const allBsLines = await tx.balanceSheetLine.findMany({
    where: { companyId, organizationId: orgId, deletedAt: null },
    select: {
      lineType: true,
      amount: true,
      planId: true,
      year: true,
      month: true,
      subType: true,
      accountId: true,
      account: { select: { name: true, nameEn: true, nameRu: true, nameAz: true } },
    },
  })
  let period: string | null = null
  let selectedPlanId: string | null = null
  let sourcePlanCount = 0
  let maxY: number | null = null
  let maxM: number | null = null
  let bsRows: RawBsLine[] = []
  if (allBsLines.length > 0) {
    // Latest (year, month).
    let latestYear = -Infinity
    let latestMonth = -Infinity
    for (const l of allBsLines) {
      if (l.year > latestYear || (l.year === latestYear && l.month > latestMonth)) {
        latestYear = l.year
        latestMonth = l.month
      }
    }
    maxY = latestYear
    maxM = latestMonth
    period = `${latestYear}-${String(latestMonth).padStart(2, "0")}`
    const latestLines = allBsLines.filter(
      (line) => line.year === latestYear && line.month === latestMonth,
    )
    const planIds = [...new Set(latestLines.map((line) => line.planId))]
    sourcePlanCount = planIds.length
    selectedPlanId = planIds.length === 1 ? planIds[0] : null

    // Multiple plans at the same latest period are not one statement. Mixing
    // them could manufacture a balanced result, so every BS check abstains.
    bsRows = (selectedPlanId
      ? latestLines.filter((line) => line.planId === selectedPlanId)
      : []
    )
      .map((l) => ({
        lineType: l.lineType,
        amount: l.amount,
        subType: l.subType,
        accountKey: l.accountId,
        accountName: [l.account?.name, l.account?.nameRu, l.account?.nameAz, l.account?.nameEn]
          .filter(Boolean)
          .join(" "),
      }))
  }

  // ── Income statement: budget lines joined to the chart of accounts ──
  const plLines = selectedPlanId && maxY !== null && maxM !== null
    ? await tx.budgetLine.findMany({
    where: {
      companyId,
      organizationId: orgId,
      planId: selectedPlanId,
      plan: { year: maxY },
      deletedAt: null,
      // P&L evidence is YTD through the balance-sheet month. Only canonical
      // monthIndex rows qualify: legacy null-month rows are indistinguishable
      // from annual totals, so including them could fabricate YTD coverage.
      monthIndex: { gte: 0, lte: maxM - 1 },
    },
    select: {
      plannedAmount: true,
      accountId: true,
      account: {
        select: {
          accountType: true,
          category: true,
          name: true,
          nameRu: true,
          nameAz: true,
          nameEn: true,
        },
      },
    },
  })
    : []
  const plRows: RawPlLine[] = plLines.map((l) => ({
    amount: l.plannedAmount,
    accountType: l.account?.accountType ?? "",
    accountKey: l.accountId,
    category: l.account?.category ?? null,
    // Join all name variants so D&A detection works in any locale.
    accountName: [l.account?.name, l.account?.nameRu, l.account?.nameAz, l.account?.nameEn]
      .filter(Boolean)
      .join(" "),
  }))

  const report = runIfrsChecks(buildIfrsInput(bsRows, plRows))

  return NextResponse.json({
    company: { id: company.id, code: company.code, name: company.name },
    period,
    scope: {
      status:
        selectedPlanId !== null
          ? "confirmed"
          : sourcePlanCount > 1
            ? "ambiguous"
            : "missing",
      basis: "same_plan_ytd",
      planId: selectedPlanId,
      sourcePlanCount,
      balanceSheetRows: bsRows.length,
      profitAndLossRows: plRows.length,
    },
    report,
  })
  })
}
