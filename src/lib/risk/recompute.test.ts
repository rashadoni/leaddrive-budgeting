import { describe, it, expect, vi } from 'vitest';
import {
  buildContext,
  createPrismaDataSource,
  recomputeIndicator,
  applyOutOfRangeClamp,
  RATIO_PLAUSIBILITY_CAP_PCT,
  validateRequiredInputs,
  validateRollupSeed,
  type BookingRow,
  type FactRow,
  type CurrencyRateRow,
  type BudgetLineRow,
  type RecomputeDataSource,
  type RecomputeInputs,
  type IndicatorDefinitionLike,
} from './recompute';
import { parsePeriod } from './periods';

// --- Mock data source factory ------------------------------------------------

type MockState = {
  bookings: BookingRow[];
  facts: Record<string, FactRow[]>;
  settings: Record<string, unknown> | null;
  currencyRates: CurrencyRateRow[];
  budgetLines: BudgetLineRow[];
  /**
   * Phase 7.E phase 3 — pre-canned IV reads for `fact()` resolver tests.
   * Keyed by `${companyId}:${indicatorCode}@${period}`. Returns null
   * (= missing IV) when the key is absent OR explicitly mapped to null;
   * the resolver then exposes NaN to the formula.
   */
  ivReads: Record<string, number | null>;
  /**
   * Phase 7.E phase 3 — pre-canned children for `rollup()` resolver tests.
   * Keyed by parent companyId. Returns [] when key absent.
   */
  children: Record<string, string[]>;
  upserts: Array<{
    organizationId: string;
    companyId: string;
    indicatorId: string;
    period: string;
    value: number;
    status: string;
    inputs: RecomputeInputs;
    /** Phase 7.E phase 2 — captured for sparkline-integration tests; the
     *  field is optional because non-sparkline call paths leave it absent. */
    sparkline?: (number | null)[];
  }>;
  /** Every read logged with the org it was scoped to — used to prove the
   *  data-source enforces tenant scoping at the call site. */
  orgReads: string[];
  /** Per-call audit of getIndicatorValue / listChildCompanyIds for phase-3
   *  dedup + cost-shape tests. */
  ivReadCalls: Array<{ companyId: string; indicatorCode: string; period: string }>;
  /** Phase 7.G Turn XLI — batched-call audit for fact() resolver. Each
   *  entry = ONE getIndicatorValues invocation; the `pairs` array tracks
   *  every (code, period) requested in that batch. Tests assert
   *  `ivBatchCalls.length` ≤ 1 to prove batching works. */
  ivBatchCalls: Array<{
    companyId: string;
    pairs: Array<{ indicatorCode: string; period: string }>;
  }>;
  childrenCalls: Array<{ parentId: string }>;
};

function mockDs(initial: Partial<MockState> = {}): RecomputeDataSource & {
  state: MockState;
} {
  const state: MockState = {
    bookings: initial.bookings ?? [],
    facts: initial.facts ?? {},
    settings: initial.settings ?? null,
    currencyRates: initial.currencyRates ?? [],
    budgetLines: initial.budgetLines ?? [],
    ivReads: initial.ivReads ?? {},
    children: initial.children ?? {},
    upserts: [],
    orgReads: [],
    ivReadCalls: [],
    ivBatchCalls: [],
    childrenCalls: [],
  };
  return {
    state,
    listBookings: async ({ organizationId }) => {
      state.orgReads.push(`bookings:${organizationId}`);
      return state.bookings;
    },
    listOperationalFacts: async ({ organizationId, metric }) => {
      state.orgReads.push(`facts:${organizationId}:${metric}`);
      return state.facts[metric] ?? [];
    },
    getCompanySettings: async ({ organizationId }) => {
      state.orgReads.push(`settings:${organizationId}`);
      return state.settings;
    },
    listCurrencyRates: async ({ organizationId }) => {
      state.orgReads.push(`rates:${organizationId}`);
      return state.currencyRates;
    },
    listBudgetLines: async ({ organizationId, period }) => {
      // Record the period.kind alongside year so tests can assert
      // monthly-vs-annual scoping. Format: `budgetlines:<org>:<year>:<kind>`
      // — backward-compat the year-only assertions via prefix match.
      state.orgReads.push(`budgetlines:${organizationId}:${period.year}:${period.kind}`);
      return state.budgetLines;
    },
    getNewsSentimentRolling30d: async ({ organizationId, companyId }) => {
      state.orgReads.push(`sentiment:${organizationId}:${companyId}`);
      return null;
    },
    upsertIndicatorValue: async (args) => {
      state.upserts.push(args);
    },
    getIndicatorValue: async ({ organizationId, companyId, indicatorCode, period }) => {
      state.orgReads.push(`getIv:${organizationId}:${companyId}:${indicatorCode}@${period}`);
      state.ivReadCalls.push({ companyId, indicatorCode, period });
      const key = `${companyId}:${indicatorCode}@${period}`;
      return state.ivReads[key] ?? null;
    },
    // Phase 7.G Turn XLI (Phase C) — batched read mock. Records each call
    // as ONE entry in `ivBatchCalls` so tests can assert call-count
    // collapses from N to 1 per recompute. Looks up each pair against
    // the same `state.ivReads` map as the singular method.
    getIndicatorValues: async ({ organizationId, companyId, pairs }) => {
      state.orgReads.push(
        `getIvs:${organizationId}:${companyId}:${pairs.length}pairs`,
      );
      state.ivBatchCalls.push({ companyId, pairs });
      const result: Record<string, number | null> = {};
      for (const p of pairs) {
        const key = `${companyId}:${p.indicatorCode}@${p.period}`;
        result[`${p.indicatorCode}@${p.period}`] = state.ivReads[key] ?? null;
      }
      return result;
    },
    listChildCompanyIds: async ({ organizationId, parentId }) => {
      state.orgReads.push(`children:${organizationId}:${parentId}`);
      state.childrenCalls.push({ parentId });
      return state.children[parentId] ?? [];
    },
  };
}

function booking(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    revenue: 100,
    nights: 1,
    roomsBooked: 1,
    sourceCountry: 'AZ',
    currencyCode: null,
    exchangeRate: null,
    isCancelled: false,
    ...overrides,
  };
}

function fact(value: number, date = new Date('2026-04-15')): FactRow {
  return { value, date };
}

function rate(
  currencyCode: string,
  rate: number,
  isBase = false,
  rateDate = new Date('2026-04-01'),
): CurrencyRateRow {
  return { currencyCode, rate, rateDate, isBase };
}

function bl(
  overrides: Partial<BudgetLineRow> = {},
): BudgetLineRow {
  return {
    plannedAmount: 100,
    currencyCode: null,
    exchangeRate: null,
    accountType: 'expense',
    accountCode: null,
    accountCategory: null,
    accountName: null,
    // Default null = "non-monthly / unknown" so existing tests that
    // don't care about monthIndex aren't bucketed into month 0.
    monthIndex: null,
    ...overrides,
  };
}

const orgArgs = {
  organizationId: 'org_1',
  companyId: 'c1',
};

// --- buildContext ------------------------------------------------------------

describe('buildContext — booking aggregation', () => {
  it('aggregates rooms_sold / nights_sold / room_revenue across bookings', async () => {
    const ds = mockDs({
      bookings: [
        booking({ roomsBooked: 10, nights: 3, revenue: 300 }),
        booking({ roomsBooked: 5, nights: 2, revenue: 200 }),
      ],
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['booking'],
    });
    expect(context.rooms_sold).toBe(15);
    expect(context.nights_sold).toBe(5);
    expect(context.room_revenue).toBe(500);
    // Snake_case mirrored into resolved:
    expect(inputs.resolved.rooms_sold).toBe(15);
    expect(inputs.resolved.room_revenue).toBe(500);
  });

  it('skips cancelled bookings but counts them in aggregates', async () => {
    const ds = mockDs({
      bookings: [
        booking({ roomsBooked: 10, revenue: 500 }),
        booking({ roomsBooked: 99, revenue: 9999, isCancelled: true }),
      ],
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['booking'],
    });
    expect(context.rooms_sold).toBe(10);
    expect(context.room_revenue).toBe(500);
    const agg = inputs.aggregates.booking as {
      booking_count: number;
      cancelled_count: number;
    };
    expect(agg.booking_count).toBe(1);
    expect(agg.cancelled_count).toBe(1);
  });

  it('converts foreign revenue to base using exchangeRate', async () => {
    const ds = mockDs({
      bookings: [
        booking({ revenue: 100, currencyCode: 'USD', exchangeRate: 1.7 }),
        booking({ revenue: 200, currencyCode: null, exchangeRate: null }),
      ],
    });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['booking'],
    });
    expect(context.room_revenue).toBeCloseTo(370);
  });

  it('tracks missing_rate_count for non-null currency without exchangeRate', async () => {
    const ds = mockDs({
      bookings: [
        booking({ revenue: 100, currencyCode: 'USD', exchangeRate: null }),
        booking({ revenue: 100, currencyCode: 'EUR', exchangeRate: 1.9 }),
      ],
    });
    const { inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['booking'],
    });
    const agg = inputs.aggregates.booking as { missing_rate_count: number };
    expect(agg.missing_rate_count).toBe(1);
  });

  it('computes fx_revenue_share as foreign-currency fraction', async () => {
    const ds = mockDs({
      bookings: [
        booking({ revenue: 100, currencyCode: 'USD', exchangeRate: 1 }),
        booking({ revenue: 100, currencyCode: null }),
      ],
    });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['booking'],
    });
    expect(context.fx_revenue_share).toBeCloseTo(0.5);
  });

  it('computes source_country_hhi (4-way equal split → 2500)', async () => {
    const ds = mockDs({
      bookings: [
        booking({ revenue: 100, sourceCountry: 'RU' }),
        booking({ revenue: 100, sourceCountry: 'TR' }),
        booking({ revenue: 100, sourceCountry: 'UA' }),
        booking({ revenue: 100, sourceCountry: 'IR' }),
      ],
    });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['booking'],
    });
    expect(context.source_country_hhi).toBeCloseTo(2500);
  });

  it('computes HHI = 10000 for single-country revenue', async () => {
    const ds = mockDs({
      bookings: [booking({ revenue: 500, sourceCountry: 'RU' })],
    });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['booking'],
    });
    expect(context.source_country_hhi).toBeCloseTo(10000);
  });

  it('zero bookings → fx_share=0, hhi=0', async () => {
    const ds = mockDs({ bookings: [] });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['booking'],
    });
    expect(context.rooms_sold).toBe(0);
    expect(context.fx_revenue_share).toBe(0);
    expect(context.source_country_hhi).toBe(0);
  });

  it('runs the booking resolver once even when multiple booking.* inputs are listed', async () => {
    const ds = mockDs({ bookings: [booking()] });
    await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['booking', 'booking.sourceCountry'],
    });
    const bookingReads = ds.state.orgReads.filter((r) =>
      r.startsWith('bookings:'),
    );
    expect(bookingReads).toHaveLength(1);
  });
});

