/**
 * Phase 7.A.0 — IndicatorValue recompute pipeline.
 *
 * Flow: requiredInputs → namespace resolvers → post-processing → formula
 * engine → classifier → upsert. Built on `formula-engine.ts` and `periods.ts`
 * (both pure). Prisma access is fronted by the narrow `RecomputeDataSource`
 * interface so the runner is unit-testable without a database.
 *
 * --- Namespaces consumed from `IndicatorDefinition.requiredInputs` ---
 *   "booking" or "booking.<anything>"   Active-only Booking rows for
 *                                       company+period. Exposes context vars:
 *                                         rooms_sold, nights_sold,
 *                                         room_revenue (FX-converted to base),
 *                                         fx_revenue_share,
 *                                         source_country_hhi.
 *                                       Seed uses "booking.sourceCountry" as
 *                                       a distinct string for HOSP_SOURCE_HHI;
 *                                       both forms load the same bookings.
 *   "company.settings.<path>"           Pluck numeric top-level keys from
 *                                       Company.settings JSON; snake-case the
 *                                       name for context.
 *   "operationalFact:<metric>"          Avg of OperationalFact.value for that
 *                                       metric in period. Exposes as <metric>.
 *
 * Post-processing derives `rooms_available = total_rooms × daysInPeriod` when
 * both are present (occupancy shape).
 *
 * --- Not implemented yet (indicator falls through to status="unknown") ---
 *   "currencyRate"  — Phase 7.E FX pack (CurrencyRateHistory resolver)
 *   "budgetLine"    — per-company BudgetLine aggregation (FK optional today)
 *
 * --- Error policy ---
 * Uses `tryEvaluateFormula` so one broken indicator's failure never aborts a
 * tenant batch. Failures land as:
 *   IndicatorValue {
 *     status: "unknown",
 *     value: 0,
 *     inputs: { resolved, aggregates, derived, error: { code, reason } }
 *   }
 *
 * --- Tenant scoping ---
 * Every data-source method takes `organizationId` explicitly. The Prisma
 * adapter always includes it in `where:` so a mis-labelled recompute call
 * (e.g. `organizationId=A` + `companyId` from org B) returns empty rows
 * instead of leaking cross-tenant data into the computed value.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import {
  tryEvaluateFormula,
  classifyValue,
  type FormulaContext,
  type FormulaFunction,
  type IndicatorStatus,
  type Thresholds,
} from './formula-engine';
import { parsePeriod, daysInPeriod, type Period } from './periods';
import { computeSparkline, bridgeRecomputeBuildContext } from './sparkline';
import {
  getIndustryEmissionFactor,
  type EmissionScope,
  type ConfidenceTier,
} from './industry-emission-factors';

/**
 * Phase 7.H F4.v2.1 — provenance ladder. Mirrors the Prisma enum
 * `IndicatorValueSource` (declared in `prisma/schema.prisma`). Kept as a
 * string-literal union here so the recompute module stays Prisma-type-free
 * at the boundary (the in-memory test data sources never touch
 * `@prisma/client`). Adapters write the literal value through to Postgres;
 * Prisma accepts string values for enum columns.
 */
export type ValueSource =
  | 'disclosed'
  | 'modeled_industry'
  | 'modeled_generic'
  | 'macro'
  | 'computed';

// --- Narrow row shapes the pipeline consumes ---------------------------------

export interface BookingRow {
  revenue: number;
  nights: number;
  roomsBooked: number | null;
  sourceCountry: string;
  currencyCode: string | null;
  exchangeRate: number | null;
  isCancelled: boolean;
}

export interface FactRow {
  value: number;
  date: Date;
}

export interface CurrencyRateRow {
  currencyCode: string;
  rate: number;
  rateDate: Date;
  isBase: boolean;
}

export interface BudgetLineRow {
  plannedAmount: number;
  currencyCode: string | null;
  exchangeRate: number | null;
  accountType: string | null;
  /** Account code from ChartOfAccount (e.g. "601-04", "711", "103-02").
   *  Nullable for legacy rows that pre-date the Phase 2.1 FK backfill — the
   *  sub-aggregations below treat null code as "no match" rather than
   *  guessing. */
  accountCode: string | null;
  /** CoA category tag (e.g. "sales", "feed", "rd", "debt_service",
   *  "inventory"). Optional; resolvers fall back to code + name heuristics
   *  when null. */
  accountCategory: string | null;
  /** Account name (preferring nameEn, falling back to name). Lowercased
   *  matching is the last-resort heuristic for sub-aggregations like
   *  feed_cost / debt_service when neither code prefix nor category fire. */
  accountName: string | null;
  /**
   * Phase 7.E perMonth chain — month index 0..11 (0 = January) for the
   * 12-row-per-line monthly persistence strategy. Apply / CLI write 12
   * BudgetLine rows per parsed line, each carrying one month's value in
   * `plannedAmount` + the month index in `sortOrder`. `monthIndex` is
   * surfaced here so resolvers (`revenueBySeason`, `sparkline`) can
   * group rows by month without reading `sortOrder` directly (the column
   * has dual semantics: it's also a tie-breaker for non-monthly rows).
   *
   * Null = unknown/legacy (pre-monthly-distribution rows); resolvers
   * that need monthly resolution treat null as "exclude". Number outside
   * [0, 11] is treated as null.
   */
  monthIndex: number | null;
}

// --- Data source interface ---------------------------------------------------

export interface RecomputeDataSource {
  listBookings(args: {
    organizationId: string;
    companyId: string;
    start: Date;
    end: Date;
  }): Promise<BookingRow[]>;

  listOperationalFacts(args: {
    organizationId: string;
    companyId: string;
    metric: string;
    start: Date;
    end: Date;
  }): Promise<FactRow[]>;

  getCompanySettings(args: {
    organizationId: string;
    companyId: string;
  }): Promise<Record<string, unknown> | null>;

  /** Latest rate per known currency as of `asOf`, one row per code.
   *  Used by the `currencyRate` namespace. Includes the base currency row
   *  with rate=1 so callers can distinguish "base was defined" from
   *  "no base currency configured". */
  listCurrencyRates(args: {
    organizationId: string;
    asOf: Date;
  }): Promise<CurrencyRateRow[]>;

  /** BudgetLine rows for a company joined to their chart-of-accounts entry.
   *  Used by the `budgetLine` namespace to aggregate revenue / cogs / opex
   *  and detect imported (foreign-currency) lines.
   *
   *  Filter contract — both year AND month-range matter:
   *   - `period.year` filters by `BudgetPlan.year` so a 2026-04 recompute
   *     doesn't aggregate every year of plans the company has ever had,
   *     producing silent skew in P&L ratios (AGRO_FX_RISK et al.).
   *   - `period.kind` further narrows by `BudgetLine.sortOrder` (= month
   *     index 0..11 per Turn-34 monthly-distribution contract):
   *       month   → sortOrder = period.start.month  (single slice)
   *       quarter → sortOrder ∈ [startMonth..startMonth+2]
   *       year    → no sortOrder filter (sums all 12 months)
   *     Without this, sparklines anchor at "2026-04" but read the SAME
   *     annual aggregate for all 12 trailing-month evaluations →
   *     IND_NET_MARGIN, IND_OPEX_RATIO, etc. render as flat horizontal
   *     lines (Δ 0.00) regardless of real monthly seasonality. */
  listBudgetLines(args: {
    organizationId: string;
    companyId: string;
    period: Period;
  }): Promise<BudgetLineRow[]>;

  /**
   * Phase 7.H Feature B — rolling-30d average sentiment for IntelItems
   * tagged with this company. Uses companyTags[] (the human-readable code,
   * e.g. "AAC"), not companyId — that's how the AI Web Crawler stores
   * mentions. Returns null when:
   *  - the company has no `code` set
   *  - no IntelItems with non-null sentimentScore in the 30d window
   * Range: [-1, +1] (LLM-clamped at write time).
   */
  getNewsSentimentRolling30d(args: {
    organizationId: string;
    companyId: string;
  }): Promise<number | null>;

  /**
   * Phase 7.I — external commodity / weather observations from the
   * `IntelDataPoint` table. Returns observations matching the source +
   * metric filter, ordered by datetime ascending (oldest first) so
   * callers can compute trailing windows by `.slice(-N)`.
   *
   * Returns `[]` when no rows match — the resolver downstream maps
   * empty → "data not available", which surfaces as `unknown` IV status.
   * Optional on the interface so legacy fixtures keep working without
   * implementing it; resolvers handle `undefined` as "feature off".
   */
  listIntelDataPoints?(args: {
    organizationId: string;
    sourceCode: string;
    metric?: string;
    /** Inclusive lower bound on `datetime`. Omit = no lower bound. */
    start?: Date;
    /** Exclusive upper bound on `datetime`. Omit = no upper bound. */
    end?: Date;
    /** Hard cap on rows returned. Defaults to 50 so a 5y monthly history
     *  doesn't blow up memory on every recompute. */
    limit?: number;
  }): Promise<
    Array<{ metric: string; datetime: Date; value: number; unit?: string | null }>
  >;

  /**
   * Phase 7.H F4.v2.3 — disclosure lookup. Returns the disclosed value
   * if a row exists in `IndicatorDisclosure` for the (companyId,
   * indicatorCode, period) triple, else null. When non-null, the
   * recompute pipeline uses this value verbatim and stamps
   * `valueSource: 'disclosed'` instead of evaluating the formula.
   *
   * Required (not optional) on the interface so a stub adapter must
   * implement it — returning null is fine for fixtures that don't
   * exercise disclosure, but the method must exist so a future
   * adapter regression can't silently fall through to modeled values.
   */
  getIndicatorDisclosure(args: {
    organizationId: string;
    companyId: string;
    indicatorCode: string;
    period: string;
  }): Promise<{ value: number; unit: string } | null>;

  upsertIndicatorValue(args: {
    organizationId: string;
    companyId: string;
    indicatorId: string;
    period: string;
    value: number;
    status: IndicatorStatus;
    inputs: RecomputeInputs;
    /**
     * Phase 7.E perMonth chain phase 2 — optional 12-slot trailing-month
     * sparkline persisted alongside the spot value. When `undefined`, the
     * Prisma adapter MUST NOT touch the existing `IndicatorValue.sparkline`
     * column — bulk recomputes (period-only fan-out) skip sparkline to stay
     * within the 60s function budget, and clobbering a previously-computed
     * array with `null` would silently nuke the dedicated worker's output.
     * On CREATE, `undefined` falls back to `[]` (the original first-write
     * default that predates phase 2).
     */
    sparkline?: (number | null)[];
    /**
     * Phase 7.H F4.v2.1 — Bloomberg-style provenance stamp inherited from
     * `IndicatorDefinition.defaultValueSource`. Drives the UI badge in
     * Panel 3 + the modeled-marker on HeatMap cells. Required at the
     * type level so callers think about it explicitly; the runner
     * passes the seed's `defaultValueSource` and falls back to
     * `'computed'` when a legacy seed omits the field. Adapters use
     * this value as-is on both CREATE and UPDATE so a re-recompute
     * after a seed flip (e.g. `modeled_generic` → `modeled_industry`
     * in v2.2) refreshes the badge without manual migration.
     */
    valueSource: ValueSource;
    /**
     * Phase 7.H F4.v2.2.1 — model-confidence tier (`A`|`B`|`C`|`D`)
     * derived from the resolver's industry-factor aggregate (worst tier
     * across scopes used). Persists into `IndicatorValue.confidence` so
     * the Panel-3 badge tooltip can surface "Confidence: B (sector-
     * average benchmark)". Optional — null on disclosed cells (the
     * disclosed value IS the ground truth; tier doesn't apply) and on
     * legacy fixtures that don't yet thread the resolver aggregate.
     */
    confidence?: 'A' | 'B' | 'C' | 'D' | null;
  }): Promise<void>;

  /**
   * Phase 7.E phase 3 — cross-period IV read for `fact()` formula function.
   * Returns the persisted spot `value` of the indicator at the requested
   * period for the SAME company, or null when:
   *  - no IV row exists for the (org, co, code, period) tuple
   *  - the IV row's status is `unknown` (formula failed) — a 0 here would
   *    silently feed bad data into the parent formula; null is honest.
   * Pure read — never throws on missing data; callers map null → NaN to
   * propagate "missing input" through the formula engine.
   *
   * **Required, not optional** (sub-41 architect Round-1 closure):
   * keeping this optional with a resolver-level fallback would let an
   * adapter regression silently produce NaN facts in production, which
   * is exactly the silent-failure mode `feedback_verify_one_layer_up.md`
   * warns against. Test stubs that don't exercise fact() can throw or
   * return null directly — the fail-loud path is preferred to a fall-
   * through that masks a real adapter bug.
   */
  getIndicatorValue(args: {
    organizationId: string;
    companyId: string;
    indicatorCode: string;
    period: string;
  }): Promise<number | null>;

