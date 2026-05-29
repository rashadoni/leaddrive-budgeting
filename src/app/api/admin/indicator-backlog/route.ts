/**
 * 2026-05-27 — GET /api/admin/indicator-backlog
 *
 * Returns per-entity readiness backlog (which indicators are missing,
 * who owns the data, what's needed) for the calling user's org.
 *
 * Query params:
 *   ?company=<code>   — filter to one entity (optional)
 *   ?period=<period>  — defaults to "2026"
 *
 * Auth: admin role required.
 *
 * Response shape: { companies: CompanyBacklog[], summary: BacklogSummary }
 * See @/lib/risk/indicator-backlog for full type definitions.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, isAuthError } from "@/lib/api-auth";
import { getLogger } from "@/lib/log";

// Phase 8 D4 final (2026-05-29) — structured logger.
const log = getLogger("api:admin:indicator-backlog");
import { computeIndicatorBacklog } from "@/lib/risk/indicator-backlog";

export async function GET(request: NextRequest) {
  const session = await requireRole(request, "admin");
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const companyCode = searchParams.get("company") ?? undefined;
  const period = searchParams.get("period") ?? "2026";

  try {
    const result = await computeIndicatorBacklog(prisma, session.orgId, {
      companyCode,
      period,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (err) {
    log.error("backlog computation failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Failed to compute backlog" },
      { status: 500 },
    );
  }
}