describe('buildContext — company.settings', () => {
  it('plucks numeric top-level keys and snake-cases them', async () => {
    const ds = mockDs({ settings: { totalRooms: 50 } });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['company.settings.totalRooms'],
    });
    expect(context.total_rooms).toBe(50);
    expect(inputs.aggregates.company_settings).toEqual({ total_rooms: 50 });
  });

  it('derives rooms_available when total_rooms + booking both requested', async () => {
    const ds = mockDs({
      settings: { totalRooms: 50 },
      bookings: [],
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['booking', 'company.settings.totalRooms'],
    });
    expect(context.rooms_available).toBe(1500);
    expect(inputs.derived.rooms_available).toEqual({
      total_rooms: 50,
      days: 30,
    });
  });

  it('derives rooms_available whenever total_rooms is plucked (booking requirement not needed)', async () => {
    // The derivation is purely `total_rooms × days` — no coupling to booking
    // resolver output. Computing an unused var for non-hospitality inputs is
    // harmless and avoids fragile cross-resolver guards.
    const ds = mockDs({ settings: { totalRooms: 50 } });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['company.settings.totalRooms'],
    });
    expect(context.rooms_available).toBe(1500);
    expect(inputs.derived.rooms_available).toEqual({
      total_rooms: 50,
      days: 30,
    });
  });

  it('ignores non-numeric settings values', async () => {
    const ds = mockDs({
      settings: { totalRooms: 'fifty' },
    });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['company.settings.totalRooms'],
    });
    expect(context.total_rooms).toBeUndefined();
  });
});

describe('buildContext — operationalFact', () => {
  it('averages fact values across period and exposes as variable', async () => {
    const ds = mockDs({
      facts: { harvest_tons: [fact(4.0), fact(6.0), fact(5.0)] },
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['operationalFact:harvest_tons'],
    });
    expect(context.harvest_tons).toBeCloseTo(5.0);
    expect(inputs.aggregates.operational_fact).toEqual({
      harvest_tons: { count: 3, avg: 5 },
    });
  });

  it('leaves variable unset when no facts exist (formula fails cleanly)', async () => {
    const ds = mockDs({ facts: {} });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['operationalFact:drought_index'],
    });
    expect(context.drought_index).toBeUndefined();
    expect(inputs.aggregates.operational_fact).toEqual({
      drought_index: { count: 0, avg: null },
    });
  });
});

describe('buildContext — currencyRate namespace', () => {
  it('exposes fx_<code> context vars for every configured currency', async () => {
    const ds = mockDs({
      currencyRates: [
        rate('AZN', 1, true),
        rate('USD', 1.7),
        rate('EUR', 1.85),
      ],
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['currencyRate'],
    });
    expect(context.fx_azn).toBe(1);
    expect(context.fx_usd).toBeCloseTo(1.7);
    expect(context.fx_eur).toBeCloseTo(1.85);
    expect(inputs.aggregates.currency_rate?.base_currency).toBe('AZN');
    expect(inputs.aggregates.currency_rate?.rate_count).toBe(3);
  });

  it('empty currency list leaves no fx_* vars and rate_count=0', async () => {
    const ds = mockDs({ currencyRates: [] });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['currencyRate'],
    });
    // No fx_* populated
    expect(Object.keys(context).filter((k) => k.startsWith('fx_'))).toEqual([]);
    expect(inputs.aggregates.currency_rate?.rate_count).toBe(0);
    expect(inputs.aggregates.currency_rate?.base_currency).toBeNull();
  });

  it('does NOT trigger when other namespaces only (matches exact string)', async () => {
    const ds = mockDs({
      currencyRates: [rate('USD', 1.7)],
    });
    await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['booking'],
    });
    const rateReads = ds.state.orgReads.filter((r) =>
      r.startsWith('rates:'),
    );
    expect(rateReads).toHaveLength(0);
  });
});

describe('buildContext — budgetLine namespace', () => {
  it('aggregates revenue / cogs / opex by accountType in base currency', async () => {
    const ds = mockDs({
      budgetLines: [
        bl({ plannedAmount: 1000, accountType: 'revenue' }),
        bl({ plannedAmount: 400, accountType: 'cogs' }),
        bl({ plannedAmount: 200, accountType: 'expense' }),
      ],
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine'],
    });
    expect(context.revenue).toBe(1000);
    expect(context.cogs).toBe(400);
    expect(context.opex).toBe(200);
    expect(context.total_cost).toBe(600);
    expect(context.gross_profit).toBe(600);
    expect(context.net_income).toBe(400);
    expect(inputs.aggregates.budget_line?.line_count).toBe(3);
  });

  it('FX-converts foreign-currency cost lines to base', async () => {
    const ds = mockDs({
      budgetLines: [
        bl({
          plannedAmount: 100,
          currencyCode: 'USD',
          exchangeRate: 1.7,
          accountType: 'cogs',
        }),
        bl({ plannedAmount: 50, accountType: 'cogs' }), // AZN
      ],
    });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine'],
    });
    // 100 × 1.7 + 50 = 170 + 50 = 220
    expect(context.cogs).toBeCloseTo(220);
  });

  it('splits imported vs domestic at the COGS level only (input ≠ opex)', async () => {
    // total_input_cost must be cogs-only so AGRO_FX_RISK = imported_input_cost
    // / total_input_cost measures input-side FX share, not overall cost FX.
    const ds = mockDs({
      budgetLines: [
        bl({
          plannedAmount: 100,
          currencyCode: 'USD',
          exchangeRate: 1,
          accountType: 'cogs',
        }),
        bl({ plannedAmount: 300, accountType: 'cogs' }), // AZN cogs
        bl({
          plannedAmount: 500,
          currencyCode: 'USD',
          exchangeRate: 1,
          accountType: 'expense', // foreign opex — imported_total_cost aggregate only
        }),
      ],
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine'],
    });
    // cogs-side only
    expect(context.imported_input_cost).toBe(100);
    expect(context.domestic_input_cost).toBe(300);
    expect(context.total_input_cost).toBe(400); // cogs only, NOT 900
    // aggregate keys use scope-explicit names so drill-down readers don't
    // mistake them for the ratio-safe `imported_input_cost` (cogs-only)
    expect(inputs.aggregates.budget_line?.imported_total_cost).toBe(600);
    expect(inputs.aggregates.budget_line?.domestic_total_cost).toBe(300);
  });

  it('tracks missing_rate_count AND excludes foreign-no-rate lines from aggregates', async () => {
    // Earlier bug: foreign line with no rate fell back to 1:1 and silently
    // inflated total_input_cost. Now it's excluded and surfaced via count.
    // line_count still reports DS total so the UI can spot divergence.
    const ds = mockDs({
      budgetLines: [
        bl({
          plannedAmount: 100,
          currencyCode: 'USD',
          exchangeRate: null,
          accountType: 'cogs',
        }),
        bl({ plannedAmount: 200, accountType: 'cogs' }), // AZN, valid
      ],
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine'],
    });
    expect(inputs.aggregates.budget_line?.missing_rate_count).toBe(1);
    expect(inputs.aggregates.budget_line?.line_count).toBe(2); // incl. skipped
    // cogs should be 200 (AZN only), not 300 (fake 1:1 inflation)
    expect(context.cogs).toBe(200);
    expect(context.imported_input_cost).toBe(0);
  });

  it('CXLVIII regression — currencyCode === baseCurrency treated as base (NOT foreign-no-rate)', async () => {
    // Pre-fix: imports stamped every line with currencyCode='AZN' + no rate,
    // and the resolver skipped them ALL as "foreign without rate" — zeroing
    // 100% of revenue/cogs/opex. Guard: when currencyCode equals baseCurrency
    // (default 'AZN'), the line is treated as base regardless of rate.
    const ds = mockDs({
      budgetLines: [
        // All 3 lines stamped with base currency, no rate — should NOT be skipped.
        bl({ plannedAmount: 1000, currencyCode: 'AZN', exchangeRate: null, accountType: 'revenue' }),
        bl({ plannedAmount: 400,  currencyCode: 'AZN', exchangeRate: null, accountType: 'cogs' }),
        bl({ plannedAmount: 200,  currencyCode: 'AZN', exchangeRate: null, accountType: 'expense' }),
      ],
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine'],
    });
    // Resolves identically to currencyCode=null case (line 479 test above).
    expect(context.revenue).toBe(1000);
    expect(context.cogs).toBe(400);
    expect(context.opex).toBe(200);
    expect(context.gross_profit).toBe(600);
    expect(inputs.aggregates.budget_line?.missing_rate_count).toBe(0); // not skipped!
    // And imported_input_cost stays 0 — base currency lines are NOT imported.
    expect(context.imported_input_cost).toBe(0);
    expect(context.domestic_input_cost).toBe(400);
  });

  it('CXLVIII regression — non-base currencyCode without rate still SKIPS', async () => {
    // Belt-and-braces — the base-currency guard must not weaken the strict
    // foreign-no-rate skip. A USD/EUR/etc. line without exchangeRate stays
    // excluded (would silently inflate denominators at 1:1).
    const ds = mockDs({
      budgetLines: [
        bl({ plannedAmount: 100, currencyCode: 'USD', exchangeRate: null, accountType: 'cogs' }),
        bl({ plannedAmount: 200, currencyCode: 'AZN', exchangeRate: null, accountType: 'cogs' }),
      ],
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine'],
    });
    // USD/no-rate skipped, AZN included.
    expect(context.cogs).toBe(200);
    expect(inputs.aggregates.budget_line?.missing_rate_count).toBe(1);
  });

  it('threads the year from the period into the DS read', async () => {
    const ds = mockDs({ budgetLines: [] });
    await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-Q2'),
      requiredInputs: ['budgetLine'],
    });
    expect(ds.state.orgReads).toContain('budgetlines:org_1:2026:quarter');
  });

  it('threads period.kind (month/quarter/year) into the DS read so resolver can scope by sortOrder', async () => {
    // Round-trip locks the contract: resolver must NOT collapse to year-only.
    // Sparkline anchors at 12 trailing months; without this, every monthly
    // anchor reads the same annual aggregate → IND_NET_MARGIN renders as a
    // flat horizontal line (Δ 0.00) regardless of seasonality.
    const ds = mockDs({ budgetLines: [] });
    await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026-04'),
      requiredInputs: ['budgetLine'],
    });
    expect(ds.state.orgReads).toContain('budgetlines:org_1:2026:month');

    // Quarterly recompute (rarer but contracted) — locks the
    // [startMonth..startMonth+2] sortOrder math via the kind tag.
    const ds3 = mockDs({ budgetLines: [] });
    await buildContext(ds3, {
      ...orgArgs,
      period: parsePeriod('2026-Q3'),
      requiredInputs: ['budgetLine'],
    });
    expect(ds3.state.orgReads).toContain('budgetlines:org_1:2026:quarter');

    // Yearly recompute still works — no sortOrder filter, sums all 12 months.
    const ds2 = mockDs({ budgetLines: [] });
    await buildContext(ds2, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine'],
    });
    expect(ds2.state.orgReads).toContain('budgetlines:org_1:2026:year');
  });

  it('ignores asset/liability/equity lines for P&L vars', async () => {
    const ds = mockDs({
      budgetLines: [
        bl({ plannedAmount: 9999, accountType: 'asset' }),
        bl({ plannedAmount: 500, accountType: 'revenue' }),
      ],
    });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine'],
    });
    expect(context.revenue).toBe(500);
    expect(context.cogs).toBe(0);
    expect(context.opex).toBe(0);
  });

  it('empty budget → all vars zero, line_count=0', async () => {
    const ds = mockDs({ budgetLines: [] });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine'],
    });
    expect(context.revenue).toBe(0);
    expect(context.cogs).toBe(0);
    expect(context.opex).toBe(0);
    expect(inputs.aggregates.budget_line?.line_count).toBe(0);
  });
});