  /**
   * Phase 7.G Turn XLI (Phase C) — batched variant of `getIndicatorValue`
   * for the `fact()` resolver. Reads many `(indicatorCode, period)` pairs
   * for a single (org, co) in ONE database call instead of N. Returns
   * a map keyed by canonical `${indicatorCode}@${period}`. Missing rows
   * (status='unknown' OR no row) map to `null`, mirroring the singular
   * method's semantic.
   *
   * Cost shape: at Phase F (60 cos × 9 indicators × 2-3 fact reads each
   * = ~1500 reads per recompute), the singular Promise.all path was 1500
   * concurrent queries; this collapses to ~60 batched queries (one per
   * recompute target). Indispensable for cross-period composite
   * indicators that fan out across many quarters.
   *
   * **Required, not optional** — same fail-loud rationale as
   * `getIndicatorValue`. Adapters that return stub data still must
   * implement this; sub-to-singular fallback is allowed only at the
   * adapter level if the call shape is identical (rare).
   */
  getIndicatorValues(args: {
    organizationId: string;
    companyId: string;
    pairs: Array<{ indicatorCode: string; period: string }>;
  }): Promise<Record<string, number | null>>;

  /**
   * Phase 7.E phase 3 — direct-children lookup for `rollup()` formula
   * function. Returns Company.id values of every active sub-company whose
   * `parentCompanyId === args.parentId`. Used by `rollupResolver` to fan
   * out an indicator read across children (default agg = sum). Empty
   * array when the company has no children (rollup formula sees an empty
   * sum = 0; formula author can guard via ternary if 0 is misleading).
   *
   * **Required, not optional** — same rationale as `getIndicatorValue`.
   */
  listChildCompanyIds(args: {
    organizationId: string;
    parentId: string;
  }): Promise<string[]>;
}

// --- Inputs snapshot shape stored on IndicatorValue.inputs -------------------

/** Per-namespace aggregate shapes — drill-down UI reads these directly. */
export interface BookingAggregate {
  booking_count: number;
  cancelled_count: number;
  fx_revenue: number;
  missing_rate_count: number;
  rev_by_country: Record<string, number>;
}
export interface OperationalFactAggregate {
  [metric: string]: { count: number; avg: number | null };
}
export type CompanySettingsAggregate = Record<string, number>;

export interface CurrencyRateAggregate {
  base_currency: string | null;
  rate_count: number;
  /** per-code rate snapshot, keys like `fx_usd`, `fx_eur` mirror context vars */
  rates: Record<string, number>;
}

export interface BudgetLineAggregate {
  line_count: number;
  revenue: number;
  cogs: number;
  opex: number;
  /** cogs+opex in foreign currency — NOT the AGRO_FX_RISK numerator. Use
   *  `resolved.imported_input_cost` (cogs-only) for ratio math. This field
   *  is drill-down only. */
  imported_total_cost: number;
  /** cogs+opex in base currency — drill-down complement to above. */
  domestic_total_cost: number;
  missing_rate_count: number;
  /** Sub-aggregation breakdowns — populated only when the corresponding
   *  `budgetLine.<sub>` requiredInput was requested. Each carries the
   *  matched line count + a tiny preview list (top 3 by amount) so the
   *  drill-down UI can show "rd_spend = 1.2M, matched 3 lines: …". */
  sub_aggregations?: Record<string, BudgetLineSubAggregation>;
}

export interface BudgetLineSubAggregation {
  /** Aggregated value in base currency (same convention as P&L vars). */
  value: number;
  /** How many BudgetLine rows the heuristic matched. 0 means the indicator
   *  will produce `unknown` because the variable is undefined in context. */
  matched_count: number;
  /** Up to 3 highest-amount lines in this sub-aggregation, for drill-down. */
  top_lines: Array<{ code: string | null; name: string | null; amount: number }>;
  /** Which heuristic actually fired (`category` | `code_prefix` | `name`).
   *  Helps the user spot when a fallback heuristic is doing the work
   *  because the CoA isn't tagged explicitly. */
  matched_by: string[];
}

export interface RecomputeAggregates {
  booking?: BookingAggregate;
  operational_fact?: OperationalFactAggregate;
  company_settings?: CompanySettingsAggregate;
  currency_rate?: CurrencyRateAggregate;
  budget_line?: BudgetLineAggregate;
  /** Phase 7.E phase 3 — `fact()` cross-period reads. */
  fact?: FactAggregate;
  /** Phase 7.E phase 3 — `rollup()` cross-company sums. */
  rollup?: RollupAggregate;
  /** Phase 7.H Feature B — rolling-30d news sentiment for the company. */
  news_sentiment?: { avg: number | null; hasData: boolean };
  /**
   * Phase 7.H F4.v2.2 — sector intensity lookup snapshot. The
   * drilldown UI surfaces this as "Source: industry intensity for
   * agro_crops, confidence B" alongside the modeled value. `null`
   * scope entries mean the company's industry has no catalog row OR
   * the scope wasn't requested by the seed's requiredInputs.
   */
  industry_factor?: {
    industry: string | null;
    scopes: Record<
      string,
      { factor: number; confidence: 'A' | 'B' | 'C' | 'D' } | null
    >;
  };
  /**
   * Phase 7.I — per-metric weather observations the `weatherResolver`
   * resolved for the current company's region. `value: null` = no
   * IntelDataPoint row matched (region unset OR adapter hasn't ingested
   * yet). The drilldown UI surfaces this as "Source: Open-Meteo,
   * region=Salyan, no data yet" so a missing weather feed reads as a
   * data-pipeline state, not a silent zero.
   */
  weather?: Record<string, { value: number | null; region: string | null }>;
  /**
   * Phase 7.I — per-alias commodity-price observations the
   * `commodityPriceResolver` derived from IntelDataPoint. `samples`
   * captures how many monthly bars fed the aggregator (`mean_12m` needs
   * 12 to be honest; fewer is a degraded answer the UI can flag).
   */
  commodity_price?: Record<
    string,
    {
      value: number | null;
      sourceCode: string;
      aggregator: string;
      samples: number;
    }
  >;
}

/**
 * Phase 7.E phase 3 — drill-down snapshot of every (code, period) pair the
 * `fact()` resolver attempted to read. `value: null` signals the IV row was
 * missing OR resolved to status='unknown' (resolver discards both alike to
 * propagate "missing input" through the formula engine).
 */
export interface FactAggregate {
  /** How many distinct (code, period) reads were attempted. */
  read_count: number;
  /** How many returned a non-null value. `read_count - hit_count` = missing. */
  hit_count: number;
  /** Per-key snapshot keyed by `${indicatorCode}@${period}`. */
  reads: Record<string, number | null>;
}

/**
 * Phase 7.E phase 3 — drill-down snapshot of `rollup()` cross-company sums.
 * `children_count` is captured BEFORE the per-code fan-out so a parent with
 * empty children-set surfaces `children_count: 0` even when no codes were
 * requested. Per-code `matched_count` shows how many children's IVs were
 * non-null (children_count - matched_count = children with missing IV).
 */
export interface RollupAggregate {
  /** Direct children of the current company. 0 = rollup yields 0 (empty sum). */
  children_count: number;
  /** Per-indicator-code sum + match count across children at current period. */
  sums: Record<string, { sum: number; matched_count: number }>;
}

export interface RecomputeDerived {
  rooms_available?: { total_rooms: number; days: number };
}

export interface RecomputeInputs {
  /** Mirror of formula context — what variables the engine saw. */
  resolved: Record<string, number>;
  /** Raw aggregates / breakdowns for drill-down UI, typed per namespace. */
  aggregates: RecomputeAggregates;
  /** Values computed from multiple source namespaces (e.g. rooms_available). */
  derived: RecomputeDerived;
  /** Present only when evaluation failed. */
  error?: { code: string; reason: string };
}

// --- Prisma adapter ----------------------------------------------------------

/**
 * Wraps a real PrismaClient into `RecomputeDataSource`. Every read includes
 * `organizationId` in `where:` for cross-tenant safety. Writes also carry
 * `organizationId` straight into the Prisma row.
 */
