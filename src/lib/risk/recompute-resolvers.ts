/**
 * Recompute pipeline — namespace resolvers.
 *
 * Phase 8 D1 (2026-05-29) — extracted from `recompute.ts` (the core engine
 * file) to shrink it. Holds the resolver-infrastructure interfaces
 * (`BuildState` / `ResolverCtx` / `NamespaceResolver`), the 13 namespace
 * resolvers (booking, companySettings, operationalFact, newsSentiment,
 * weather, commodityPrice, currencyRate, budgetLine, fact, rollup,
 * industryFactor, counterpartyHhi, balanceSheet), their leaf helpers
 * (weather-region / commodity-alias / aggregateCommodity / bsIsInventoryLine),
 * the `fact:` / `rollup:` canonical input prefixes, and the `RESOLVERS`
 * registry array.
 *
 * `recompute.ts` imports `RESOLVERS` + the three interfaces back for its
 * orchestration (`buildContext` / `postProcess` / `validateRequiredInputs`)
 * and re-exports the two prefix constants for external consumers
 * (`targets.ts`). Resolvers never call back into `recompute.ts`, so there is
 * no import cycle — each resolver reads data only through the
 * `RecomputeDataSource` abstraction passed in `ResolverCtx`.
 */

import {
  tryEvaluateFormula,
  type FormulaContext,
  type FormulaFunction,
} from './formula-engine';
import type { Period } from './periods';
import { isDaCode } from '../budgeting/da-codes';
import { WEATHER_REGIONS } from '../intel/commodity/weather-openmeteo';
import {
  getIndustryEmissionFactor,
  type EmissionScope,
  type ConfidenceTier,
} from './industry-emission-factors';
import {
  SUB_AGGREGATION_MATCHERS,
  applyBudgetLineSubMatcher,
} from './recompute-sub-aggregation';
import { toSnakeCase, revenueInBase, computeHhi } from './recompute-helpers';
import type {
  RecomputeDataSource,
  RecomputeInputs,
  BudgetLineSubAggregation,
} from './recompute-types';

// --- Resolver registry -------------------------------------------------------