describe('createPrismaDataSource.listBudgetLines — sortOrder filter math', () => {
  // The mock-level tests above verify period.kind flows through, but the
  // actual `[startMonth..startMonth+2]` sortOrder math for quarter and
  // `{gte:m, lte:m}` for month live INSIDE createPrismaDataSource. Lock
  // them by capturing the prisma.budgetLine.findMany where clause.
  // Stubbing prisma is acceptable because the function under test is pure
  // plumbing — month-index math + Prisma filter shape.
  function makePrismaSpy() {
    const findMany = vi.fn().mockResolvedValue([]);
    // Cast to PrismaClient — only `budgetLine.findMany` is exercised by
    // this test path.
    const prisma = {
      budgetLine: { findMany },
    } as unknown as Parameters<typeof createPrismaDataSource>[0];
    return { prisma, findMany };
  }

  it('month period (Apr) → sortOrder filter {gte: 3, lte: 3}', async () => {
    const { prisma, findMany } = makePrismaSpy();
    const ds = createPrismaDataSource(prisma);
    await ds.listBudgetLines({
      organizationId: 'org_1',
      companyId: 'co_1',
      period: parsePeriod('2026-04'),
    });
    expect(findMany).toHaveBeenCalledTimes(1);
    const where = findMany.mock.calls[0][0].where;
    expect(where.plan).toEqual({ year: 2026 });
    expect(where.sortOrder).toEqual({ gte: 3, lte: 3 });
  });

  it('quarter period (Q3 = Jul-Sep) → sortOrder filter {gte: 6, lte: 8}', async () => {
    const { prisma, findMany } = makePrismaSpy();
    const ds = createPrismaDataSource(prisma);
    await ds.listBudgetLines({
      organizationId: 'org_1',
      companyId: 'co_1',
      period: parsePeriod('2026-Q3'),
    });
    const where = findMany.mock.calls[0][0].where;
    expect(where.sortOrder).toEqual({ gte: 6, lte: 8 });
  });

  it('quarter period (Q1) → sortOrder filter {gte: 0, lte: 2}', async () => {
    const { prisma, findMany } = makePrismaSpy();
    const ds = createPrismaDataSource(prisma);
    await ds.listBudgetLines({
      organizationId: 'org_1',
      companyId: 'co_1',
      period: parsePeriod('2026-Q1'),
    });
    const where = findMany.mock.calls[0][0].where;
    expect(where.sortOrder).toEqual({ gte: 0, lte: 2 });
  });

  it('year period → no sortOrder filter (sums all 12 months)', async () => {
    const { prisma, findMany } = makePrismaSpy();
    const ds = createPrismaDataSource(prisma);
    await ds.listBudgetLines({
      organizationId: 'org_1',
      companyId: 'co_1',
      period: parsePeriod('2026'),
    });
    const where = findMany.mock.calls[0][0].where;
    expect(where.plan).toEqual({ year: 2026 });
    expect(where.sortOrder).toBeUndefined();
  });

  it('month period (Dec) → sortOrder filter {gte: 11, lte: 11}', async () => {
    // Locks the boundary case (December = month index 11). A bug like
    // `{gte: m, lte: m + 1}` would silently include January next year here.
    const { prisma, findMany } = makePrismaSpy();
    const ds = createPrismaDataSource(prisma);
    await ds.listBudgetLines({
      organizationId: 'org_1',
      companyId: 'co_1',
      period: parsePeriod('2026-12'),
    });
    const where = findMany.mock.calls[0][0].where;
    expect(where.sortOrder).toEqual({ gte: 11, lte: 11 });
  });
});

