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
import { filterOperationalCompanies } from '@/lib/risk/targets';

// Hand off to Phase-6 BullMQ when recompute fan-out exceeds this. 500 covers a
// realistic 60-company × 9-indicator holding-wide refresh (~540 pairs typical
// today, architect-raised from the initial 100 which would 413 most real
// period-only calls). At ~4 Prisma reads + 1 write per pair, 500 fits into the
// 60s function window set via `export const maxDuration`.
const MAX_TARGETS_PER_REQUEST = 500;

// Next.js/Vercel function budget. Default is 10s on Hobby and 30s on Pro,
// which is tight for 500 × 5 Prisma calls even on warm connections. Lift
// explicitly so period-only recomputes don't time out half-way through a
// batch and leave IndicatorValue rows in an inconsistent state.
export const maxDuration = 60;

async function resolveTargets(
  organizationId: string,
  filter: { companyId?: string; indicatorCode?: string },
) {
  const companies = await prisma.company.findMany({
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

  const allDefs = await prisma.indicatorDefinition.findMany({
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
  const defs = [...byCode.values()];

  const targets: Array<{
    company: (typeof operational)[number];
    definition: (typeof defs)[number];
  }> = [];
  for (const company of operational) {
    for (const def of defs) {
      if (
        def.industries.length === 0 ||
        def.industries.includes(company.industry)
      ) {
        targets.push({ company, definition: def });
      }
    }
  }
  return targets;
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
    // UI list view — omit heavy implementation fields (formula, thresholds,
    // requiredInputs, sparklineFormula, hintTemplates). Detail endpoint can
    // hydrate the rest when we add one.
    const indicators = await prisma.indicatorDefinition.findMany({
      where: {
        isActive: true,
        OR: [{ organizationId: null }, { organizationId: session.orgId }],
      },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        organizationId: true,
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
    return NextResponse.json(indicators);
  } catch (error) {
    console.error('Error fetching indicators:', error);
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
    targets = await resolveTargets(session.orgId, { companyId, indicatorCode });
  } catch (error) {
    console.error('Failed to resolve recompute targets:', error);
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

  if (targets.length > MAX_TARGETS_PER_REQUEST) {
    return NextResponse.json(
      {
        error: `Recompute fan-out too large (${targets.length} pairs, max ${MAX_TARGETS_PER_REQUEST}). Narrow with companyId or indicatorCode, or wait for the Phase-6 background queue.`,
      },
      { status: 413 },
    );
  }

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
  const results: Outcome[] = [];

  // Phase 7.E phase 2 — opt in to inline sparkline computation only when
  // the request is a single (company, indicator) recompute (UI drill-down,
  // ~91ms). Bulk paths (period-only fan-out, single-company multi-indicator)
  // stay sparkline-free to fit the 60s function budget — the offline
  // `scripts/compute-sparklines.ts` worker is the canonical refresher there.
  const withSparkline = Boolean(companyId && indicatorCode);

  for (const { company, definition } of targets) {
    const defLike: IndicatorDefinitionLike = {
      id: definition.id,
      code: definition.code,
      formula: definition.formula,
      sparklineFormula: definition.sparklineFormula,
      thresholds: definition.thresholds,
      requiredInputs: definition.requiredInputs,
      unit: definition.unit,
    };
    try {
      const r = await recomputeIndicator(ds, {
        organizationId: session.orgId,
        companyId: company.id,
        definition: defLike,
        period,
        withSparkline,
      });
      results.push({
        companyId: company.id,
        companyCode: company.code,
        indicatorId: definition.id,
        indicatorCode: definition.code,
        status: r.status,
        value: r.value,
      });
    } catch (err) {
      // Pipeline errors never abort the batch — log + record + continue.
      console.error(
        `Recompute failed for ${company.code}/${definition.code}:`,
        err,
      );
      results.push({
        companyId: company.id,
        companyCode: company.code,
        indicatorId: definition.id,
        indicatorCode: definition.code,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

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