export function createPrismaDataSource(
  prisma: PrismaClient,
): RecomputeDataSource {
  return {
    async listBookings({ organizationId, companyId, start, end }) {
      return prisma.booking.findMany({
        where: {
          organizationId,
          companyId,
          arrivalDate: { gte: start, lt: end },
        },
        select: {
          revenue: true,
          nights: true,
          roomsBooked: true,
          sourceCountry: true,
          currencyCode: true,
          exchangeRate: true,
          isCancelled: true,
        },
      });
    },

    async listOperationalFacts({
      organizationId,
      companyId,
      metric,
      start,
      end,
    }) {
      return prisma.operationalFact.findMany({
        where: {
          organizationId,
          companyId,
          metric,
          date: { gte: start, lt: end },
        },
        select: { value: true, date: true },
      });
    },

    async getCompanySettings({ organizationId, companyId }) {
      const c = await prisma.company.findFirst({
        where: { id: companyId, organizationId },
        select: { settings: true },
      });
      if (!c || !c.settings) return null;
      return c.settings as Record<string, unknown>;
    },

    // Phase 7.I — IntelDataPoint reads for the weather + commodityPrice
    // resolvers. The table is added by the drift-resolution v2-models
    // migration; until that migration applies in dev, prisma.intelDataPoint
    // is in the client but the table doesn't exist. We catch the table-
    // missing error and return [] so the resolver downgrades cleanly to
    // "data not available" rather than throwing inside recompute.
    async listIntelDataPoints({ organizationId, sourceCode, metric, start, end, limit = 50 }) {
      const where: {
        organizationId: string;
        sourceCode: string;
        metric?: string;
        datetime?: { gte?: Date; lt?: Date };
      } = { organizationId, sourceCode };
      if (metric) where.metric = metric;
      if (start || end) {
        where.datetime = {};
        if (start) where.datetime.gte = start;
        if (end) where.datetime.lt = end;
      }
      try {
        const rows = await prisma.intelDataPoint.findMany({
          where,
          orderBy: { datetime: 'asc' },
          take: limit,
          select: { metric: true, datetime: true, value: true, unit: true },
        });
        return rows;
      } catch (err) {
        // Drift-migration not applied yet — table missing. Treat as no
        // data rather than fail loudly: recompute should still complete
        // for the financial / operational indicators that don't depend
        // on IntelDataPoint, and the external-feed indicators will
        // legitimately read `unknown` until the migration lands.
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('relation "intel_data_points"') ||
          msg.includes('does not exist') ||
          msg.includes('P2021')
        ) {
          return [];
        }
        throw err;
      }
    },

    async listCurrencyRates({ organizationId, asOf }) {
      // One row per configured currency. For the base currency we emit
      // { rate: 1, rateDate: asOf }. For non-base currencies we look up the
      // latest rate in CurrencyRateHistory on or before `asOf`, falling back
      // to Currency.exchangeRate if no history row exists.
      //
      // Two queries total regardless of currency count — avoids N+1 that
      // bit us in the earlier loop-per-code implementation.
      const currencies = await prisma.currency.findMany({
        where: { organizationId, isActive: true },
        select: {
          code: true,
          isBase: true,
          exchangeRate: true,
        },
      });
      if (currencies.length === 0) return [];

      const nonBaseCodes = currencies
        .filter((c: { isBase: boolean }) => !c.isBase)
        .map((c: { code: string }) => c.code);

      // Fetch all history rows for all non-base codes in one query, then
      // group in memory and take the latest per code.
      const history =
        nonBaseCodes.length === 0
          ? []
          : await prisma.currencyRateHistory.findMany({
              where: {
                organizationId,
                currencyCode: { in: nonBaseCodes },
                rateDate: { lte: asOf },
              },
              orderBy: { rateDate: 'desc' },
              select: { currencyCode: true, rate: true, rateDate: true },
            });
      const latestByCode = new Map<
        string,
        { rate: number; rateDate: Date }
      >();
      for (const h of history) {
        if (!latestByCode.has(h.currencyCode)) {
          // findMany is already sorted desc, so first hit per code wins.
          latestByCode.set(h.currencyCode, {
            rate: h.rate,
            rateDate: h.rateDate,
          });
        }
      }

      return currencies.map(
        (c: { code: string; isBase: boolean; exchangeRate: number }) => {
          if (c.isBase) {
            return {
              currencyCode: c.code,
              rate: 1,
              rateDate: asOf,
              isBase: true,
            };
          }
          const hit = latestByCode.get(c.code);
          return {
            currencyCode: c.code,
            rate: hit ? hit.rate : c.exchangeRate,
            rateDate: hit ? hit.rateDate : asOf,
            isBase: false,
          };
        },
      );
    },

    async listBudgetLines({ organizationId, companyId, period }) {
      // Year scope: without `plan.year` a 2026-04 recompute would aggregate
      // every year of plans the company has ever had, making P&L
      // denominators year-agnostic and skewing ratios.
      //
      // Month scope (Turn-42-sub3 fix): post-Turn-34 each parsed line is
      // 12 BudgetLine rows with `sortOrder` = month index 0..11 +
      // `plannedAmount` = perMonth slice. When period.kind is monthly /
      // quarterly, narrow by sortOrder so sparkline trailing-month
      // evaluations actually see different data per anchor — the whole
      // point of a sparkline is varying-by-period, defeated by an
      // unfiltered annual sum.
      let sortOrderFilter: { gte: number; lte: number } | undefined;
      if (period.kind === 'month') {
        const m = period.start.getUTCMonth();
        sortOrderFilter = { gte: m, lte: m };
      } else if (period.kind === 'quarter') {
        const startMonth = period.start.getUTCMonth();
        sortOrderFilter = { gte: startMonth, lte: startMonth + 2 };
      }
      // year — no sortOrder filter; aggregate across all 12 months.

      const rows = await prisma.budgetLine.findMany({
        where: {
          organizationId,
          companyId,
          plan: { year: period.year },
          ...(sortOrderFilter ? { sortOrder: sortOrderFilter } : {}),
        },
        select: {
          plannedAmount: true,
          currencyCode: true,
          exchangeRate: true,
          // Phase 7.E perMonth chain — `sortOrder` doubles as month
          // index 0..11 for the 12-row-per-line monthly persistence
          // strategy. Surfaced as `monthIndex` in the Row shape with
          // null for out-of-range / non-monthly rows so resolvers can
          // group by month deterministically.
          sortOrder: true,
          // CLI follow-up — fallback channel when accountId is null.
          // The ATL detailed import (`scripts/import-atl-detailed.cjs`)
          // populates `lineType` directly instead of linking to CoA. The
          // resolver below reads `accountType ?? lineType` so granular
          // imports work without the upstream CoA-link step.
          lineType: true,
          account: {
            select: {
              accountType: true,
              code: true,
              category: true,
              name: true,
              nameEn: true,
            },
          },
        },
      });
      return rows.map(
        (
          r: {
            plannedAmount: number;
            currencyCode: string | null;
            exchangeRate: number | null;
            sortOrder: number;
            lineType: string;
            account: {
              accountType: string;
              code: string;
              category: string | null;
              name: string;
              nameEn: string | null;
            } | null;
          },
        ) => ({
          plannedAmount: r.plannedAmount,
          currencyCode: r.currencyCode,
          exchangeRate: r.exchangeRate,
          accountType: r.account?.accountType ?? r.lineType ?? null,
          accountCode: r.account?.code ?? null,
          accountCategory: r.account?.category ?? null,
          // Prefer English name for downstream lowercase-name heuristics
          // (deterministic across locale-mixed CoAs); fall back to the
          // primary name when nameEn was never populated.
          accountName: r.account?.nameEn ?? r.account?.name ?? null,
          // Month index lives on the row's `sortOrder` field per the
          // 12-row-per-line monthly persistence contract. Anything
          // outside [0,11] is non-monthly (rollup-sourced single-row
          // legacy or hand-edited) — surface as null so resolvers
          // bypass it instead of bucketing into "month 99".
          monthIndex:
            r.sortOrder >= 0 && r.sortOrder <= 11 ? r.sortOrder : null,
        }),
      );
    },

    /**
     * Phase 7.E phase 3 — read peer IV by (org, co, code, period). Returns
     * null on missing row OR status='unknown' (the latter would otherwise
     * silently feed a placeholder 0 into a parent formula).
     */
    async getIndicatorValue({
      organizationId,
      companyId,
      indicatorCode,
      period,
    }) {
      const row = await prisma.indicatorValue.findFirst({
        where: {
          organizationId,
          companyId,
          period,
          indicator: { code: indicatorCode },
        },
        select: { value: true, status: true },
      });
      if (!row) return null;
      if (row.status === 'unknown') return null;
      return row.value;
    },

    /**
     * Phase 7.G Turn XLI (Phase C) — batched read for fact() resolver.
     * Single Prisma `findMany` with OR clause; missing rows OR
     * status='unknown' rows map to `null` keyed by `${code}@${period}`.
     * Empty pairs returns empty object without hitting Prisma.
     */
    async getIndicatorValues({ organizationId, companyId, pairs }) {
      if (pairs.length === 0) return {};
      const rows = await prisma.indicatorValue.findMany({
        where: {
          organizationId,
          companyId,
          OR: pairs.map((p) => ({
            indicator: { code: p.indicatorCode },
            period: p.period,
          })),
        },
        select: {
          value: true,
          status: true,
          period: true,
          indicator: { select: { code: true } },
        },
      });
      const result: Record<string, number | null> = {};
      // Initialise every requested pair to null so callers can rely on
      // key presence (not the same as `undefined`).
      for (const p of pairs) {
        result[`${p.indicatorCode}@${p.period}`] = null;
      }
      for (const row of rows) {
        const key = `${row.indicator.code}@${row.period}`;
        if (row.status === 'unknown') {
          result[key] = null;
        } else {
          result[key] = row.value;
        }
      }
      return result;
    },

    /**
     * Phase 7.E phase 3 — direct-children lookup for `rollup()`. Active
     * children only; org-scoped.
     */
    async listChildCompanyIds({ organizationId, parentId }) {
      const rows = await prisma.company.findMany({
        where: {
          organizationId,
          parentCompanyId: parentId,
          isActive: true,
        },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },

    async getNewsSentimentRolling30d({ organizationId, companyId }) {
      // Resolve the company's code — IntelItem.companyTags[] uses the
      // human-readable code (e.g. "AAC"), not the cuid id.
      const co = await prisma.company.findFirst({
        where: { id: companyId, organizationId },
        select: { code: true },
      });
      if (!co?.code) return null;

      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      // PostgreSQL array-contains via `has` (Prisma operator); partial
      // index `intel_items_sentiment_lookup_idx` (WHERE sentimentScore IS
      // NOT NULL) speeds the date-bound scan.
      const rows = await prisma.intelItem.findMany({
        where: {
          organizationId,
          companyTags: { has: co.code },
          fetchedAt: { gte: cutoff },
          sentimentScore: { not: null },
        },
        select: { sentimentScore: true },
      });
      if (rows.length === 0) return null;
      const sum = rows.reduce(
        (acc, r) => acc + (r.sentimentScore ?? 0),
        0,
      );
      return sum / rows.length;
    },

    async getIndicatorDisclosure({
      organizationId,
      companyId,
      indicatorCode,
      period,
    }) {
      const row = await prisma.indicatorDisclosure.findFirst({
        where: { organizationId, companyId, indicatorCode, period },
        select: { value: true, unit: true },
      });
      return row ?? null;
    },

    async upsertIndicatorValue({
      organizationId,
      companyId,
      indicatorId,
      period,
      value,
      status,
      inputs,
      sparkline,
      valueSource,
      confidence,
    }) {
      // Phase 7.E phase 2 — sparkline write semantics:
      //   - CREATE: caller-supplied array OR `[]` (the original first-write
      //     default). `[]` keeps the schema invariant `sparkline != null` so
      //     the UI doesn't have to handle null specially.
      //   - UPDATE: include the column ONLY if the caller supplied a value.
      //     Bulk recomputes that pass `withSparkline: false` (period-only
      //     fan-out, xlsx-import follow-up) MUST NOT clobber sparklines
      //     populated earlier by the offline `compute-sparklines.ts` worker
      //     OR by an interactive `withSparkline: true` recompute.
      // Phase 7.H F4.v2.1 — `valueSource` is written on both CREATE and
      // UPDATE so a seed flip (e.g. v2.2 swapping a generic placeholder
      // for industry-specific) refreshes the badge on the next recompute.
      await prisma.indicatorValue.upsert({
        where: {
          companyId_indicatorId_period: { companyId, indicatorId, period },
        },
        create: {
          organizationId,
          companyId,
          indicatorId,
          period,
          value,
          status,
          sparkline: (sparkline ?? []) as Prisma.InputJsonValue,
          inputs: inputs as unknown as Prisma.InputJsonValue,
          // Our `ValueSource` string union mirrors the generated Prisma enum
          // `IndicatorValueSource` 1:1 (declared in prisma/schema.prisma).
          // TypeScript accepts the literal union directly without a cast
          // because Prisma generates the enum as a union of the same string
          // literals.
          valueSource,
          // Phase 7.H F4.v2.2.1 — model-confidence tier written on
          // CREATE; null when caller omits.
          confidence: confidence ?? null,
        },
        update: {
          value,
          status,
          inputs: inputs as unknown as Prisma.InputJsonValue,
          computedAt: new Date(),
          // Our `ValueSource` string union mirrors the generated Prisma enum
          // `IndicatorValueSource` 1:1 (declared in prisma/schema.prisma).
          // TypeScript accepts the literal union directly without a cast
          // because Prisma generates the enum as a union of the same string
          // literals.
          valueSource,
          // Confidence on UPDATE: caller's null clears the tier (mirrors
          // disclosed-override → no tier). Recompute always passes a
          // value or null; undefined → null via the `??` coercion.
          confidence: confidence ?? null,
          ...(sparkline !== undefined && {
            sparkline: sparkline as Prisma.InputJsonValue,
          }),
        },
      });
    },
  };
}

// --- Helpers -----------------------------------------------------------------

function toSnakeCase(camel: string): string {
  return camel
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

function revenueInBase(b: BookingRow): number {
  if (b.currencyCode == null) return b.revenue;
  const rate = b.exchangeRate ?? 1;
  return b.revenue * rate;
}

function computeHhi(
  countryToRevenue: Map<string, number>,
  total: number,
): number {
  if (total <= 0 || countryToRevenue.size === 0) return 0;
  let hhi = 0;
  for (const rev of countryToRevenue.values()) {
    const pct = (rev / total) * 100;
    hhi += pct * pct;
  }
  return hhi;
}

// --- Resolver registry -------------------------------------------------------

/** Mutable state threaded through resolvers + post-processors. */
interface BuildState {
  context: FormulaContext;
  inputs: RecomputeInputs;
  /**
   * Phase 7.E phase 3 — formula-engine functions injected by resolvers.
   * Today populated by `factResolver` + `rollupResolver`; the engine sees
   * them via the `functions` arg of `tryEvaluateFormula`. Each function
   * closes over a per-recompute snapshot map (no DB access at eval time
   * — required because expr-eval is synchronous).
   */
  functions: Record<string, FormulaFunction>;
}

interface ResolverCtx {
  ds: RecomputeDataSource;
  organizationId: string;
  companyId: string;
  period: Period;
  /** Company-base currency code (or "AZN" fallback). Used by the budgetLine
   *  resolver to NOT treat lines tagged with the company's base currency as
   *  foreign — see CXLVIII regression note in the resolver body. */
  baseCurrency: string;
  /**
   * Phase 7.H F4.v2.2 — company industry code (e.g. "agro_crops",
   * "real_estate"). Threaded from the recompute trigger so the
   * `industryFactorResolver` can pick the right sector intensity
   * factor without an extra DB read. `null` when the company has no
   * industry set (defensive — Company.industry is required at the
   * schema level today but legacy fixtures may omit it).
   */
  industry: string | null;
}

interface NamespaceResolver {
  name: string;
  /** True if this resolver handles the raw requiredInput string. */
  matches(requiredInput: string): boolean;
  /** Populate context + aggregates for the matched inputs. Called once per
   *  namespace per recompute — guaranteed by the single RESOLVERS loop in
   *  `buildContext`, which passes each resolver its full matched batch. */
  resolve(
    matchedInputs: string[],
    ctx: ResolverCtx,
    state: BuildState,
  ): Promise<void>;
}

const bookingResolver: NamespaceResolver = {
  name: 'booking',
  matches: (r) => r === 'booking' || r.startsWith('booking.'),
  async resolve(_matched, ctx, state) {
    const bookings = await ctx.ds.listBookings({
      organizationId: ctx.organizationId,
      companyId: ctx.companyId,
      start: ctx.period.start,
      end: ctx.period.end,
    });
    const active = bookings.filter((b) => !b.isCancelled);

    let rooms_sold = 0;
    let nights_sold = 0;
    let room_revenue = 0;
    let fx_revenue = 0;
    let missing_rate_count = 0;
    const rev_by_country = new Map<string, number>();

    for (const b of active) {
      rooms_sold += b.roomsBooked ?? 0;
      nights_sold += b.nights;
      const revBase = revenueInBase(b);
      room_revenue += revBase;
      if (b.currencyCode != null) {
        fx_revenue += revBase;
        // Non-null currency with no rate means we silently fell back to 1 —
        // record it so FX-sensitive indicators don't trust a fake zero delta.
        if (b.exchangeRate == null) missing_rate_count += 1;
      }
      rev_by_country.set(
        b.sourceCountry,
        (rev_by_country.get(b.sourceCountry) ?? 0) + revBase,
      );
    }

    const fx_revenue_share = room_revenue > 0 ? fx_revenue / room_revenue : 0;
    const source_country_hhi = computeHhi(rev_by_country, room_revenue);

    state.context.rooms_sold = rooms_sold;
    state.context.nights_sold = nights_sold;
    state.context.room_revenue = room_revenue;
    state.context.fx_revenue_share = fx_revenue_share;
    state.context.source_country_hhi = source_country_hhi;

    state.inputs.resolved.rooms_sold = rooms_sold;
    state.inputs.resolved.nights_sold = nights_sold;
    state.inputs.resolved.room_revenue = room_revenue;
    state.inputs.resolved.fx_revenue_share = fx_revenue_share;
    state.inputs.resolved.source_country_hhi = source_country_hhi;

    state.inputs.aggregates.booking = {
      booking_count: active.length,
      cancelled_count: bookings.length - active.length,
      fx_revenue,
      missing_rate_count,
      rev_by_country: Object.fromEntries(rev_by_country),
    };
  },
};

const companySettingsResolver: NamespaceResolver = {
  name: 'company.settings',
  matches: (r) => r.startsWith('company.settings.'),
  async resolve(matched, ctx, state) {
    const settings = await ctx.ds.getCompanySettings({
      organizationId: ctx.organizationId,
      companyId: ctx.companyId,
    });
    const plucked: Record<string, number> = {};
    for (const raw of matched) {
      const key = raw.slice('company.settings.'.length);
      const value = settings?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        const snake = toSnakeCase(key);
        state.context[snake] = value;
        state.inputs.resolved[snake] = value;
        plucked[snake] = value;
      }
    }
    state.inputs.aggregates.company_settings = plucked;
  },
};

const operationalFactResolver: NamespaceResolver = {
  name: 'operationalFact',
  matches: (r) => r.startsWith('operationalFact:'),
  async resolve(matched, ctx, state) {
    const perMetric: Record<
      string,
      { count: number; avg: number | null }
    > = {};
    for (const raw of matched) {
      const metric = raw.slice('operationalFact:'.length);
      const rows = await ctx.ds.listOperationalFacts({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        metric,
        start: ctx.period.start,
        end: ctx.period.end,
      });
      if (rows.length === 0) {
        perMetric[metric] = { count: 0, avg: null };
        continue;
      }
      const avg = rows.reduce((a, r) => a + r.value, 0) / rows.length;
      state.context[metric] = avg;
      state.inputs.resolved[metric] = avg;
      perMetric[metric] = { count: rows.length, avg };
    }
    state.inputs.aggregates.operational_fact = perMetric;
  },
};

// Phase 7.H Feature B — news sentiment resolver.
// Exposes the rolling-30-day average sentiment for IntelItems tagged
// with the company's code as a single context variable
// `news_sentiment_30d` ∈ [-1, +1]. NULL = no scored news in the window
// (formula resolves to NaN → status='unknown' downstream, which the
// UI renders as a blank/grey cell — the honest answer when we have
// nothing to say). Triggered by any `requiredInputs` entry equal to
// `news.sentiment30d` or starting with `news.sentiment30d.`.
const newsSentimentResolver: NamespaceResolver = {
  name: 'news.sentiment',
  matches: (r) => r === 'news.sentiment30d' || r.startsWith('news.sentiment30d.'),
  async resolve(_matched, ctx, state) {
    const avg = await ctx.ds.getNewsSentimentRolling30d({
      organizationId: ctx.organizationId,
      companyId: ctx.companyId,
    });
    if (avg !== null && Number.isFinite(avg)) {
      state.context['news_sentiment_30d'] = avg;
      state.inputs.resolved['news_sentiment_30d'] = avg;
    }
    state.inputs.aggregates.news_sentiment = { avg, hasData: avg !== null };
  },
};

/**
 * Phase 7.I — weather resolver.
 *
 * Triggers: any `requiredInputs` entry like `weather:<metric>` (e.g.
 *   `weather:rainfall_mm_90d`, `weather:temp_avg_c_30d`).
 *
 * Flow: read `company.settings.region` (e.g. "salyan"), look up the
 * latest `IntelDataPoint` where sourceCode='weather-openmeteo' and
 * metric=`<REGION>_<METRIC>` (the adapter writes per-region rows so
 * one ingest covers every AzerSheker entity downstream).
 *
 * Exposes the bare metric name to the formula context (e.g. the
 * formula `rainfall_mm_90d` resolves to the value), matching the
 * operationalFactResolver convention.
 *
 * Graceful degradation: when company.settings.region is missing, or
 * when no IntelDataPoint exists for that region+metric, leaves the
 * context var unset → formula evaluates to NaN → IV status='unknown'
 * (the right "honest" answer; no synthetic placeholder).
 */
const WEATHER_SOURCE_CODE = 'weather-openmeteo';
const weatherResolver: NamespaceResolver = {
  name: 'weather',
  matches: (r) => r.startsWith('weather:'),
  async resolve(matched, ctx, state) {
    // Resolve region once per recompute (per-company).
    const settings = await ctx.ds.getCompanySettings({
      organizationId: ctx.organizationId,
      companyId: ctx.companyId,
    });
    const region =
      settings && typeof settings.region === 'string'
        ? settings.region.toLowerCase()
        : null;
    const perMetric: Record<string, { value: number | null; region: string | null }> = {};
    if (!ctx.ds.listIntelDataPoints || !region) {
      // No DataSource impl or no region — emit per-metric nulls for snapshot.
      for (const raw of matched) {
        const m = raw.slice('weather:'.length);
        perMetric[m] = { value: null, region };
      }
      state.inputs.aggregates.weather = perMetric;
      return;
    }
    for (const raw of matched) {
      const varName = raw.slice('weather:'.length);
      const dbMetric = `${region.toUpperCase()}_${varName.toUpperCase()}`;
      const rows = await ctx.ds.listIntelDataPoints({
        organizationId: ctx.organizationId,
        sourceCode: WEATHER_SOURCE_CODE,
        metric: dbMetric,
        limit: 1,
      });
      if (rows.length === 0) {
        perMetric[varName] = { value: null, region };
        continue;
      }
      // Adapter orders ASC; the most recent is the last row.
      const value = rows[rows.length - 1].value;
      state.context[varName] = value;
      state.inputs.resolved[varName] = value;
      perMetric[varName] = { value, region };
    }
    state.inputs.aggregates.weather = perMetric;
  },
};

/**
 * Phase 7.I — commodity-price resolver.
 *
 * Triggers: `commodityPrice:<varName>` requiredInput. The varName maps
 * to a series-and-aggregator via the COMMODITY_PRICE_ALIASES table:
 *
 *   sugar_price_latest    → latest monthly close, sugar-yahoo-sb-f
 *   sugar_price_mean_12m  → trailing-12-month mean of same series
 *   sugar_price_stdev_12m → trailing-12-month stdev of same series
 *
 * The alias table is the single source of truth for "which commodity
 * series feeds which formula variable" — adding a new commodity later
 * (cotton, wheat) is one table row + one adapter, no resolver code change.
 *
 * Exposes `varName` (bare) to the formula context; aggregate snapshot
 * records the (alias, series, agg, n_samples) tuple for forensics in
 * Panel 3.
 */
interface CommodityAlias {
  varName: string;
  sourceCode: string;
  metric: string;
  /** How to derive the value from the series. */
  aggregator: 'latest' | 'mean_12m' | 'stdev_12m';
}
const COMMODITY_PRICE_ALIASES: readonly CommodityAlias[] = [
  {
    varName: 'sugar_price_latest',
    sourceCode: 'sugar-yahoo-sb-f',
    metric: 'SUGAR_RAW_USD_TONNE',
    aggregator: 'latest',
  },
  {
    varName: 'sugar_price_mean_12m',
    sourceCode: 'sugar-yahoo-sb-f',
    metric: 'SUGAR_RAW_USD_TONNE',
    aggregator: 'mean_12m',
  },
  {
    varName: 'sugar_price_stdev_12m',
    sourceCode: 'sugar-yahoo-sb-f',
    metric: 'SUGAR_RAW_USD_TONNE',
    aggregator: 'stdev_12m',
  },
];

function aggregateCommodity(
  values: number[],
  agg: CommodityAlias['aggregator'],
): number | null {
  if (values.length === 0) return null;
  if (agg === 'latest') return values[values.length - 1];
  const sample = values.slice(-12);
  if (sample.length === 0) return null;
  const mean = sample.reduce((s, v) => s + v, 0) / sample.length;
  if (agg === 'mean_12m') return mean;
  // stdev_12m: population stdev (we control the sample size, no inferential need)
  const variance =
    sample.reduce((s, v) => s + (v - mean) ** 2, 0) / sample.length;
  return Math.sqrt(variance);
}

const commodityPriceResolver: NamespaceResolver = {
  name: 'commodityPrice',
  matches: (r) => r.startsWith('commodityPrice:'),
  async resolve(matched, ctx, state) {
    const perAlias: Record<
      string,
      { value: number | null; sourceCode: string; aggregator: string; samples: number }
    > = {};
    if (!ctx.ds.listIntelDataPoints) {
      for (const raw of matched) {
        const varName = raw.slice('commodityPrice:'.length);
        const alias = COMMODITY_PRICE_ALIASES.find((a) => a.varName === varName);
        if (alias) {
          perAlias[varName] = {
            value: null,
            sourceCode: alias.sourceCode,
            aggregator: alias.aggregator,
            samples: 0,
          };
        }
      }
      state.inputs.aggregates.commodity_price = perAlias;
      return;
    }
    // Group needed aliases by sourceCode+metric so we hit the DB once per
    // series even if multiple aggregators read it.
    const seriesKey = (a: CommodityAlias) => `${a.sourceCode}::${a.metric}`;
    const seriesCache = new Map<string, number[]>();
    for (const raw of matched) {
      const varName = raw.slice('commodityPrice:'.length);
      const alias = COMMODITY_PRICE_ALIASES.find((a) => a.varName === varName);
      if (!alias) continue;
      const key = seriesKey(alias);
      if (!seriesCache.has(key)) {
        const rows = await ctx.ds.listIntelDataPoints({
          organizationId: ctx.organizationId,
          sourceCode: alias.sourceCode,
          metric: alias.metric,
          limit: 24, // up to 2y monthly — enough for 12m windows + buffer
        });
        seriesCache.set(
          key,
          rows.map((r) => r.value),
        );
      }
      const series = seriesCache.get(key) ?? [];
      const value = aggregateCommodity(series, alias.aggregator);
      if (value !== null && Number.isFinite(value)) {
        state.context[varName] = value;
        state.inputs.resolved[varName] = value;
      }
      perAlias[varName] = {
        value,
        sourceCode: alias.sourceCode,
        aggregator: alias.aggregator,
        samples: series.length,
      };
    }
    state.inputs.aggregates.commodity_price = perAlias;
  },
};

const currencyRateResolver: NamespaceResolver = {
  name: 'currencyRate',
  matches: (r) => r === 'currencyRate',
  async resolve(_matched, ctx, state) {
    const rates = await ctx.ds.listCurrencyRates({
      organizationId: ctx.organizationId,
      asOf: ctx.period.end,
    });
    const snapshot: Record<string, number> = {};
    let base: string | null = null;
    for (const r of rates) {
      if (r.isBase) base = r.currencyCode;
      // Context var name: `fx_<code_lowercase>`. Base currency gets
      // fx_<code>=1 so formulas that reference it explicitly still resolve.
      const varName = `fx_${r.currencyCode.toLowerCase()}`;
      state.context[varName] = r.rate;
      state.inputs.resolved[varName] = r.rate;
      snapshot[varName] = r.rate;
    }
    state.inputs.aggregates.currency_rate = {
      base_currency: base,
      rate_count: rates.length,
      rates: snapshot,
    };
  },
};

/**
 * Aggregates `BudgetLine` rows into P&L-shaped context vars for a single
 * company within the period's year.
 *
 * **Exposed context vars (base currency):**
 *   - `revenue`, `cogs`, `opex` — raw sums by `account.accountType`
 *   - `total_cost` = cogs + opex (full operating base)
 *   - `total_input_cost` = **cogs only** — "input" in the finance sense
 *     means raw materials / feed / seed / fuel, not payroll / rent /
 *     marketing. `AGRO_FX_RISK` and similar FX-input indicators divide
 *     `imported_input_cost` by this, so including opex would dilute the
 *     ratio.
 *   - `imported_input_cost` = foreign-denominated **cogs only** (same
 *     reasoning as `total_input_cost`)
 *   - `domestic_input_cost` = base-currency cogs only
 *   - `gross_profit` = revenue − cogs
 *   - `net_income` = revenue − cogs − opex
 *
 * **`imported_*` semantics — MVP heuristic.** A line is counted as
 * "imported" if its `currencyCode` is non-null (plan authored in a foreign
 * currency). This is a proxy for the real signal, which would be an
 * explicit import-origin tag on the budget line or account — that tagging
 * doesn't exist in the schema yet. Consequence: a domestic supplier
 * invoiced in USD looks imported, and an imported good paid in AZN looks
 * domestic. Document the approximation when showing this to finance
 * users; replace the heuristic once `BudgetLine.isImported` or an
 * equivalent `ChartOfAccount.role` lands.
 *
 * **Foreign line without exchangeRate — skip, don't inflate.** Earlier
 * versions fell back to rate=1, which silently inflated the base-currency
 * total by the full foreign amount. Now such lines are excluded from all
 * aggregates and counted under `missing_rate_count` so the tenant can see
 * them and fix the data. The aggregate still reports `line_count = total
 * rows returned by the DS` (incl. skipped) — divergence from `line_count −
 * missing_rate_count` is the UI's cue that data needs attention.
 */
const budgetLineResolver: NamespaceResolver = {
  name: 'budgetLine',
  // Match the bare namespace AND any `budgetLine.<sub>` requirement so
  // sub-aggregations land in the same DB read as the P&L roll-up.
  matches: (r) => r === 'budgetLine' || r.startsWith('budgetLine.'),
  async resolve(matched, ctx, state) {
    const lines = await ctx.ds.listBudgetLines({
      organizationId: ctx.organizationId,
      companyId: ctx.companyId,
      period: ctx.period,
    });

    let revenue = 0;
    let cogs = 0;
    let opex = 0;
    let imported_cogs = 0;
    let domestic_cogs = 0;
    let imported_opex = 0;
    let domestic_opex = 0;
    let missing_rate_count = 0;

    // Defensive: a line tagged with the company's base currency is NOT
    // foreign — treat as base regardless of whether `exchangeRate` is set.
    // CXLVIII regression class: pre-fix imports stamped every base-currency
    // line with `currencyCode='AZN'` + no rate, which the strict-foreign
    // path below skipped, zeroing out 100% of revenue/cogs/opex.
    const baseCcy = ctx.baseCurrency;
    for (const l of lines) {
      const isForeign = l.currencyCode != null && l.currencyCode !== baseCcy;
      // Skip foreign lines without an explicit rate rather than silently
      // assume 1:1 — that would inflate P&L denominators.
      if (isForeign && l.exchangeRate == null) {
        missing_rate_count += 1;
        continue;
      }
      const rate = l.exchangeRate ?? 1;
      const amountBase = isForeign ? l.plannedAmount * rate : l.plannedAmount;

      const type = l.accountType;
      if (type === 'revenue') {
        revenue += amountBase;
      } else if (type === 'cogs') {
        cogs += amountBase;
        if (isForeign) imported_cogs += amountBase;
        else domestic_cogs += amountBase;
      } else if (type === 'expense') {
        opex += amountBase;
        if (isForeign) imported_opex += amountBase;
        else domestic_opex += amountBase;
      }
      // asset/liability/equity rows are ignored for P&L-shaped context.
    }

    // Semantic split (see resolver jsdoc above):
    //   - `total_cost`        = full operating base (cogs + opex)
    //   - `total_input_cost`  = cogs only (input ≠ payroll / rent / marketing)
    //   - `imported_input_cost` = foreign-denominated cogs only — this is what
    //     AGRO_FX_RISK divides by `total_input_cost` for an input-side FX share
    //   - `imported_total_cost` (aggregate-only) = all foreign lines cogs+opex,
    //     kept for drill-down but NOT used as a denominator
    const total_cost = cogs + opex;
    const total_input_cost = cogs;
    const imported_input_cost = imported_cogs;
    const domestic_input_cost = domestic_cogs;
    const gross_profit = revenue - cogs;
    const net_income = revenue - cogs - opex;

    state.context.revenue = revenue;
    state.context.cogs = cogs;
    state.context.opex = opex;
    state.context.total_cost = total_cost;
    state.context.total_input_cost = total_input_cost;
    state.context.imported_input_cost = imported_input_cost;
    state.context.domestic_input_cost = domestic_input_cost;
    state.context.gross_profit = gross_profit;
    state.context.net_income = net_income;

    state.inputs.resolved.revenue = revenue;
    state.inputs.resolved.cogs = cogs;
    state.inputs.resolved.opex = opex;
    state.inputs.resolved.total_cost = total_cost;
    state.inputs.resolved.total_input_cost = total_input_cost;
    state.inputs.resolved.imported_input_cost = imported_input_cost;
    state.inputs.resolved.domestic_input_cost = domestic_input_cost;
    state.inputs.resolved.gross_profit = gross_profit;
    state.inputs.resolved.net_income = net_income;

    state.inputs.aggregates.budget_line = {
      line_count: lines.length,
      revenue,
      cogs,
      opex,
      imported_total_cost: imported_cogs + imported_opex,
      domestic_total_cost: domestic_cogs + domestic_opex,
      missing_rate_count,
    };

    // --- Sub-aggregations (`budgetLine.<sub>`) ----------------------------
    // Each requested sub becomes a context var with the same name. We run
    // the matching pass over the same `lines` array — one DB read total.
    // Lines that were skipped above (foreign with no rate) are also
    // skipped here for consistency.
    const validLines = lines
      .filter(
        (l) => !(l.currencyCode != null && l.exchangeRate == null),
      )
      .map((l) => ({
        line: l,
        amountBase:
          l.currencyCode != null
            ? l.plannedAmount * (l.exchangeRate ?? 1)
            : l.plannedAmount,
      }));
    const subs = matched
      .filter((m) => m.startsWith('budgetLine.'))
      .map((m) => m.slice('budgetLine.'.length));
    if (subs.length > 0) {
      const subAggregations: Record<string, BudgetLineSubAggregation> = {};
      for (const sub of subs) {
        const matcher = SUB_AGGREGATION_MATCHERS[sub];
        if (!matcher) {
          // Unknown sub key — surface as zero+empty rather than silent skip.
          // Indicator will fall to `unknown` because `<sub>` is missing
          // from context, with a clean reason from the formula engine.
          subAggregations[sub] = {
            value: 0,
            matched_count: 0,
            top_lines: [],
            matched_by: [],
          };
          continue;
        }
        const result = applyBudgetLineSubMatcher(matcher, validLines);
        if (result.matched_count > 0) {
          state.context[sub] = result.value;
          state.inputs.resolved[sub] = result.value;
        }
        subAggregations[sub] = result;
      }
      state.inputs.aggregates.budget_line.sub_aggregations = subAggregations;
    }
  },
};

// --- BudgetLine sub-aggregation matchers -------------------------------------
// Each matcher returns `{ accept, matchedBy }` per line. The driver below
// applies the matcher across all lines and produces a SubAggregation. This
// shape is deliberately verbose so the heuristics are inspectable in tests.

interface SubMatcher {
  /** Decides whether a line is in the bucket. The string returned identifies
   *  WHICH heuristic fired (`category` / `code_prefix` / `name` / `accountType`)
   *  for drill-down attribution. Return null to reject. */
  test(line: BudgetLineRow): string | null;
  /** Reduce amounts. Default = sum. Override for HHI / max / etc. */
  reduce?(samples: Array<{ line: BudgetLineRow; amountBase: number }>): number;
  /**
   * Optional validity gate AFTER lines have been collected. Used by
   * `revenueBySeason` to demand ≥ 3 distinct months — otherwise the
   * "top-3-month share" formula degenerates to 100% trivially. When this
   * returns false, the driver forces `matched_count=0` so the indicator
   * cleanly resolves to `unknown` (downstream formula sees missing var).
   * Skipping `isValid` keeps the existing behavior: matched_count = number
   * of `test()` accepts.
   */
  isValid?(samples: Array<{ line: BudgetLineRow; amountBase: number }>): boolean;
}

const startsWithCode = (line: BudgetLineRow, prefix: string): boolean =>
  line.accountCode != null && line.accountCode.startsWith(prefix);

const nameIncludes = (line: BudgetLineRow, needle: string): boolean =>
  line.accountName != null &&
  line.accountName.toLowerCase().includes(needle);

/**
 * Sub-aggregation matchers, keyed by the suffix in `budgetLine.<sub>`.
 *
 * Heuristic ladder for code-pattern-driven matchers (rd_spend, inventory,
 * debt_service, feed_cost): explicit `category` tag → SAP code prefix →
 * lowercase name substring. First hit wins — surfaced via `matched_by`
 * so users see whether they're getting an explicit tag or a fallback.
 *
 * `revenue_line_hhi` is a structural matcher (HHI on per-code revenue),
 * not a content one — implemented inline in `applyBudgetLineSubMatcher`.
 *
 * `revenueBySeason` (Phase 7.E perMonth chain phase 1, 2026-04-30) reads
 * monthly distribution from the existing 12-row-per-line persistence
 * (apply route + import-azmade-budgets each write 12 BudgetLine rows
 * carrying one month's value, with `sortOrder` 0..11 = month index).
 * `monthIndex` on the row shape mirrors `sortOrder`; the matcher
 * groups revenue by month and uses the optional `isValid` gate to
 * reject degenerate <3-month plans (would falsely compute as 100% top-3
 * concentration).
 */
const SUB_AGGREGATION_MATCHERS: Record<string, SubMatcher> = {
  rd_spend: {
    test(line) {
      if (line.accountCategory === 'rd' || line.accountCategory === 'r_and_d')
        return 'category';
      if (startsWithCode(line, '720')) return 'code_prefix';
      if (
        nameIncludes(line, 'r&d') ||
        nameIncludes(line, 'research') ||
        nameIncludes(line, 'r and d') ||
        nameIncludes(line, 'нир') ||
        nameIncludes(line, 'ниокр')
      )
        return 'name';
      return null;
    },
  },
  inventory: {
    // **Functionally dormant until balance-sheet ingest lands.** This
    // matcher requires `accountType='asset'` because inventory is a
    // balance, not a P&L flow. The current ingest path
    // (`scripts/import-azmade-budgets.ts` + `applier.ts`) writes only
    // revenue/cogs/expense rows from P&L sheets — there are no
    // `accountType='asset'` BudgetLine rows in production data today.
    // PHARMA_INVENTORY_DAYS / FP_INVENTORY_TURNS therefore land as
    // `unknown` until either (a) a balance-sheet xlsx ingest lands, or
    // (b) finance teams start authoring asset-balance lines through the
    // future onboarding wizard. The matcher is correct; the upstream
    // data is the missing piece. Tracked in CARRYOVER as a follow-up.
    test(line) {
      if (line.accountType !== 'asset') return null;
      if (line.accountCategory === 'inventory') return 'category';
      if (startsWithCode(line, '103')) return 'code_prefix';
      if (
        nameIncludes(line, 'inventory') ||
        nameIncludes(line, 'запас') ||
        nameIncludes(line, 'материал')
      )
        return 'name';
      return null;
    },
  },
  debt_service: {
    test(line) {
      // Hard gate: debt service is an EXPENSE outflow, never a revenue
      // line. Without this, an "Interest Income" revenue line would
      // pollute the denominator of RE_DEBT_SERVICE_COVERAGE
      // (gross_profit / debt_service) and silently inflate coverage.
      if (line.accountType !== 'expense') return null;
      if (line.accountCategory === 'debt_service') return 'category';
      // No SAP-prefix heuristic for debt service — 75x is staff in our
      // CoA. Names are the reliable signal.
      if (
        nameIncludes(line, 'interest') ||
        nameIncludes(line, 'debt service') ||
        nameIncludes(line, 'debt-service') ||
        nameIncludes(line, 'процент') ||
        nameIncludes(line, 'обслуж') // обслуживание долга
      )
        return 'name';
      return null;
    },
  },
  feed_cost: {
    test(line) {
      if (line.accountType !== 'cogs') return null;
      if (line.accountCategory === 'feed') return 'category';
      // Poultry CoA template puts Feed at code 711 — but so does every
      // other industry (711 = first cogs line). Disambiguate via name to
      // avoid a false positive on "Raw Materials" / "Active Ingredients".
      if (
        nameIncludes(line, 'feed') ||
        nameIncludes(line, 'корм')
      )
        return 'name';
      return null;
    },
  },
  revenue_line_hhi: {
    test(line) {
      // Filter to revenue lines; the actual HHI math runs in `reduce`.
      if (line.accountType !== 'revenue') return null;
      return 'accountType';
    },
    reduce(samples) {
      if (samples.length === 0) return 0;
      // Group by accountCode (or fallback to accountName / line index for
      // un-coded legacy rows). Each unique key contributes one share.
      const byKey = new Map<string, number>();
      let i = 0;
      let total = 0;
      for (const s of samples) {
        const key =
          s.line.accountCode ??
          s.line.accountName ??
          `__line_${i++}`;
        byKey.set(key, (byKey.get(key) ?? 0) + s.amountBase);
        total += s.amountBase;
      }
      if (total <= 0) return 0;
      let hhi = 0;
      for (const v of byKey.values()) {
        const pct = (v / total) * 100;
        hhi += pct * pct;
      }
      return hhi;
    },
  },
  /**
   * **`budgetLine.revenueBySeason`** — top-3-month revenue concentration.
   *
   * Aggregates revenue lines by `monthIndex` (0..11), then returns the
   * share of annual revenue that lands in the 3 highest-grossing months
   * (range 25.0..100.0 since at least 3/12=25% can't be avoided).
   *
   * Used by `ENT_SEASONALITY_CONCENTRATION`:
   *   - Green ≤ 40 — well-diversified across the year
   *   - Amber ≤ 55 — peak quarter dominates (theme parks, ski resorts)
   *   - Red  > 55 — single bad season kills the year
   *
   * **Skip semantics** — lines without `monthIndex` (legacy single-row
   * imports / rollup-sourced flat splits) are excluded. If FEWER than 3
   * distinct months carry revenue, the indicator returns `unknown` (the
   * resolver wraps null in matched_count=0). Avoids false-100% from a
   * one-month dataset.
   */
  revenueBySeason: {
    test(line) {
      if (line.accountType !== 'revenue') return null;
      // Only monthly-distributed rows participate. Non-monthly rows
      // (rollup sources, legacy single-row plans) can't say which month
      // — bucketing them into month 0 would create fake January spikes.
      if (line.monthIndex === null) return null;
      return 'monthIndex';
    },
    /**
     * Reject the aggregation entirely if revenue lands in fewer than
     * 3 distinct months — "top-3-month share" trivially evaluates to
     * 100% with 1-2 months and a `green` ENT_SEASONALITY_CONCENTRATION
     * read on a degenerate dataset would be a false-positive. The driver
     * forces matched_count=0 in this case, which makes the indicator
     * resolve to `unknown` rather than a misleading green.
     */
    isValid(samples) {
      // Count months that carry NON-ZERO revenue. Edge case the test
      // exposed: monthlyRevenue helper creates 12 rows even for a single-
      // month plan (11 zero-amount rows + 1 with the full annual). All 12
      // pass `test()` because they have monthIndex+revenue accountType,
      // but the operational reality is "revenue arrives in 1 month" —
      // top-3-share would falsely compute as 100% (all-rev top 3 = total).
      // Filter zero-amount rows here so the structural gate matches the
      // economic intent.
      const monthsWithRevenue = new Set<number>();
      let total = 0;
      for (const s of samples) {
        if (s.line.monthIndex !== null && s.amountBase > 0) {
          monthsWithRevenue.add(s.line.monthIndex);
        }
        total += s.amountBase;
      }
      return monthsWithRevenue.size >= 3 && total > 0;
    },
    reduce(samples) {
      if (samples.length === 0) return 0;
      const byMonth = new Map<number, number>();
      let total = 0;
      for (const s of samples) {
        const m = s.line.monthIndex!;
        byMonth.set(m, (byMonth.get(m) ?? 0) + s.amountBase);
        total += s.amountBase;
      }
      // isValid already gated; reduce can assume ≥3 months + total>0.
      // Belt-and-braces: keep the guards in case isValid is bypassed.
      if (byMonth.size < 3 || total <= 0) return 0;
      // Top 3 months by absolute revenue.
      const sorted = Array.from(byMonth.values()).sort((a, b) => b - a);
      const top3 = sorted.slice(0, 3).reduce((s, v) => s + v, 0);
      return (top3 / total) * 100;
    },
  },
};

function applyBudgetLineSubMatcher(
  matcher: SubMatcher,
  validLines: Array<{ line: BudgetLineRow; amountBase: number }>,
): BudgetLineSubAggregation {
  const matchedSamples: Array<{
    line: BudgetLineRow;
    amountBase: number;
    by: string;
  }> = [];
  for (const v of validLines) {
    const by = matcher.test(v.line);
    if (by) matchedSamples.push({ ...v, by });
  }
  // Optional post-collection validity gate. When isValid returns false,
  // the indicator falls through to `unknown` because matched_count=0
  // suppresses `state.context.<sub>` set at the resolver level. Used
  // for sub-aggregations whose math degenerates without a minimum
  // structural condition (e.g. revenueBySeason needs ≥ 3 months).
  const valid = matcher.isValid ? matcher.isValid(matchedSamples) : true;
  const value = valid
    ? matcher.reduce != null
      ? matcher.reduce(matchedSamples)
      : matchedSamples.reduce((a, s) => a + s.amountBase, 0)
    : 0;
  // Top-3 by absolute amount for drill-down. Stable sort — preserve input
  // order on ties so identical lines don't shuffle between recomputes.
  const topLines = [...matchedSamples]
    .sort((a, b) => Math.abs(b.amountBase) - Math.abs(a.amountBase))
    .slice(0, 3)
    .map((s) => ({
      code: s.line.accountCode,
      name: s.line.accountName,
      amount: s.amountBase,
    }));
  const matchedByCounts = new Map<string, number>();
  for (const s of matchedSamples) {
    matchedByCounts.set(s.by, (matchedByCounts.get(s.by) ?? 0) + 1);
  }
  // Sort `matched_by` so its serialization is deterministic for tests +
  // diff-friendly snapshots.
  const matchedBy = Array.from(matchedByCounts.keys()).sort();
  return {
    value,
    // When isValid rejects, force matched_count=0 so the resolver
    // doesn't set `state.context[sub]` and the formula resolves to
    // `unknown` cleanly. Top-lines + matched-by are still surfaced for
    // drill-down — operators see WHICH lines were collected even when
    // the structural gate rejected the aggregation.
    matched_count: valid ? matchedSamples.length : 0,
    top_lines: topLines,
    matched_by: matchedBy,
  };
}

// ─── Phase 7.E phase 3 — namespace-resolver canonical prefixes ───────────
// Sub-44 prereq-#1 architect closure (carried into prereq #2 commit). The
// `fact:` and `rollup:` prefix strings were hardcoded at 8+ sites across
// `recompute.ts` (resolver `matches`, body slices, validator) AND
// `targets.ts` (rollup-bearing predicate). A future rename or v2
// extension (e.g. `rollup:<CODE>:<AGG>` per the comment at the rollup
// resolver below) would require touching every site with no compile-
// time guard. Centralizing here gives:
//
//   1. Single source of truth — typo on import is a TS error.
//   2. Future v2 prefix extension migrates by editing one constant.
//   3. Cross-module discoverability — `targets.ts:isRollupIndicator`
//      and the validator both reach the SAME constant.
//
// Intentionally NOT exported as `const enum` — would inline the value
// at compile time, defeating the single-source goal during dev hot-
// reload. Plain `const` ensures every importer reads the same string
// at runtime.
export const FACT_INPUT_PREFIX = 'fact:';
export const ROLLUP_INPUT_PREFIX = 'rollup:';

/**
 * Phase 7.E phase 3 — `fact(code, period)` formula function.
 *
 * Reads the persisted spot value of `IndicatorValue` for the SAME company
 * at a different period, enabling cross-period composites like
 * year-over-year deltas, prior-quarter comparisons, etc.
 *
 * Pre-fetch model: every (code, period) pair the formula will touch must
 * be declared in `IndicatorDefinition.requiredInputs` as
 * `fact:CODE@PERIOD` — the resolver fans out the reads in parallel,
 * stuffs them into a Map, then exposes a synchronous `fact()` closure
 * for the formula engine. Required because expr-eval is sync; can't
 * await DB calls inside `expr.evaluate()`.
 *
 * Required-input format: `fact:<INDICATOR_CODE>@<PERIOD>`
 *   - `<INDICATOR_CODE>` mirrors `IndicatorDefinition.code` (e.g.
 *     `IND_NET_MARGIN`).
 *   - `<PERIOD>` is the period string the recompute pipeline uses
 *     elsewhere (`"2025"`, `"2026-Q2"`, `"2026-04"`). NOT the relative
 *     "prev_year" syntax — keep it explicit so seed authors can't mis-
 *     compute the period at indicator level (the same indicator at
 *     monthly granularity vs annual would resolve "prev_year" to
 *     different values and that's confusing).
 *
 * Lenient parsing: malformed `requiredInputs` entries (missing `@`,
 * empty code, empty period) are silently skipped. The formula will see
 * `fact()` return NaN for those keys → propagates to formula failure
 * → IV status='unknown'. We could throw at parse time but that aborts
 * the entire indicator over a typo; soft-fail is friendlier.
 *
 * Missing IV: returns null in the read map. The exposed `fact()` closure
 * maps null → NaN so the formula propagates the missing-input failure
 * naturally. The aggregate snapshot keeps null (drill-down sees the gap).
 *
 * Cost: Phase 7.G Turn XLI batched the resolver into a single
 * `getIndicatorValues` call (one `findMany` with OR clause) instead of
 * N concurrent `findFirst`s. Phase F scale (~1500 reads) → ~60 batched
 * queries (one per recompute target). Original v1 cost note preserved
 * in git history.
 */
const factResolver: NamespaceResolver = {
  name: 'fact',
  matches: (r) => r === 'fact' || r.startsWith(FACT_INPUT_PREFIX),
  async resolve(matched, ctx, state) {
    interface ParsedFactKey {
      raw: string;
      code: string;
      period: string;
      key: string; // canonical `${code}@${period}`
    }
    const parsed: ParsedFactKey[] = [];
    for (const raw of matched) {
      // Strip `fact:` prefix; bare `fact` (no colon) is a no-op declaration —
      // the seed author wanted the function in scope without pre-fetching
      // any specific (code, period). The function still resolves but every
      // call returns NaN (no entries pre-fetched).
      if (raw === 'fact') continue;
      const body = raw.slice(FACT_INPUT_PREFIX.length);
      const at = body.lastIndexOf('@');
      if (at < 0) continue; // malformed: no @; skip
      const code = body.slice(0, at).trim();
      const period = body.slice(at + 1).trim();
      if (!code || !period) continue; // malformed: empty side
      parsed.push({ raw, code, period, key: `${code}@${period}` });
    }
    // De-dupe by canonical key — multiple requiredInputs entries that resolve
    // to the same (code, period) trigger one Prisma read, not N.
    const seen = new Set<string>();
    const unique: ParsedFactKey[] = [];
    for (const p of parsed) {
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      unique.push(p);
    }

    // Phase 7.G Turn XLI (Phase C): batched read replaces the per-pair
    // Promise.all that was sending N concurrent findFirst queries. At
    // Phase F scale (60 cos × 9 indicators × 2-3 fact reads each) this
    // collapses ~1500 queries to ~60. Empty `unique` short-circuits to
    // `{}` without hitting the DB.
    const reads: Record<string, number | null> =
      unique.length > 0
        ? await ctx.ds.getIndicatorValues({
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            pairs: unique.map((p) => ({
              indicatorCode: p.code,
              period: p.period,
            })),
          })
        : {};

    let hitCount = 0;
    for (const v of Object.values(reads)) if (v !== null) hitCount++;

    state.inputs.aggregates.fact = {
      read_count: unique.length,
      hit_count: hitCount,
      reads,
    };

    // Re-entry guard (sub-41 architect Round-1 closure): resolvers are
    // invoked once per buildContext today, but a future refactor that
    // segments the call (e.g. partial recompute) would silently overwrite
    // the closure's `reads` snapshot. Throw loudly so the regression
    // surfaces at the regression site, not as a stale-cache mystery
    // downstream.
    if (state.functions.fact) {
      throw new Error(
        'factResolver re-entry: state.functions.fact already set. ' +
        'buildContext must invoke each resolver at most once per call.',
      );
    }
    // Synchronous closure exposed to the formula engine. Captures `reads`
    // by reference, but the resolver has finished populating it before
    // the engine runs (resolvers are awaited; eval comes after).
    state.functions.fact = (code: FormulaFunctionArgLike, period: FormulaFunctionArgLike) => {
      const key = `${String(code)}@${String(period)}`;
      const value = reads[key];
      if (value == null) return Number.NaN;
      return value;
    };
  },
};

/**
 * Phase 7.E phase 3 — `rollup(code)` formula function.
 *
 * Sums the persisted spot value of `IndicatorValue` for `<code>` across
 * the current company's DIRECT children at the same period. Use case:
 * holding-level composites where the parent's metric is the sum of its
 * sub-companies (e.g. holding-wide revenue = sum of per-sub-co revenue).
 *
 * Required-input format: `rollup:<INDICATOR_CODE>`
 *   - Period is implicit (= current recompute period). Cross-period
 *     rollup composites can be expressed as `fact(rollup_code, period)`
 *     IF the rollup IV is itself persisted (separate seed entry). v1 of
 *     phase 3 doesn't auto-persist rollup outputs.
 *
 * Empty children: returns 0 (empty sum). Formula author can guard with
 * a ternary if 0 would be misleading: `rollup("X") > 0 ? rollup("X") : NaN`.
 *
 * Aggregation: today only sum. Avg / min / max / hhi can be added by
 * extending the format to `rollup:<CODE>:<AGG>` in v2; not done now to
 * keep the v1 surface minimal.
 *
 * Missing child IV: skipped from the sum (treated as 0 contribution).
 * Symmetric with `fact()`'s null-as-NaN-propagation, but the nature of
 * sum-aggregation is to ignore missing terms — explicit NaN propagation
 * here would reject the entire rollup over one missing child, which is
 * a worse default for holding-level reporting.
 *
 * Cost: 1 children-list query + 1 IV read per (child × code) pair.
 * Symmetric with `fact()` — at Phase F scale O(children × codes) reads
 * per recompute. Same v2 batched-IN optimization applies.
 */
const rollupResolver: NamespaceResolver = {
  name: 'rollup',
  matches: (r) => r === 'rollup' || r.startsWith(ROLLUP_INPUT_PREFIX),
  async resolve(matched, ctx, state) {
    const codes: string[] = [];
    for (const raw of matched) {
      if (raw === 'rollup') continue;
      const code = raw.slice(ROLLUP_INPUT_PREFIX.length).trim();
      if (!code) continue;
      codes.push(code);
    }
    const uniqueCodes = Array.from(new Set(codes));

    const childIds = await ctx.ds.listChildCompanyIds({
      organizationId: ctx.organizationId,
      parentId: ctx.companyId,
    });

    const sums: Record<string, { sum: number; matched_count: number }> = {};
    // Pre-seed every requested code with a zero entry so the snapshot
    // always lists them — even when childIds is empty or no IV reads
    // happen. Saves consumers from a "code missing from sums map vs sum
    // is zero" ambiguity.
    for (const code of uniqueCodes) sums[code] = { sum: 0, matched_count: 0 };

    if (uniqueCodes.length > 0 && childIds.length > 0) {
      const periodStr = ctx.period.raw;
      // Fan out: every (code × child) pair fetched in parallel.
      const tasks: Array<{ code: string; promise: Promise<number | null> }> = [];
      for (const code of uniqueCodes) {
        for (const childId of childIds) {
          tasks.push({
            code,
            promise: ctx.ds.getIndicatorValue({
              organizationId: ctx.organizationId,
              companyId: childId,
              indicatorCode: code,
              period: periodStr,
            }),
          });
        }
      }
      const results = await Promise.all(tasks.map((t) => t.promise));
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const v = results[i];
        if (v == null) continue;
        sums[t.code].sum += v;
        sums[t.code].matched_count += 1;
      }
    }

    state.inputs.aggregates.rollup = {
      children_count: childIds.length,
      sums,
    };

    // Re-entry guard (sub-41 architect Round-1 closure) — symmetric with
    // factResolver above.
    if (state.functions.rollup) {
      throw new Error(
        'rollupResolver re-entry: state.functions.rollup already set. ' +
        'buildContext must invoke each resolver at most once per call.',
      );
    }
    state.functions.rollup = (code: FormulaFunctionArgLike) => {
      const entry = sums[String(code)];
      if (!entry) return Number.NaN;
      return entry.sum;
    };
  },
};

