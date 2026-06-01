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
import { prisma } from "@/lib/prisma"
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

  // Tenant scope first — 404 (not 403) for cross-tenant to avoid leaking existence.
  const company = await prisma.company.findFirst({
    where: { id: companyId, organizationId: session.orgId },
    select: { id: true, code: true, name: true },
  })
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 })
  }

  // Sub-group RBAC — managers restricted to a sub-group can't probe others.
  const scope = await getCompanyScope(session.orgId, session.userId, session.role)
  if (scope.ids != null && !scope.ids.has(companyId)) {
    return NextResponse.json({ error: "Access denied to this company" }, { status: 403 })
  }

  // ── Balance sheet: load all (non-deleted), keep only the latest period ──
  const allBsLines = await prisma.balanceSheetLine.findMany({
    where: { companyId, organizationId: session.orgId, deletedAt: null },
    select: {
      lineType: true,
      amount: true,
      year: true,
      month: true,
      subType: true,
      accountId: true,
      account: { select: { name: true, nameEn: true, nameRu: true, nameAz: true } },
    },
  })
  let period: string | null = null
  let bsRows: RawBsLine[] = []
  if (allBsLines.length > 0) {
    // Latest (year, month).
    let maxY = -Infinity
    let maxM = -Infinity
    for (const l of allBsLines) {
      if (l.year > maxY || (l.year === maxY && l.month > maxM)) {
        maxY = l.year
        maxM = l.month
      }
    }
    period = `${maxY}-${String(maxM).padStart(2, "0")}`
    bsRows = allBsLines
      .filter((l) => l.year === maxY && l.month === maxM)
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
  const plLines = await prisma.budgetLine.findMany({
    where: { companyId, organizationId: session.orgId, deletedAt: null },
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
    report,
  })
}
