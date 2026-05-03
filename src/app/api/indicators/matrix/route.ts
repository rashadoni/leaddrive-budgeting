/**
 * Phase 7.A.0 — matrix feed for the HeatMap panel.
 *
 * GET /api/indicators/matrix?period=YYYY-MM | YYYY
 *
 * **Default period (Turn 16 fix):** `YYYY` (annual) — the recompute
 * pipeline writes IndicatorValue rows under `period: String(year)`
 * (annual), not under monthly periods. Earlier the default was
 * `currentMonthString()` (`YYYY-MM`) which silently mismatched all
 * pipeline-written rows and showed users stale orphan-monthly data
 * left over from prior recompute attempts. Confirmed in Turn 16
 * browser audit — terminal showed 15 cells (all from leftover
 * `2026-04` rows) instead of the real 36 annual cells.
 *
 * Response shape:
 *   {
 *     period,
 *     companies: Array<{ id, code, name, industry, role }>, operational only;
 *                  `role` is always 'operational' here (admin/holding are
 *                  filtered out server-side) but surfaced explicitly so the
 *                  UI can later render a "scoring exempt" badge if the
 *                  filter is relaxed (e.g. a holding-tree view that
 *                  intentionally includes admin entities greyed-out).
 *     indicators: Array<{ id, code, nameEn, direction, unit }>, active, ordered
 *     cells: Array<{ companyId, indicatorId, value, status }>  sparse
 *   }
 *
 * Keeps the payload compact — cells missing from the response are rendered
 * as "missing" by the client, no fabricated rows. Companies are level=2
 * operational entities only (sub-groups have no indicators).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isAuthError } from '@/lib/api-auth';
import type { IndicatorStatus } from '@/lib/risk/formula-engine';
import { parsePeriod, PeriodParseError } from '@/lib/risk/periods';
import { filterOperationalCompanies, isRollupIndicator } from '@/lib/risk/targets';

function defaultPeriodString(): string {
  // Annual period — matches what the recompute pipeline writes
  // (`period: String(year)` in `recompute-trigger.ts`). Callers wanting
  // monthly granularity must pass `?period=YYYY-MM` explicitly.
  return String(new Date().getUTCFullYear());
}

export async function GET(request: NextRequest) {
  const session = await requireAuth(request);
  if (isAuthError(session)) return session;
  // defense-in-depth; getSession already filters empty orgId → null → 401
  if (!session.orgId) {
    return NextResponse.json(
      { error: 'User has no organization' },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const rawPeriod = searchParams.get('period') ?? defaultPeriodString();

  // Validate the period string before trusting it in a query — guards both
  // against garbage input and against `../../`-style path probing hitting the
  // column as-is.
  try {
    parsePeriod(rawPeriod);
  } catch (err) {
    if (err instanceof PeriodParseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  const period = rawPeriod;

  try {
    // Load companies + indicators first, then fetch only the IndicatorValue
    // rows scoped to their ids — avoids pulling orphan values for disabled
    // companies / retired indicators even though tenant scoping would keep
    // them inside the org.
    const [companiesRaw, indicators] = await Promise.all([
      prisma.company.findMany({
        where: { organizationId: session.orgId, isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          industry: true,
          level: true,
          // `isActive` is redundant with the WHERE clause but the
          // shared `filterOperationalCompanies` helper requires it on
          // the row shape (compile-time enforcement of "every Phase 7.E
          // role-aware filter sees the same columns").
          isActive: true,
          // Phase 7.E — admin / holding cost-centres are excluded from
          // the operational matrix so OpEx ratios on a pure HQ entity
          // don't false-red the holding view.
          role: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.indicatorDefinition.findMany({
        where: {
          isActive: true,
          OR: [{ organizationId: null }, { organizationId: session.orgId }],
          // Sub-44 cont'd render-path closure: keep internal-only filter
          // OUT of the SQL where-clause now and apply in JS below. Reason:
          // we want to ALSO include rollup-bearing internal indicators
          // (e.g. IND_HOLDING_REVENUE) so their parent-co IVs become a
          // visible column. Prisma's String[].has matches exact strings
          // not prefixes, so we can't filter `requiredInputs` containing
          // `'rollup:...'` at the SQL level — post-fetch JS filter is the
          // pragmatic alternative (catalog is ~52 rows, perf is non-issue).
        },
        select: {
          id: true,
          code: true,
          nameEn: true,
          nameAz: true,
          nameRu: true,
          direction: true,
          unit: true,
          sortOrder: true,
          // Sub-44 cont'd — needed for the rollup-bearing-internals
          // post-fetch filter below.
          category: true,
          requiredInputs: true,
        },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    // Sub-44 cont'd render-path closure: post-fetch filter — keep
    // (a) all non-internal indicators (the original gate) PLUS
    // (b) rollup-bearing internal indicators (so their parent-co IVs
    // surface as visible columns). The two-step filter replaces the
    // SQL `category: { not: 'internal' }` with a more nuanced predicate.
    type RawIndicatorShape = (typeof indicators)[number] & {
      category: string | null;
      requiredInputs: string[];
    };
    const indicatorsTyped = indicators as RawIndicatorShape[];
    const rollupBearingInternalIds = new Set<string>();
    const visibleIndicators = indicatorsTyped.filter((ind) => {
      if (ind.category !== 'internal') return true;
      // Internal-category — keep ONLY if rollup-bearing (parent-co IVs
      // give it visible meaning at the holding-level row).
      if (isRollupIndicator(ind)) {
        rollupBearingInternalIds.add(ind.id);
        return true;
      }
      return false;
    });
    // Re-bind so downstream code uses the filtered list. Original
    // variable name kept (`indicators`) to minimize churn.
    const indicatorsForRender = visibleIndicators;

    type CompanyRawShape = (typeof companiesRaw)[number];
    type IndicatorShape = (typeof indicatorsForRender)[number];

    // Phase 7.E hardening (Turn 10): use the shared
    // `filterOperationalCompanies` helper instead of a hand-rolled
    // predicate. The generic preserves `name` / `sortOrder` on the
    // returned rows; any future role-taxonomy tweak (new role member,
    // changed industry rules) flows through `targets.ts` and lands in
    // the matrix automatically. The legacy `role == null` fallback was
    // removed — column is NOT NULL DEFAULT 'operational'. The explicit
    // type argument keeps the row's `name`/`sortOrder` on the returned
    // type — without it Prisma's deep result type can lose specificity
    // when handed to a generic.
    const operational =
      filterOperationalCompanies<CompanyRawShape>(companiesRaw);
    const operationalIds = operational.map((c) => c.id);
    const indicatorIds = indicatorsForRender.map((i: IndicatorShape) => i.id);

    const values =
      operationalIds.length === 0 || indicatorIds.length === 0
        ? []
        : await prisma.indicatorValue.findMany({
            where: {
              organizationId: session.orgId,
              period,
              companyId: { in: operationalIds },
              indicatorId: { in: indicatorIds },
            },
            select: {
              // `id` is the IndicatorValue primary key — Phase 7.D cell-
              // click → Variance Explainer routes through `id`, so the
              // matrix MUST surface it. Keep it stable across pages.
              id: true,
              companyId: true,
              indicatorId: true,
              value: true,
              status: true,
              // `inputs` is the full drill-down JSON; we only lift `error`
              // into the cell payload so a gray cell's tooltip can explain
              // the reason without a second API round-trip.
              inputs: true,
              // Phase B2 — 12-slot trailing-month sparkline series.
              // Populated by `scripts/compute-sparklines.ts`. Phase B3
              // renders this in HeatMap cell tooltip + IndicatorDetail.
              sparkline: true,
            },
          });

    type ValueShape = (typeof values)[number];

    const companies = operational.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      industry: c.industry,
      // Surfaced for UI badge support. Today this is always 'operational'
      // (the filter above guarantees it), but Phase 7.E plans a holding-tree
      // view that includes admin entities greyed-out — keeping the field
      // here means that change is one-line on the server.
      role: c.role,
    }));

    const cells = values
      .filter((v: ValueShape) => {
        // Sub-44 cont'd render-path closure: suppress op-co cells for
        // rollup-bearing internals (e.g. IND_HOLDING_REVENUE). On op-cos
        // the rollup() formula has no children → returns 0 → falls in
        // amber band. Showing this would give every op-co a misleading
        // amber column for a holding-level metric. Keep the IV in DB
        // (recompute pipeline still wrote it; deletion would cause a
        // re-run on next trigger) but skip emission for the operational
        // matrix render. Parent-co cells for these indicators ARE
        // emitted below (real IVs from the rollup() resolver).
        if (rollupBearingInternalIds.has(v.indicatorId)) return false;
        return true;
      })
      .map((v: ValueShape) => {
        const inputs = v.inputs as { error?: { code: string; reason: string } } | null;
        const error = inputs?.error;
        // sparkline column is `Json`; runtime shape is `(number | null)[]`
        // (per `prisma/schema.prisma:1059`). Treat anything non-array as
        // missing — IVs that pre-date Phase B2 have raw JSON `null` here.
        const sparklineRaw = v.sparkline;
        const sparkline = Array.isArray(sparklineRaw)
          ? (sparklineRaw as (number | null)[])
          : null;
        return {
          indicatorValueId: v.id,
          companyId: v.companyId,
          indicatorId: v.indicatorId,
          value: v.value,
          status: v.status as IndicatorStatus,
          ...(sparkline ? { sparkline } : {}),
          ...(error ? { error } : {}),
        };
      });

    // Turn 33.5 (Item 5 / Bug #7 slim rollup): include level=1 sub-groups
    // as additional rows with synthetic cells. Aggregation rules:
    //   - value: AVERAGE of children's cell values (rough but visually
    //     meaningful for ratio indicators which dominate the catalog)
    //   - status: worst-of (any red → red; else any amber → amber; else
    //     all-green → green) — matches "weakest-link" risk semantics
    //   - indicatorValueId: null (no persisted IV; click = drill-down NOT
    //     supported, IndicatorDetail handles null gracefully — see comment
    //     in IndicatorDetail.tsx)
    //   - isSubgroup: true (frontend can style differently)
    //
    // Sub-44 cont'd render-path: parent-co cells for rollup-bearing
    // indicators (sub-44 prereq #1 IVs) are now emitted as REAL cells
    // BELOW with `indicatorValueId` set + drill-down enabled. The Turn
    // 33.5 synthetic-average path stays for everything else; pairs that
    // get a real cell are excluded via `realParentCellKeys` (priority:
    // real IV > Turn 33.5 average).
    const subgroups = companiesRaw.filter((c: CompanyRawShape) => c.level === 1 && c.role === 'operational');
    const subgroupCompanies = subgroups.map((sg: CompanyRawShape) => ({
      id: sg.id,
      code: sg.code,
      name: sg.name,
      industry: sg.industry,
      role: sg.role,
      isSubgroup: true,
    }));

    // Build child-id → sub-group-id map. Children are operational level=2
    // companies whose parentCompanyId points to a sub-group's id.
    const childToSubgroup = new Map<string, string>();
    const subgroupIds = new Set(subgroups.map((s: CompanyRawShape) => s.id));
    const fullCompaniesRaw = await prisma.company.findMany({
      where: { organizationId: session.orgId, isActive: true, parentCompanyId: { in: Array.from(subgroupIds) } },
      select: { id: true, parentCompanyId: true },
    });
    for (const c of fullCompaniesRaw) {
      if (c.parentCompanyId) childToSubgroup.set(c.id, c.parentCompanyId);
    }

    // Sub-44 cont'd render-path closure: fetch parent-co (level=1) IVs
    // for any indicator (NOT just rollup-bearing — e.g. seed authors may
    // add operational-category indicators that fire on parent cos via
    // future formulas). Conditional: only if at least one sub-group exists
    // AND at least one indicator is in scope. Cost: one extra findMany,
    // bounded by `subgroupIds.size × indicatorIds.length`.
    const parentValues =
      subgroupIds.size === 0 || indicatorIds.length === 0
        ? []
        : await prisma.indicatorValue.findMany({
            where: {
              organizationId: session.orgId,
              period,
              companyId: { in: Array.from(subgroupIds) },
              indicatorId: { in: indicatorIds },
            },
            select: {
              id: true,
              companyId: true,
              indicatorId: true,
              value: true,
              status: true,
              inputs: true,
              sparkline: true,
            },
          });

    type ParentValueShape = (typeof parentValues)[number];
    const realParentCellKeys = new Set<string>();
    const parentCells = parentValues.map((v: ParentValueShape) => {
      realParentCellKeys.add(`${v.companyId}::${v.indicatorId}`);
      const inputs = v.inputs as { error?: { code: string; reason: string } } | null;
      const error = inputs?.error;
      const sparklineRaw = v.sparkline;
      const sparkline = Array.isArray(sparklineRaw)
        ? (sparklineRaw as (number | null)[])
        : null;
      return {
        indicatorValueId: v.id,
        companyId: v.companyId,
        indicatorId: v.indicatorId,
        value: v.value,
        status: v.status as IndicatorStatus,
        ...(sparkline ? { sparkline } : {}),
        ...(error ? { error } : {}),
        // Sub-44 cont'd architect 💡 closure — discriminated-union
        // `kind` field replaces the legacy `isRealParentRollup` boolean.
        // Distinguishes from synthetic averages (different drill-down
        // semantics: real IV is queryable, average is not). Gate
        // downstream via `isAggregateRollup(c)` helper.
        kind: 'real-rollup' as const,
      };
    });

    // Aggregate cells per (subgroupId, indicatorId) — Turn 33.5 synthetic
    // average. Sub-44 cont'd: skip pairs where a REAL parent IV exists
    // (priority lock: real IV > synthetic average; see `realParentCellKeys`
    // above). The ops-cell `cells` array already has rollup-bearing
    // internals filtered out, so they don't enter the average pool either.
    type AggBucket = { sum: number; count: number; statuses: Set<IndicatorStatus> };
    const aggMap = new Map<string, AggBucket>(); // key: `${sgId}::${indId}`
    for (const cell of cells) {
      const sgId = childToSubgroup.get(cell.companyId);
      if (!sgId) continue;
      const key = `${sgId}::${cell.indicatorId}`;
      // Sub-44 cont'd render-path: real parent IV beats synthetic average.
      if (realParentCellKeys.has(key)) continue;
      let bucket = aggMap.get(key);
      if (!bucket) {
        bucket = { sum: 0, count: 0, statuses: new Set() };
        aggMap.set(key, bucket);
      }
      bucket.sum += cell.value;
      bucket.count += 1;
      bucket.statuses.add(cell.status);
    }

    const worstStatus = (statuses: Set<IndicatorStatus>): IndicatorStatus => {
      if (statuses.has('red')) return 'red';
      if (statuses.has('amber')) return 'amber';
      if (statuses.has('green')) return 'green';
      return 'unknown';
    };

    const subgroupCells = Array.from(aggMap.entries()).map(([key, bucket]) => {
      const [sgId, indId] = key.split('::');
      return {
        indicatorValueId: null, // no persisted IV — synthetic rollup
        companyId: sgId,
        indicatorId: indId,
        value: bucket.sum / bucket.count, // simple average
        status: worstStatus(bucket.statuses),
        // Sub-44 cont'd architect 💡 closure — discriminated-union
        // `kind` field replaces the legacy `isSubgroupRollup` boolean.
        // Gate downstream via `isAggregateRollup(c)` helper.
        kind: 'synthetic-rollup' as const,
      };
    });

    return NextResponse.json({
      period,
      companies: [...companies, ...subgroupCompanies],
      indicators: indicatorsForRender,
      cells: [...cells, ...parentCells, ...subgroupCells],
    });
  } catch (error) {
    console.error('Error building indicator matrix:', error);
    return NextResponse.json(
      { error: 'Failed to build matrix' },
      { status: 500 },
    );
  }
}