/**
 * Local alias matching `formula-engine.ts`'s `FormulaFunctionArg` (number |
 * string). Re-stated here so the resolver bodies don't need the full type
 * import at use sites — readability over micro-DRY. The real type is the
 * one above (imported as FormulaFunction signature); callers cast at call
 * site since expr-eval passes arguments dynamically.
 */
type FormulaFunctionArgLike = number | string;

/**
 * Phase 7.H F4.v2.2 — `industryFactor(scope)` formula function.
 *
 * Looks up the kg CO₂e per AZN coefficient for the current company's
 * industry × scope. Powers the v2.2 ESG formulas:
 *   `revenue * industryFactor("scope_1") / 1000  // → tonnes CO₂e`
 *
 * Required-input format: `industryFactor:<scope>` where scope ∈
 * `{scope_1, scope_2, scope_3}`. Bare `industryFactor` (no colon)
 * declares the function in scope without committing to a specific
 * scope — useful when a seed builds the scope arg dynamically.
 *
 * Returns:
 *  - factor (kg/AZN) when company.industry has a catalog row
 *  - NaN when industry is null OR not catalogued — this propagates
 *    via `tryEvaluateFormula` to `status='unknown'`, which is the
 *    fail-loud semantic. Silently returning 0 would render a green
 *    «zero emissions» cell for an un-catalogued company.
 *
 * Also stamps `state.inputs.aggregates.industry_factor` with the
 * resolved (industry, scope) → factor map so the drilldown UI can
 * surface "Source: industry intensity for [industry], confidence B"
 * alongside the value.
 */
