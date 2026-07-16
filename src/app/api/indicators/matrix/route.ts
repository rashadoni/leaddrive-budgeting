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
import { getLogger } from '@/lib/log';

// Phase 8 D4 continuation (2026-05-28) — structured logger.
const log = getLogger('api:indicators-matrix');
// Phase 5.2 Stage 2 (2026-05-21) — RLS wrap. Every Prisma call below
// runs through `tx` so when indicator_values RLS migration applies,
// rows are filtered by `app.organization_id` at the DB layer rather
// than relying on the JS-side WHERE clauses below. The WHERE clauses
// stay as a defence-in-depth narrowing (companyIds + period etc.) —
// they're not removed, just no longer the sole protection.
import { withOrgScope } from '@/lib/db/with-org-scope';
import type { IndicatorStatus } from '@/lib/risk/formula-engine';
import { currentBakuYearNumber, headlinePeriod, parsePeriod, PeriodParseError } from '@/lib/risk/periods';
import type { Prisma } from '@prisma/client';
import { filterOperationalCompanies, isRollupIndicator } from '@/lib/risk/targets';
import { getCompanyScope } from '@/lib/rbac/company-scope';
import {
  getMateriality,
  isMaterialityScoped,
} from '@/lib/risk/esg-materiality';
import { deriveSignalConfidence } from '@/lib/risk/heatmap-matrix';
import { getCompanyReadiness } from '@/lib/server/get-company-readiness';

/**
 * Data-aware default period (no `?period=` given) — the latest COMPLETE fiscal
 * year that ACTUALLY HAS data for this org, else the latest year that does.
 *
 * Why not a static `headlinePeriod()`: a financial terminal should open on the
 * last full year (e.g. 2025, where EDEN's EBITDA is the defensible 28%, not the
 * partial-2026 169.8% false-green). But it must NEVER default to an EMPTY year —
 * a deployment whose DB only carries the in-progress year (e.g. prod before the
 * historical 2023–25 import runs) would otherwise open on a blank grid. So we
 * pick the newest annual ("YYYY") period that has IndicatorValues and is before
 * the current Baku year; if none is complete yet, fall back to the newest year
 * present; if the org has no annual data at all, `headlinePeriod()`. Callers
 * wanting a specific or monthly view pass `?period=YYYY` / `?period=YYYY-MM`.
 *
 * Also derives `availableYears` — every distinct year that has ANY
 * IndicatorValue (annual, quarter or month period), plus the current Baku
 * year. The PeriodChips year row renders from it, so a freshly imported
 * in-progress year (2026) is reachable even while the DEFAULT stays on the
 * last complete year — without this the terminal had NO year navigation at
 * all and data outside the default year was invisible (2026-07-15 audit).
 */