describe('buildContext — budgetLine sub-aggregations', () => {
  it('rd_spend matches by category tag (preferred over heuristics)', async () => {
    const ds = mockDs({
      budgetLines: [
        bl({
          plannedAmount: 500_000,
          accountType: 'expense',
          accountCode: '770',
          accountCategory: 'rd',
          accountName: 'R&D Programs',
        }),
        bl({ plannedAmount: 200, accountType: 'expense', accountCode: '751' }),
      ],
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine', 'budgetLine.rd_spend'],
    });
    expect(context.rd_spend).toBe(500_000);
    const sub = inputs.aggregates.budget_line?.sub_aggregations?.rd_spend;
    expect(sub?.matched_count).toBe(1);
    expect(sub?.matched_by).toEqual(['category']);
    expect(sub?.top_lines[0]?.code).toBe('770');
  });

  it('rd_spend falls back to code-prefix 720, then to name', async () => {
    const ds = mockDs({
      budgetLines: [
        bl({
          plannedAmount: 100,
          accountType: 'expense',
          accountCode: '720-01',
          accountName: 'Misc R&D bucket',
        }), // matches via code_prefix (720), name also includes 'r&d'
        bl({
          plannedAmount: 50,
          accountType: 'expense',
          accountCode: '791',
          accountName: 'Research salaries',
        }), // matches via name only
      ],
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.rd_spend'],
    });
    expect(context.rd_spend).toBe(150);
    const sub = inputs.aggregates.budget_line?.sub_aggregations?.rd_spend;
    expect(sub?.matched_count).toBe(2);
    // Order is alphabetical for diff stability — see resolver impl
    expect(sub?.matched_by).toEqual(['code_prefix', 'name']);
  });

  it('rd_spend with no matches → no context var set, sub returns matched_count=0', async () => {
    const ds = mockDs({
      budgetLines: [
        bl({ plannedAmount: 100, accountType: 'expense', accountCode: '751', accountName: 'Salaries' }),
      ],
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.rd_spend'],
    });
    expect(context.rd_spend).toBeUndefined();
    expect(
      inputs.aggregates.budget_line?.sub_aggregations?.rd_spend?.matched_count,
    ).toBe(0);
  });

  it('inventory matches asset rows by code 103 prefix or category', async () => {
    const ds = mockDs({
      budgetLines: [
        // category match
        bl({
          plannedAmount: 1000,
          accountType: 'asset',
          accountCode: '103-02',
          accountCategory: 'inventory',
          accountName: 'Raw Materials',
        }),
        // code-prefix match (no category)
        bl({
          plannedAmount: 500,
          accountType: 'asset',
          accountCode: '103-99',
          accountName: 'Stockpile',
        }),
        // name match (no code/category)
        bl({
          plannedAmount: 200,
          accountType: 'asset',
          accountCode: '199',
          accountName: 'Inventory misc',
        }),
        // not asset → ignored even if name says inventory
        bl({
          plannedAmount: 50,
          accountType: 'expense',
          accountName: 'Inventory write-off',
        }),
      ],
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.inventory'],
    });
    expect(context.inventory).toBe(1700);
    const sub = inputs.aggregates.budget_line?.sub_aggregations?.inventory;
    expect(sub?.matched_count).toBe(3);
    expect(sub?.matched_by).toEqual(['category', 'code_prefix', 'name']);
  });

  it('debt_service IGNORES non-expense lines (revenue interest income must NOT be counted)', async () => {
    const ds = mockDs({
      budgetLines: [
        bl({
          plannedAmount: 50_000,
          accountType: 'revenue', // ← treasury interest income, NOT debt service
          accountCode: '603',
          accountName: 'Interest income',
        }),
        bl({
          plannedAmount: 100_000,
          accountType: 'expense',
          accountName: 'Interest expense on long-term debt',
        }),
      ],
    });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.debt_service'],
    });
    // Without the accountType gate this would be 150_000 (50k + 100k).
    // With the gate it's 100_000 — only the expense line counts.
    expect(context.debt_service).toBe(100_000);
  });

  it('debt_service matches by name only (no SAP code prefix in our CoA)', async () => {
    const ds = mockDs({
      budgetLines: [
        bl({
          plannedAmount: 100_000,
          accountType: 'expense',
          accountName: 'Interest expense',
        }),
        bl({
          plannedAmount: 50_000,
          accountType: 'expense',
          accountCategory: 'debt_service',
          accountName: 'Loan principal repayment',
        }),
        bl({
          plannedAmount: 750_000,
          accountType: 'expense',
          accountCode: '751',
          accountName: 'Salaries',
        }), // ignored
      ],
    });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.debt_service'],
    });
    expect(context.debt_service).toBe(150_000);
  });

  it('feed_cost requires accountType=cogs AND name/category match (avoids hitting "active ingredients")', async () => {
    const ds = mockDs({
      budgetLines: [
        bl({
          plannedAmount: 200,
          accountType: 'cogs',
          accountCode: '711',
          accountName: 'Feed',
        }), // poultry hit
        bl({
          plannedAmount: 100,
          accountType: 'cogs',
          accountCode: '711',
          accountName: 'Active Ingredients',
        }), // pharma — must NOT count
        bl({
          plannedAmount: 30,
          accountType: 'expense',
          accountName: 'Feed inspection fees',
        }), // wrong accountType → ignored
        bl({
          plannedAmount: 75,
          accountType: 'cogs',
          accountCategory: 'feed',
          accountName: 'Корма цыплят',
        }), // category match (Russian name match too — category wins, see matched_by)
      ],
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.feed_cost'],
    });
    expect(context.feed_cost).toBe(275);
    const sub = inputs.aggregates.budget_line?.sub_aggregations?.feed_cost;
    expect(sub?.matched_count).toBe(2);
    expect(sub?.matched_by.sort()).toEqual(['category', 'name']);
  });

  it('revenue_line_hhi: single line → 10000 (max), four equal → 2500', async () => {
    const dsSingle = mockDs({
      budgetLines: [
        bl({
          plannedAmount: 1000,
          accountType: 'revenue',
          accountCode: '601',
        }),
      ],
    });
    const single = await buildContext(dsSingle, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.revenue_line_hhi'],
    });
    expect(single.context.revenue_line_hhi).toBeCloseTo(10_000, 1);

    const dsFour = mockDs({
      budgetLines: [
        bl({ plannedAmount: 250, accountType: 'revenue', accountCode: '601' }),
        bl({ plannedAmount: 250, accountType: 'revenue', accountCode: '602' }),
        bl({ plannedAmount: 250, accountType: 'revenue', accountCode: '603' }),
        bl({ plannedAmount: 250, accountType: 'revenue', accountCode: '604' }),
      ],
    });
    const four = await buildContext(dsFour, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.revenue_line_hhi'],
    });
    // 4 codes × (25%)² = 4 × 625 = 2500
    expect(four.context.revenue_line_hhi).toBeCloseTo(2_500, 1);
  });

  it('revenue_line_hhi groups multiple lines under the same code (true HHI denominator)', async () => {
    const ds = mockDs({
      budgetLines: [
        bl({ plannedAmount: 600, accountType: 'revenue', accountCode: '601' }),
        bl({ plannedAmount: 200, accountType: 'revenue', accountCode: '601' }),
        bl({ plannedAmount: 200, accountType: 'revenue', accountCode: '602' }),
      ],
    });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.revenue_line_hhi'],
    });
    // After grouping: 601=800 (80%), 602=200 (20%) → 6400 + 400 = 6800
    expect(context.revenue_line_hhi).toBeCloseTo(6_800, 1);
  });

  it('unknown sub key → empty sub-aggregation, no context var', async () => {
    const ds = mockDs({
      budgetLines: [
        bl({ plannedAmount: 100, accountType: 'revenue', accountCode: '601' }),
      ],
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.does_not_exist'],
    });
    expect(context.does_not_exist).toBeUndefined();
    expect(
      inputs.aggregates.budget_line?.sub_aggregations?.does_not_exist
        ?.matched_count,
    ).toBe(0);
  });

  it('foreign-currency lines without exchangeRate are skipped from sub-aggs too', async () => {
    const ds = mockDs({
      budgetLines: [
        bl({
          plannedAmount: 1_000_000,
          accountType: 'expense',
          currencyCode: 'USD',
          exchangeRate: null, // bad data — skip
          accountCategory: 'rd',
          accountName: 'R&D in foreign currency',
        }),
        bl({
          plannedAmount: 100,
          accountType: 'expense',
          accountCategory: 'rd',
          accountName: 'R&D in AZN',
        }),
      ],
    });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.rd_spend'],
    });
    // Without the skip, this would be 1,000,100. The skipped line is
    // surfaced via missing_rate_count in the parent aggregate, not silent.
    expect(context.rd_spend).toBe(100);
  });

  it('foreign-currency lines with rate are FX-converted in sub-aggs', async () => {
    const ds = mockDs({
      budgetLines: [
        bl({
          plannedAmount: 100,
          accountType: 'expense',
          currencyCode: 'USD',
          exchangeRate: 1.7, // 100 USD = 170 AZN
          accountCategory: 'rd',
          accountName: 'R&D in USD',
        }),
      ],
    });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.rd_spend'],
    });
    expect(context.rd_spend).toBe(170);
  });

  it('top_lines is capped at 3 and sorted by absolute amount desc', async () => {
    const ds = mockDs({
      budgetLines: [
        bl({ plannedAmount: 10, accountType: 'revenue', accountCode: '601' }),
        bl({ plannedAmount: 50, accountType: 'revenue', accountCode: '602' }),
        bl({ plannedAmount: 100, accountType: 'revenue', accountCode: '603' }),
        bl({ plannedAmount: 200, accountType: 'revenue', accountCode: '604' }),
        bl({ plannedAmount: 300, accountType: 'revenue', accountCode: '605' }),
      ],
    });
    const { inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.revenue_line_hhi'],
    });
    const sub = inputs.aggregates.budget_line?.sub_aggregations?.revenue_line_hhi;
    expect(sub?.top_lines).toHaveLength(3);
    expect(sub?.top_lines.map((l) => l.amount)).toEqual([300, 200, 100]);
  });

  it('runs ONE listBudgetLines DB read even when sub-aggregations + bare namespace are both requested', async () => {
    const ds = mockDs({
      budgetLines: [
        bl({ plannedAmount: 1000, accountType: 'revenue', accountCode: '601' }),
        bl({ plannedAmount: 400, accountType: 'cogs', accountCode: '711' }),
      ],
    });
    await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: [
        'budgetLine',
        'budgetLine.revenue_line_hhi',
        'budgetLine.rd_spend',
      ],
    });
    const blReads = ds.state.orgReads.filter((r) =>
      r.startsWith('budgetlines:'),
    );
    expect(blReads).toHaveLength(1);
  });

  // --- Phase 7.E perMonth chain — revenueBySeason ---------------------------

  /**
   * Helper: build 12 monthly revenue rows whose values sum to `annual`,
   * with the requested distribution. `dist` is a 12-element array of
   * weights; values default to even 1/12 split.
   */
  function monthlyRevenue(
    annual: number,
    dist: readonly number[] = Array(12).fill(1 / 12),
  ): BudgetLineRow[] {
    if (dist.length !== 12) {
      throw new Error(`monthlyRevenue: dist must have length 12, got ${dist.length}`);
    }
    return dist.map((weight, monthIndex) =>
      bl({
        plannedAmount: annual * weight,
        accountType: 'revenue',
        accountCode: '601',
        monthIndex,
      }),
    );
  }

  it('revenueBySeason: even 12-month split → top-3 share = 25.0', async () => {
    const ds = mockDs({
      budgetLines: monthlyRevenue(120000), // 10k/month × 12
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.revenueBySeason'],
    });
    expect(context.revenueBySeason).toBeCloseTo(25.0, 1);
    const sub =
      inputs.aggregates.budget_line?.sub_aggregations?.revenueBySeason;
    expect(sub?.matched_count).toBe(12);
    expect(sub?.matched_by).toEqual(['monthIndex']);
  });

  it('revenueBySeason: peaked summer → top-3 share = 75.0 (red territory)', async () => {
    // June+July+August = 75% of revenue, 9 other months share 25% evenly.
    const otherWeight = 0.25 / 9;
    const dist = [
      otherWeight, otherWeight, otherWeight, otherWeight, otherWeight, // J-M
      0.25, 0.25, 0.25, // J-J-A peak
      otherWeight, otherWeight, otherWeight, otherWeight, // S-D
    ];
    const ds = mockDs({ budgetLines: monthlyRevenue(100000, dist) });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.revenueBySeason'],
    });
    expect(context.revenueBySeason).toBeCloseTo(75.0, 1);
  });

  it('revenueBySeason: only 1 month with revenue → unknown (matched_count=0)', async () => {
    // Single-month revenue plan — formula would trivially be 100% which
    // is misleading green → red. Resolver gates with isValid → unknown.
    const dist = [1.0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const ds = mockDs({ budgetLines: monthlyRevenue(50000, dist) });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.revenueBySeason'],
    });
    expect(context.revenueBySeason).toBeUndefined();
    const sub =
      inputs.aggregates.budget_line?.sub_aggregations?.revenueBySeason;
    expect(sub?.matched_count).toBe(0);
  });

  it('revenueBySeason: 2 months with revenue → unknown (still degenerate)', async () => {
    const dist = [0.5, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const ds = mockDs({ budgetLines: monthlyRevenue(50000, dist) });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.revenueBySeason'],
    });
    expect(context.revenueBySeason).toBeUndefined();
  });

  it('revenueBySeason: 3 months exactly → top-3 share = 100', async () => {
    // Lower bound of validity — exactly 3 distinct months, top-3 share
    // is the entire revenue (worst case for an entertainment venue with
    // a 3-month operating window).
    const dist = [0, 0, 0, 0, 0.4, 0.35, 0.25, 0, 0, 0, 0, 0];
    const ds = mockDs({ budgetLines: monthlyRevenue(100000, dist) });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.revenueBySeason'],
    });
    expect(context.revenueBySeason).toBeCloseTo(100.0, 1);
  });

  it('revenueBySeason: ignores cogs/expense rows even with monthIndex', async () => {
    // Revenue distributed evenly across 12 months PLUS a cogs row with
    // monthIndex=5. cogs must NOT participate in the calculation.
    const ds = mockDs({
      budgetLines: [
        ...monthlyRevenue(120000),
        bl({
          plannedAmount: 50000,
          accountType: 'cogs',
          accountCode: '711',
          monthIndex: 5,
        }),
      ],
    });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.revenueBySeason'],
    });
    // Pure revenue / 12 even months → 25%. cogs ignored.
    expect(context.revenueBySeason).toBeCloseTo(25.0, 1);
  });

  it('revenueBySeason: ignores rows without monthIndex (rollup-source / legacy)', async () => {
    // 12 monthly rows + one rollup-source row with null monthIndex.
    // The rollup row has revenue but no month attribution — must be
    // skipped to avoid bucketing into month 0.
    const ds = mockDs({
      budgetLines: [
        ...monthlyRevenue(120000),
        bl({
          plannedAmount: 999999,
          accountType: 'revenue',
          accountCode: 'ROLLUP-REVENUE',
          monthIndex: null,
        }),
      ],
    });
    const { context, inputs } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.revenueBySeason'],
    });
    expect(context.revenueBySeason).toBeCloseTo(25.0, 1);
    const sub =
      inputs.aggregates.budget_line?.sub_aggregations?.revenueBySeason;
    // 12 monthly rows matched; the rollup-source row was rejected by `test()`.
    expect(sub?.matched_count).toBe(12);
  });

  it('revenueBySeason: zero-total revenue → unknown (degenerate division)', async () => {
    // Edge case: 12 zero-amount monthly rows. Total = 0 → division by
    // zero would produce NaN. isValid catches this via `total > 0`.
    const ds = mockDs({
      budgetLines: monthlyRevenue(0, Array(12).fill(1 / 12)),
    });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine.revenueBySeason'],
    });
    expect(context.revenueBySeason).toBeUndefined();
  });
});

