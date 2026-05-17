/**
 * Phase 7.K Phase 5b — sector-specific indicator seeds powered by the
 * new external data feeds (CBAR FX / EIA Energy / FAO Food / Yahoo
 * Grains+Metals+Fuel-BDI / WB Indicators / UN Comtrade / USDA NASS /
 * AZ Stat CPI / OpenMeteo Forecast / Google Trends).
 *
 * Each entry follows the IndicatorSeed contract from
 * `./indicator-seeds.ts`. The `requiredInputs` reference
 * `commodityPrice:<varName>` variables, which the recompute pipeline
 * resolves via `COMMODITY_PRICE_ALIASES` in `recompute.ts` — that
 * table was extended in this same phase to cover all the new sources.
 *
 * Sort orders pick up from each sector's existing block:
 *   HOSP_*  → 70+
 *   PHARM_* → 130+
 *   RE_*    → 360+
 *   IND_*   → 750+
 *   CONSTR_*→ 760+
 *   LOG_*   → 790+
 *   POULT_* → 820+
 *   FP_*    → 870+
 *   BEV_*   → 950+
 *   RET_*   → 970+
 *   EDU_*   → 1020+
 *   ENT_*   → 1050+
 *   SERV_*  → 1100+
 *   AGRO_*  → 1150+
 */
import type { IndicatorSeed } from "./indicator-seeds"

/** Generic pressure-style thresholds: lower is better. */
const PRESSURE = {
  green: { op: "<=" as const, value: 15 },
  amber: { op: "<=" as const, value: 30 },
  red: { op: ">" as const, value: 30 },
}

/** Generic demand-signal: higher is better. */
const DEMAND_SIGNAL = {
  green: { op: ">=" as const, value: 100 },
  amber: { op: ">=" as const, value: 80 },
  red: { op: "<" as const, value: 80 },
}

