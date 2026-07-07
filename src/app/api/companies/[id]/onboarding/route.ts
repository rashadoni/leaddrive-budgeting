/**
 * Financial-truth-infra Phase C.2 — GET /api/companies/[id]/onboarding.
 *
 * Returns a per-company completeness report (P&L, Sales, Balance Sheet,
 * Cash Flow, ESG, industry-specific KPI baselines, ...). The report is
 * derived live from the DB on every request — no persisted state — so
 * after a re-import the next call reflects the new completeness
 * automatically.
 *
 * Auth: viewer+ (read-only, same as /settings GET — non-sensitive).
 * Scope: same sub-group RBAC enforcement as the other /companies/[id]/*
 *        routes; cross-tenant ids return 404 (existence-leak guard).
 */
import { NextRequest, NextResponse } from "next/server";
import { withOrgScope } from "@/lib/db/with-org-scope";
import { requireRole, isAuthError } from "@/lib/api-auth";
import { getCompanyScope } from "@/lib/rbac/company-scope";
import { checkOnboardingCompleteness } from "@/lib/onboarding/completeness-checker";
import { getLogger } from "@/lib/log";

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger("api:companies:onboarding");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(req, "viewer");
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    );
  }

  const { id } = await params;
  const period = req.nextUrl.searchParams.get("period") ?? "2026";

  const company = await withOrgScope(session.orgId, (tx) =>
    tx.company.findFirst({
      where: { id, organizationId: session.orgId },
      select: { id: true },
    }),
  );
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }
  const scope = await getCompanyScope(session.orgId, session.userId, session.role);
  if (scope.ids != null && !scope.ids.has(id)) {
    return NextResponse.json({ error: "Access denied to this company" }, { status: 403 });
  }

  try {
    // Stage 3 RLS — the checker runs inside the org-scoped tx (it takes a TransactionClient).
    const report = await withOrgScope(session.orgId, (tx) =>
      checkOnboardingCompleteness(tx, id, period),
    );
    return NextResponse.json(report);
  } catch (error) {
    log.error("onboarding-check failed", {
      companyId: id,
      err: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Failed to compute onboarding completeness" },
      { status: 500 },
    );
  }
}
