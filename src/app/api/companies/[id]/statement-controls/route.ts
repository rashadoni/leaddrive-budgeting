/**
 * Phase 10 / B1 shadow slice — shadow statement-controls surface.
 *
 * GET /api/companies/[id]/statement-controls[?period=YYYY-MM]
 *   → { shadow: true, decisionGrade: false, banner, company, period, policy,
 *       bsSignConvention, controls, notes, generatedAt }
 *
 * Deliberately mirrors `/api/companies/[id]/ifrs-check` (auth, tenant scope,
 * sub-group RBAC, read-only tx). SHADOW / PROVISIONAL only: the pinned policy
 * approval is "provisional" and no statement row carries lineage, so every
 * control is "provisional" or "blocked" — never a decision-grade pass/fail.
 * GET is the module's only HTTP export (Next answers 405 for mutations); the
 * handler performs only findFirst/findMany inside RLS transactions plus pure
 * calls, so the surface is read-only by construction. No audit emission
 * (read-only, parity with ifrs-check), no caching, no paid calls.
 */

import { NextRequest, NextResponse } from "next/server"
import { withOrgScope } from "@/lib/db/with-org-scope"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { getCompanyScope } from "@/lib/rbac/company-scope"
import {
  SHADOW_STATEMENT_POLICY,
  assembleShadowStatementControls,
  fetchStatementEvidence,
} from "@/lib/risk/statement-controls-adapter"

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

const SHADOW_BANNER = "SHADOW / PROVISIONAL — NOT DECISION-GRADE"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await requireAuth(req)
  if (isAuthError(session)) return session
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 })
  }

  const { id: companyId } = await params
  const orgId = session.orgId
  const periodParam = req.nextUrl.searchParams.get("period")
  if (periodParam != null && !PERIOD_RE.test(periodParam)) {
    return NextResponse.json({ error: "Invalid period; expected YYYY-MM" }, { status: 400 })
  }

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

  // Stage 3 RLS — all statement reads run in one org-scoped tx; every `where`
  // inside also carries explicit { organizationId, companyId } (defense in
  // depth). The assembly is pure and sits outside any write path.
  const evidence = await withOrgScope(orgId, (tx) =>
    fetchStatementEvidence(tx, orgId, companyId, periodParam),
  )
  if (evidence === null) {
    return NextResponse.json({
      shadow: true,
      decisionGrade: false,
      noStatements: true,
      period: null,
      controls: [],
    })
  }

  const controls = assembleShadowStatementControls(evidence)

  return NextResponse.json({
    shadow: true,
    decisionGrade: false,
    banner: SHADOW_BANNER,
    company: { id: company.id, code: company.code, name: company.name },
    period: evidence.periodKey,
    openingPeriod: evidence.openingPeriodKey,
    basis: "plan",
    currency: "AZN",
    policy: {
      id: SHADOW_STATEMENT_POLICY.id,
      approval: SHADOW_STATEMENT_POLICY.approval,
      relativeTolerance: SHADOW_STATEMENT_POLICY.relativeTolerance,
      absoluteFloorByCurrency: SHADOW_STATEMENT_POLICY.absoluteFloorByCurrency,
      materialityRate: SHADOW_STATEMENT_POLICY.materialityRate,
      materialityFloorByCurrency: SHADOW_STATEMENT_POLICY.materialityFloorByCurrency,
    },
    bsSignConvention: {
      detected: evidence.bs.signConvention.convention,
      signedResidual: evidence.bs.signConvention.signedResidual,
      naturalResidual: evidence.bs.signConvention.naturalResidual,
      rawSums: evidence.bs.rawSums,
    },
    planCount: evidence.pl.planCount,
    controls,
    // Payload-level disclosures, rendered via `adminStatementControls.limitations.*`.
    notes: ["planYearScope", "multiPlan", "legacyRows", "rateIndependence", "rateStaleness"],
    generatedAt: new Date().toISOString(),
  })
}
