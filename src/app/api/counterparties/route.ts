/**
 * GET /api/counterparties?companyId=<id>&role=customer|supplier
 *
 * Returns the top-N counterparty register for a company. Used by:
 *  - Risk Terminal Concentration panel (top-10 chart)
 *  - AI Variance Explainer "what if X customer leaves" narrative
 *  - Onboarding completeness §3.x check (does the register exist?)
 *
 * Auth: viewer+ (read-only).
 */
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireRole, isAuthError } from "@/lib/api-auth"
// Phase 5.2 Stage 2 Tier 4 (2026-05-21) — RLS wrap for counterparties reads.
import { withOrgScope } from "@/lib/db/with-org-scope"

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "viewer")
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }
  const url = new URL(request.url)
  const companyId = url.searchParams.get("companyId")
  const role = url.searchParams.get("role")
  const period = url.searchParams.get("period") ?? "2026"

  const where: Record<string, unknown> = { organizationId: session.orgId, period }
  if (companyId) where.companyId = companyId
  if (role === "customer" || role === "supplier") where.role = role

  const rows = await withOrgScope(session.orgId, async (tx) =>
    tx.counterparty.findMany({
      where,
      orderBy: [{ role: "asc" }, { sharePct: "desc" }],
      select: {
        id: true, companyId: true, role: true, name: true,
        sharePct: true, annualAmount: true,
        contractExpiry: true, paymentTermsDays: true,
        singleSource: true, notes: true, period: true,
      },
    })
  )

  // Aggregate HHI per role for the requested company (or whole org)
  type Row = (typeof rows)[number]
  const customers: Row[] = rows.filter((r: Row) => r.role === "customer")
  const suppliers: Row[] = rows.filter((r: Row) => r.role === "supplier")
  const hhi = (set: Row[]): number =>
    set.reduce((s: number, r: Row) => s + (r.sharePct / 100) ** 2, 0)
  const singleSourceSuppliers = suppliers.filter((r: Row) => r.singleSource).length

  return NextResponse.json({
    period,
    companyId,
    counterparties: rows,
    summary: {
      customerCount: customers.length,
      supplierCount: suppliers.length,
      singleSourceSuppliers,
      customerHhi: Math.round(hhi(customers) * 10000) / 10000,
      supplierHhi: Math.round(hhi(suppliers) * 10000) / 10000,
    },
  })
}
