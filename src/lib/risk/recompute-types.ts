/**
 * Recompute pipeline — type surface.
 *
 * Phase 8 D1 (2026-05-29) — extracted verbatim from `recompute.ts` (which was
 * 3411 LOC) to shrink the core formula-engine file. Pure type / interface
 * declarations only: the `ValueSource` provenance ladder, the
 * `RecomputeDataSource` adapter contract, every per-namespace aggregate shape,
 * and the `RecomputeInputs` result envelope. No runtime code, no behaviour
 * change — `recompute.ts` re-exports all of these via `export *`, so existing
 * `import { … } from '@/lib/risk/recompute'` call sites are unaffected.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import type { IndicatorStatus } from './formula-engine';
import type { Period } from './periods';

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
  /** OperationalFact.unit (currency code / physical unit). Optional + nullable
   *  (Prisma column is `String?`); consumers that care about currency (e.g. the
   *  captured pl_ebitda guard in recompute-resolvers-b) check it against base
   *  currency, treating null/undefined as "trust" via `?? baseCcy`. */
  unit?: string | null;
}

export interface CurrencyRateRow {
  currencyCode: string;
  rate: number;
  rateDate: Date;
  isBase: boolean;
}

export interface BudgetLineRow {
  /** Canonical amount in the company's base/reporting currency. */
  plannedAmount: number;
  /** Original foreign-currency amount, retained as source evidence. Missing
   *  on legacy rows; FX exposure treats a missing value as unproven. */
  originalAmount?: number | null;
  currencyCode: string | null;
  exchangeRate: number | null;
  accountType: string | null;
  /** BudgetLine.lineType — the importer's storage-sign convention. This can
   *  intentionally differ from ChartOfAccount.accountType for PLF.07 income
   *  rows, which are semantically revenue but stored as negative expense. */
  lineType?: string | null;
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
   * metric filter. Callers choose deterministic datetime order explicitly;
   * the default ascending order is retained for historical window reads.
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
    /** Datetime ordering. Defaults to ascending for backwards compatibility. */
    order?: 'asc' | 'desc';
  }): Promise<
    Array<{ metric: string; datetime: Date; value: number; unit?: string | null }>
  >;

  /**
   * Phase 7.J — Counterparty register lookup.
   *
   * Returns the rows for a given (company × role × period) so the HHI
   * resolver can compute Σ(sharePct/100)². Optional on the interface
   * so legacy fixtures keep working without implementing it — resolver
   * checks for absence and returns an empty array.
   */
  listCounterparties?(args: {
    organizationId: string;
    companyId: string;
    role: 'customer' | 'supplier';
    period: string;
  }): Promise<Array<{ sharePct: number; singleSource: boolean; name: string }>>;

  /**
   * Phase 7.O (2026-05-24) — Balance-sheet line lookup for per-entity
   * BS aggregations (inventory, equity, current-ratio, etc.).
   *
   * Filters `BalanceSheetLine` by companyId (Phase 7.O nullable column)
   * and period.year. For period.kind='year', returns December (month=12)
   * rows for a year-end balance snapshot; for 'month', returns the
   * specific month's rows.
   *
   * Optional on the interface: legacy fixtures without listBalanceSheetLines
   * degrade cleanly (resolver silently skips, indicators stay 'unknown').
   */
  listBalanceSheetLines?(args: {
    organizationId: string;
    companyId: string;
    period: Period;
  }): Promise<
    Array<{
      accountCode: string;
      accountName: string;
      lineType: string;  // 'asset' | 'liability' | 'equity'
      subType: string | null;  // 'non_current' | 'current' | 'long_term' | 'short_term' | null
      year: number;
      month: number;
      amount: number;
    }>
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
    /**
     * Phase 10 / Stage B5 — lineage. The DataRevision whose pinned source and
     * mapping state produced this value.
     *
     * This is the **only** place a `revisionId` is stamped onto an
     * IndicatorValue; no other writer may set it. The Prisma adapter verifies
     * the revision belongs to the same organization **and names the company**
     * before writing. A pointer to another tenant or sibling company's source
     * state would be worse than no lineage because it would look like evidence.
     *
     * Optional and defaulting to untraced: omit it and the writer stores
     * `revisionId = null`, exactly like legacy rows, which A5's gate treats as
     * not decision-grade. Passing one is valid only when the caller can prove
     * it covers the complete inputs of this specific observation; reconciliation,
     * coverage and approval remain separate gates.
     *
     * `undefined` clears an existing pointer on UPDATE because the recomputed
     * value has replaced the number the old revision described.
     */
    revisionId?: string | null;
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
// Phase 7.M Tier 4 (2026-05-19) — widened to `number | string` so the
// companySettingsResolver can emit string flags (e.g. fxExposureSource).
// Formula expressions still see numbers only via state.context — strings
// stay in aggregates for use by guard logic.
export type CompanySettingsAggregate = Record<string, number | string>;

