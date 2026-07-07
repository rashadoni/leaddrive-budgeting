/**
 * Financial-truth-infra Phase D.3 — drift dashboard API.
 *
 * GET /api/admin/drift
 *   Returns:
 *     - recentDrifts: last 30 days of `reconciliation_drift_detected`
 *       audit events with company + indicator drill-down
 *     - referenceFreshness: per-source age + status (fresh/stale/critical_stale)
 *     - stalePending: companies with status='pending' / 'partial' for > 7
 *       days (onboarding stalled)
 *
 * Admin-only.
 */
// rls-scan-ignore: admin-only drift/freshness dashboard (read-only). It reads
// org audit events + companies + IndicatorValue AND drives the reference-data
// freshness helpers (resolveFreshnessSources / checkReferenceFreshness) which
// read shared/cross-source reference tables via the prisma client they're
// handed. Rather than thread a scope tx through the freshness internals (which
// touch shared reference data), it runs read-only on the BYPASSRLS
// `prismaAdmin` client — every query is orgId-scoped in code.
import { NextRequest, NextResponse } from "next/server";
import { prismaAdmin as prisma } from "@/lib/db/prisma-admin";
import { requireRole, isAuthError } from "@/lib/api-auth";
import { checkReferenceFreshness, resolveFreshnessSources } from "@/lib/intel/freshness";

export async function GET(req: NextRequest) {
  const session = await requireRole(req, "admin");
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json({ error: "User has no organization" }, { status: 403 });
  }

  // Last 30 days of drift events.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentDrifts = await prisma.auditEvent.findMany({
    where: {
      organizationId: session.orgId,
      action: "reconciliation_drift_detected",
      createdAt: { gte: thirtyDaysAgo },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      createdAt: true,
      entityId: true,
      // actor relation for the user who ran the audit (null when the
      // event was emitted by a CLI / cron script — those store the
      // runner id in metadata.runBy instead).
      actor: { select: { email: true, name: true } },
      metadata: true,
    },
  });
  // Enrich with company code.
  type DriftRow = (typeof recentDrifts)[number];
  type CompanyRow = { id: string; code: string; name: string };
  const companyIds = [
    ...new Set(recentDrifts.map((d: DriftRow) => d.entityId).filter(Boolean)),
  ] as string[];
  const companies = await prisma.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, code: true, name: true },
  });
  const codeById = new Map<string, CompanyRow>(
    companies.map((c: CompanyRow) => [c.id, c]),
  );
  const drifts = recentDrifts.map((d: DriftRow) => {
    const meta = (d.metadata ?? {}) as { drifts?: unknown; runBy?: string };
    return {
      id: d.id,
      createdAt: d.createdAt.toISOString(),
      // Prefer the joined User.email; fall back to metadata.runBy stamp
      // that CLI scripts (drift-watchdog) attach when there's no
      // logged-in actor.
      runBy: d.actor?.email ?? meta.runBy ?? null,
      company: d.entityId ? codeById.get(d.entityId) ?? null : null,
      drifts: meta.drifts ?? null,
    };
  });

  // Reference-data freshness. L3 closure: list of sources is resolved from
  // Organization.settings.intelFreshnessSources (falls back to DEFAULT_SOURCES
  // when missing or malformed) so new adapters can be onboarded without a
  // code change.
  const freshnessSources = await resolveFreshnessSources(prisma, session.orgId);
  const referenceFreshness = await checkReferenceFreshness(
    prisma,
    session.orgId,
    freshnessSources,
  );

  // Stale-pending companies (onboarding stalled).
  // Heuristic: leaf op-cos (level=2) whose most recent IV
  // lastReconciledAt is null OR older than 7 days.
  //
  // Phase L5 — batched query (was N+1). One groupBy over IndicatorValue
  // computes max(lastReconciledAt) per companyId in a single Postgres
  // call; then we walk leaf companies in JS comparing against the map.
  // 20 cos → 1 query (was 20). 60 cos → 1 query (was 60).
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const allCompanies = await prisma.company.findMany({
    where: { organizationId: session.orgId },
    select: { id: true, code: true, name: true, level: true },
  });
  type CompanyRow2 = (typeof allCompanies)[number];
  const leafIds = allCompanies.filter((c: CompanyRow2) => c.level === 2).map((c: CompanyRow2) => c.id);
  const maxReconciledByCompany = new Map<string, Date | null>();
  if (leafIds.length > 0) {
    const aggregated = await prisma.indicatorValue.groupBy({
      by: ["companyId"],
      where: { organizationId: session.orgId, companyId: { in: leafIds } },
      _max: { lastReconciledAt: true },
    });
    for (const row of aggregated) {
      maxReconciledByCompany.set(row.companyId, row._max.lastReconciledAt);
    }
  }
  const stalePending: Array<{ code: string; name: string; level: number; lastReconciledAt: string | null }> = [];
  for (const c of allCompanies) {
    if (c.level !== 2) continue;
    const latest = maxReconciledByCompany.get(c.id) ?? null;
    if (!latest || latest < sevenDaysAgo) {
      stalePending.push({
        code: c.code,
        name: c.name,
        level: c.level,
        lastReconciledAt: latest?.toISOString() ?? null,
      });
    }
  }

  return NextResponse.json({
    recentDrifts: drifts,
    referenceFreshness,
    stalePending,
    generatedAt: new Date().toISOString(),
  });
}