/** Mutable state threaded through resolvers + post-processors. */
export interface BuildState {
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

export interface ResolverCtx {
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

export interface NamespaceResolver {
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
    const plucked: Record<string, number | string> = {};
    for (const raw of matched) {
      const key = raw.slice('company.settings.'.length);
      const value = settings?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        const snake = toSnakeCase(key);
        state.context[snake] = value;
        state.inputs.resolved[snake] = value;
        plucked[snake] = value;
      } else if (typeof value === 'string') {
        // Phase 7.M Tier 4 (2026-05-19) — string flags (e.g.
        // `fxExposureSource`) into aggregates only. Don't pollute
        // formula context (strings would crash expr-eval). The fx-guard
        // reads via `aggregates.company_settings.fx_exposure_source`.
        const snake = toSnakeCase(key);
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

/**
 * Resolve a company.settings.region value to the canonical ASCII code
 * used by the weather-openmeteo adapter as the metric-key prefix
 * (e.g. "Beyləqan" → "beylaqan", "Ağcabədi" → "agjabedi").
 *
 * Strategy (in priority order):
 *  1. Exact code match (already lowercase ASCII — fast path).
 *  2. Case-insensitive label match in WEATHER_REGIONS — covers the common
 *     case where company.settings.region stores the display label
 *     ("Beyləqan", "Salyan", etc.) rather than the adapter code.
 *  3. Simple lowercase fallback — for regions added after this module was
 *     written; may still miss if the adapter uses non-trivial transliteration,
 *     but that's the graceful-degradation ("no data → unknown") path.
 */
function resolveWeatherRegionCode(raw: string): string {
  const lower = raw.toLowerCase().trim();
  // Fast path: already a known code
  const byCode = WEATHER_REGIONS.find((r) => r.code === lower);
  if (byCode) return byCode.code;
  // Label match: covers "Beyləqan", "Salyan", "İmişli", etc.
  const byLabel = WEATHER_REGIONS.find(
    (r) => r.label.toLowerCase() === lower,
  );
  if (byLabel) return byLabel.code;
  // Fallback: just lowercase (works for ASCII-only labels)
  return lower;
}

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
        ? resolveWeatherRegionCode(settings.region)
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
  // Phase 7.I — sugar (AzerSheker pilot)
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
  // Phase 7.K Phase 5b — global feeds wired into formula vars.
  // Grains (yahoo-grains; cents/bushel → USD/tonne).
  { varName: 'corn_price_latest', sourceCode: 'yahoo-grains', metric: 'CORN_USD_TONNE', aggregator: 'latest' },
  { varName: 'corn_price_mean_12m', sourceCode: 'yahoo-grains', metric: 'CORN_USD_TONNE', aggregator: 'mean_12m' },
  { varName: 'wheat_price_latest', sourceCode: 'yahoo-grains', metric: 'WHEAT_USD_TONNE', aggregator: 'latest' },
  { varName: 'wheat_price_mean_12m', sourceCode: 'yahoo-grains', metric: 'WHEAT_USD_TONNE', aggregator: 'mean_12m' },
  { varName: 'soybean_price_latest', sourceCode: 'yahoo-grains', metric: 'SOYBEAN_USD_TONNE', aggregator: 'latest' },
  { varName: 'oats_price_latest', sourceCode: 'yahoo-grains', metric: 'OATS_USD_TONNE', aggregator: 'latest' },
  { varName: 'cotton_price_latest', sourceCode: 'yahoo-grains', metric: 'COTTON_USD_TONNE', aggregator: 'latest' },
  // Metals + lumber (yahoo-metals).
  { varName: 'steel_price_latest', sourceCode: 'yahoo-metals', metric: 'STEEL_USD_TONNE', aggregator: 'latest' },
  { varName: 'steel_price_mean_12m', sourceCode: 'yahoo-metals', metric: 'STEEL_USD_TONNE', aggregator: 'mean_12m' },
  { varName: 'copper_price_latest', sourceCode: 'yahoo-metals', metric: 'COPPER_USD_TONNE', aggregator: 'latest' },
  { varName: 'aluminum_price_latest', sourceCode: 'yahoo-metals', metric: 'ALUMINUM_USD_TONNE', aggregator: 'latest' },
  { varName: 'lumber_price_latest', sourceCode: 'yahoo-metals', metric: 'LUMBER_USD_MBF', aggregator: 'latest' },
  // Energy (eia-energy; requires apiKey).
  { varName: 'brent_price_latest', sourceCode: 'eia-energy', metric: 'BRENT_USD_BBL', aggregator: 'latest' },
  { varName: 'wti_price_latest', sourceCode: 'eia-energy', metric: 'WTI_USD_BBL', aggregator: 'latest' },
  { varName: 'natgas_price_latest', sourceCode: 'eia-energy', metric: 'NATGAS_USD_MMBTU', aggregator: 'latest' },
  // Shipping + retail fuel (yahoo-fuel-bdi).
  { varName: 'baltic_dry_latest', sourceCode: 'yahoo-fuel-bdi', metric: 'BALTIC_DRY_INDEX', aggregator: 'latest' },
  { varName: 'baltic_dry_mean_12m', sourceCode: 'yahoo-fuel-bdi', metric: 'BALTIC_DRY_INDEX', aggregator: 'mean_12m' },
  { varName: 'diesel_price_latest', sourceCode: 'yahoo-fuel-bdi', metric: 'DIESEL_USD_LITRE', aggregator: 'latest' },
  { varName: 'gasoline_price_latest', sourceCode: 'yahoo-fuel-bdi', metric: 'GASOLINE_USD_LITRE', aggregator: 'latest' },
  // FX (cbar-official-fx).
  { varName: 'azn_usd_latest', sourceCode: 'cbar-official-fx', metric: 'AZN_USD', aggregator: 'latest' },
  { varName: 'azn_eur_latest', sourceCode: 'cbar-official-fx', metric: 'AZN_EUR', aggregator: 'latest' },
  { varName: 'azn_rub_latest', sourceCode: 'cbar-official-fx', metric: 'AZN_RUB', aggregator: 'latest' },
  { varName: 'azn_try_latest', sourceCode: 'cbar-official-fx', metric: 'AZN_TRY', aggregator: 'latest' },
  // Food price index (fao-food-prices).
  { varName: 'fao_ffpi_latest', sourceCode: 'fao-food-prices', metric: 'FAO_FFPI_NOMINAL', aggregator: 'latest' },
  { varName: 'fao_meat_latest', sourceCode: 'fao-food-prices', metric: 'FAO_MEAT_INDEX', aggregator: 'latest' },
  { varName: 'fao_dairy_latest', sourceCode: 'fao-food-prices', metric: 'FAO_DAIRY_INDEX', aggregator: 'latest' },
  { varName: 'fao_cereal_latest', sourceCode: 'fao-food-prices', metric: 'FAO_CEREAL_INDEX', aggregator: 'latest' },
  { varName: 'fao_sugar_latest', sourceCode: 'fao-food-prices', metric: 'FAO_SUGAR_INDEX', aggregator: 'latest' },
  // AZ CPI breakdown (az-stat-cpi). 001_2en.xlsx has 4 categories
  // (all-items / food / non-food / services). Housing/utilities is
  // only in annual 001_4en — no monthly breakout. We proxy
  // `az_cpi_housing_latest` from AZ_CPI_SERVICES because "Paid
  // services" in AZ CPI methodology includes rent + communal + utility
  // tariffs (it's the closest monthly proxy). If we ever wire 001_4en
  // separately, this alias flips to the dedicated metric.
  { varName: 'az_cpi_all_latest', sourceCode: 'az-stat-cpi', metric: 'AZ_CPI_ALL_ITEMS', aggregator: 'latest' },
  { varName: 'az_cpi_food_latest', sourceCode: 'az-stat-cpi', metric: 'AZ_CPI_FOOD', aggregator: 'latest' },
  { varName: 'az_cpi_housing_latest', sourceCode: 'az-stat-cpi', metric: 'AZ_CPI_SERVICES', aggregator: 'latest' },
  // Poultry (usda-nass; requires apiKey).
  { varName: 'broiler_price_latest', sourceCode: 'usda-nass', metric: 'BROILER_PRICE_USD_LB', aggregator: 'latest' },
  { varName: 'egg_price_latest', sourceCode: 'usda-nass', metric: 'EGG_PRICE_USD_DOZ', aggregator: 'latest' },
  { varName: 'chick_placement_latest', sourceCode: 'usda-nass', metric: 'CHICK_PLACEMENT_THOUSAND', aggregator: 'latest' },
  // Trade (un-comtrade-az).
  { varName: 'az_trade_exports_latest', sourceCode: 'un-comtrade-az', metric: 'AZ_GOODS_EXPORTS_USD', aggregator: 'latest' },
  { varName: 'az_trade_imports_latest', sourceCode: 'un-comtrade-az', metric: 'AZ_GOODS_IMPORTS_USD', aggregator: 'latest' },
  { varName: 'az_trade_balance_latest', sourceCode: 'un-comtrade-az', metric: 'AZ_TRADE_BALANCE_USD', aggregator: 'latest' },
  // Tourism + education (wb-indicators).
  { varName: 'az_tourism_arrivals_latest', sourceCode: 'wb-indicators', metric: 'AZ_TOURISM_ARRIVALS', aggregator: 'latest' },
  { varName: 'az_tourism_receipts_latest', sourceCode: 'wb-indicators', metric: 'AZ_TOURISM_RECEIPTS_USD', aggregator: 'latest' },
  { varName: 'az_school_enroll_latest', sourceCode: 'wb-indicators', metric: 'AZ_SCHOOL_ENROLL_SEC_PCT', aggregator: 'latest' },
  { varName: 'az_pop_age_0_14_latest', sourceCode: 'wb-indicators', metric: 'AZ_POP_AGE_0_14_PCT', aggregator: 'latest' },
  // Search trends (google-trends-az; requires proxy apiKey).
  { varName: 'az_trend_food_latest', sourceCode: 'google-trends-az', metric: 'AZ_TREND_FOOD_RETAIL', aggregator: 'latest' },
  { varName: 'az_trend_fashion_latest', sourceCode: 'google-trends-az', metric: 'AZ_TREND_FASHION', aggregator: 'latest' },
  { varName: 'az_trend_electronics_latest', sourceCode: 'google-trends-az', metric: 'AZ_TREND_ELECTRONICS', aggregator: 'latest' },
  { varName: 'az_trend_travel_latest', sourceCode: 'google-trends-az', metric: 'AZ_TREND_TRAVEL', aggregator: 'latest' },
  // Weather forecast (openmeteo-forecast). Lives under commodityPrice
  // namespace because we don't have a dedicated `weather:forecast:`
  // resolver — the existing weatherResolver only handles archive
  // metrics (RAINFALL_MM_90D / TEMP_AVG_C_30D).
  { varName: 'salyan_rainfall_forecast_14d', sourceCode: 'openmeteo-forecast', metric: 'SALYAN_RAINFALL_MM_14D_FCST', aggregator: 'latest' },
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
    // Phase 7.O — D&A add-back for true EBITDA.
    // Scans for SAP codes 703-11 (D&A in COGS) + 721-11 (D&A in OpEx).
    // For companies without those codes (e.g. PLF-format AZSEKER) da_total=0
    // so ebitda degrades gracefully to EBIT — honest, not wrong.
    let da_total = 0;

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
      // D&A add-back: applies to both cogs and expense lines that are
      // depreciation/amortization accounts (703-11 / 721-11 SAP codes).
      if (l.accountCode != null && isDaCode(l.accountCode)) {
        da_total += Math.abs(amountBase);
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
    // True EBITDA = EBIT + D&A add-back (703-11 + 721-11 SAP codes).
    // Equals net_income when no D&A lines are identified (PLF-format data).
    const ebitda = net_income + da_total;

    state.context.revenue = revenue;
    state.context.cogs = cogs;
    state.context.opex = opex;
    state.context.total_cost = total_cost;
    state.context.total_input_cost = total_input_cost;
    state.context.imported_input_cost = imported_input_cost;
    state.context.domestic_input_cost = domestic_input_cost;
    state.context.gross_profit = gross_profit;
    state.context.net_income = net_income;
    state.context.ebitda = ebitda;
    state.context.da_total = da_total;

    state.inputs.resolved.revenue = revenue;
    state.inputs.resolved.cogs = cogs;
    state.inputs.resolved.opex = opex;
    state.inputs.resolved.total_cost = total_cost;
    state.inputs.resolved.total_input_cost = total_input_cost;
    state.inputs.resolved.imported_input_cost = imported_input_cost;
    state.inputs.resolved.domestic_input_cost = domestic_input_cost;
    state.inputs.resolved.gross_profit = gross_profit;
    state.inputs.resolved.net_income = net_income;
    state.inputs.resolved.ebitda = ebitda;
    state.inputs.resolved.da_total = da_total;

    // Phase 7.M Step 4 follow-up (2026-05-19) — count foreign-tagged
    // lines explicitly so the zombie-row guard can distinguish "this
    // company is genuinely 100% domestic" from "the importer didn't
    // populate currencyCode on any line, so imported_* defaulted to 0".
    // Without the count, FX_IMPORTED_INPUT cells everywhere read as
    // false-green ("0% imported — healthy!") on holdings whose xlsx
    // import dropped the currency column.
    const foreign_line_count = lines.filter(
      (l) =>
        l.currencyCode != null &&
        l.currencyCode !== baseCcy &&
        l.exchangeRate != null,
    ).length;

    state.inputs.aggregates.budget_line = {
      line_count: lines.length,
      foreign_line_count,
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

// Phase 7.J — counterparty HHI resolver. Reads the Counterparty
// register for a company/role/period and computes
// HHI = Σ(sharePct/100)² for use in CUSTOMER_HHI / SUPPLIER_HHI
// indicators. The requiredInputs key shape is
// `counterparty:<role>` (no period — period derives from
// IndicatorValue.period; default 2026).
const counterpartyHhiResolver: NamespaceResolver = {
  name: 'counterparty.hhi',
  matches: (r) => r.startsWith('counterparty:'),
  async resolve(matched, ctx, state) {
    // Stub adapters don't implement listCounterparties — quietly skip
    // so the formula evaluates to NaN → IV status='unknown' (the right
    // honest answer when the register isn't wired yet).
    if (!ctx.ds.listCounterparties) return;
    // Counterparty register is annual; key off the year only.
    const period = String(ctx.period.year);
    for (const raw of matched) {
      const role = raw.slice('counterparty:'.length);
      if (role !== 'customer' && role !== 'supplier') continue;
      const rows = await ctx.ds.listCounterparties({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        role,
        period,
      });
      if (rows.length === 0) continue;
      const hhi = rows.reduce((s, r) => s + (r.sharePct / 100) ** 2, 0);
      const rounded = Math.round(hhi * 10000) / 10000;
      // Two context keys: the colon-namespaced one (matches the
      // resolver match prefix) + a flat alias so seeds can reference
      // `counterparty_hhi_customer` without colon-handling.
      state.context[`counterparty_hhi:${role}`] = rounded;
      state.context[`counterparty_hhi_${role}`] = rounded;
      state.inputs.resolved[`counterparty_hhi_${role}`] = rounded;

      // 2026-05-27 — also expose the max share (top counterparty's %
      // of revenue/spend) and the top-3 cumulative share for direct
      // indicators that complement HHI. Single concentration metrics
      // are easier to communicate to non-analyst CFOs than HHI.
      const sortedShares = rows
        .map((r) => r.sharePct)
        .sort((a, b) => b - a);
      const topShare = sortedShares[0] ?? 0;
      const top3Share = sortedShares.slice(0, 3).reduce((s, x) => s + x, 0);
      state.context[`top_counterparty_share_${role}`] = topShare;
      state.context[`top3_counterparty_share_${role}`] = top3Share;
      state.inputs.resolved[`top_counterparty_share_${role}`] = topShare;
      state.inputs.resolved[`top3_counterparty_share_${role}`] = top3Share;
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Phase 7.O (2026-05-24) — Balance-sheet line resolver.
//
// Handles the `balanceSheetLine.*` namespace. Currently supports one
// sub-aggregation: `inventory` — sums current-asset rows whose name or
// code matches inventory heuristics.
//
// Used by:
//   • PHARMA_INVENTORY_DAYS  (requiredInputs: ["balanceSheetLine.inventory"])
//   • FP_INVENTORY_TURNS     (requiredInputs: ["balanceSheetLine.inventory"])
//   • RETAIL_INVENTORY_TURNS (requiredInputs: ["balanceSheetLine.inventory"])
//
// Cost: 1 DB query per recompute (when the resolver fires). Degrades
// gracefully when listBalanceSheetLines is absent from the data source
// (legacy fixtures) or when companyId is not set on the BS rows
// (pre-Phase-7.O imports).
// ─────────────────────────────────────────────────────────────────────────────

/** Inventory detection for BalanceSheetLine rows.
 *
 * Inventory lives under current assets (subType='current', BS.01.02.*).
 * Within current assets we distinguish inventory from receivables / cash / prepayments
 * via name keywords covering English + Russian + Azerbaijani finance vocabulary.
 *
 * No code-pattern matching — CoA numbering varies by company and CoA version.
 * Names are the only reliable discriminator across schemas.
 */
function bsIsInventoryLine(_accountCode: string, accountName: string): boolean {
  const name = accountName.toLowerCase();
  return (
    name.includes('inventory') ||
    name.includes('ehtiyat') ||   // AZ: reserve / stock
    name.includes('xammal') ||    // AZ: raw material
    name.includes('yarım') ||     // AZ: work-in-progress (yarımfabrikat)
    name.includes('hazır mal') || // AZ: finished goods
    name.includes('hazır məhsul') || // AZ: finished product
    name.includes('mallar') ||    // AZ: goods
    name.includes('запас') ||     // RU: stock / inventory
    name.includes('материал') ||  // RU: material
    name.includes('незаверш') ||  // RU: work-in-progress (незавершенное)
    name.includes('готовая') ||   // RU: finished goods (готовая продукция)
    name.includes('stock') ||
    name.includes('raw material') ||
    name.includes('товар')        // RU: goods / merchandise
  );
}

const balanceSheetLineResolver: NamespaceResolver = {
  name: 'balanceSheetLine',
  matches: (r) => r === 'balanceSheetLine' || r.startsWith('balanceSheetLine.'),
  async resolve(matched, ctx, state) {
    // Degrade gracefully when the data source doesn't implement
    // listBalanceSheetLines (legacy fixtures, pre-Phase-7.O envs).
    if (!ctx.ds.listBalanceSheetLines) return;

    const subs = matched
      .filter((r) => r.startsWith('balanceSheetLine.'))
      .map((r) => r.slice('balanceSheetLine.'.length));
    if (subs.length === 0) return;

    const rows = await ctx.ds.listBalanceSheetLines({
      organizationId: ctx.organizationId,
      companyId: ctx.companyId,
      period: ctx.period,
    });

    if (rows.length === 0) return;

    if (subs.includes('inventory')) {
      // Sum current-asset rows that match inventory heuristics.
      // lineType='asset' + subType='current' narrows to current assets;
      // bsIsInventoryLine then filters to inventory-specific rows.
      const inventorySum = rows
        .filter(
          (r) =>
            r.lineType === 'asset' &&
            r.subType === 'current' &&
            bsIsInventoryLine(r.accountCode, r.accountName),
        )
        .reduce((sum, r) => sum + r.amount, 0);

      if (inventorySum > 0) {
        state.context['inventory'] = inventorySum;
        state.inputs.resolved['inventory'] = inventorySum;
      }
    }
  },
};

export const RESOLVERS: readonly NamespaceResolver[] = [
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
  // Phase 7.J — Counterparty register HHI for concentration indicators.
  counterpartyHhiResolver,
  // Phase 7.O — Balance-sheet line aggregations (inventory turns etc.).
  balanceSheetLineResolver,
];
