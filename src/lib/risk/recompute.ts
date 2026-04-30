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
  type IndicatorStatus,
  type Thresholds,
} from './formula-engine';
import { parsePeriod, daysInPeriod, type Period } from './periods';
import { computeSparkline } from './sparkline';

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
  }): Promise<void>;
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
          accountType: r.account?.accountType ?? null,
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

    async upsertIndicatorValue({
      organizationId,
      companyId,
      indicatorId,
      period,
      value,
      status,
      inputs,
      sparkline,
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
        },
        update: {
          value,
          status,
          inputs: inputs as unknown as Prisma.InputJsonValue,
          computedAt: new Date(),
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
}

interface ResolverCtx {
  ds: RecomputeDataSource;
  organizationId: string;
  companyId: string;
  period: Period;
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

    for (const l of lines) {
      const isForeign = l.currencyCode != null;
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

const RESOLVERS: readonly NamespaceResolver[] = [
  bookingResolver,
  companySettingsResolver,
  operationalFactResolver,
  currencyRateResolver,
  budgetLineResolver,
];

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
  },
): Promise<{ context: FormulaContext; inputs: RecomputeInputs }> {
  const state: BuildState = {
    context: {},
    inputs: { resolved: {}, aggregates: {}, derived: {} },
  };
  const ctx: ResolverCtx = {
    ds,
    organizationId: args.organizationId,
    companyId: args.companyId,
    period: args.period,
  };

  // RESOLVERS is iterated once per recompute; each resolver sees all its
  // matching inputs in one batch, so multiple inputs in the same namespace
  // (e.g. "booking" + "booking.sourceCountry") trigger one DS read, not N.
  for (const resolver of RESOLVERS) {
    const matched = args.requiredInputs.filter((r) => resolver.matches(r));
    if (matched.length === 0) continue;
    await resolver.resolve(matched, ctx, state);
  }

  await postProcess(ctx, state);

  return { context: state.context, inputs: state.inputs };
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
  },
): Promise<RecomputeResult> {
  const period = parsePeriod(args.period);

  const { context, inputs } = await buildContext(ds, {
    organizationId: args.organizationId,
    companyId: args.companyId,
    period,
    requiredInputs: args.definition.requiredInputs,
  });

  const result = tryEvaluateFormula(args.definition.formula, context);

  let status: IndicatorStatus;
  let value: number;
  // Shallow-copy the builder's result so the sub-objects (resolved,
  // aggregates, derived) stay by-reference but the top-level error key
  // mutation here doesn't alias anything buildContext or its resolvers
  // may hold onto in the future (e.g. per-org caching).
  const finalInputs: RecomputeInputs = { ...inputs };

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
      // Adapter: sparkline.ts buildContext takes period:string; recompute's
      // buildContext takes Period — bridge here. Mirrors the same shape used
      // by `scripts/compute-sparklines.ts:77-92`.
      buildContext: async (a) => {
        const p = parsePeriod(a.period);
        const { context: c } = await buildContext(ds, {
          organizationId: a.organizationId,
          companyId: a.companyId,
          period: p,
          requiredInputs: a.requiredInputs,
        });
        return { context: c };
      },
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
  });

  return { ok: result.ok, status, value };
}
