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
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, isAuthError } from "@/lib/api-auth";
import { checkReferenceFreshness } from "@/lib/intel/freshness";

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

  // Reference-data freshness.
  const referenceFreshness = await checkReferenceFreshness(prisma, session.orgId);

  // Stale-pending companies (onboarding stalled).
  // Heuristic: companies that have IVs but the most recent
  // lastReconciledAt is null OR older than 7 days.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const allCompanies = await prisma.company.findMany({
    where: { organizationId: session.orgId },
    select: { id: true, code: true, name: true, level: true },
  });
  const stalePending: Array<{ code: string; name: string; level: number; lastReconciledAt: string | null }> = [];
  for (const c of allCompanies) {
    if (c.level !== 2) continue; // only check leaf op-cos
    const latestIv = await prisma.indicatorValue.findFirst({
      where: { companyId: c.id },
      orderBy: { lastReconciledAt: "desc" },
      select: { lastReconciledAt: true },
    });
    if (!latestIv || !latestIv.lastReconciledAt || latestIv.lastReconciledAt < sevenDaysAgo) {
      stalePending.push({
        code: c.code,
        name: c.name,
        level: c.level,
        lastReconciledAt: latestIv?.lastReconciledAt?.toISOString() ?? null,
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