export interface CurrencyRateAggregate {
  base_currency: string | null;
  rate_count: number;
  /** per-code rate snapshot, keys like `fx_usd`, `fx_eur` mirror context vars */
  rates: Record<string, number>;
}

export interface BudgetLineAggregate {
  line_count: number;
  /** Phase 7.M Step 4 (2026-05-19) — count of lines that carry an
   *  explicit non-base currencyCode + finite positive exchangeRate +
   *  finite originalAmount. Used by the
   *  zombie-row guard to distinguish "genuinely 100% domestic" from
   *  "xlsx importer dropped the currency column". When `line_count > 0`
   *  but `foreign_line_count === 0`, any FX-share formula evaluates
   *  to a structurally meaningless 0 and the guard demotes the cell
   *  to `unknown`. */
  foreign_line_count: number;
  revenue: number;
  cogs: number;
  opex: number;
  /** Other operating income/(expense) — signed, income-positive, above EBITDA. */
  other_operating: number;
  below_ebitda: number;
  /** cogs+opex in foreign currency — NOT the AGRO_FX_RISK numerator. Use
   *  `resolved.imported_input_cost` (cogs-only) for ratio math. This field
   *  is drill-down only. */
  imported_total_cost: number;
  /** cogs+opex in base currency — drill-down complement to above. */
  domestic_total_cost: number;
  missing_rate_count: number;
  /** Present when a captured source EBITDA subtotal exists but its monthly
   *  coverage cannot be reconciled to the operating P&L rows. Metadata only:
   *  recomputeIndicator promotes it to an error exclusively for formulas that
   *  reference `ebitda`, leaving unrelated budget-line indicators untouched. */
  ebitda_basis_mismatch?: { reason: string };
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
  weather?: Record<
    string,
    {
      value: number | null;
      region: string | null;
      sourceCode?: string;
      metric?: string;
      /** ISO timestamp of the observation selected inside the target period. */
      observedAt?: string;
    }
  >;
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
      metric: string;
      aggregator: string;
      samples: number;
      /** ISO timestamp selected for latest, or the canonical monthly anchor for 12M stats. */
      observedAt?: string;
      /** `as_of` preserves low-frequency observations; `canonical_monthly` is a monthly-feed guard. */
      cadence?: 'as_of' | 'canonical_monthly';
      /** Rejected timestamps for the selected policy, retained for audit. */
      invalidTimestamps?: string[];
      /**
       * Present for 12-month statistics. A monthly series is decision-usable
       * only when every calendar month in this exact historical window is
       * represented once. This prevents a future quote or duplicate month
       * from quietly filling a historical gap.
       */
      coverage?: {
        /** Inclusive UTC month boundary, serialized as YYYY-MM-DD. */
        windowStart: string | null;
        /** Exclusive UTC month boundary, serialized as YYYY-MM-DD. */
        windowEnd: string | null;
        expectedMonths: string[];
        observedMonths: string[];
        missingMonths: string[];
        duplicateMonths: string[];
        /** Non-canonical timestamps skipped from a nominally monthly series. */
        invalidMonthTimestamps: string[];
        /** Non-canonical candidates skipped while choosing the 12M anchor. */
        invalidAnchorTimestamps: string[];
        complete: boolean;
      };
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