const industryFactorResolver: NamespaceResolver = {
  name: 'industryFactor',
  matches: (r) => r === 'industryFactor' || r.startsWith('industryFactor:'),
  async resolve(matched, ctx, state) {
    // Pre-resolve every scope mentioned in requiredInputs so the
    // synchronous formula function below doesn't need to do an
    // additional lookup per call. The catalog is in-memory + cheap so
    // this is essentially free, but keeps the function pure-sync
    // (expr-eval requires sync functions).
    const resolved: Record<
      string,
      { factor: number; confidence: ConfidenceTier; note: string } | null
    > = {};
    for (const raw of matched) {
      if (raw === 'industryFactor') continue;
      const scope = raw.slice('industryFactor:'.length) as EmissionScope;
      const lookup = getIndustryEmissionFactor(ctx.industry, scope);
      resolved[scope] = lookup;
    }

    state.inputs.aggregates.industry_factor = {
      industry: ctx.industry ?? null,
      scopes: Object.fromEntries(
        Object.entries(resolved).map(([scope, v]) => [
          scope,
          v ? { factor: v.factor, confidence: v.confidence } : null,
        ]),
      ),
    };

    if (state.functions.industryFactor) {
      throw new Error(
        'industryFactorResolver re-entry: state.functions.industryFactor already set. ' +
          'buildContext must invoke each resolver at most once per call.',
      );
    }
    state.functions.industryFactor = (scope: FormulaFunctionArgLike) => {
      const key = String(scope) as EmissionScope;
      const r = resolved[key];
      if (!r) {
        // Allow late lookup for callers that didn't pre-declare the
        // exact scope in requiredInputs (e.g. defensive seed author
        // who only listed `industryFactor`). Falls back to the live
        // catalog read for the company's industry; NaN when missing.
        const live = getIndustryEmissionFactor(ctx.industry, key);
        return live ? live.factor : Number.NaN;
      }
      return r.factor;
    };
  },
};