async function resolvePeriodContext(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<{ defaultPeriod: string; availableYears: number[] }> {
  const rows = await tx.indicatorValue.findMany({
    where: { organizationId },
    select: { period: true },
    distinct: ['period'],
  });
  const periods = rows.map((r) => r.period);
  const cur = currentBakuYearNumber();
  const availableYears = [
    ...new Set(
      periods
        .map((p) => p.slice(0, 4))
        .filter((y) => /^\d{4}$/.test(y))
        .map(Number)
        .concat(cur),
    ),
  ].sort((a, b) => a - b);
  const annual = periods.filter((p) => /^\d{4}$/.test(p)).map(Number);
  if (annual.length === 0)
    return { defaultPeriod: headlinePeriod(), availableYears };
  const complete = annual.filter((y) => y < cur);
  return {
    defaultPeriod: String(
      complete.length > 0 ? Math.max(...complete) : Math.max(...annual),
    ),
    availableYears,
  };
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
  const explicitPeriod = searchParams.get('period');

  // Validate ONLY explicit user input — guards garbage / `../../`-style path
  // probing hitting the column as-is. The no-param default is resolved
  // data-aware inside the org scope below (resolveDefaultPeriod), so it never
  // needs validation (always a "YYYY" string we constructed).
  if (explicitPeriod !== null) {
    try {
      parsePeriod(explicitPeriod);
    } catch (err) {
      if (err instanceof PeriodParseError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  // Truth-infra C.3 — admin opt-in toggle. When `?includePending=true`
  // the matrix returns pending-status companies alongside active ones
  // (CompanyTree renders them with a dim pill). Default behaviour
  // (no param OR `false`) hides pending — clean operating view.
  const includePending = searchParams.get('includePending') === 'true';

  // Phase 7.F sub-group RBAC — narrow visible companies to the user's
  // allowed sub-groups + their children. Admins / unrestricted users
  // get scope.ids === null and pass the full org through unchanged.
  const scope = await getCompanyScope(session.orgId, session.userId, session.role)

  try {
    // Phase 5.2 Stage 2 — wrap every DB call in withOrgScope. The
    // returned NextResponse propagates up through the closure.
    return await withOrgScope(session.orgId, async (tx) => {
    // Load companies + indicators first, then fetch only the IndicatorValue
    // rows scoped to their ids — avoids pulling orphan values for disabled
    // companies / retired indicators even though tenant scoping would keep
    // them inside the org.
    const [companiesRaw, indicators] = await Promise.all([
      tx.company.findMany({
        where: {
          organizationId: session.orgId,
          isActive: true,
          // Truth-infra C.3 — hide onboarding-pending companies from the
          // terminal by default. `?includePending=true` admin toggle
          // (CompanyTree.tsx "Show pending" button) opts back in. New
          // companies onboarded via wizard start `status='pending'`; an
          // admin flips them to 'active' once data is ready.
          ...(includePending
            ? {}
            : { status: { not: 'pending' } }),
          ...(scope.ids ? { id: { in: Array.from(scope.ids) } } : {}),
        },
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
          // Truth-infra C.1 — surface to CompanyTree so pending rows
          // visible under admin toggle render with a "pending" pill.
          status: true,
          sortOrder: true,
          // CLI follow-up — surface parentCompanyId so the CompanyTree can
          // derive composite scores for sub-groups + holding umbrella from
          // their children's averages (otherwise level=1 nodes show "—"
          // because they only carry rollup indicators which composite-score
          // intentionally filters out).
          parentCompanyId: true,
        },
        orderBy: { sortOrder: 'asc' },
      }),
      tx.indicatorDefinition.findMany({
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
          // CLI Tier 2 — surfaced so HeatMap can distinguish "N/A — indicator
          // not applicable to this industry" from "unknown — applicable but
          // no computed value". UI renders the two states differently.
          industries: true,
          // Phase 7.N C5 v2 — composite weight (1.0 default → ESG 0.7 → profitability 1.5)
          weight: true,
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

    // Phase 7.N C5 v2 — weight lookup map: indicatorId → weight.
    // Built once per request; used below when assembling cells.
    const indicatorWeightMap = new Map<string, number>(
      indicatorsForRender.map((ind) => [ind.id, (ind as typeof ind & { weight?: number }).weight ?? 1.0]),
    );

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

    // Resolve the period: explicit `?period=` (validated above) wins. Otherwise
    // the data-aware default (latest complete year WITH data). Gated on having
    // operational companies so an empty org does ZERO extra IV work (matches the
    // "skips indicatorValue.findMany when no operational companies" guard) — the
    // period is moot when the matrix is empty, so `headlinePeriod()` suffices.
    // `availableYears` is resolved even for an explicit period — the year-chip
    // row needs it on every fetch, not just the default one.
    const periodCtx =
      operationalIds.length === 0
        ? {
            defaultPeriod: headlinePeriod(),
            availableYears: [currentBakuYearNumber()],
          }
        : await resolvePeriodContext(tx, session.orgId);
    const period = explicitPeriod ?? periodCtx.defaultPeriod;

    const values =
      operationalIds.length === 0 || indicatorIds.length === 0
        ? []
        : await tx.indicatorValue.findMany({
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
              // Phase 7.H F4.v2.1 — provenance stamp threaded to the
              // HeatMap cell + Panel 3 badge. Without this select the
              // cell payload omits the field and modeled-generic ESG
              // cells fall back to "computed" rendering — defeating
              // the entire feature.
              valueSource: true,
              // Phase 10 / Stage B5 — lineage. Scalar on the IV row, and
              // this query is already `organizationId`-scoped, so it can
              // only ever be a revision of the caller's own org; no
              // DataRevision join, so no other org's revision detail is
              // reachable through here. Null on every legacy row.
              revisionId: true,
              // Financial-truth-infra Phase B.2 — sanityBand reaches
              // every HeatMap cell so the CompanyTree trust badge can
              // promote to 'suspicious' on extreme-band cells without a
              // second round-trip per row.
              sanityBand: true,
              // Phase L6 — staleness fallback. Trust badge degrades
              // verified→partial when all material cells were audited
              // more than 30 days ago; carrying lastReconciledAt on the
              // wire lets the CompanyTree compute the degradation
              // client-side without a second round-trip per row.
              lastReconciledAt: true,
              // 2026-05-27 A4 — feeds matrix.lastComputedAt aggregate
              // for the «Updated 2h ago» freshness badge in HeatMap
              // header. Kept on the cell for future row-level freshness.
              computedAt: true,
            },
          });

    type ValueShape = (typeof values)[number];

    // Phase 7.M Step 5 (2026-05-19) — one batched fetch of per-company
    // readiness. Joined into the company rows below so CompanyTree
    // renders the badge without an extra round-trip. Caught/null on
    // failure so a readiness-helper bug doesn't blank the whole
    // HeatMap — the badge just doesn't render.
    let readinessMap: Awaited<ReturnType<typeof getCompanyReadiness>>
    try {
      readinessMap = await getCompanyReadiness(prisma, session.orgId)
    } catch (err) {
      log.error('readiness fetch failed (non-fatal)', {
        err: err instanceof Error ? err.message : String(err),
      })
      readinessMap = new Map()
    }

    // Per-company revenue — materiality basis for the revenue-weighted
    // holding composite roll-up (see deriveParentComposites). Pulled from
    // any IV's resolved.revenue (consistent within a company; take the max
    // so a stray partial 0 can't win). 0 when no P&L is loaded → 0 weight
    // in the parent roll-up, so a no-data shell can't inflate the holding.
    const revenueByCompanyId = new Map<string, number>();
    for (const v of values) {
      const rev = (v.inputs as { resolved?: { revenue?: unknown } } | null)?.resolved?.revenue;
      if (typeof rev === 'number' && Number.isFinite(rev)) {
        const cur = revenueByCompanyId.get(v.companyId) ?? -Infinity;
        if (rev > cur) revenueByCompanyId.set(v.companyId, rev);
      }
    }

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
      // CLI follow-up — needed by CompanyTree to derive parent composite
      // from children's averages.
      parentCompanyId: c.parentCompanyId ?? null,
      // Phase 7.M Step 5 — readiness {score, tier, areas[]}. `null` when
      // the helper failed or this entity wasn't in scope (level=1 parents).
      readiness: readinessMap.get(c.id) ?? null,
      // 2026-05-30 — materiality basis for the revenue-weighted holding
      // composite roll-up (deriveParentComposites). 0 = no P&L → 0 weight.
      revenue: revenueByCompanyId.get(c.id) ?? 0,
    }));

    // Phase 7.H F4.v2.4 — materiality lookup needs the company's
    // industry + indicator's code. Pre-build maps so the per-cell
    // emission stays O(1).
    // Phase 5.2 Stage 2 wrap follow-up — tx's stricter inference exposed
    // that `c.industry` is `string | null` (Company.industry is nullable
    // for level=1 rollup entities). Filter out nulls — they're holding
    // companies that don't contribute to materiality lookups anyway.
    const companyIndustryById = new Map<string, string>();
    for (const c of companiesRaw) {
      if (c.industry) companyIndustryById.set(c.id, c.industry);
    }
    const indicatorCodeById = new Map<string, string>();
    for (const i of indicatorsForRender) {
      indicatorCodeById.set(i.id, i.code);
    }
    const lookupMateriality = (
      companyId: string,
      indicatorId: string,
    ): 'material' | 'low_materiality' | 'not_material' | undefined => {
      const indCode = indicatorCodeById.get(indicatorId);
      if (!indCode || !isMaterialityScoped(indCode)) return undefined;
      const industry = companyIndustryById.get(companyId);
      return getMateriality(industry, indCode);
    };

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
        const materiality = lookupMateriality(v.companyId, v.indicatorId);
        const valueSource = v.valueSource as
          | 'disclosed'
          | 'modeled_industry'
          | 'modeled_generic'
          | 'macro'
          | 'computed';
        // Phase 7.M Step 2 — derive signal-quality tier per cell.
        const signalConfidence = deriveSignalConfidence({ valueSource, error });
        return {
          indicatorValueId: v.id,
          companyId: v.companyId,
          indicatorId: v.indicatorId,
          value: v.value,
          status: v.status as IndicatorStatus,
          // Phase 7.N C5 v2 — per-indicator weight for weighted composite.
          weight: indicatorWeightMap.get(v.indicatorId) ?? 1.0,
          // Phase 7.H F4.v2.1 — string mirror of the Prisma enum,
          // safe to send to the client as-is.
          valueSource,
          signalConfidence,
          ...(sparkline ? { sparkline } : {}),
          ...(error ? { error } : {}),
          // Phase 10 / Stage B5 — omitted rather than sent as null when the
          // row is untraced, so a legacy cell's payload is byte-identical to
          // what it was before lineage existed. The gate reads absent and
          // null the same (`!cell.revisionId` → no_lineage), so omission
          // costs no meaning and every legacy row costs no bytes.
          ...(v.revisionId ? { revisionId: v.revisionId } : {}),
          // Phase 7.H F4.v2.4 — materiality is only stamped on ESG
          // cells (other indicators don't participate in the framework).
          ...(materiality ? { materiality } : {}),
          // Financial-truth-infra Phase B.2 — sanity-band from latest
          // audit run; null when not yet audited.
          ...(v.sanityBand ? { sanityBand: v.sanityBand as 'normal' | 'low_extreme' | 'high_extreme' | 'missing_input' | 'no_band' } : {}),
          ...(v.lastReconciledAt ? { lastReconciledAt: v.lastReconciledAt.toISOString() } : {}),
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
      parentCompanyId: sg.parentCompanyId ?? null,
      isSubgroup: true,
    }));

    // Build child-id → sub-group-id map. Children are operational level=2
    // companies whose parentCompanyId points to a sub-group's id.
    const childToSubgroup = new Map<string, string>();
    const subgroupIds = new Set(subgroups.map((s: CompanyRawShape) => s.id));
    const fullCompaniesRaw = await tx.company.findMany({
      where: {
        organizationId: session.orgId,
        isActive: true,
        // Truth-infra C.3 — same pending-exclusion as the top-level
        // findMany so pending children don't propagate into subgroup
        // composite scores. Admin toggle includes them via the same
        // `includePending` flag.
        ...(includePending ? {} : { status: { not: 'pending' } }),
        parentCompanyId: { in: Array.from(subgroupIds) },
      },
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
        : await tx.indicatorValue.findMany({
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
              // Phase 7.H F4.v2.1 — also threaded for real-rollup
              // parent cells (sub-44 path) so a holding-level cell
              // carries the same provenance badge as its children.
              valueSource: true,
              // Phase 10 / Stage B5 — lineage on real parent rollup cells,
              // on the same org-scoped terms as the operational query above.
              revisionId: true,
              // Financial-truth-infra Phase B.2 — sanityBand mirrored to
              // parent rollup cells so a holding-level row inherits the
              // audit verdict from its IV.
              sanityBand: true,
              // Phase L6 — staleness fallback. Trust badge degrades
              // verified→partial when all material cells were audited
              // more than 30 days ago; carrying lastReconciledAt on the
              // wire lets the CompanyTree compute the degradation
              // client-side without a second round-trip per row.
              lastReconciledAt: true,
              // 2026-05-27 A4 — feeds matrix.lastComputedAt aggregate
              // for the «Updated 2h ago» freshness badge in HeatMap
              // header. Kept on the cell for future row-level freshness.
              computedAt: true,
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
      const materiality = lookupMateriality(v.companyId, v.indicatorId);
      const valueSource = v.valueSource as
        | 'disclosed'
        | 'modeled_industry'
        | 'modeled_generic'
        | 'macro'
        | 'computed';
      const signalConfidence = deriveSignalConfidence({ valueSource, error });
      return {
        indicatorValueId: v.id,
        companyId: v.companyId,
        indicatorId: v.indicatorId,
        value: v.value,
        status: v.status as IndicatorStatus,
        valueSource,
        signalConfidence,
        ...(sparkline ? { sparkline } : {}),
        ...(error ? { error } : {}),
        ...(materiality ? { materiality } : {}),
        ...(v.sanityBand ? { sanityBand: v.sanityBand as 'normal' | 'low_extreme' | 'high_extreme' | 'missing_input' | 'no_band' } : {}),
        // Phase 10 / Stage B5 — same omit-when-untraced contract as the
        // operational cells above.
        ...(v.revisionId ? { revisionId: v.revisionId } : {}),
        // Sub-44 cont'd architect 💡 closure — discriminated-union
        // `kind` field replaces the legacy `isRealParentRollup` boolean.
        // Distinguishes from synthetic averages (different drill-down
        // semantics: real IV is queryable, average is not). Gate
        // downstream via `isAggregateRollup(c)` helper.
        kind: 'real-rollup' as const,
      };
    });

    // ── Sub-group rollup VALUE (Turn 33.5 → 2026-05-30 consolidation fix) ──
    // Ratio indicators (margins, OpEx %, per-ha) CONSOLIDATE: Σnumerator /
    // Σdenominator from the children's resolved P&L inputs — the
    // economically correct holding figure. Averaging children's percentages
    // is mathematically wrong (you can't average ratios with different
    // denominators) and let a hidden-implausible child (e.g. an out_of_range
    // -738% EBITDA the leaf hides as `unknown`) dominate the parent — a
    // holding EBITDA read -142.9% when the true consolidated figure is
    // -29.1%. For non-ratio indicators a simple average is the fallback, but
    // BOTH paths now exclude `unknown`/non-finite children (they carry no
    // meaningful value — including them double-counted hidden/no-data zeros).
    // Status stays worst-of-children ("weakest-link" risk semantics).
    const RATIO_ROLLUP_CONFIG: Record<string, { num: string; denom: string; scale: number }> = {
      IND_EBITDA_MARGIN:  { num: 'ebitda',              denom: 'revenue',          scale: 100 },
      FP_GROSS_MARGIN:    { num: 'gross_profit',        denom: 'revenue',          scale: 100 },
      SVC_GROSS_MARGIN:   { num: 'gross_profit',        denom: 'revenue',          scale: 100 },
      FP_OPEX_RATIO:      { num: 'opex',                denom: 'revenue',          scale: 100 },
      SVC_OPEX_RATIO:     { num: 'opex',                denom: 'revenue',          scale: 100 },
      SVC_NET_MARGIN:     { num: 'net_income',          denom: 'revenue',          scale: 100 },
      SVC_COGS_INTENSITY: { num: 'cogs',                denom: 'revenue',          scale: 100 },
      FX_IMPORTED_INPUT:  { num: 'imported_input_cost', denom: 'total_input_cost', scale: 100 },
      AGRO_COST_PER_HA:      { num: 'cogs',         denom: 'hectares_planted', scale: 1 },
      AGRO_REVENUE_PER_HA:   { num: 'revenue',      denom: 'hectares_planted', scale: 1 },
      AGRO_YIELD_EFFICIENCY: { num: 'gross_profit', denom: 'hectares_planted', scale: 1 },
    };
    // `cells` doesn't carry inputs; `values` does. Build (co::ind) → resolved.
    const resolvedByCell = new Map<string, Record<string, unknown>>();
    for (const v of values) {
      const r = (v.inputs as { resolved?: Record<string, unknown> } | null)?.resolved;
      if (r && typeof r === 'object') resolvedByCell.set(`${v.companyId}::${v.indicatorId}`, r);
    }
    const idToCode = new Map<string, string>(indicatorsForRender.map((i) => [i.id, i.code]));

    type AggBucket = {
      sum: number; count: number; statuses: Set<IndicatorStatus>;
      numSum: number; denomSum: number; consolidatable: boolean;
    };
    const aggMap = new Map<string, AggBucket>(); // key: `${sgId}::${indId}`
    for (const cell of cells) {
      const sgId = childToSubgroup.get(cell.companyId);
      if (!sgId) continue;
      const key = `${sgId}::${cell.indicatorId}`;
      // Sub-44 cont'd render-path: real parent IV beats synthetic average.
      if (realParentCellKeys.has(key)) continue;
      let bucket = aggMap.get(key);
      if (!bucket) {
        bucket = { sum: 0, count: 0, statuses: new Set(), numSum: 0, denomSum: 0, consolidatable: false };
        aggMap.set(key, bucket);
      }
      // worst-of-children status uses ALL children (worstStatus ignores
      // 'unknown' in its precedence, so a no-data child can't make red).
      bucket.statuses.add(cell.status);
      // CONSOLIDATION (ratio indicators): accumulate the child's real
      // numerator/denominator REGARDLESS of the child's margin status. A
      // child's margin may be flagged unknown/out_of_range (e.g. EDEN's
      // -738% on tiny revenue, hidden at the leaf) while its underlying
      // ebitda + revenue are real and DO belong in the holding's
      // consolidated Σ. Excluding it would understate the holding loss.
      // Finite-guarded so a NaN/parse-error component can't poison the sum.
      const cfg = RATIO_ROLLUP_CONFIG[idToCode.get(cell.indicatorId) ?? ''];
      if (cfg) {
        const resolved = resolvedByCell.get(`${cell.companyId}::${cell.indicatorId}`);
        const num = resolved?.[cfg.num];
        const denom = resolved?.[cfg.denom];
        if (typeof num === 'number' && Number.isFinite(num) && typeof denom === 'number' && Number.isFinite(denom)) {
          bucket.numSum += num;
          bucket.denomSum += denom;
          bucket.consolidatable = true;
        }
      }
      // AVERAGE fallback (non-ratio indicators): exclude unknown / non-finite
      // children — they carry no meaningful margin value to average.
      if (cell.status === 'unknown' || !Number.isFinite(cell.value)) continue;
      bucket.sum += cell.value;
      bucket.count += 1;
    }

    const worstStatus = (statuses: Set<IndicatorStatus>): IndicatorStatus => {
      if (statuses.has('red')) return 'red';
      if (statuses.has('amber')) return 'amber';
      if (statuses.has('green')) return 'green';
      return 'unknown';
    };

    const subgroupCells = Array.from(aggMap.entries())
      .map(([key, bucket]) => {
        const [sgId, indId] = key.split('::');
        const cfg = RATIO_ROLLUP_CONFIG[idToCode.get(indId) ?? ''];
        let value: number;
        if (bucket.consolidatable && cfg && bucket.denomSum !== 0) {
          // Consolidated ratio: Σnum / Σdenom × scale (×100 for percentage
          // margins) — the economically correct holding-level figure.
          value = (bucket.numSum / bucket.denomSum) * cfg.scale;
        } else if (bucket.count > 0) {
          value = bucket.sum / bucket.count; // average over KNOWN children only
        } else {
          // All children unknown/no-data → no meaningful rollup value.
          // Drop the synthetic cell entirely (honest empty rather than 0/NaN).
          return null;
        }
        return {
          indicatorValueId: null, // no persisted IV — synthetic rollup
          companyId: sgId,
          indicatorId: indId,
          value,
          status: worstStatus(bucket.statuses),
          // Sub-44 cont'd architect 💡 closure — discriminated-union
          // `kind` field replaces the legacy `isSubgroupRollup` boolean.
          // Gate downstream via `isAggregateRollup(c)` helper.
          kind: 'synthetic-rollup' as const,
          // Phase 7.G Turn VI — drives IndicatorDetail "averaged from N
          // children" copy. Now counts KNOWN-status contributors only.
          contributingChildCount: bucket.count,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    // Phase 7.G Turn CC — `Cache-Control: private, max-age=10` per
    // Turn-32 architect ⚠️ spec option (b). Defense-in-depth layer:
    // the original CommandBar IND-keystroke-flurry problem was already
    // mitigated client-side in Turn 42 sub-20 via `ensureMatrix()` at
    // `src/features/terminal/hooks/use-matrix.ts:15-28` — module-level
    // cache keyed by period, so within a single JS-tab session
    // duplicate fetches are already foreclosed. This server-side header
    // adds protection across (a) cross-tab use (each tab has its own
    // module cache), (b) hard-reloads (module cache reset on full
    // navigation), (c) any future code path that bypasses ensureMatrix.
    // `private` keeps the response out of shared/CDN caches (matrix is
    // org-scoped + auth-gated); 10s window is short enough that a
    // recompute event >10s later won't be obscured by stale cached
    // data. At Phase F 60-co × 80-ind scale this header is the
    // safety-net layer; the load-bearing cache is `ensureMatrix`.
    const allCellsForFreshness = [...cells, ...parentCells, ...subgroupCells];

    // 2026-05-27 A4 freshness — aggregate max(computedAt). Single ISO string
    // the HeatMap header turns into «Updated 2h ago» via a relative-time
    // formatter. Null when no IV exists (empty org / no recompute ever fired)
    // — UI degrades to «No data yet».
    //
    // 2026-06-03 fix (terminal-audit run-2 #7): read computedAt from the raw
    // `values` / `parentValues` rows (which select it), NOT from the emitted
    // cell objects. The leaf/parent cell `.map()`s never copied `computedAt`
    // onto the cell, so the previous loop over `cells` always saw `undefined`,
    // `lastComputedAt` stayed null, and the badge (gated on it in HeatMap)
    // NEVER rendered. Subgroup cells are synthetic averages with no real
    // computedAt and derive from the same values, so leaf+parent max covers them.
    let lastComputedAt: string | null = null;
    const considerTs = (ts: Date | string | null | undefined) => {
      if (!ts) return;
      const iso = ts instanceof Date ? ts.toISOString() : String(ts);
      if (!lastComputedAt || iso > lastComputedAt) lastComputedAt = iso;
    };
    for (const v of values) considerTs(v.computedAt);
    for (const v of parentValues) considerTs(v.computedAt);

    return NextResponse.json(
      {
        period,
        availableYears: periodCtx.availableYears,
        companies: [...companies, ...subgroupCompanies],
        indicators: indicatorsForRender,
        cells: allCellsForFreshness,
        lastComputedAt,
      },
      { headers: { 'Cache-Control': 'private, max-age=10' } },
    );
    });
  } catch (error) {
    log.error('error building indicator matrix', {
      err: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: 'Failed to build matrix' },
      { status: 500 },
    );
  }
}