export const phase7kSeeds: IndicatorSeed[] = [
  // ──────────────────────────────────────────────────────────────────
  // HOSPITALITY — tourism + FX
  // ──────────────────────────────────────────────────────────────────
  {
    code: "HOSP_TOURISM_ARRIVALS_SIGNAL",
    nameEn: "AZ Tourism Arrivals Signal",
    nameAz: "Turist axını siqnalı",
    nameRu: "Сигнал туристического потока AZ",
    category: "macro",
    industries: ["hospitality"],
    unit: "k arrivals",
    direction: "higher_better",
    formula: "az_tourism_arrivals_latest / 1000",
    thresholds: {
      green: { op: ">=", value: 2000 },
      amber: { op: ">=", value: 1500 },
      red: { op: "<", value: 1500 },
    },
    hintTemplateEn:
      "AZ tourism arrivals at {value}k (annual, latest reported year). Above 2M is a green demand signal; below 1.5M means hotel occupancy headwind ahead.",
    requiredInputs: ["commodityPrice:az_tourism_arrivals_latest"],
    sortOrder: 75,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // PHARMA — FX pass-through
  // ──────────────────────────────────────────────────────────────────
  {
    code: "PHARM_FX_USD_PRESSURE",
    nameEn: "Pharma USD Import FX Pressure",
    nameAz: "AZN/USD farmasevtik təzyiqi",
    nameRu: "Давление AZN/USD на фармимпорт",
    category: "fx",
    industries: ["pharma"],
    unit: "AZN/USD",
    direction: "lower_better",
    formula: "azn_usd_latest",
    thresholds: {
      green: { op: "<=", value: 1.7 },
      amber: { op: "<=", value: 1.75 },
      red: { op: ">", value: 1.75 },
    },
    hintTemplateEn:
      "AZN/USD at {value}. Pharma cost-of-goods is ~80% USD imports — every 1% AZN devaluation flows directly to gross margin.",
    requiredInputs: ["commodityPrice:azn_usd_latest"],
    sortOrder: 135,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // REAL ESTATE — housing CPI
  // ──────────────────────────────────────────────────────────────────
  {
    code: "RE_HOUSING_CPI_PRESSURE",
    nameEn: "AZ Housing/Services CPI Pressure",
    nameAz: "Mənzil + xidmət İPI təzyiqi",
    nameRu: "Давление ИПЦ жилья и услуг AZ",
    category: "macro",
    industries: ["real_estate"],
    unit: "% YoY",
    direction: "higher_better",
    formula: "az_cpi_housing_latest",
    thresholds: {
      // AZ_CPI_SERVICES (paid services — rent + utility tariffs +
      // communal payments) is the monthly proxy until stat.gov.az
      // 001_4en housing-specific monthly file gets wired.
      green: { op: ">=", value: 105 },
      amber: { op: ">=", value: 100 },
      red: { op: "<", value: 100 },
    },
    hintTemplateEn:
      "AZ Services CPI (rent + utilities proxy) at {value}% YoY. ≥105 indicates rising occupancy + utility cost pass-through (tailwind for real-estate revenue); <100 = deflationary headwind.",
    requiredInputs: ["commodityPrice:az_cpi_housing_latest"],
    sortOrder: 365,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // INDUSTRIAL — input commodity exposure
  // ──────────────────────────────────────────────────────────────────
  {
    code: "IND_COPPER_PRICE_SIGNAL",
    nameEn: "Copper Price Signal",
    nameAz: "Mis qiymət siqnalı",
    nameRu: "Сигнал цены меди",
    category: "commodity",
    industries: ["industrial"],
    unit: "USD/tonne",
    direction: "lower_better",
    formula: "copper_price_latest",
    thresholds: {
      green: { op: "<=", value: 9000 },
      amber: { op: "<=", value: 11000 },
      red: { op: ">", value: 11000 },
    },
    hintTemplateEn:
      "Copper at {value} USD/tonne. >$11k/t is an industrial input-cost red flag — review pass-through pricing.",
    requiredInputs: ["commodityPrice:copper_price_latest"],
    sortOrder: 755,
    defaultValueSource: "macro",
  },
  {
    code: "IND_NATGAS_PRICE_SIGNAL",
    nameEn: "Natural Gas Price Signal",
    nameAz: "Təbii qaz qiymət siqnalı",
    nameRu: "Сигнал цены природного газа",
    category: "commodity",
    industries: ["industrial"],
    unit: "USD/MMBtu",
    direction: "lower_better",
    formula: "natgas_price_latest",
    thresholds: {
      green: { op: "<=", value: 4 },
      amber: { op: "<=", value: 6 },
      red: { op: ">", value: 6 },
    },
    hintTemplateEn:
      "Henry Hub natural gas at {value} USD/MMBtu. >$6 is a power + petrochem input cost red flag.",
    requiredInputs: ["commodityPrice:natgas_price_latest"],
    sortOrder: 756,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // CONSTRUCTION — steel + lumber
  // ──────────────────────────────────────────────────────────────────
  {
    code: "CONSTR_STEEL_PRICE_SIGNAL",
    nameEn: "Steel HRC Price Signal",
    nameAz: "Polad qiymət siqnalı",
    nameRu: "Сигнал цены стали HRC",
    category: "commodity",
    industries: ["construction"],
    unit: "USD/tonne",
    direction: "lower_better",
    formula: "steel_price_latest",
    thresholds: {
      green: { op: "<=", value: 700 },
      amber: { op: "<=", value: 900 },
      red: { op: ">", value: 900 },
    },
    hintTemplateEn:
      "HRC steel {value} USD/tonne. >$900/t is a construction-margin red flag — review project bid contingencies.",
    requiredInputs: ["commodityPrice:steel_price_latest"],
    sortOrder: 765,
    defaultValueSource: "macro",
  },
  {
    code: "CONSTR_LUMBER_PRICE_SIGNAL",
    nameEn: "Lumber Price Signal",
    nameAz: "Ağac materialı qiymət siqnalı",
    nameRu: "Сигнал цены пиломатериалов",
    category: "commodity",
    industries: ["construction"],
    unit: "USD/MBF",
    direction: "lower_better",
    formula: "lumber_price_latest",
    thresholds: {
      green: { op: "<=", value: 400 },
      amber: { op: "<=", value: 600 },
      red: { op: ">", value: 600 },
    },
    hintTemplateEn:
      "Lumber at {value} USD/1000 board ft. >$600 is a residential-margin red flag.",
    requiredInputs: ["commodityPrice:lumber_price_latest"],
    sortOrder: 766,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // LOGISTICS — fuel + freight index
  // ──────────────────────────────────────────────────────────────────
  {
    code: "LOG_DIESEL_PRICE_SIGNAL",
    nameEn: "Diesel Price Signal",
    nameAz: "Dizel qiymət siqnalı",
    nameRu: "Сигнал цены дизеля",
    category: "commodity",
    industries: ["logistics"],
    unit: "USD/L",
    direction: "lower_better",
    formula: "diesel_price_latest",
    thresholds: {
      green: { op: "<=", value: 0.7 },
      amber: { op: "<=", value: 0.9 },
      red: { op: ">", value: 0.9 },
    },
    hintTemplateEn:
      "ULSD diesel proxy {value} USD/L. >$0.9 is a fleet-cost red flag — review fuel-surcharge clauses.",
    requiredInputs: ["commodityPrice:diesel_price_latest"],
    sortOrder: 795,
    defaultValueSource: "macro",
  },
  {
    code: "LOG_BDI_FREIGHT_SIGNAL",
    nameEn: "Baltic Dry Freight Signal (BDRY ETF proxy)",
    nameAz: "Baltic Dry yük siqnalı (BDRY ETF)",
    nameRu: "Сигнал фрахта Baltic Dry (BDRY ETF)",
    category: "commodity",
    industries: ["logistics"],
    unit: "USD/share",
    direction: "higher_better",
    formula: "baltic_dry_latest",
    thresholds: {
      // Calibrated for the BDRY ETF (Breakwave Dry Bulk Shipping
      // Fund) which tracks BDI via 3-month rolling futures. ETF
      // historical range $5-30 covers the BDI's ~500-3000 point
      // range. Yahoo blocks ^BDIY itself so this is the proxy.
      green: { op: ">=", value: 20 },
      amber: { op: ">=", value: 10 },
      red: { op: "<", value: 10 },
    },
    hintTemplateEn:
      "BDRY ETF at {value} USD/share — proxy for Baltic Dry Index. <$10 = global freight slowdown (negative for logistics revenue); ≥$20 = freight demand strength.",
    requiredInputs: ["commodityPrice:baltic_dry_latest"],
    sortOrder: 796,
    defaultValueSource: "macro",
  },
  {
    code: "LOG_BRENT_OIL_SIGNAL",
    nameEn: "Brent Crude Oil Signal",
    nameAz: "Brent neft siqnalı",
    nameRu: "Сигнал нефти Brent",
    category: "commodity",
    industries: ["logistics"],
    unit: "USD/bbl",
    direction: "lower_better",
    formula: "brent_price_latest",
    thresholds: {
      green: { op: "<=", value: 80 },
      amber: { op: "<=", value: 100 },
      red: { op: ">", value: 100 },
    },
    hintTemplateEn:
      "Brent at {value} USD/bbl. >$100 is a logistics cost-pass-through red flag (drives diesel + freight rates upstream).",
    requiredInputs: ["commodityPrice:brent_price_latest"],
    sortOrder: 797,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // POULTRY — feed cost + output prices
  // ──────────────────────────────────────────────────────────────────
  {
    code: "POULT_BROILER_PRICE_SIGNAL",
    nameEn: "Broiler Wholesale Price Signal",
    nameAz: "Broiler topdansatış qiymət siqnalı",
    nameRu: "Сигнал оптовой цены бройлера",
    category: "commodity",
    industries: ["poultry"],
    unit: "USD/lb",
    direction: "higher_better",
    formula: "broiler_price_latest",
    thresholds: {
      green: { op: ">=", value: 1.2 },
      amber: { op: ">=", value: 1.0 },
      red: { op: "<", value: 1.0 },
    },
    hintTemplateEn:
      "Wholesale broiler at {value} USD/lb (USDA). <$1.00 = margin compression risk; >$1.20 = pricing tailwind.",
    requiredInputs: ["commodityPrice:broiler_price_latest"],
    sortOrder: 825,
    defaultValueSource: "macro",
  },
  {
    code: "POULT_FEED_CORN_PRESSURE",
    nameEn: "Poultry Feed Corn Price Signal",
    nameAz: "Quş yemi qarğıdalı qiymət siqnalı",
    nameRu: "Сигнал цены кукурузы для корма",
    category: "commodity",
    industries: ["poultry"],
    unit: "USD/tonne",
    direction: "lower_better",
    formula: "corn_price_latest",
    thresholds: {
      green: { op: "<=", value: 200 },
      amber: { op: "<=", value: 280 },
      red: { op: ">", value: 280 },
    },
    hintTemplateEn:
      "Corn at {value} USD/tonne — primary feed input. >$280/t squeezes broiler margin (typical feed is 65-75% of cost).",
    requiredInputs: ["commodityPrice:corn_price_latest"],
    sortOrder: 826,
    defaultValueSource: "macro",
  },
  {
    code: "POULT_EGG_PRICE_SIGNAL",
    nameEn: "Egg Wholesale Price Signal",
    nameAz: "Yumurta qiymət siqnalı",
    nameRu: "Сигнал цены яиц",
    category: "commodity",
    industries: ["poultry"],
    unit: "USD/dozen",
    direction: "higher_better",
    formula: "egg_price_latest",
    thresholds: {
      green: { op: ">=", value: 2.0 },
      amber: { op: ">=", value: 1.5 },
      red: { op: "<", value: 1.5 },
    },
    hintTemplateEn:
      "Wholesale eggs at {value} USD/dozen (USDA). <$1.50 = layer-operation margin pressure.",
    requiredInputs: ["commodityPrice:egg_price_latest"],
    sortOrder: 827,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // FOOD PROCESSING — FAO + grain inputs
  // ──────────────────────────────────────────────────────────────────
  {
    code: "FP_FAO_FOOD_INDEX_SIGNAL",
    nameEn: "FAO Food Price Index Signal",
    nameAz: "FAO Qida Qiymət İndeksi siqnalı",
    nameRu: "Сигнал индекса цен FAO",
    category: "commodity",
    industries: ["food_processing"],
    unit: "index",
    direction: "lower_better",
    formula: "fao_ffpi_latest",
    thresholds: {
      green: { op: "<=", value: 120 },
      amber: { op: "<=", value: 140 },
      red: { op: ">", value: 140 },
    },
    hintTemplateEn:
      "FAO Food Price Index {value}. >140 = global food inflation pressure — passes through to all food processors' input costs.",
    requiredInputs: ["commodityPrice:fao_ffpi_latest"],
    sortOrder: 875,
    defaultValueSource: "macro",
  },
  {
    code: "FP_WHEAT_PRICE_SIGNAL",
    nameEn: "Wheat Price Signal",
    nameAz: "Buğda qiymət siqnalı",
    nameRu: "Сигнал цены пшеницы",
    category: "commodity",
    industries: ["food_processing"],
    unit: "USD/tonne",
    direction: "lower_better",
    formula: "wheat_price_latest",
    thresholds: {
      green: { op: "<=", value: 250 },
      amber: { op: "<=", value: 320 },
      red: { op: ">", value: 320 },
    },
    hintTemplateEn:
      "Wheat at {value} USD/tonne. >$320/t pressures bakery + milling input cost.",
    requiredInputs: ["commodityPrice:wheat_price_latest"],
    sortOrder: 876,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // BEVERAGE — sugar + AZ food CPI
  // ──────────────────────────────────────────────────────────────────
  {
    code: "BEV_FAO_SUGAR_INDEX_SIGNAL",
    nameEn: "FAO Sugar Index Signal",
    nameAz: "FAO Şəkər indeksi siqnalı",
    nameRu: "Сигнал индекса сахара FAO",
    category: "commodity",
    industries: ["beverage"],
    unit: "index",
    direction: "lower_better",
    formula: "fao_sugar_latest",
    thresholds: {
      green: { op: "<=", value: 110 },
      amber: { op: "<=", value: 140 },
      red: { op: ">", value: 140 },
    },
    hintTemplateEn:
      "FAO Sugar sub-index {value}. >140 = sugar pricing pressure — review syrup cost in carbonated beverage formulas.",
    requiredInputs: ["commodityPrice:fao_sugar_latest"],
    sortOrder: 955,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // RETAIL — food CPI + search trends
  // ──────────────────────────────────────────────────────────────────
  {
    code: "RET_AZ_FOOD_CPI_PRESSURE",
    nameEn: "AZ Food CPI Pressure",
    nameAz: "AZ Ərzaq İPI təzyiqi",
    nameRu: "Давление ИПЦ продовольствия AZ",
    category: "macro",
    industries: ["retail"],
    unit: "index",
    direction: "lower_better",
    formula: "az_cpi_food_latest",
    thresholds: {
      green: { op: "<=", value: 105 },
      amber: { op: "<=", value: 115 },
      red: { op: ">", value: 115 },
    },
    hintTemplateEn:
      "AZ food CPI at {value}. >115 = staples inflation pressure on retail margins; <105 = stable consumer-cost environment.",
    requiredInputs: ["commodityPrice:az_cpi_food_latest"],
    sortOrder: 975,
    defaultValueSource: "macro",
  },
  {
    code: "RET_TREND_FOOD_SIGNAL",
    nameEn: "Food Retail Search Demand",
    nameAz: "Ərzaq pərakəndə axtarış tələbi",
    nameRu: "Поисковый спрос на продукты",
    category: "macro",
    industries: ["retail"],
    unit: "index",
    direction: "higher_better",
    formula: "az_trend_food_latest",
    thresholds: DEMAND_SIGNAL,
    hintTemplateEn:
      "Google Trends food-retail interest {value}/100. <80 = consumer demand softening; ≥100 = strong demand window.",
    requiredInputs: ["commodityPrice:az_trend_food_latest"],
    sortOrder: 976,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // EDUCATION — demographic
  // ──────────────────────────────────────────────────────────────────
  {
    code: "EDU_POPULATION_0_14_SIGNAL",
    nameEn: "AZ Population Age 0-14 Signal",
    nameAz: "0-14 yaş əhali siqnalı",
    nameRu: "Сигнал населения 0–14 лет AZ",
    category: "macro",
    industries: ["education"],
    unit: "%",
    direction: "higher_better",
    formula: "az_pop_age_0_14_latest",
    thresholds: {
      green: { op: ">=", value: 23 },
      amber: { op: ">=", value: 20 },
      red: { op: "<", value: 20 },
    },
    hintTemplateEn:
      "AZ population age 0-14 at {value}% of total. <20% signals long-term enrollment shrinkage; ≥23% = healthy student cohort.",
    requiredInputs: ["commodityPrice:az_pop_age_0_14_latest"],
    sortOrder: 1025,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // ENTERTAINMENT — travel demand
  // ──────────────────────────────────────────────────────────────────
  {
    code: "ENT_TRAVEL_DEMAND_SIGNAL",
    nameEn: "AZ Travel Search Demand",
    nameAz: "Səyahət axtarış tələbi",
    nameRu: "Поисковый спрос на путешествия",
    category: "macro",
    industries: ["entertainment", "hospitality"],
    unit: "index",
    direction: "higher_better",
    formula: "az_trend_travel_latest",
    thresholds: DEMAND_SIGNAL,
    hintTemplateEn:
      "Google Trends travel interest {value}/100. Forward demand signal for events + hospitality; ≥100 = high travel-search activity.",
    requiredInputs: ["commodityPrice:az_trend_travel_latest"],
    sortOrder: 1055,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // SERVICES — trade balance
  // ──────────────────────────────────────────────────────────────────
  {
    code: "SERV_AZ_TRADE_BALANCE_SIGNAL",
    nameEn: "AZ Trade Balance Signal",
    nameAz: "AZ ticarət balansı siqnalı",
    nameRu: "Сигнал торгового баланса AZ",
    category: "macro",
    industries: ["services", "logistics"],
    unit: "USD",
    direction: "higher_better",
    formula: "az_trade_balance_latest",
    thresholds: {
      green: { op: ">=", value: 10_000_000_000 },
      amber: { op: ">=", value: 0 },
      red: { op: "<", value: 0 },
    },
    hintTemplateEn:
      "AZ trade balance {value} USD (annual). Negative = import-dependent; ≥$10B = strong export economy supporting services demand.",
    requiredInputs: ["commodityPrice:az_trade_balance_latest"],
    sortOrder: 1105,
    defaultValueSource: "macro",
  },

  // ──────────────────────────────────────────────────────────────────
  // AGRO — forward weather
  // ──────────────────────────────────────────────────────────────────
  {
    code: "AGRO_SALYAN_RAINFALL_14D_FCST",
    nameEn: "Salyan 14-Day Rainfall Forecast",
    nameAz: "Salyan 14 günlük yağıntı proqnozu",
    nameRu: "Прогноз осадков Salyan 14 дн",
    category: "macro",
    industries: ["agro_crops"],
    unit: "mm",
    direction: "higher_better",
    formula: "salyan_rainfall_forecast_14d",
    thresholds: {
      green: { op: ">=", value: 30 },
      amber: { op: ">=", value: 10 },
      red: { op: "<", value: 10 },
    },
    hintTemplateEn:
      "Salyan 14-day rainfall forecast {value} mm. <10mm = irrigation pressure for cane fields; ≥30mm = good moisture window.",
    // Maps via COMMODITY_PRICE_ALIASES → openmeteo-forecast source +
    // SALYAN_RAINFALL_MM_14D_FCST metric. Uses commodityPrice
    // namespace because we don't have a dedicated `weather:` resolver
    // for forecast metrics (only the historical-archive weatherResolver).
    requiredInputs: ["commodityPrice:salyan_rainfall_forecast_14d"],
    sortOrder: 1155,
    defaultValueSource: "macro",
  },
  // Phase 7.K Phase 5b sentinel — used by tests to verify the pack
  // landed and is in the correct ALL_INDICATOR_SEEDS slot.
  {
    code: "FP_GRAIN_COST_PRESSURE_BLEND",
    nameEn: "Grain Cost Pressure Blend",
    nameAz: "Dənli yem qarışıq xərc təzyiqi",
    nameRu: "Давление совокупной цены зерна",
    category: "commodity",
    industries: ["food_processing", "poultry"],
    unit: "USD/tonne",
    direction: "lower_better",
    formula: "(corn_price_latest + wheat_price_latest) / 2",
    thresholds: {
      green: { op: "<=", value: 230 },
      amber: { op: "<=", value: 320 },
      red: { op: ">", value: 320 },
    },
    hintTemplateEn:
      "Blended corn+wheat mid-point at {value} USD/tonne. >$320/t = grain input cost stress for processors + integrated poultry.",
    requiredInputs: [
      "commodityPrice:corn_price_latest",
      "commodityPrice:wheat_price_latest",
    ],
    sortOrder: 877,
    defaultValueSource: "macro",
  },
]

// Suppress unused-warning on the helper threshold templates above —
// they're declared at the top of the file to keep seeds DRY but TS
// won't see usage if only some seeds reference them.
void PRESSURE
