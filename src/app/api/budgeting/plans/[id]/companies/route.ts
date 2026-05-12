/**
 * Phase 7.G — list of companies that participate in a budget plan.
 *
 * Backed by `BudgetLine.companyId` — the only piece of the plan data
 * model that is actually company-scoped. We `groupBy` distinct
 * companyIds, then also surface every parent of those leaves so the
 * dropdown can offer rollup views (clicking AZSEKER aggregates
 * AZSEKER-EDEN + AZSEKER-AZSF + ... per `getCompanyScope` semantics).
 *
 * Why this exists: the budgeting page's company filter previously
 * showed every operational company in the org, regardless of whether
 * the active plan even covered them. User selected "Azərşəkər 2026
 * Budget" plan but the dropdown still listed AAC / ATL / SPARK (the
 * AZMADE branch) — misleading because none of those have lines in
 * the AZSEKER plan.
 *
 * Returns `{ companyIds: string[] }` — IDs only. The page already
 * has the full company tree loaded; this endpoint just narrows the
 * dropdown to the relevant subset.
 */

import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    )
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "Invalid plan id" }, { status: 400 })
  }

  // Cross-tenant guard — confirm the plan belongs to caller's org
  // before leaking BudgetLine companyIds.
  const plan = await prisma.budgetPlan.findFirst({
    where: { id, organizationId: session.orgId, deletedAt: null },
    select: { id: true },
  })
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 })
  }

  // Distinct companyIds across the plan's BudgetLines. `companyId` is
  // nullable on the model (legacy lines from before the company
  // refactor) — we drop nulls because a "no-company" line can't
  // anchor a dropdown row.
  const rows = await prisma.budgetLine.findMany({
    where: {
      organizationId: session.orgId,
      planId: id,
      companyId: { not: null },
    },
    distinct: ["companyId"],
    select: { companyId: true },
  })

  const leafIds = rows
    .map((r: { companyId: string | null }) => r.companyId)
    .filter((v: string | null): v is string => typeof v === "string")

  // Walk up the parentCompanyId chain to include every ancestor.
  // Two hops covers the holding tree depth today (level=1 sub-groups
  // → level=2 ops). Doing it as one findMany scoped to the org keeps
  // the call O(1).
  let parentIds: string[] = []
  if (leafIds.length > 0) {
    const cos = await prisma.company.findMany({
      where: { organizationId: session.orgId, id: { in: leafIds } },
      select: { parentCompanyId: true },
    })
    parentIds = cos
      .map((c: { parentCompanyId: string | null }) => c.parentCompanyId)
      .filter((v: string | null): v is string => typeof v === "string")
  }
  // Grandparent hop (holding level above sub-group) — guards against
  // future 3-level tree without forcing recursion.
  let grandparentIds: string[] = []
  if (parentIds.length > 0) {
    const cos = await prisma.company.findMany({
      where: { organizationId: session.orgId, id: { in: parentIds } },
      select: { parentCompanyId: true },
    })
    grandparentIds = cos
      .map((c: { parentCompanyId: string | null }) => c.parentCompanyId)
      .filter((v: string | null): v is string => typeof v === "string")
  }

  const all = Array.from(new Set([...leafIds, ...parentIds, ...grandparentIds]))
  return NextResponse.json({ companyIds: all })
}
