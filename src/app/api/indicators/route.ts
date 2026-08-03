/**
 * Phase 7.A.0 — indicator definitions API + recompute trigger.
 *
 * GET:  list IndicatorDefinition rows visible to the caller's org (global
 *       seeds + org-specific overrides; org-specific wins on code collision).
 * POST: synchronously recompute IndicatorValue rows for a given period. Body
 *       is `{ period, companyId?, indicatorCode? }`:
 *         - all three   → single recompute
 *         - period+cId  → all industry-matching indicators for that company
 *         - period only → every operational company × its industry's indicators
 *       Replaces the 2026-04-23 stub that only console-logged a fake job id.
 *       Still synchronous — proper BullMQ / cron scheduling is Phase 6 work.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireRole, isAuthError } from '@/lib/api-auth';
import {
  createPrismaDataSource,
  recomputeIndicator,
  type IndicatorDefinitionLike,
} from '@/lib/risk/recompute';
import {
  filterOperationalCompanies,
  isRollupIndicator,
  preferOrgScopedDefinitions,
} from '@/lib/risk/targets';
import {
  loadPairApplicabilityResolver,
  matchApplicablePairs,
} from '@/lib/risk/pair-applicability';
import { enqueue as enqueueRecomputeJob } from '@/lib/recompute/job-runner';
// Phase 5.2 Stage 2 (2026-05-21) — RLS wrap for GET + POST sync paths.
// Async (BullMQ) path runs in the worker process; wrap inside the
// processor instead — tracked as ROADMAP Phase 8 §D5(b).
import { withOrgScope } from '@/lib/db/with-org-scope';
import { getLogger } from '@/lib/log';
import type { Prisma, PrismaClient } from '@prisma/client';

const logger = getLogger('api:indicators');

// Phase 6.1 — sync vs async threshold. Targets ≤ this run synchronously
// in the request handler (drill-down style: single cell, instant feedback).
// Larger fan-outs are enqueued via the in-process job runner — POST returns
// 202 + jobId; client polls GET /api/recompute/jobs/[jobId] for status.
// The old 500 cap is gone — async path has no fan-out limit.
const SYNC_THRESHOLD = 50;

function serverlessSyncRecomputeEnabled(): boolean {
  return process.env.SERVERLESS_SYNC_RECOMPUTE === 'true';
}

// Keep the route compatible with the Cloud Run request timeout used by the
// scale-to-zero deployment. Large fan-outs run inline there so the platform
// cannot freeze an unfinished setImmediate worker after the response.
export const maxDuration = 900;

// Phase 5.2 Stage 2 (2026-05-21) — resolveTargets accepts an optional
// `db` argument so callers wrapped in `withOrgScope` can pass the tx
// (preserves the SET LOCAL session var across both queries). When `db`
// is omitted, falls back to the global `prisma` — keeps existing
// internal callers working unchanged.
async function resolveTargets(
  organizationId: string,
  filter: { companyId?: string; indicatorCode?: string },
  db: PrismaClient | Prisma.TransactionClient = prisma,
) {
  const companies = await db.company.findMany({
    where: {
      organizationId,
      isActive: true,
      ...(filter.companyId ? { id: filter.companyId } : {}),
    },
    select: {
      id: true,
      code: true,
      industry: true,
      level: true,
      isActive: true,
      role: true,
    },
  });
  const operational = filterOperationalCompanies(companies);

  const allDefs = await db.indicatorDefinition.findMany({
    where: {
      isActive: true,
      OR: [{ organizationId: null }, { organizationId }],
      ...(filter.indicatorCode ? { code: filter.indicatorCode } : {}),
    },
    select: {
      id: true,
      organizationId: true,
      code: true,
      formula: true,
      sparklineFormula: true,
      thresholds: true,
      requiredInputs: true,
      industries: true,
      isActive: true,
      unit: true,
      // Phase 7.H F4.v2.1 — provenance default needed by recompute to
      // stamp every IV; without this select, the field becomes
      // `undefined` on the `definition` object and the runner falls
      // back to `computed`, mis-tagging modeled-generic ESG IVs as
      // real measurements.
      defaultValueSource: true,
      aggregation: true, // 2026-05-31 — snapshot/flow → ctx.aggregation
    },
  });
  // Inline prefer-org-scoped + match — keeping Prisma's full row types.
  // Generic inference in `preferOrgScopedDefinitions` / `matchCompaniesToIndicators`
  // widens to `IndicatorForMatch` and drops `formula`/`thresholds`/`requiredInputs`,
  // which we need below. The pure logic is unit-tested separately in
  // `targets.test.ts` against narrow shapes.
  const byCode = new Map<string, (typeof allDefs)[number]>();
  for (const d of allDefs) {
    const cur = byCode.get(d.code);
    if (!cur || (cur.organizationId === null && d.organizationId !== null)) {
      byCode.set(d.code, d);
    }
  }
  // This endpoint's target universe is operational level-2 companies.
  // rollup()-bearing definitions are structurally parent-only and are
  // refreshed by the canonical import trigger's parent pass instead.
  const defs = [...byCode.values()].filter(
    (definition) => !isRollupIndicator(definition),
  );

  const pairApplicability = await loadPairApplicabilityResolver(db, {
    organizationId,
    companies: operational,
    definitions: defs,
  });
  return matchApplicablePairs(operational, defs, pairApplicability);
}

// --- GET: list indicator definitions scoped to caller's org ------------------

export async function GET(request: NextRequest) {
  const session = await requireAuth(request);
  if (isAuthError(session)) return session;
  // defense-in-depth; getSession already filters empty orgId → null → 401
  if (!session.orgId) {
    return NextResponse.json({ error: 'User has no organization' }, { status: 403 });
  }

  try {
    // Phase 5.2 Stage 2 — wrap so indicator_definitions RLS policy
    // (nullable-aware variant — global seeds + org overrides) sees
    // app.organization_id once enabled.
    return await withOrgScope(session.orgId, async (tx) => {
      // Phase 8 F1 (2026-05-29) — scope the catalog to the org's ACTIVE
      // industries (derived from its companies). Multi-org-safe + query-time:
      // the seed catalog holds every industry's indicators (110 today) so the
      // platform stays multi-tenant, but a given org should only SEE the
      // subset relevant to the sectors it actually operates in (AZSEKER:
      // agro / processing / … → its relevant set, not the hospitality / pharma
      // / construction defs). Universal indicators (empty `industries`) always
      // pass. A global `isActive=false` on the irrelevant defs would have been
      // WRONG — it'd hide them from a future hospitality/pharma org too.
      const orgCompanies = await tx.company.findMany({
        where: { organizationId: session.orgId, industry: { not: null } },
        select: { industry: true },
        distinct: ['industry'],
      });
      const orgIndustries = orgCompanies
        .map((c) => c.industry)
        .filter((x): x is string => x != null && x.length > 0);

      // UI list view — omit heavy implementation fields (formula, thresholds,
      // requiredInputs, sparklineFormula, hintTemplates). Detail endpoint can
      // hydrate the rest when we add one.
      const indicators = await tx.indicatorDefinition.findMany({
        where: {
          isActive: true,
          OR: [{ organizationId: null }, { organizationId: session.orgId }],
        },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          organizationId: true,
          isActive: true,
          code: true,
          nameEn: true,
          nameAz: true,
          nameRu: true,
          category: true,
          industries: true,
          unit: true,
          direction: true,
          sortOrder: true,
        },
      });
      // Resolve a same-code tenant override before applying activity scope.
      // Filtering in SQL first can discard a non-matching tenant override and
      // incorrectly resurrect its matching global seed.
      const orgIndustrySet = new Set(orgIndustries);
      const scopedIndicators = preferOrgScopedDefinitions(indicators).filter(
        (indicator) =>
          indicator.industries.length === 0 ||
          indicator.industries.some((industry) =>
            orgIndustrySet.has(industry),
          ),
      );
      // `isActive` is selected only to satisfy the canonical definition
      // preference shape; the public lightweight catalog contract omits it.
      return NextResponse.json(
        scopedIndicators.map(({ isActive: _isActive, ...indicator }) =>
          indicator,
        ),
      );
    });
  } catch (error) {
    logger.error('fetch indicators failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to fetch indicators' },
      { status: 500 },
    );
  }
}

// --- POST: synchronous recompute ---------------------------------------------

export async function POST(request: NextRequest) {
  // `manager`: recompute touches 1–500 IndicatorValue rows and feeds board-
  // level risk views. Matches the auth level of other holding-wide write
  // endpoints (company create, plan create/apply-templates).
  const session = await requireRole(request, 'manager');
  if (isAuthError(session)) return session;
  // defense-in-depth; getSession already filters empty orgId → null → 401
  if (!session.orgId) {
    return NextResponse.json({ error: 'User has no organization' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const period = typeof body.period === 'string' ? body.period : undefined;
  const companyId = typeof body.companyId === 'string' ? body.companyId : undefined;
  const indicatorCode =
    typeof body.indicatorCode === 'string' ? body.indicatorCode : undefined;

  if (!period) {
    return NextResponse.json(
      { error: 'period is required (e.g. "2026-04")' },
      { status: 400 },
    );
  }

  let targets: Awaited<ReturnType<typeof resolveTargets>>;
  try {
    // Target resolution includes CompanyIndicator and therefore belongs in
    // the same org-scoped read boundary as the company/definition lookups.
    targets = await withOrgScope(session.orgId, (tx) =>
      resolveTargets(
        session.orgId,
        { companyId, indicatorCode },
        tx,
      ),
    );
  } catch (error) {
    logger.error('resolve recompute targets failed', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: 'Failed to resolve targets' },
      { status: 500 },
    );
  }

  if (targets.length === 0) {
    return NextResponse.json(
      {
        period,
        processed: 0,
        ok: 0,
        unknown: 0,
        error: 0,
        results: [],
        message:
          'No (company, indicator) targets matched the filter. Check companyId, indicatorCode, and that the company has level=2 + an industry set.',
      },
      { status: 200 },
    );
  }

  // Phase 8 D5(a) (2026-05-28) — `ds` is now per-path:
  //   - Async fan-out (≥SYNC_THRESHOLD): uses the global prisma (worker
  //     process wraps its own withOrgScope inside the processor —
  //     §D5(b) is the follow-up that ships that wrap).
  //   - Sync drill-down (<SYNC_THRESHOLD): the loop is wrapped in
  //     withOrgScope below, and a tx-bound `ds` is built inside.
  // The async branch above still references this top-level `ds`.
  const ds = createPrismaDataSource(prisma);
  type Outcome = {
    companyId: string;
    companyCode: string;
    indicatorId: string;
    indicatorCode: string;
    status: string;
    value?: number;
    error?: string;
  };

  // Phase 7.E phase 2 — opt in to inline sparkline computation only when
  // the request is a single (company, indicator) recompute (UI drill-down,
  // ~91ms). Bulk paths (period-only fan-out, single-company multi-indicator)
  // stay sparkline-free to fit the 60s function budget — the offline
  // `scripts/compute-sparklines.ts` worker is the canonical refresher there.
  const withSparkline = Boolean(companyId && indicatorCode);

  // Phase 6.1 — async path for large fan-outs. Returns 202 + jobId; the
  // client polls /api/recompute/jobs/[jobId] for progress. No more 413
  // ceiling — workloads of 5000+ pairs are now safe.
  const runLargeFanoutInline = serverlessSyncRecomputeEnabled();
  if (targets.length > SYNC_THRESHOLD && !runLargeFanoutInline) {
    const orgId = session.orgId;
    // Phase 6 (2026-05-21) — BullMQ-backed path. Activates only when
    // QUEUE_BACKEND=bullmq AND a worker process is running. Defaults
    // to inprocess so the legacy job-runner stays the production
    // hot-path until the worker daemon is rolled out.
    const { isBullMqEnabled } = await import("@/lib/queue/feature-flag");
    if (isBullMqEnabled()) {
      const { enqueueRecomputeBatch } = await import("@/lib/queue/queues");
      // Derive year from period — supports "2026" / "2026-04" / "2026-Q2"
      const periodYear = parseInt(period.slice(0, 4), 10);
      const queueJobId = await enqueueRecomputeBatch({
        organizationId: orgId,
        targets: targets.map((t) => ({ companyId: t.company.id, year: periodYear })),
        actorUserId: session.userId,
        reason: "POST /api/indicators (async fan-out)",
      });
      return NextResponse.json(
        {
          async: true,
          jobId: queueJobId,
          backend: "bullmq",
          period,
          total: targets.length,
          statusUrl: `/api/queue/jobs/${queueJobId}`,
        },
        { status: 202 },
      );
    }
    const job = enqueueRecomputeJob(orgId, targets.length, async (state, report) => {
      let processed = 0;
      for (const { company, definition } of targets) {
        const defLike: IndicatorDefinitionLike = {
          id: definition.id,
          code: definition.code,
          formula: definition.formula,
          sparklineFormula: definition.sparklineFormula,
          thresholds: definition.thresholds,
          requiredInputs: definition.requiredInputs,
          unit: definition.unit,
          aggregation: definition.aggregation, // 2026-05-31 — snapshot/flow
          defaultValueSource: definition.defaultValueSource as unknown as IndicatorDefinitionLike["defaultValueSource"],
        };
        let outcome: Outcome;
        try {
          const r = await recomputeIndicator(ds, {
            organizationId: orgId,
            companyId: company.id,
            definition: defLike,
            period,
            withSparkline,
            industry: company.industry ?? null,
          });
          outcome = {
            companyId: company.id,
            companyCode: company.code,
            indicatorId: definition.id,
            indicatorCode: definition.code,
            status: r.status,
            value: r.value,
          };
        } catch (err) {
          logger.error('recompute pair failed', {
            companyCode: company.code,
            indicatorCode: definition.code,
            reason: err instanceof Error ? err.message : String(err),
          });
          outcome = {
            companyId: company.id,
            companyCode: company.code,
            indicatorId: definition.id,
            indicatorCode: definition.code,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          };
        }
        processed += 1;
        report({
          processed,
          total: targets.length,
          result: {
            companyCode: outcome.companyCode,
            indicatorCode: outcome.indicatorCode,
            status: outcome.status === 'error' ? 'error' : outcome.status === 'unknown' ? 'unknown' : 'ok',
            error: outcome.error,
          },
        });
      }
      void state;
    });
    return NextResponse.json(
      {
        async: true,
        jobId: job.jobId,
        period,
        total: targets.length,
        statusUrl: `/api/recompute/jobs/${job.jobId}`,
      },
      { status: 202 },
    );
  }

  // Sync path — small fan-outs (drill-down style, ≤ SYNC_THRESHOLD pairs).
  //
  // Phase 8 D5(a) (2026-05-28) — sync recompute path RLS wrap shipped.
  // The whole loop runs inside `withOrgScope(session.orgId, ...)` so every
  // resolver read (`booking.findMany`, `budgetLine.findMany`, etc.) and
  // every write (`indicatorValue.upsert`) picks up the `app.organization_id`
  // Postgres session var. createPrismaDataSource accepts the tx now
  // (Phase 8 D5(a) — Prisma.TransactionClient union).
  //
  // Caveat: a single per-pair Prisma error doesn't abort the tx because
  // each `recomputeIndicator` call has its own try/catch. If a hard tx
  // abort fires (e.g. lock timeout), the whole batch rolls back — that's
  // a behavioural change vs the pre-D5(a) per-call rollback model, but
  // matches the safer "all-or-nothing per drill-down" RLS contract.
  const results: Outcome[] = await withOrgScope(session.orgId, async (tx) => {
    const txDs = createPrismaDataSource(tx);
    const localResults: Outcome[] = [];
    for (const { company, definition } of targets) {
      const defLike: IndicatorDefinitionLike = {
        id: definition.id,
        code: definition.code,
        formula: definition.formula,
        sparklineFormula: definition.sparklineFormula,
        thresholds: definition.thresholds,
        requiredInputs: definition.requiredInputs,
        unit: definition.unit,
        aggregation: definition.aggregation, // 2026-05-31 — snapshot/flow
        defaultValueSource: definition.defaultValueSource as unknown as IndicatorDefinitionLike["defaultValueSource"],
      };
      try {
        const r = await recomputeIndicator(txDs, {
          organizationId: session.orgId,
          companyId: company.id,
          definition: defLike,
          period,
          withSparkline,
          industry: company.industry ?? null,
        });
        localResults.push({
          companyId: company.id,
          companyCode: company.code,
          indicatorId: definition.id,
          indicatorCode: definition.code,
          status: r.status,
          value: r.value,
        });
      } catch (err) {
        // Pipeline errors never abort the batch — log + record + continue.
        logger.error('recompute batch item failed', {
          companyCode: company.code,
          indicatorCode: definition.code,
          reason: err instanceof Error ? err.message : String(err),
        });
        localResults.push({
          companyId: company.id,
          companyCode: company.code,
          indicatorId: definition.id,
          indicatorCode: definition.code,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return localResults;
  }, runLargeFanoutInline
    ? { timeoutMs: 10 * 60 * 1000, maxWaitMs: 10_000 }
    : undefined);

  const ok = results.filter((r) =>
    ['green', 'amber', 'red'].includes(r.status),
  ).length;
  const unknown = results.filter((r) => r.status === 'unknown').length;
  const error = results.filter((r) => r.status === 'error').length;

  return NextResponse.json(
    { period, processed: results.length, ok, unknown, error, results },
    { status: 200 },
  );
}