const RESOLVERS: readonly NamespaceResolver[] = [
  bookingResolver,
  companySettingsResolver,
  operationalFactResolver,
  newsSentimentResolver,
  currencyRateResolver,
  budgetLineResolver,
  factResolver,
  rollupResolver,
  industryFactorResolver,
  // Phase 7.I — AzerSheker pilot. Both pull from IntelDataPoint; degrade
  // to "data not available" cleanly when no rows / no region set.
  weatherResolver,
  commodityPriceResolver,
];

// --- Seed-load-time requiredInputs validator -------------------------------

/**
 * Phase 7.E phase 3 — strict validator for `requiredInputs` strings,
 * intended to run at seed-load time (e.g. inside `seed-indicators.ts`)
 * so a typo in a seed entry aborts the seed run with a clear error
 * message instead of silently producing a fact()→NaN at runtime.
 *
 * Per `feedback_verify_one_layer_up.md`: the resolver intentionally stays
 * lenient (skip-malformed) at runtime so a stray bad entry on one
 * indicator doesn't abort the recompute of unrelated indicators. The
 * strictness lives one layer up — at seed-author time — where a seed
 * author typo SHOULD halt the import.
 *
 * Returns `{ ok: true }` when every entry parses cleanly.
 * Returns `{ ok: false, reason }` on first malformed entry, with the
 * specific bad string + position included.
 *
 * Validates:
 *  - `fact:<CODE>@<PERIOD>` — both sides non-empty, exactly one `@`
 *    in the body (the body's lastIndexOf('@') splits — but if there's
 *    no `@` at all, that's a parse error).
 *  - `rollup:<CODE>` — code non-empty.
 *  - bare `fact` and `rollup` (no colon) are treated as no-op declarations
 *    (resolver skips them silently); validator accepts them too.
 *
 * Does NOT validate:
 *  - that the indicator CODE referenced actually exists (would require
 *    cross-seed lookup; out of scope for v1).
 *  - that the PERIOD string parses as a valid period (caller may use
 *    e.g. fiscal-year suffixes the period parser doesn't accept; defer).
 *  - non-fact/rollup namespaces (booking, company.settings, etc) — those
 *    have their own resolvers with their own implicit format.
 */
