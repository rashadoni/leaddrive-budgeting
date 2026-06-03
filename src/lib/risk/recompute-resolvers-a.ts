/**
 * Recompute namespace resolvers — group A (core entities + external market
 * data). Extracted from recompute-resolvers.ts (Phase 8 D1 2026-05-29):
 * booking, companySettings, operationalFact, newsSentiment, weather,
 * commodityPrice, currencyRate (+ their leaf helpers). The barrel assembles
 * these into the RESOLVERS registry; resolvers read data only through the
 * RecomputeDataSource in ResolverCtx, so there is no cycle.
 */
import { WEATHER_REGIONS } from '../intel/commodity/weather-openmeteo';
import { toSnakeCase, revenueInBase, computeHhi } from './recompute-helpers';
import type { NamespaceResolver } from './recompute-resolver-types';

export const bookingResolver: NamespaceResolver = {
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

    const baseCcy = ctx.baseCurrency;
    for (const b of active) {
      // Occupancy (rooms / nights) is physical and currency-independent — count
      // it for every active booking regardless of FX.
      rooms_sold += b.roomsBooked ?? 0;
      nights_sold += b.nights;
      // "Foreign" = a currency tag that differs from the base currency (NOT just
      // "currencyCode present"); a base-currency-tagged booking is domestic.
      const isForeign = b.currencyCode != null && b.currencyCode !== baseCcy;
      // A foreign booking with no exchange rate can't be converted to base.
      // Mirror aggregatePnlLines (which `continue`s on foreign-no-rate) and
      // EXCLUDE its revenue from room_revenue / fx_revenue / rev_by_country
      // instead of summing the raw foreign amount at face value (rate=1) — that
      // would inflate room_revenue, fx_revenue_share (HOSP_FX_EXPOSURE) and
      // source_country_hhi (HOSP_SOURCE_HHI) with a wrong-scale number.
      if (isForeign && b.exchangeRate == null) {
        missing_rate_count += 1;
        continue;
      }
      const revBase = revenueInBase(b);
      room_revenue += revBase;
      if (isForeign) fx_revenue += revBase;
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

export const companySettingsResolver: NamespaceResolver = {
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

export const operationalFactResolver: NamespaceResolver = {
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
      // Aggregation of multiple in-period facts is per-indicator (2026-05-31,
      // replaces the old SNAPSHOT_METRIC_RE regex — now `IndicatorDefinition.
      // aggregation`, threaded via ctx). "snapshot" = the facts are successive
      // POINT-IN-TIME snapshots from re-imports → take the LATEST by date, not
      // the mean (averaging blends stale+fresh: CPC LEGAL_CASES_ACTIVE had
      // 6@2026-05-01 + 8@2026-12-31 → mean 7 instead of the correct 8). "flow"
      // (default) = additive/period metrics (production, weather, prices) → mean.
      // No indicator mixes snapshot+flow operationalFact inputs, so the
      // indicator-level flag is sufficient (verified at migration time).
      const resolved =
        ctx.aggregation === 'snapshot'
          ? // `>=` (not `>`) so that on a same-date tie the LATER row in the
            // query's deterministic [date asc, createdAt asc] order wins — i.e.
            // the most recently written fact at the latest date (a correction
            // re-imported at the same as-of date), picked deterministically
            // across recomputes. See listOperationalFacts orderBy.
            rows.reduce((latest, r) => (r.date >= latest.date ? r : latest), rows[0]).value
          : rows.reduce((a, r) => a + r.value, 0) / rows.length;
      state.context[metric] = resolved;
      state.inputs.resolved[metric] = resolved;
      perMetric[metric] = { count: rows.length, avg: resolved };
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
export const newsSentimentResolver: NamespaceResolver = {
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

export const weatherResolver: NamespaceResolver = {
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

export const commodityPriceResolver: NamespaceResolver = {
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

export const currencyRateResolver: NamespaceResolver = {
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