describe('buildContext — AGRO_FX_RISK end-to-end', () => {
  it('resolves imported_input_cost / total_input_cost * 100 with both namespaces', async () => {
    // Cogs-only input semantic: 170 USD cogs + 170 AZN cogs = 340 total cogs,
    // 50% imported. Opex lines must not dilute the denominator.
    const ds = mockDs({
      currencyRates: [rate('AZN', 1, true), rate('USD', 1.7)],
      budgetLines: [
        bl({
          plannedAmount: 100,
          currencyCode: 'USD',
          exchangeRate: 1.7,
          accountType: 'cogs',
        }),
        bl({ plannedAmount: 170, accountType: 'cogs' }),
        bl({ plannedAmount: 5000, accountType: 'expense' }), // opex, not input
      ],
    });
    const { context } = await buildContext(ds, {
      ...orgArgs,
      period: parsePeriod('2026'),
      requiredInputs: ['budgetLine', 'currencyRate'],
    });
    expect(context.imported_input_cost).toBeCloseTo(170);
    expect(context.total_input_cost).toBeCloseTo(340); // cogs only
    const share =
      (context.imported_input_cost / context.total_input_cost) * 100;
    expect(share).toBeCloseTo(50);
  });
});

describe('buildContext — tenant scoping', () => {
  it('threads organizationId through every data-source read', async () => {
    const ds = mockDs({
      settings: { totalRooms: 50 },
      bookings: [booking()],
      facts: { foo: [fact(1)] },
    });
    await buildContext(ds, {
      organizationId: 'org_ACME',
      companyId: 'c1',
      period: parsePeriod('2026-04'),
      requiredInputs: [
        'booking',
        'company.settings.totalRooms',
        'operationalFact:foo',
      ],
    });
    expect(ds.state.orgReads).toContain('bookings:org_ACME');
    expect(ds.state.orgReads).toContain('settings:org_ACME');
    expect(ds.state.orgReads).toContain('facts:org_ACME:foo');
  });
});

// --- recomputeIndicator ------------------------------------------------------

const HOSP_OCC: IndicatorDefinitionLike = {
  id: 'ind_occ',
  formula: 'rooms_sold / rooms_available * 100',
  thresholds: {
    green: { op: '>=', value: 70 },
    amber: { op: '>=', value: 50 },
    red: { op: '<', value: 50 },
  },
  requiredInputs: ['booking', 'company.settings.totalRooms'],
};

const AGRO_YIELD: IndicatorDefinitionLike = {
  id: 'ind_yield',
  formula: 'harvest_tons / area_hectares',
  thresholds: {
    green: { op: '>=', value: 4 },
    amber: { op: '>=', value: 2.5 },
    red: { op: '<', value: 2.5 },
  },
  requiredInputs: [
    'operationalFact:harvest_tons',
    'operationalFact:area_hectares',
  ],
};

