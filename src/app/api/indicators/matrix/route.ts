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
import { filterOperationalCompanies } from '@/lib/risk/targets';

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
        },
        select: {
          id: true,
          code: true,
          nameEn: true,
          direction: true,
          unit: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    type CompanyRawShape = (typeof companiesRaw)[number];
    type IndicatorShape = (typeof indicators)[number];

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
    const indicatorIds = indicators.map((i: IndicatorShape) => i.id);

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

    const cells = values.map((v: ValueShape) => {
      const inputs = v.inputs as { error?: { code: string; reason: string } } | null;
      const error = inputs?.error;
      return {
        indicatorValueId: v.id,
        companyId: v.companyId,
        indicatorId: v.indicatorId,
        value: v.value,
        status: v.status as IndicatorStatus,
        ...(error ? { error } : {}),
      };
    });

    return NextResponse.json({
      period,
      companies,
      indicators,
      cells,
    });
  } catch (error) {
    console.error('Error building indicator matrix:', error);
    return NextResponse.json(
      { error: 'Failed to build matrix' },
      { status: 500 },
    );
  }
}