export type RequiredInputValidation =
  | { ok: true }
  | { ok: false; reason: string };

export function validateRequiredInputs(
  requiredInputs: readonly string[],
): RequiredInputValidation {
  for (let i = 0; i < requiredInputs.length; i++) {
    const r = requiredInputs[i];
    if (r.startsWith(FACT_INPUT_PREFIX)) {
      const body = r.slice(FACT_INPUT_PREFIX.length);
      if (body.length === 0) {
        return {
          ok: false,
          reason: `requiredInputs[${i}] = "${r}" — empty body after "fact:". Expected "fact:<INDICATOR_CODE>@<PERIOD>".`,
        };
      }
      const at = body.lastIndexOf('@');
      if (at < 0) {
        return {
          ok: false,
          reason: `requiredInputs[${i}] = "${r}" — missing "@" separator. Expected "fact:<INDICATOR_CODE>@<PERIOD>".`,
        };
      }
      const code = body.slice(0, at).trim();
      const period = body.slice(at + 1).trim();
      if (!code) {
        return {
          ok: false,
          reason: `requiredInputs[${i}] = "${r}" — empty INDICATOR_CODE before "@".`,
        };
      }
      if (!period) {
        return {
          ok: false,
          reason: `requiredInputs[${i}] = "${r}" — empty PERIOD after "@".`,
        };
      }
    } else if (r.startsWith(ROLLUP_INPUT_PREFIX)) {
      const code = r.slice(ROLLUP_INPUT_PREFIX.length).trim();
      if (!code) {
        return {
          ok: false,
          reason: `requiredInputs[${i}] = "${r}" — empty INDICATOR_CODE after "rollup:". Expected "rollup:<INDICATOR_CODE>".`,
        };
      }
    } else if (r.startsWith('industryFactor:')) {
      // Phase 7.H F4.v2.2 — sector intensity factor. Validates the
      // scope token is one of the three known names; typos like
      // `industryFactor:scope1` (no underscore) get caught at seed-
      // load time instead of producing silent NaN at evaluation.
      const scope = r.slice('industryFactor:'.length).trim();
      if (!scope) {
        return {
          ok: false,
          reason: `requiredInputs[${i}] = "${r}" — empty scope after "industryFactor:". Expected "industryFactor:scope_1" | "scope_2" | "scope_3".`,
        };
      }
      if (
        scope !== 'scope_1' &&
        scope !== 'scope_2' &&
        scope !== 'scope_3'
      ) {
        return {
          ok: false,
          reason: `requiredInputs[${i}] = "${r}" — unknown scope "${scope}". Expected one of: scope_1, scope_2, scope_3.`,
        };
      }
    }
    // Other namespaces (booking, company.settings, operationalFact,
    // currencyRate, budgetLine, bare "fact"/"rollup") are not validated
    // here — they have their own resolvers + tests covering shape.
  }
  return { ok: true };
}

/**
 * Sub-44 cont'd architect 💡 closure — seed-author-time validation that
 * a rollup-bearing indicator is sector-agnostic (`industries.length === 0`).
 *
 * Why: parent-co rollup targets in `recompute-trigger.ts:230` are built
 * via `parentCompanies.flatMap(p => rollupDefs.map(d => ...))` — bypassing
 * `matchCompaniesToIndicators` industry-filter because parent cos lack
 * the `industry: string` invariant. If a future seed declared
 * `requiredInputs: ['rollup:...']` with non-empty `industries:
 * ['hospitality']`, the parent pass would silently fire on ALL parent
 * cos regardless of their (non-existent) industry, violating the
 * indicator's own sector restriction.
 *
 * Strict layer-up belongs HERE — at seed-author time. The trigger has
 * a runtime defensive filter that drops + warns for the same case
 * (belt-and-braces if seed validation slipped past).
 *
 * Returns `{ ok: true }` when every entry passes.
 * Returns `{ ok: false, reason }` on the FIRST seed that fails (first-
 * failure-loud, mirrors `validateRequiredInputs` semantic).
 */
export type RollupSeedValidation =
  | { ok: true }
  | { ok: false; reason: string };

export function validateRollupSeed(seed: {
  code: string;
  industries: readonly string[];
  requiredInputs?: readonly string[] | null;
}): RollupSeedValidation {
  const inputs = seed.requiredInputs ?? [];
  const isRollup = inputs.some(
    (s) => typeof s === 'string' && s.startsWith(ROLLUP_INPUT_PREFIX),
  );
  if (!isRollup) return { ok: true };
  if (seed.industries.length > 0) {
    return {
      ok: false,
      reason:
        `Indicator '${seed.code}' is rollup-bearing (requiredInputs has '${ROLLUP_INPUT_PREFIX}...') ` +
        `but declares non-empty industries [${seed.industries.join(',')}]. ` +
        `Rollup-bearing indicators MUST be sector-agnostic (industries: []) ` +
        `because parent-co recompute targets bypass the industry-match ` +
        `filter. Either drop the industries restriction OR change the ` +
        `formula to use a per-sector composition (fact() with explicit ` +
        `period/code rather than rollup()).`,
    };
  }
  return { ok: true };
}

/**
 * Cross-namespace derivations that need multiple resolvers' output. Today
 * there's one (`rooms_available`); when this reaches ~5+, lift to a
 * `PostProcessor[]` registry with the same shape as `NamespaceResolver`.
 */
async function postProcess(
  ctx: ResolverCtx,
  state: BuildState,
): Promise<void> {
  // rooms_available = total_rooms × daysInPeriod. Derives whenever
  // total_rooms was plucked from company.settings — computing an unused
  // context var is cheap and removes the guard's semantic coupling to
  // other resolvers' output.
  if (typeof state.context.total_rooms === 'number') {
    const days = daysInPeriod(ctx.period);
    const rooms_available = state.context.total_rooms * days;
    state.context.rooms_available = rooms_available;
    state.inputs.resolved.rooms_available = rooms_available;
    state.inputs.derived.rooms_available = {
      total_rooms: state.context.total_rooms,
      days,
    };
  }
}

// --- Context builder ---------------------------------------------------------