describe('recomputeIndicator — happy path', () => {
  it('evaluates HOSP_OCC green at 80% occupancy', async () => {
    const ds = mockDs({
      settings: { totalRooms: 50 },
      bookings: [booking({ roomsBooked: 1200, revenue: 100_000 })],
    });
    const result = await recomputeIndicator(ds, {
      organizationId: 'org_1',
      companyId: 'c1',
      definition: HOSP_OCC,
      period: '2026-04',
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('green');
    expect(result.value).toBeCloseTo(80);
    expect(ds.state.upserts).toHaveLength(1);
    expect(ds.state.upserts[0]).toMatchObject({
      organizationId: 'org_1',
      companyId: 'c1',
      indicatorId: 'ind_occ',
      period: '2026-04',
      status: 'green',
    });
  });

  it('evaluates HOSP_OCC red at 20% occupancy', async () => {
    const ds = mockDs({
      settings: { totalRooms: 50 },
      bookings: [booking({ roomsBooked: 300 })],
    });
    const result = await recomputeIndicator(ds, {
      organizationId: 'org_1',
      companyId: 'c1',
      definition: HOSP_OCC,
      period: '2026-04',
    });
    expect(result.status).toBe('red');
    expect(result.value).toBeCloseTo(20);
  });

  it('evaluates AGRO_YIELD green at 5 t/ha', async () => {
    const ds = mockDs({
      facts: {
        harvest_tons: [fact(500)],
        area_hectares: [fact(100)],
      },
    });
    const result = await recomputeIndicator(ds, {
      organizationId: 'org_1',
      companyId: 'c2',
      definition: AGRO_YIELD,
      period: '2026',
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('green');
    expect(result.value).toBeCloseTo(5);
  });
});

describe('recomputeIndicator — error paths produce status=unknown', () => {
  it('missing total_rooms → rooms_available undefined → eval error → unknown', async () => {
    const ds = mockDs({
      settings: {},
      bookings: [booking({ roomsBooked: 100 })],
    });
    const result = await recomputeIndicator(ds, {
      organizationId: 'org_1',
      companyId: 'c1',
      definition: HOSP_OCC,
      period: '2026-04',
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('unknown');
    expect(result.value).toBe(0);

    const stored = ds.state.upserts[0];
    expect(stored.status).toBe('unknown');
    expect(stored.inputs.error?.code).toBe('eval');
    expect(stored.inputs.error?.reason).toMatch(/rooms_available/);
  });

  it('zero total_rooms → 0/0 → non_finite → unknown', async () => {
    const ds = mockDs({
      settings: { totalRooms: 0 },
      bookings: [],
    });
    const result = await recomputeIndicator(ds, {
      organizationId: 'org_1',
      companyId: 'c1',
      definition: HOSP_OCC,
      period: '2026-04',
    });
    expect(result.status).toBe('unknown');
    expect(ds.state.upserts[0].inputs.error?.code).toBe('non_finite');
  });

  it('empty operationalFact → missing var → unknown', async () => {
    const ds = mockDs({ facts: {} });
    const result = await recomputeIndicator(ds, {
      organizationId: 'org_1',
      companyId: 'c1',
      definition: AGRO_YIELD,
      period: '2026',
    });
    expect(result.status).toBe('unknown');
    expect(result.value).toBe(0);
  });

  it('upserts the row on failure too (UI sees stale→unknown)', async () => {
    const ds = mockDs({ facts: {} });
    await recomputeIndicator(ds, {
      organizationId: 'org_1',
      companyId: 'c1',
      definition: AGRO_YIELD,
      period: '2026',
    });
    expect(ds.state.upserts).toHaveLength(1);
    expect(ds.state.upserts[0].status).toBe('unknown');
  });
});

describe('applyOutOfRangeClamp', () => {
  it('leaves values alone when unit is not "%"', () => {
    expect(applyOutOfRangeClamp(500, 'AZN', 'HOSP_REVPAR').clamped).toBe(false);
    expect(applyOutOfRangeClamp(9999, undefined, 'AGRO_YIELD').clamped).toBe(false);
  });

  it('leaves values inside the cap alone', () => {
    expect(applyOutOfRangeClamp(50, '%', 'X').clamped).toBe(false);
    expect(applyOutOfRangeClamp(-199, '%', 'X').clamped).toBe(false);
    expect(applyOutOfRangeClamp(RATIO_PLAUSIBILITY_CAP_PCT, '%', 'X').clamped).toBe(false);
  });

  it('clamps ratios outside ±200% with a finance-user-readable reason', () => {
    const r = applyOutOfRangeClamp(253.8, '%', 'IND_OPEX_RATIO');
    expect(r.clamped).toBe(true);
    expect(r.reason).toMatch(/253\.8%/);
    expect(r.reason).toMatch(/IND_OPEX_RATIO/);
    expect(r.reason).toMatch(/data-classification/i);
    const neg = applyOutOfRangeClamp(-215, '%', 'IND_NET_MARGIN');
    expect(neg.clamped).toBe(true);
    expect(neg.reason).toMatch(/-215/);
  });
});

describe('recomputeIndicator — out-of-range plausibility clamp', () => {
  const LLS_OPEX: IndicatorDefinitionLike = {
    id: 'ind_opex',
    code: 'IND_OPEX_RATIO',
    formula: 'opex / revenue * 100',
    unit: '%',
    thresholds: {
      green: { op: '<=', value: 20 },
      amber: { op: '<=', value: 35 },
      red: { op: '>', value: 35 },
    },
    requiredInputs: ['budgetLine'],
  };

  it('flips an OpEx ratio > 200% to unknown + out_of_range error', async () => {
    // Revenue 100, opex 300 → ratio = 300%. Without clamp this would be red
    // ("overhead bloat"); with clamp it's gray ("data quality issue").
    const ds = mockDs({
      budgetLines: [
        bl({ plannedAmount: 100, accountType: 'revenue' }),
        bl({ plannedAmount: 300, accountType: 'expense' }),
      ],
    });
    const result = await recomputeIndicator(ds, {
      organizationId: 'org_1',
      companyId: 'c1',
      definition: LLS_OPEX,
      period: '2026',
    });
    expect(result.status).toBe('unknown');
    expect(result.value).toBeCloseTo(300);
    const stored = ds.state.upserts[0];
    expect(stored.inputs.error?.code).toBe('out_of_range');
    expect(stored.inputs.error?.reason).toMatch(/data-classification|plausibility/i);
    // Raw value preserved in resolved for drill-down
    expect(stored.inputs.resolved.opex).toBe(300);
    expect(stored.inputs.resolved.revenue).toBe(100);
  });

  it('does NOT clamp when value is within ±200% (e.g. SPARK 109.8% stays red)', async () => {
    // Cogs 110, revenue 100 → ratio = 110%. Over green/amber thresholds → red,
    // but within plausibility window → stays red, not clamped to unknown.
    const COGS_IND: IndicatorDefinitionLike = {
      id: 'ind_cogs',
      code: 'IND_COGS_INTENSITY',
      formula: 'cogs / revenue * 100',
      unit: '%',
      thresholds: {
        green: { op: '<=', value: 70 },
        amber: { op: '<=', value: 85 },
        red: { op: '>', value: 85 },
      },
      requiredInputs: ['budgetLine'],
    };
    const ds = mockDs({
      budgetLines: [
        bl({ plannedAmount: 100, accountType: 'revenue' }),
        bl({ plannedAmount: 110, accountType: 'cogs' }),
      ],
    });
    const result = await recomputeIndicator(ds, {
      organizationId: 'org_1',
      companyId: 'c1',
      definition: COGS_IND,
      period: '2026',
    });
    expect(result.status).toBe('red');
    expect(result.value).toBeCloseTo(110);
    expect(ds.state.upserts[0].inputs.error).toBeUndefined();
  });

  it('does NOT clamp non-percent indicators (unit="AZN" / "ton/ha" / etc.)', async () => {
    const REVPAR: IndicatorDefinitionLike = {
      id: 'ind_revpar',
      code: 'HOSP_REVPAR',
      formula: 'room_revenue / rooms_available',
      unit: 'AZN',
      thresholds: {
        green: { op: '>=', value: 80 },
        amber: { op: '>=', value: 50 },
        red: { op: '<', value: 50 },
      },
      requiredInputs: ['booking', 'company.settings.totalRooms'],
    };
    const ds = mockDs({
      settings: { totalRooms: 1 }, // rooms_available = 1 × 30 = 30
      bookings: [booking({ revenue: 50000, roomsBooked: 1 })],
    });
    const result = await recomputeIndicator(ds, {
      organizationId: 'org_1',
      companyId: 'c1',
      definition: REVPAR,
      period: '2026-04',
    });
    expect(result.status).toBe('green'); // large AZN value not clamped
    expect(result.value).toBeGreaterThan(200);
    expect(ds.state.upserts[0].inputs.error).toBeUndefined();
  });
});

describe('recomputeIndicator — tenant scoping', () => {
  it('passes organizationId through to both reads and writes', async () => {
    const ds = mockDs({
      settings: { totalRooms: 50 },
      bookings: [booking({ roomsBooked: 1200 })],
    });
    await recomputeIndicator(ds, {
      organizationId: 'org_ACME',
      companyId: 'c1',
      definition: HOSP_OCC,
      period: '2026-04',
    });
    expect(ds.state.upserts[0].organizationId).toBe('org_ACME');
    expect(ds.state.orgReads).toContain('bookings:org_ACME');
    expect(ds.state.orgReads).toContain('settings:org_ACME');
  });
});

// --- Phase 7.E perMonth chain phase 2 — sparkline integration ----------------

describe('recomputeIndicator — sparkline integration (Phase 7.E phase 2)', () => {
  // Constant-formula indicator: sparkline = 12 copies of the same value.
  // Locks the integration chain (length / numeric / idempotency) without
  // entangling the resolver-level monthly-distribution semantics, which
  // are already covered by `sparkline.test.ts:217+` against a real
  // BudgetLine fixture.
  const IND_CONST: IndicatorDefinitionLike = {
    id: 'ind_const',
    code: 'IND_CONST',
    formula: '42',
    thresholds: {
      green: { op: '>=', value: 0 },
      amber: { op: '>=', value: -100 },
      red: { op: '<', value: -100 },
    },
    requiredInputs: [],
  };

  it('default (withSparkline omitted) → upsert.sparkline is undefined (back-compat lock)', async () => {
    const ds = mockDs({});
    await recomputeIndicator(ds, {
      ...orgArgs,
      definition: IND_CONST,
      period: '2026-04',
    });
    expect(ds.state.upserts).toHaveLength(1);
    expect(ds.state.upserts[0].sparkline).toBeUndefined();
  });

  it('withSparkline:false explicit → upsert.sparkline is undefined', async () => {
    const ds = mockDs({});
    await recomputeIndicator(ds, {
      ...orgArgs,
      definition: IND_CONST,
      period: '2026-04',
      withSparkline: false,
    });
    expect(ds.state.upserts[0].sparkline).toBeUndefined();
  });

  it('withSparkline:true → upsert.sparkline is 12-slot array of constant', async () => {
    const ds = mockDs({});
    await recomputeIndicator(ds, {
      ...orgArgs,
      definition: IND_CONST,
      period: '2026-04',
      withSparkline: true,
    });
    expect(ds.state.upserts).toHaveLength(1);
    const sl = ds.state.upserts[0].sparkline;
    expect(sl).toBeDefined();
    expect(sl).toHaveLength(12);
    expect(sl).toEqual(Array(12).fill(42));
  });

  it('withSparkline:true uses sparklineFormula when present (overrides formula)', async () => {
    // Spot value reads `formula` (=10); sparkline reads `sparklineFormula`
    // (=99). Verifies the variant override fires inside `recomputeIndicator`,
    // not just at the `sparkline.ts` boundary.
    const ds = mockDs({});
    const def: IndicatorDefinitionLike = {
      ...IND_CONST,
      formula: '10',
      sparklineFormula: '99',
    };
    const r = await recomputeIndicator(ds, {
      ...orgArgs,
      definition: def,
      period: '2026-04',
      withSparkline: true,
    });
    expect(r.value).toBe(10); // spot from `formula`
    expect(ds.state.upserts[0].sparkline).toEqual(Array(12).fill(99));
  });

  it('withSparkline:true with sparklineFormula:null falls back to formula', async () => {
    const ds = mockDs({});
    const def: IndicatorDefinitionLike = {
      ...IND_CONST,
      sparklineFormula: null,
    };
    await recomputeIndicator(ds, {
      ...orgArgs,
      definition: def,
      period: '2026-04',
      withSparkline: true,
    });
    expect(ds.state.upserts[0].sparkline).toEqual(Array(12).fill(42));
  });

  it('idempotent — same fixtures × 2 recomputes produce identical sparklines', async () => {
    const ds = mockDs({});
    for (let i = 0; i < 2; i++) {
      await recomputeIndicator(ds, {
        ...orgArgs,
        definition: IND_CONST,
        period: '2026-04',
        withSparkline: true,
      });
    }
    expect(ds.state.upserts).toHaveLength(2);
    expect(ds.state.upserts[0].sparkline).toEqual(
      ds.state.upserts[1].sparkline,
    );
  });

  it('spot-status independent of sparkline value (classify reads `formula` only)', async () => {
    // Defensive: spot value uses `formula`; classifier must NOT see the
    // sparklineFormula output. With formula=10 and thresholds requiring 50
    // for green, status MUST be amber (not green-from-99).
    const ds = mockDs({});
    const def: IndicatorDefinitionLike = {
      id: 'ind_x',
      code: 'IND_X',
      formula: '10',
      sparklineFormula: '99',
      thresholds: {
        green: { op: '>=', value: 50 },
        amber: { op: '>=', value: 5 },
        red: { op: '<', value: 5 },
      },
      requiredInputs: [],
    };
    const r = await recomputeIndicator(ds, {
      ...orgArgs,
      definition: def,
      period: '2026-04',
      withSparkline: true,
    });
    expect(r.value).toBe(10);
    expect(r.status).toBe('amber');
    expect(ds.state.upserts[0].sparkline).toEqual(Array(12).fill(99));
  });
});

// --- Phase 7.E phase 2 — Prisma adapter sparkline write semantics ------------

describe('createPrismaDataSource.upsertIndicatorValue — sparkline write semantics (Phase 7.E phase 2)', () => {
  // Critical no-clobber invariant: bulk recomputes that pass `sparkline:
  // undefined` must NOT include sparkline in the UPDATE payload, otherwise
  // every period-only fan-out would silently nuke sparklines populated by
  // the offline `compute-sparklines.ts` worker or by an interactive
  // single-IV recompute. Lock the Prisma `upsert(...)` arg shape directly.
  function makePrismaSpy() {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      indicatorValue: { upsert },
    } as unknown as Parameters<typeof createPrismaDataSource>[0];
    return { prisma, upsert };
  }

  const baseArgs = {
    organizationId: 'org_1',
    companyId: 'co_1',
    indicatorId: 'ind_1',
    period: '2026-04',
    value: 80,
    status: 'green' as const,
    inputs: { resolved: {}, aggregates: {}, derived: {} },
  };

  it('CREATE: omits sparkline → writes [] (preserves first-write default)', async () => {
    const { prisma, upsert } = makePrismaSpy();
    const ds = createPrismaDataSource(prisma);
    await ds.upsertIndicatorValue(baseArgs);
    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0][0];
    expect(args.create.sparkline).toEqual([]);
  });

  it('CREATE: caller-supplied sparkline lands in create payload', async () => {
    const { prisma, upsert } = makePrismaSpy();
    const ds = createPrismaDataSource(prisma);
    const sl: (number | null)[] = [1, 2, null, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    await ds.upsertIndicatorValue({ ...baseArgs, sparkline: sl });
    const args = upsert.mock.calls[0][0];
    expect(args.create.sparkline).toEqual(sl);
  });

  it('UPDATE: omits sparkline KEY when caller omits (no-clobber invariant)', async () => {
    // The load-bearing invariant. If `update.sparkline` is set to anything
    // (including `undefined` / `null` / `[]`) when caller didn't supply one,
    // bulk period-only recomputes would zero out worker-populated arrays.
    const { prisma, upsert } = makePrismaSpy();
    const ds = createPrismaDataSource(prisma);
    await ds.upsertIndicatorValue(baseArgs);
    const args = upsert.mock.calls[0][0];
    expect(args.update).not.toHaveProperty('sparkline');
  });

  it('UPDATE: caller-supplied sparkline lands in update payload', async () => {
    const { prisma, upsert } = makePrismaSpy();
    const ds = createPrismaDataSource(prisma);
    const sl: (number | null)[] = Array(12).fill(42);
    await ds.upsertIndicatorValue({ ...baseArgs, sparkline: sl });
    const args = upsert.mock.calls[0][0];
    expect(args.update.sparkline).toEqual(sl);
  });
});

// --- Phase 7.E phase 3 — fact() / rollup() resolvers ------------------------

describe("buildContext — fact() resolver (Phase 7.E phase 3)", () => {
  // Indicator definition with year-over-year delta formula. Pre-fetches
  // 2025's IND_NET_MARGIN value, divides current-period value into delta.
  const YOY_DELTA: IndicatorDefinitionLike = {
    id: 'ind_yoy',
    code: 'IND_YOY_DELTA',
    formula: 'value_now - fact("IND_NET_MARGIN", "2025")',
    thresholds: {
      green: { op: '>=', value: 0 },
      amber: { op: '>=', value: -50 },
      red: { op: '<', value: -50 },
    },
    requiredInputs: ['fact:IND_NET_MARGIN@2025'],
  };

  it('resolves fact(code, period) → persisted IV value (happy path)', async () => {
    const ds = mockDs({
      ivReads: { 'c1:IND_NET_MARGIN@2025': 12.5 },
    });
    const { context, inputs, functions } = await buildContext(ds, {
      organizationId: 'org_1',
      companyId: 'c1',
      period: parsePeriod('2026'),
      requiredInputs: ['fact:IND_NET_MARGIN@2025'],
    });
    // The function is exposed via state.functions.
    expect(typeof functions.fact).toBe('function');
    expect(functions.fact('IND_NET_MARGIN', '2025')).toBe(12.5);
    // Aggregate snapshot persists for drill-down.
    expect(inputs.aggregates.fact).toEqual({
      read_count: 1,
      hit_count: 1,
      reads: { 'IND_NET_MARGIN@2025': 12.5 },
    });
    // No formula context vars are added — fact() is a function, not a var.
    expect(context).toEqual({});
  });

  it('missing IV (returns null) → fact() exposes NaN → formula fails', async () => {
    const ds = mockDs({
      ivReads: { /* no key */ },
    });
    // Standalone fact() formula isolates the NaN-propagation path
    // (vs YOY_DELTA's `value_now - fact(...)` which would fail at
    // `value_now` resolution before fact() even runs).
    const r = await recomputeIndicator(ds, {
      organizationId: 'org_1',
      companyId: 'c1',
      definition: {
        ...YOY_DELTA,
        formula: 'fact("IND_NET_MARGIN", "2025")',
        requiredInputs: ['fact:IND_NET_MARGIN@2025'],
      },
      period: '2026',
    });
    // Formula = NaN → non_finite → unknown.
    expect(r.status).toBe('unknown');
    expect(ds.state.upserts[0].inputs.error?.code).toBe('non_finite');
    // Snapshot still records the attempted read (for drill-down).
    expect(ds.state.upserts[0].inputs.aggregates.fact).toMatchObject({
      read_count: 1,
      hit_count: 0,
      reads: { 'IND_NET_MARGIN@2025': null },
    });
  });

  it('resolves multiple (code, period) pairs in one batch', async () => {
    const ds = mockDs({
      ivReads: {
        'c1:IND_X@2024': 80,
        'c1:IND_X@2025': 90,
        'c1:IND_X@2026': 100,
      },
    });
    const { functions, inputs } = await buildContext(ds, {
      organizationId: 'org_1',
      companyId: 'c1',
      period: parsePeriod('2026'),
      requiredInputs: [
        'fact:IND_X@2024',
        'fact:IND_X@2025',
        'fact:IND_X@2026',
      ],
    });
    expect(functions.fact!('IND_X', '2024')).toBe(80);
    expect(functions.fact!('IND_X', '2025')).toBe(90);
    expect(functions.fact!('IND_X', '2026')).toBe(100);
    expect(inputs.aggregates.fact?.read_count).toBe(3);
    expect(inputs.aggregates.fact?.hit_count).toBe(3);
  });

  it('de-duplicates same (code, period) declared multiple times', async () => {
    // requiredInputs may contain the same fact key twice — author error or
    // composition. Resolver de-dupes so the batched read fires once with
    // a SINGLE pair.
    const ds = mockDs({
      ivReads: { 'c1:IND_X@2025': 42 },
    });
    await buildContext(ds, {
      organizationId: 'org_1',
      companyId: 'c1',
      period: parsePeriod('2026'),
      requiredInputs: ['fact:IND_X@2025', 'fact:IND_X@2025', 'fact:IND_X@2025'],
    });
    // Phase 7.G Turn XLI: post-batching, the dedup contract is "3
    // requiredInputs → 1 batched call with 1 pair", not "3 → 1 singular
    // calls". Both invariants together prove the dedup happens BEFORE
    // the network round-trip (not just at the result-mapping step).
    expect(ds.state.ivBatchCalls).toHaveLength(1);
    expect(ds.state.ivBatchCalls[0].pairs).toEqual([
      { indicatorCode: 'IND_X', period: '2025' },
    ]);
    // Singular path is unused for fact() now.
    expect(ds.state.ivReadCalls).toHaveLength(0);
  });

  it('skips malformed fact entries silently (lenient parse)', async () => {
    // `fact:bad` (no @), `fact:@2025` (empty code), `fact:CODE@` (empty period),
    // `fact:` (empty body) are all soft-skipped — only the well-formed
    // `fact:IND_X@2025` reaches the batched read.
    const ds = mockDs({
      ivReads: { 'c1:IND_X@2025': 42 },
    });
    await buildContext(ds, {
      organizationId: 'org_1',
      companyId: 'c1',
      period: parsePeriod('2026'),
      requiredInputs: [
        'fact:bad',
        'fact:@2025',
        'fact:CODE@',
        'fact:',
        'fact:IND_X@2025',
      ],
    });
    expect(ds.state.ivBatchCalls).toHaveLength(1);
    expect(ds.state.ivBatchCalls[0].pairs).toEqual([
      { indicatorCode: 'IND_X', period: '2025' },
    ]);
  });

  it('Phase 7.G Turn XLI: batching collapses N pair reads into ONE call', async () => {
    // Pre-Turn-XLI: each fact:CODE@PERIOD entry triggered an independent
    // `getIndicatorValue` Prisma findFirst (Promise.all of N). At Phase
    // F scale (~1500 fact reads per recompute batch), this was 1500
    // concurrent queries.
    //
    // Post-Turn-XLI: ONE batched `getIndicatorValues` per buildContext
    // with N pairs in the OR clause. This test pins the contract: 5
    // distinct fact:CODE@PERIOD entries → 1 batched call with 5 pairs.
    const ds = mockDs({
      ivReads: {
        'c1:IND_A@2024': 100,
        'c1:IND_A@2025': 110,
        'c1:IND_B@2024': 200,
        'c1:IND_B@2025': 220,
        'c1:IND_C@2025': 300,
      },
    });
    await buildContext(ds, {
      organizationId: 'org_1',
      companyId: 'c1',
      period: parsePeriod('2026'),
      requiredInputs: [
        'fact:IND_A@2024',
        'fact:IND_A@2025',
        'fact:IND_B@2024',
        'fact:IND_B@2025',
        'fact:IND_C@2025',
      ],
    });
    expect(ds.state.ivBatchCalls).toHaveLength(1);
    expect(ds.state.ivBatchCalls[0].pairs).toHaveLength(5);
    // Singular path unused.
    expect(ds.state.ivReadCalls).toHaveLength(0);
  });

  it('end-to-end: formula uses fact() for YoY delta', async () => {
    // value_now = current IV value (set by formula constant for this test).
    // fact("IND_NET_MARGIN", "2025") = 10 (from IV reads).
    // formula = 15 - fact("IND_NET_MARGIN", "2025") = 15 - 10 = 5 → green.
    const ds = mockDs({
      ivReads: { 'c1:IND_NET_MARGIN@2025': 10 },
    });
    const r = await recomputeIndicator(ds, {
      organizationId: 'org_1',
      companyId: 'c1',
      definition: {
        ...YOY_DELTA,
        formula: '15 - fact("IND_NET_MARGIN", "2025")',
      },
      period: '2026',
    });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(5);
    expect(r.status).toBe('green');
  });

  it('passes current-period orgId + companyId through (tenant scoping)', async () => {
    const ds = mockDs({
      ivReads: { 'c1:IND_X@2025': 42 },
    });
    await buildContext(ds, {
      organizationId: 'org_specific',
      companyId: 'c1',
      period: parsePeriod('2026'),
      requiredInputs: ['fact:IND_X@2025'],
    });
    // Phase 7.G Turn XLI: tenant scoping is now asserted on the batched
    // `getIvs:` log entry (org + co + N-pairs marker). The pair details
    // are checked separately on `ivBatchCalls[0].pairs`.
    expect(ds.state.orgReads).toContain(
      'getIvs:org_specific:c1:1pairs',
    );
    expect(ds.state.ivBatchCalls).toEqual([
      {
        companyId: 'c1',
        pairs: [{ indicatorCode: 'IND_X', period: '2025' }],
      },
    ]);
  });
});

describe("buildContext — rollup() resolver (Phase 7.E phase 3)", () => {
  it('sums child IVs at current period (basic happy path)', async () => {
    const ds = mockDs({
      children: { parent_co: ['c_child_1', 'c_child_2'] },
      ivReads: {
        'c_child_1:IND_REVENUE@2026': 100,
        'c_child_2:IND_REVENUE@2026': 200,
      },
    });
    const { functions, inputs } = await buildContext(ds, {
      organizationId: 'org_1',
      companyId: 'parent_co',
      period: parsePeriod('2026'),
      requiredInputs: ['rollup:IND_REVENUE'],
    });
    expect(functions.rollup!('IND_REVENUE')).toBe(300);
    expect(inputs.aggregates.rollup).toEqual({
      children_count: 2,
      sums: { IND_REVENUE: { sum: 300, matched_count: 2 } },
    });
  });

  it('empty children → rollup() returns 0 (empty sum, not NaN)', async () => {
    const ds = mockDs({
      children: { /* parent_co has no entry */ },
    });
    const { functions, inputs } = await buildContext(ds, {
      organizationId: 'org_1',
      companyId: 'parent_co',
      period: parsePeriod('2026'),
      requiredInputs: ['rollup:IND_X'],
    });
    expect(functions.rollup!('IND_X')).toBe(0);
    expect(inputs.aggregates.rollup).toEqual({
      children_count: 0,
      sums: { IND_X: { sum: 0, matched_count: 0 } },
    });
  });

  it('skips children with missing IV (matched_count reflects gap)', async () => {
    const ds = mockDs({
      children: { parent_co: ['c1', 'c2', 'c3'] },
      ivReads: {
        'c1:IND_X@2026': 50,
        // c2 has no IV (missing entirely)
        'c3:IND_X@2026': 100,
      },
    });
    const { functions, inputs } = await buildContext(ds, {
      organizationId: 'org_1',
      companyId: 'parent_co',
      period: parsePeriod('2026'),
      requiredInputs: ['rollup:IND_X'],
    });
    expect(functions.rollup!('IND_X')).toBe(150); // 50 + 100, c2 skipped
    expect(inputs.aggregates.rollup).toEqual({
      children_count: 3,
      sums: { IND_X: { sum: 150, matched_count: 2 } },
    });
  });

  it('passes current-period to getIv (not a hardcoded year)', async () => {
    // Locks the period.raw plumbing — earlier impl had a custom formatter
    // that hit a tsc bug on `period.q` / `period.m`. Verify monthly anchor
    // → "2026-04" is the period sent to children's IV lookups.
    const ds = mockDs({
      children: { parent_co: ['c1'] },
      ivReads: { 'c1:IND_X@2026-04': 42 },
    });
    await buildContext(ds, {
      organizationId: 'org_1',
      companyId: 'parent_co',
      period: parsePeriod('2026-04'),
      requiredInputs: ['rollup:IND_X'],
    });
    expect(ds.state.ivReadCalls).toEqual([
      { companyId: 'c1', indicatorCode: 'IND_X', period: '2026-04' },
    ]);
  });

  it('end-to-end: formula uses rollup() for parent-co aggregate', async () => {
    const HOLDING_REVENUE: IndicatorDefinitionLike = {
      id: 'ind_holding_rev',
      code: 'IND_HOLDING_REVENUE',
      formula: 'rollup("IND_REVENUE")',
      thresholds: {
        green: { op: '>=', value: 100 },
        amber: { op: '>=', value: 50 },
        red: { op: '<', value: 50 },
      },
      requiredInputs: ['rollup:IND_REVENUE'],
    };
    const ds = mockDs({
      children: { parent_co: ['child_a', 'child_b', 'child_c'] },
      ivReads: {
        'child_a:IND_REVENUE@2026': 100,
        'child_b:IND_REVENUE@2026': 200,
        'child_c:IND_REVENUE@2026': 300,
      },
    });
    const r = await recomputeIndicator(ds, {
      organizationId: 'org_1',
      companyId: 'parent_co',
      definition: HOLDING_REVENUE,
      period: '2026',
    });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(600);
    expect(r.status).toBe('green');
  });

  it('de-duplicates same code declared multiple times', async () => {
    const ds = mockDs({
      children: { parent_co: ['c1'] },
      ivReads: { 'c1:IND_X@2026': 7 },
    });
    await buildContext(ds, {
      organizationId: 'org_1',
      companyId: 'parent_co',
      period: parsePeriod('2026'),
      requiredInputs: ['rollup:IND_X', 'rollup:IND_X'],
    });
    // 1 children call + 1 IV read call (not 2).
    expect(ds.state.childrenCalls).toHaveLength(1);
    expect(ds.state.ivReadCalls).toHaveLength(1);
  });

  it('multiple codes share one children-list query', async () => {
    // Architectural lock: rollup of [code_a, code_b] must reuse the SAME
    // children list, not re-fetch it per code. children-list is the
    // expensive part (DB scan); IV reads fan out per (code × child).
    const ds = mockDs({
      children: { parent_co: ['c1', 'c2'] },
      ivReads: {
        'c1:CODE_A@2026': 1,
        'c2:CODE_A@2026': 2,
        'c1:CODE_B@2026': 10,
        'c2:CODE_B@2026': 20,
      },
    });
    const { functions } = await buildContext(ds, {
      organizationId: 'org_1',
      companyId: 'parent_co',
      period: parsePeriod('2026'),
      requiredInputs: ['rollup:CODE_A', 'rollup:CODE_B'],
    });
    expect(functions.rollup!('CODE_A')).toBe(3);
    expect(functions.rollup!('CODE_B')).toBe(30);
    // The cost-shape lock — children-list called once; IV reads called
    // 4 times (2 codes × 2 children).
    expect(ds.state.childrenCalls).toHaveLength(1);
    expect(ds.state.ivReadCalls).toHaveLength(4);
  });
});

// --- Phase 7.E phase 3 — seed-load-time validateRequiredInputs --------------

describe('validateRequiredInputs (Phase 7.E phase 3, sub-41 architect closure)', () => {
  // The strict layer-up validator that lives at seed-author time. Resolver
  // stays lenient at runtime; this guard catches typos BEFORE they ship.

  it('accepts well-formed fact: + rollup: + non-namespace entries', () => {
    const r = validateRequiredInputs([
      'fact:IND_NET_MARGIN@2025',
      'fact:IND_X@2026-Q2',
      'rollup:IND_REVENUE',
      'booking',
      'company.settings.totalRooms',
      'operationalFact:harvest_tons',
      'budgetLine.revenue',
      'currencyRate',
      // bare fact / rollup are no-op declarations (resolver skips silently)
      'fact',
      'rollup',
    ]);
    expect(r).toEqual({ ok: true });
  });

  it('rejects fact: with empty body', () => {
    const r = validateRequiredInputs(['fact:']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/empty body after "fact:"/);
      expect(r.reason).toMatch(/requiredInputs\[0\]/);
    }
  });

  it('rejects fact: missing @ separator', () => {
    const r = validateRequiredInputs(['booking', 'fact:bad']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/missing "@" separator/);
      expect(r.reason).toMatch(/requiredInputs\[1\]/);
    }
  });

  it('rejects fact: with empty CODE before @', () => {
    const r = validateRequiredInputs(['fact:@2025']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty INDICATOR_CODE before "@"/);
  });

  it('rejects fact: with empty PERIOD after @', () => {
    const r = validateRequiredInputs(['fact:CODE@']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty PERIOD after "@"/);
  });

  it('rejects rollup: with empty CODE', () => {
    const r = validateRequiredInputs(['rollup:']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/empty INDICATOR_CODE after "rollup:"/);
    }
  });

  it('returns first failure (short-circuit) — does not bury later errors', () => {
    // Position 1 fails first; positions 2/3 (also bad) are not surfaced.
    // The seed author fixes one at a time; surfacing all at once would
    // bury the most-actionable error.
    const r = validateRequiredInputs([
      'booking',
      'fact:bad', // bad #1 — surfaced
      'fact:@', // bad #2 — would also fail, but not surfaced this run
      'rollup:', // bad #3 — would also fail
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/requiredInputs\[1\]/);
      expect(r.reason).not.toMatch(/requiredInputs\[2\]/);
    }
  });

  it('empty array → ok', () => {
    expect(validateRequiredInputs([])).toEqual({ ok: true });
  });

  it('does not validate non-fact/rollup namespace formats (out of scope)', () => {
    // booking / company.settings / operationalFact / budgetLine /
    // currencyRate have their own resolvers + schema-level checks
    // elsewhere; the validator deliberately skips them.
    const r = validateRequiredInputs([
      'booking.<garbage>',
      'company.settings.deeply.nested.path',
      'operationalFact:',
    ]);
    expect(r).toEqual({ ok: true });
  });
});

// --- Sub-44 cont'd architect 💡 — validateRollupSeed (industries-empty guard) ─

describe("validateRollupSeed (sub-44 cont'd architect 💡 closure)", () => {
  it('non-rollup seed with industries → ok (gate only fires on rollup-bearing)', () => {
    const r = validateRollupSeed({
      code: 'IND_NET_MARGIN',
      industries: ['industrial'],
      requiredInputs: ['budgetLine'],
    });
    expect(r).toEqual({ ok: true });
  });

  it('rollup-bearing seed with empty industries → ok (canonical shape)', () => {
    const r = validateRollupSeed({
      code: 'IND_HOLDING_REVENUE',
      industries: [],
      requiredInputs: ['rollup:IND_REVENUE_TOTAL'],
    });
    expect(r).toEqual({ ok: true });
  });

  it('rollup-bearing seed with non-empty industries → REJECTS with explicit reason', () => {
    // Load-bearing case: a future seed author writes a sector-restricted
    // rollup. Without this gate, parent-co recompute targets at
    // recompute-trigger.ts:230 would silently fire on EVERY parent-co
    // (industrial, agro, all sectors), violating the indicator's
    // declared sector restriction.
    const r = validateRollupSeed({
      code: 'IND_HOSPITALITY_HOLDING_REVENUE',
      industries: ['hospitality'],
      requiredInputs: ['rollup:IND_REVENUE_TOTAL'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain('IND_HOSPITALITY_HOLDING_REVENUE');
      expect(r.reason).toContain('rollup-bearing');
      expect(r.reason).toContain('hospitality');
      expect(r.reason).toContain('sector-agnostic');
      // Names the actionable fix.
      expect(r.reason).toMatch(/Either drop the industries|change the formula/);
    }
  });

  it('mixed requiredInputs (rollup: + others) with non-empty industries → still REJECTED', () => {
    // Defensive: rollup-bearing-ness is detected by ANY entry with the
    // prefix, not the only entry. Mixed indicators must obey the same
    // gate.
    const r = validateRollupSeed({
      code: 'IND_MIXED',
      industries: ['agro'],
      requiredInputs: [
        'budgetLine',
        'fact:IND_X@2025',
        'rollup:IND_REVENUE_TOTAL',
      ],
    });
    expect(r.ok).toBe(false);
  });

  it('handles undefined / null / missing requiredInputs (lenient — non-rollup → ok)', () => {
    expect(validateRollupSeed({ code: 'X', industries: ['hospitality'] })).toEqual({ ok: true });
    expect(
      validateRollupSeed({ code: 'X', industries: ['hospitality'], requiredInputs: null }),
    ).toEqual({ ok: true });
    expect(
      validateRollupSeed({ code: 'X', industries: ['hospitality'], requiredInputs: [] }),
    ).toEqual({ ok: true });
  });

  it('empty industries on rollup-bearing → ok regardless of other requiredInputs', () => {
    const r = validateRollupSeed({
      code: 'IND_X',
      industries: [],
      requiredInputs: ['budgetLine', 'rollup:Y', 'fact:Z@2025'],
    });
    expect(r).toEqual({ ok: true });
  });
});
