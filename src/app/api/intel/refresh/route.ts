/**
 * Phase 7.G Turn XLIII (Phase D.2) — admin-triggered AI Web Crawler refresh.
 *
 * POST /api/intel/refresh
 *
 * Auth: `requireRole('admin')` — only org admins can fan out an LLM
 * call that costs ~$0.05 + 5 web_search uses. Phase D.5's BullMQ
 * recurring worker lands on top of this for the daily schedule; this
 * endpoint is the on-demand override.
 *
 * Rate limit: 1×/15min keyed by `organizationId` (org-wide, NOT per
 * admin) — multiple admins share the budget so a button-spam by one
 * doesn't compound. Hourly auto-refresh ceiling = 4 ×/hour org-wide
 * worst case + the daily Phase D.5 cron.
 *
 * Flow: validate auth + rate limit → fetch caller's org's active
 * companies (`code` + `industry`) → derive distinct industries[] +
 * companyCodes[] → `runIntelCrawl()` → audit `intel_crawl_run` →
 * return counters + durationMs.
 *
 * 503 if `ANTHROPIC_API_KEY` not set.
 * 401/403 from `requireRole`.
 * 429 from `enforceRateLimit`.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, isAuthError } from "@/lib/api-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { hasAnthropicKey } from "@/lib/ai/client";
import { logAuditEvent, buildAuditContext } from "@/lib/audit/log";
import { runIntelCrawl } from "@/lib/intel/crawler";

export const maxDuration = 120;
export const runtime = "nodejs";

const RATE_LIMIT = {
  name: "intel-refresh",
  // 1 call per 15 minutes per organization — sized so two concurrent
  // admin clicks don't double-bill, and the BullMQ daily worker
  // (Phase D.5) won't collide with on-demand refreshes.
  max: 1,
  windowMs: 15 * 60_000,
};

export async function POST(request: NextRequest) {
  if (!hasAnthropicKey()) {
    return NextResponse.json(
      {
        error:
          "AI Web Crawler unavailable: ANTHROPIC_API_KEY not configured on this deployment.",
      },
      { status: 503 },
    );
  }

  const session = await requireRole(request, "admin");
  if (isAuthError(session)) return session;
  const orgId = session.orgId;
  if (!orgId) {
    return NextResponse.json(
      { error: "User has no organization" },
      { status: 403 },
    );
  }

  // Rate-limit identity = orgId only (not per-user). Two admins sharing
  // the org share the budget. Phase D.5 BullMQ schedule runs in a
  // separate process, identified by org regardless of caller.
  const rateLimitError = enforceRateLimit(orgId, RATE_LIMIT);
  if (rateLimitError) return rateLimitError;

  const companies: Array<{ code: string; industry: string | null }> =
    await prisma.company.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { code: true, industry: true },
    });

  // Distinct, non-null derivations. Set preserves insertion order for
  // industries (irrelevant — the LLM doesn't depend on order — but
  // makes the audit metadata deterministic for tests).
  const industries: string[] = Array.from(
    new Set(
      companies
        .map((c) => c.industry)
        .filter((i): i is string => i !== null && i !== ""),
    ),
  );
  const companyCodes: string[] = Array.from(
    new Set(
      companies
        .map((c) => c.code)
        .filter((c): c is string => typeof c === "string" && c !== ""),
    ),
  );

  const startedAt = Date.now();
  const result = await runIntelCrawl({
    organizationId: orgId,
    industries,
    companyCodes,
  });
  const durationMs = Date.now() - startedAt;

  // Audit emission is non-blocking — same pattern as variance-explainer
  // route. Compliance trail records WHO ran the crawl, against WHICH
  // org context, WHAT counters resulted, on WHICH model. Errors-count
  // is included so reviewers can drill into IntelItem rows when ≠ 0.
  void logAuditEvent(prisma, {
    organizationId: orgId,
    actorUserId: session.userId,
    event: {
      action: "intel_crawl_run",
      entityType: "Organization",
      entityId: orgId,
      metadata: {
        industriesCount: industries.length,
        companyCodesCount: companyCodes.length,
        itemsFetched: result.itemsFetched,
        itemsCreated: result.itemsCreated,
        itemsSkipped: result.itemsSkipped,
        durationMs,
        tokensIn: result.usage?.inputTokens ?? 0,
        tokensOut: result.usage?.outputTokens ?? 0,
        modelName: result.modelName ?? "unknown",
        promptVersion: result.promptVersion ?? "unknown",
        errorsCount: result.errors.length,
      },
    },
    context: buildAuditContext({
      route: "/api/intel/refresh",
      userAgent: request.headers.get("user-agent") ?? undefined,
    }),
  }).catch((err) => {
    console.error("[intel/refresh] audit emission failed (non-blocking):", err);
  });

  return NextResponse.json(
    { ...result, durationMs },
    {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