export async function buildContext(
  ds: RecomputeDataSource,
  args: {
    organizationId: string;
    companyId: string;
    period: Period;
    requiredInputs: string[];
    /** Optional override; defaults to "AZN" — FO Holding base. */
    baseCurrency?: string;
    /**
     * Phase 7.E ad-hoc scenario preview — flat key/value overrides
     * applied to `state.context` AFTER all resolvers run. Keys must
     * match the variable names resolvers produce (e.g. `fx_usd`,
     * `fx_eur`, `news_sentiment_30d`, `revenue`, etc).
     *
     * Use case: "what if AZN/USD jumps to 2.0?" — caller passes
     * `{ fx_usd: 2.0 }` and downstream formulas see the override
     * instead of the persisted rate. Pure preview — no DB writes.
     *
     * Override values bypass resolver-level transforms; pass the
     * final per-variable value the formula should see.
     */
    scenarioOverrides?: Record<string, number>;
    /**
     * Phase 7.H F4.v2.2 — sector intensity factor lookup key. Threaded
     * from the recompute trigger (which already knows
     * `company.industry`); resolvers requiring `industryFactor:<scope>`
     * read it via ctx. Optional + null tolerant so test fixtures and
     * legacy callers compile without churn — when null, the resolver
     * surfaces NaN into the formula (status='unknown').
     */
    industry?: string | null;
  },
): Promise<{
  context: FormulaContext;
  inputs: RecomputeInputs;
  functions: Record<string, FormulaFunction>;
}> {
  const state: BuildState = {
    context: {},
    inputs: { resolved: {}, aggregates: {}, derived: {} },
    functions: {},
  };
  const ctx: ResolverCtx = {
    ds,
    organizationId: args.organizationId,
    companyId: args.companyId,
    period: args.period,
    baseCurrency: args.baseCurrency ?? 'AZN',
    industry: args.industry ?? null,
  };

  // RESOLVERS is iterated once per recompute; each resolver sees all its
  // matching inputs in one batch, so multiple inputs in the same namespace
  // (e.g. "booking" + "booking.sourceCountry") trigger one DS read, not N.
  for (const resolver of RESOLVERS) {
    const matched = args.requiredInputs.filter((r) => resolver.matches(r));
    if (matched.length === 0) continue;
    await resolver.resolve(matched, ctx, state);
  }

  // Phase 7.E ad-hoc scenario preview — apply overrides AFTER resolvers
  // so resolver-side computations are never bypassed (e.g. revenue
  // aggregation still runs to populate aggregates for drill-down) but
  // the formula sees the overridden value. Inputs.resolved is also
  // overwritten so the audit trail shows the preview value, not the
  // baseline.
  if (args.scenarioOverrides) {
    for (const [key, value] of Object.entries(args.scenarioOverrides)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      state.context[key] = value;
      state.inputs.resolved[key] = value;
    }
  }

  await postProcess(ctx, state);

  return {
    context: state.context,
    inputs: state.inputs,
    functions: state.functions,
  };
}

// --- Runner ------------------------------------------------------------------

export interface IndicatorDefinitionLike {
  id: string;
  code?: string;
  formula: string;
  thresholds: unknown; // Prisma Json — cast at classify time
  requiredInputs: string[];
  /** Matches `IndicatorDefinition.unit`. When this is `"%"` the pipeline
   *  applies a plausibility cap on the computed value — ratios outside
   *  ±200% almost always indicate upstream data misclassification (e.g. a
   *  revenue line tagged as cost). Flag them as `status='unknown'` with a
   *  structured `error.code='out_of_range'` + a human-readable reason so
   *  finance users see "verify data" rather than a misleading red alert.
   *  Optional so tests / callers without the unit can skip the cap. */
  unit?: string;
  /**
   * Phase 7.E perMonth chain phase 2 — optional formula variant evaluated
   * at each of the 12 trailing months when `withSparkline=true`. When
   * absent or null, the sparkline pipeline falls back to `formula` (see
   * `sparkline.ts:103-105`). Most indicators leave this null; the override
   * exists for cases where the annual formula doesn't cleanly evaluate at
   * monthly granularity (e.g. AAC_OCC's daily-aggregate variant).
   * Optional so tests / callers without sparkline support stay green.
   */
  sparklineFormula?: string | null;
  /**
   * Phase 7.H F4.v2.1 — provenance default for IVs produced from this
   * definition. Mirrors the Prisma column `defaultValueSource`. Optional
   * so legacy callers / fixtures that don't set the field still recompute;
   * `recomputeIndicator` falls back to `'computed'` (the financial /
   * operational default) when absent.
   */
  defaultValueSource?: ValueSource;
}

/**
 * Plausibility cap for ratio-type indicators (`unit='%'`). Values outside
 * ±`RATIO_PLAUSIBILITY_CAP_PCT` are almost always upstream misclassification.
 */
export const RATIO_PLAUSIBILITY_CAP_PCT = 200;

export interface OutOfRangeClampResult {
  clamped: boolean;
  reason?: string;
}

/**
 * Returns `{ clamped: true, reason }` when `value` falls outside the cap
 * for the given `unit`. The reason is written in finance-user-readable
 * English — terminal UI is expected to surface it verbatim in the HeatMap
 * cell tooltip (and eventually in a drill-down side panel / CSV export).
 */
export function applyOutOfRangeClamp(
  value: number,
  unit: string | undefined,
  indicatorLabel: string,
): OutOfRangeClampResult {
  if (unit !== '%') return { clamped: false };
  if (Math.abs(value) <= RATIO_PLAUSIBILITY_CAP_PCT) return { clamped: false };
  return {
    clamped: true,
    reason: `Value ${value.toFixed(1)}% is outside the ±${RATIO_PLAUSIBILITY_CAP_PCT}% plausibility range for ${indicatorLabel} — likely a data-classification issue (e.g. a revenue line mis-tagged as cost). Verify the source rows before treating this as a genuine red alert.`,
  };
}

export interface RecomputeResult {
  ok: boolean;
  status: IndicatorStatus;
  value: number;
}

/**
 * Phase 7.H F4.v2.2.1 — derive a single confidence tier for the IV from
 * the per-scope catalog readings the `industryFactorResolver` left in
 * `inputs.aggregates.industry_factor`.
 *
 * Rule: take the WORST tier across non-null scopes. A composite that
 * uses Scope 1 (B) + Scope 2 (B) + Scope 3 (C) lands at C — the whole
 * is only as trustworthy as the weakest scope. Scope-3 is uniformly C
 * across the catalog (spend-based proxy), so most composite IVs end
 * up C; pure-Scope-1 IVs end up B (and A for `logistics` which has a
 * directly-measurable fleet fuel scope_1).
 *
 * Returns `null` when no scopes were resolved (formula doesn't use
 * industryFactor) — the IV is either disclosed (handled upstream) or
 * `computed`/`modeled_generic`/`macro` where confidence-tier isn't
 * meaningful.
 */
function worstConfidenceFromAggregate(
  agg: RecomputeAggregates['industry_factor'],
): ConfidenceTier | null {
  if (!agg || !agg.scopes) return null;
  // Tier ordering: A (best) > B > C > D (worst). Return the highest
  // ordinal — i.e. the most conservative.
  const order: Record<ConfidenceTier, number> = { A: 0, B: 1, C: 2, D: 3 };
  let worst: ConfidenceTier | null = null;
  for (const scope of Object.values(agg.scopes)) {
    if (!scope) continue;
    const c = scope.confidence;
    if (worst === null || order[c] > order[worst]) worst = c;
  }
  return worst;
}

export async function recomputeIndicator(
  ds: RecomputeDataSource,
  args: {
    organizationId: string;
    companyId: string;
    definition: IndicatorDefinitionLike;
    period: string;
    /**
     * Phase 7.E perMonth chain phase 2 — when true, also compute and
     * persist a 12-slot trailing-month sparkline alongside the spot value.
     *
     * Cost: +12 buildContext calls per indicator (~13× the no-sparkline
     * cost). Acceptable for single-IV / single-co interactive recomputes
     * (UI drill-down → ~91ms). Avoid on bulk-import + holding-wide refresh
     * paths — those hit `MAX_TARGETS_PER_REQUEST` ceilings or per-pair
     * fan-out into the thousands. Default `false` preserves the prior
     * pipeline behavior; the offline `scripts/compute-sparklines.ts`
     * worker remains the canonical refresher for bulk paths.
     */
    withSparkline?: boolean;
    /**
     * CXLVIII — the operating company's base currency, threaded into the
     * budgetLine resolver so BudgetLines tagged with `currencyCode ==
     * baseCurrency` are NOT treated as foreign (would otherwise be skipped
     * if no `exchangeRate` is set). Undefined falls back to 'AZN' in
     * buildContext (FO Holding default; safe for the single-tenant case).
     */
    baseCurrency?: string;
    /** Phase 7.E ad-hoc scenario preview — see `buildContext` doc. */
    scenarioOverrides?: Record<string, number>;
    /**
     * Phase 7.H F4.v2.2 — sector industry code (e.g. "agro_crops"),
     * threaded into `industryFactorResolver`. Optional + null tolerant
     * — when missing, ESG formulas that depend on `industryFactor`
     * surface NaN → `status='unknown'` rather than silently returning
     * a misleading zero.
     */
    industry?: string | null;
  },
): Promise<RecomputeResult> {
  const period = parsePeriod(args.period);

  // Phase 7.H F4.v2.3 — disclosure-first override. If the user has
  // manually entered a value for this (co, indicator, period) triple
  // via the data-entry admin, use it verbatim and skip formula
  // evaluation entirely. The stamped `valueSource: 'disclosed'`
  // overrides whatever the seed's `defaultValueSource` was — a
  // disclosed ESG cell wins over its modeled-generic formula. Only
  // honored when the definition has a `code` (anchor for the
  // disclosure lookup); legacy fixtures without `code` skip this path
  // and fall through to the formula branch.
  let disclosed: { value: number; unit: string } | null = null;
  if (args.definition.code) {
    disclosed = await ds.getIndicatorDisclosure({
      organizationId: args.organizationId,
      companyId: args.companyId,
      indicatorCode: args.definition.code,
      period: args.period,
    });
  }

  const { context, inputs, functions } = await buildContext(ds, {
    organizationId: args.organizationId,
    companyId: args.companyId,
    period,
    requiredInputs: args.definition.requiredInputs,
    baseCurrency: args.baseCurrency,
    scenarioOverrides: args.scenarioOverrides,
    industry: args.industry,
  });

  // Skip formula evaluation when a disclosure overrides the value —
  // there's no point burning expr-eval cycles on a number we already
  // know. But we DO still need the resolved-inputs snapshot for
  // drilldown UI, so buildContext runs above either way.
  const result = disclosed
    ? { ok: true as const, value: disclosed.value }
    : tryEvaluateFormula(args.definition.formula, context, functions);

  let status: IndicatorStatus;
  let value: number;
  // Shallow-copy the builder's result so the sub-objects (resolved,
  // aggregates, derived) stay by-reference but the top-level error key
  // mutation here doesn't alias anything buildContext or its resolvers
  // may hold onto in the future (e.g. per-org caching).
  const finalInputs: RecomputeInputs = { ...inputs };
  if (disclosed) {
    // Annotate the audit snapshot so a drilldown viewer sees this was
    // a manual disclosure, not a formula evaluation. The
    // `disclosed.unit` lands here for after-the-fact verification.
    finalInputs.resolved = {
      ...(finalInputs.resolved ?? {}),
      disclosed_value: disclosed.value,
    };
  }

  if (result.ok) {
    value = result.value;
    const thresholds = args.definition.thresholds as Thresholds;
    status = classifyValue(value, thresholds);

    // Plausibility cap for ratio-type indicators. Override to `unknown` so
    // a misclassified revenue row doesn't show up as a red alert on the
    // HeatMap. Raw `value` is preserved so finance users can see what was
    // computed before the clamp — the error carries the reason.
    const clamp = applyOutOfRangeClamp(
      value,
      args.definition.unit,
      args.definition.code ?? args.definition.id,
    );
    if (clamp.clamped) {
      status = 'unknown';
      finalInputs.error = {
        code: 'out_of_range',
        reason: clamp.reason ?? 'Value outside plausibility range',
      };
    }
  } else {
    value = 0;
    status = 'unknown';
    finalInputs.error = { code: result.code, reason: result.reason };
  }

  // Phase 7.E phase 2 — opt-in sparkline. Computed BEFORE upsert so a
  // sparkline failure (resolver-level throw) abandons the whole recompute
  // (caller's per-pair try/catch surfaces it). `null` slots inside the
  // returned array are normal — they signal a single-period evaluation
  // that failed (missing data / formula error) and must be preserved as
  // gaps in the rendered chart, NOT collapsed to zero.
  let sparkline: (number | null)[] | undefined;
  if (args.withSparkline) {
    sparkline = await computeSparkline(ds, {
      organizationId: args.organizationId,
      companyId: args.companyId,
      definition: {
        id: args.definition.id,
        formula: args.definition.formula,
        sparklineFormula: args.definition.sparklineFormula ?? null,
        requiredInputs: args.definition.requiredInputs,
      },
      anchorPeriod: args.period,
      // Sub-43 closure — extracted period:string→Period bridge.
      buildContext: bridgeRecomputeBuildContext(ds, buildContext),
    });
  }

  await ds.upsertIndicatorValue({
    organizationId: args.organizationId,
    companyId: args.companyId,
    indicatorId: args.definition.id,
    period: args.period,
    value,
    status,
    inputs: finalInputs,
    sparkline,
    // Phase 7.H F4.v2.1 — fall back to `computed` when the caller omits
    // the field (legacy / pre-v2.1 IndicatorDefinitionLike fixtures).
    // The matrix API + IndicatorDetail UI rely on this stamp to render
    // the provenance badge.
    //
    // Phase 7.H F4.v2.3 — a disclosed override beats the seed default.
    // When the user manually entered the value, the badge MUST show
    // "РАСКРЫТО" (teal) rather than "ОБЩАЯ ОЦЕНКА" (gray) — the whole
    // point of the data-entry flow is to upgrade provenance.
    valueSource: disclosed
      ? 'disclosed'
      : (args.definition.defaultValueSource ?? 'computed'),
    // Phase 7.H F4.v2.2.1 — model-confidence tier (A|B|C|D). Disclosed
    // cells are ground truth → no tier. Industry-modeled cells inherit
    // the WORST tier across the scopes used (a Scope 1+2+3 composite is
    // only as trustworthy as its weakest scope). When industry_factor
    // aggregate is absent (formula doesn't use industryFactor()), null.
    confidence: disclosed
      ? null
      : worstConfidenceFromAggregate(finalInputs.aggregates?.industry_factor),
  });

  return { ok: result.ok, status, value };
}
