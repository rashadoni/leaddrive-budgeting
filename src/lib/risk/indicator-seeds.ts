/**
 * Phase 7.C — pure source-of-truth catalog for IndicatorDefinition seeds.
 *
 * Both `scripts/seed-indicators.ts` (the runtime seed script) AND
 * `src/lib/risk/indicator-thresholds.test.ts` (the boundary suite) import
 * from here. Prevents the dual-of-truth drift that surfaced in the round-1
 * architect review (HOSP_SOURCE_HHI / HOSP_FX_EXPOSURE / others) where the
 * test had its own hand-typed copy of the thresholds and slowly diverged
 * from the seed.
 *
 * No DB / no Prisma — pure data. The seed script wraps each entry with
 * `Prisma.InputJsonValue` casts at write time; the test consumes
 * `Thresholds` directly.
 */

import type { Direction, Thresholds } from "./formula-engine";

export interface IndicatorSeed {
  code: string;
  nameEn: string;
  nameAz?: string;
  nameRu?: string;
  /** fx | commodity | operational | geopolitical | macro | regulatory | composite */
  category: string;
  industries: string[];
  unit: string;
  direction: Direction;
  formula: string;
  sparklineFormula?: string;
  thresholds: Thresholds;
  hintTemplateEn?: string;
  /**
   * Phase 7.G Turn VIII — locale-aware hint templates. The render path
   * at `IndicatorDetail.tsx:315` picks the field matching the user's
   * locale; falls back to `hintTemplateEn` when the locale-specific
   * field is null/empty. Status-token substitution `{status}` is localized
   * via `tStatus()` at render time (architect Turn-VII Round-1 sub-task).
   */
  hintTemplateAz?: string;
  hintTemplateRu?: string;
  requiredInputs: string[];
  sortOrder: number;
}

// ─── Hospitality pack (5) ──────────────────────────────────────────────────

export const hospitalityIndicators: IndicatorSeed[] = [
  {
    code: "HOSP_OCC",
    nameEn: "Occupancy",
    nameAz: "Doluluq",
    nameRu: "Загрузка",
    category: "operational",
    industries: ["hospitality"],
    unit: "%",
    direction: "higher_better",
    formula: "rooms_sold / rooms_available * 100",
    sparklineFormula: "rooms_sold_daily / rooms_available_daily * 100",
    thresholds: {
      green: { op: ">=", value: 70 },
      amber: { op: ">=", value: 50 },
      red: { op: "<", value: 50 },
    },
    hintTemplateEn:
      "Occupancy is {value}% — {status}. Target is 70%+ for stabilised hospitality assets.",
    hintTemplateRu:
      "Загрузка {value}% — {status}. Целевой ориентир для устойчивого hospitality актива — 70%+.",
    hintTemplateAz:
      "Doluluq {value}% — {status}. Sabitləşmiş hospitality aktivi üçün hədəf — 70%+.",
    requiredInputs: ["booking", "company.settings.totalRooms"],
    sortOrder: 10,
  },
  {
    code: "HOSP_REVPAR",
    nameEn: "RevPAR (Revenue Per Available Room)",
    nameAz: "RevPAR",
    nameRu: "RevPAR",
    category: "operational",
    industries: ["hospitality"],
    unit: "AZN",
    direction: "higher_better",
    formula: "room_revenue / rooms_available",
    thresholds: {
      green: { op: ">=", value: 80 },
      amber: { op: ">=", value: 50 },
      red: { op: "<", value: 50 },
    },
    hintTemplateEn:
      "RevPAR of {value} AZN — combines rate and occupancy. Flag if trending below last-year same-month.",
    hintTemplateRu:
      "RevPAR {value} AZN — комбинирует тариф и загрузку. Сигнал: тренд ниже того же месяца прошлого года.",
    hintTemplateAz:
      "RevPAR {value} AZN — qiymət və doluluğun birləşməsi. Siqnal: keçən il eyni ayın altında trend.",
    requiredInputs: ["booking", "company.settings.totalRooms"],
    sortOrder: 20,
  },
  {
    code: "HOSP_ADR",
    nameEn: "Average Daily Rate",
    nameAz: "Orta Gündəlik Tarif",
    nameRu: "Средний тариф за сутки",
    category: "operational",
    industries: ["hospitality"],
    unit: "AZN",
    direction: "higher_better",
    formula: "room_revenue / rooms_sold",
    thresholds: {
      green: { op: ">=", value: 120 },
      amber: { op: ">=", value: 80 },
      red: { op: "<", value: 80 },
    },
    requiredInputs: ["booking"],
    sortOrder: 30,
  },
  {
    code: "HOSP_FX_EXPOSURE",
    nameEn: "FX Exposure",
    nameAz: "Valyuta Riski",
    nameRu: "Валютный риск",
    category: "fx",
    industries: ["hospitality"],
    unit: "%",
    direction: "lower_better",
    formula: "fx_revenue_share * 100",
    thresholds: {
      green: { op: "<=", value: 20 },
      amber: { op: "<=", value: 50 },
      red: { op: ">", value: 50 },
    },
    hintTemplateEn:
      "{value}% of revenue is FX-denominated. A 10% AZN devaluation moves EBITDA by roughly the same share.",
    hintTemplateRu:
      "{value}% выручки в FX. Девальвация AZN на 10% двигает EBITDA примерно на ту же долю.",
    hintTemplateAz:
      "Gəlirin {value}%-i FX-də. AZN-in 10% devalvasiyası EBITDA-nı təxminən eyni payda hərəkət etdirir.",
    requiredInputs: ["booking", "currencyRate"],
    sortOrder: 40,
  },
  {
    code: "HOSP_SOURCE_HHI",
    nameEn: "Source-Country Concentration (HHI)",
    nameAz: "Mənbə Ölkə Konsentrasiyası",
    nameRu: "Концентрация по странам-источникам",
    category: "geopolitical",
    industries: ["hospitality"],
    unit: "index",
    direction: "lower_better",
    formula: "source_country_hhi",
    thresholds: {
      green: { op: "<=", value: 1500 },
      amber: { op: "<=", value: 2500 },
      red: { op: ">", value: 2500 },
    },
    hintTemplateEn:
      "HHI = {value}. Above 2500 means a single source market dominates — one travel restriction can sink the quarter.",
    hintTemplateRu:
      "HHI = {value}. Выше 2500 — один source-market доминирует; одно travel-ограничение топит квартал.",
    hintTemplateAz:
      "HHI = {value}. 2500-dən yuxarı bir mənbə bazar üstünlük təşkil edir; bir səyahət məhdudiyyəti rübü batırır.",
    requiredInputs: ["booking.sourceCountry"],
    sortOrder: 50,
  },
];

// ─── Agro pack (3 — AGRO_FX_RISK retired) ──────────────────────────────────

export const agroIndicators: IndicatorSeed[] = [
  {
    code: "AGRO_YIELD",
    nameEn: "Yield per Hectare",
    nameAz: "Hektardan Məhsuldarlıq",
    nameRu: "Урожайность с гектара",
    category: "operational",
    industries: ["agro_crops"],
    unit: "ton/ha",
    direction: "higher_better",
    formula: "harvest_tons / area_hectares",
    thresholds: {
      green: { op: ">=", value: 4 },
      amber: { op: ">=", value: 2.5 },
      red: { op: "<", value: 2.5 },
    },
    hintTemplateEn:
      "Yield is {value} t/ha. Below 2.5 usually signals irrigation, seed-quality, or pest issues — investigate.",
    hintTemplateRu:
      "Урожайность {value} т/га. Ниже 2.5 — обычно сигнал ирригации, качества семян или вредителей; разбираться.",
    hintTemplateAz:
      "Məhsuldarlıq {value} t/ha. 2.5-dən aşağı — adətən suvarma, toxum keyfiyyəti və ya zərərvericilər siqnalı; araşdırın.",
    requiredInputs: [
      "operationalFact:harvest_tons",
      "operationalFact:area_hectares",
    ],
    sortOrder: 10,
  },
  {
    code: "AGRO_DROUGHT_RISK",
    nameEn: "Drought Risk Index",
    nameAz: "Quraqlıq Riski",
    nameRu: "Индекс засухи",
    category: "macro",
    industries: ["agro_crops"],
    unit: "index",
    direction: "lower_better",
    formula: "drought_index",
    thresholds: {
      green: { op: "<=", value: 30 },
      amber: { op: "<=", value: 60 },
      red: { op: ">", value: 60 },
    },
    hintTemplateEn:
      "Drought index at {value}/100 — above 60 is the historical threshold for >20% yield loss in the region.",
    hintTemplateRu:
      "Индекс засухи {value}/100 — выше 60 — исторический порог для >20% потери урожая в регионе.",
    hintTemplateAz:
      "Quraqlıq indeksi {value}/100 — 60-dan yuxarı bölgə üçün >20% məhsul itkisinin tarixi həddi.",
    requiredInputs: ["operationalFact:drought_index"],
    sortOrder: 20,
  },
  {
    code: "AGRO_COMMODITY_VOL",
    nameEn: "Commodity Price Volatility",
    nameAz: "Əmtəə Qiymət Dəyişkənliyi",
    nameRu: "Волатильность цен на товар",
    category: "commodity",
    industries: ["agro_crops", "poultry", "food_processing"],
    unit: "%",
    direction: "lower_better",
    formula: "commodity_price_stdev / commodity_price_mean * 100",
    thresholds: {
      green: { op: "<=", value: 10 },
      amber: { op: "<=", value: 25 },
      red: { op: ">", value: 25 },
    },
    hintTemplateEn:
      "Trailing-12M price volatility is {value}%. Above 25% — consider forward contracts to lock margins.",
    hintTemplateRu:
      "Скользящая 12-месячная волатильность цены {value}%. Выше 25% — рассмотрите forward-контракты для фиксации маржи.",
    hintTemplateAz:
      "Sürüşkən 12-aylıq qiymət volatilliyi {value}%. 25%-dən yuxarı — marjanı bağlamaq üçün forvard müqavilələrini nəzərdən keçirin.",
    requiredInputs: ["operationalFact:commodity_price"],
    sortOrder: 40,
  },
];

// ─── Cross-sector pack (4) ─────────────────────────────────────────────────

export const crossSectorIndicators: IndicatorSeed[] = [
  {
    code: "FX_IMPORTED_INPUT",
    nameEn: "Imported-Input FX Exposure",
    nameAz: "İdxal Girişlərinin FX Riski",
    nameRu: "Доля импорта во входах (FX-риск)",
    category: "fx",
    industries: [
      "agro_crops",
      "poultry",
      "food_processing",
      "industrial",
      "services",
    ],
    unit: "%",
    direction: "lower_better",
    formula: "imported_input_cost / total_input_cost * 100",
    thresholds: {
      green: { op: "<=", value: 25 },
      amber: { op: "<=", value: 50 },
      red: { op: ">", value: 50 },
    },
    hintTemplateEn:
      "{value}% of input costs are imported. AZN weakness hits gross margin directly.",
    hintTemplateRu:
      "{value}% затрат на сырьё — импорт. Ослабление AZN бьёт по валовой марже напрямую.",
    hintTemplateAz:
      "Giriş xərclərinin {value}%-i idxaldır. AZN-in zəifləməsi ümumi mənfəətə birbaşa təsir edir.",
    requiredInputs: ["budgetLine", "currencyRate"],
    sortOrder: 5,
  },
  // ── Phase 7.E phase 3 — building blocks for `rollup()` and `fact()` ────
  // demonstrations (sub-42, 2026-04-30). These indicators persist raw $$
  // values + fact()-baseline deltas so the formula engine has cross-period
  // and cross-company composites to evaluate.
  //
  // Operational prerequisites for end-to-end activation (tracked as 🔄):
  //   1. `IND_HOLDING_REVENUE` requires parent-company recompute support.
  //      Today `recompute-trigger.ts:filterOperationalCompanies` only feeds
  //      level=2+role='operational' cos to the recompute loop; parent-cos
  //      (level=1) are skipped, so their `IND_HOLDING_REVENUE` IV is never
  //      created. UI affordance "rollup formulas" needs the trigger to also
  //      walk parent cos with rollup-flagged indicators.
  //   2. `IND_NET_MARGIN_VS_2025` requires historical 2025 IND_NET_MARGIN
  //      IVs in DB. v1 runs `IND_NET_MARGIN` only at the current period;
  //      2025 IVs would have to be either backfilled by a separate
  //      compute-historical-ivs script OR seeded manually for demo orgs.
  //
  // For a Prisma adapter with no historical data + no parent-co recompute,
  // these indicators resolve to status='unknown' (fact returns null →
  // formula NaN; rollup on op-co with no children returns 0 which still
  // hits amber but is misleading). Hint templates document that.
  {
    code: "IND_REVENUE_TOTAL",
    nameEn: "Revenue (Total)",
    nameAz: "Ümumi Gəlir",
    nameRu: "Совокупная выручка",
    // Sub-42 architect Round-1 closure — `category: "internal"` excludes
    // this indicator from HeatMap rendering. Its job is to PERSIST raw $
    // for rollup() / fact() composites, not to be a user-facing risk row.
    // Without this gate the threshold "any positive revenue is green"
    // would emit a green-by-default column on every operational co —
    // signal-free noise polluting the matrix. The matrix endpoint at
    // `src/app/api/indicators/matrix/route.ts` filters out
    // `category: 'internal'` rows.
    category: "internal",
    industries: [],
    unit: "AZN",
    direction: "higher_better",
    // Persists raw revenue from `budgetLineResolver` as an IV. Building
    // block for `rollup("IND_REVENUE_TOTAL")` — parent cos sum across
    // children. Threshold "any positive revenue is green" is intentional:
    // the indicator's job is to PERSIST the number for cross-co rollup,
    // not to flag risk. Risk-bearing margin indicators (IND_NET_MARGIN,
    // IND_GROSS_MARGIN) live separately.
    formula: "revenue",
    thresholds: {
      green: { op: ">=", value: 0 },
      amber: { op: ">=", value: -1 },
      red: { op: "<", value: -1 },
    },
    hintTemplateEn:
      "Total revenue {value} AZN. Persists raw $ for rollup() and fact() composites; risk classification lives on margin indicators.",
    hintTemplateRu:
      "Общая выручка {value} AZN. Сохраняет сырые $ для rollup() и fact() композитов; классификация рисков на других индикаторах.",
    hintTemplateAz:
      "Ümumi gəlir {value} AZN. Rollup() və fact() kompozitləri üçün xam $ saxlayır; risk təsnifatı digər göstəricilərdə.",
    requiredInputs: ["budgetLine"],
    sortOrder: 1,
  },
  {
    code: "IND_HOLDING_REVENUE",
    nameEn: "Holding Revenue (rollup)",
    nameAz: "Holdinq Gəliri (rollup)",
    nameRu: "Выручка холдинга (rollup)",
    // Sub-42 architect Round-1 closure + sub-44 prereq-#1 + render-path:
    //   • Sub-42 set `category: "internal"` because (a) op-cos with no
    //     children compute rollup as 0 → amber (misleading "Holding
    //     Revenue 0" on a sub-co), (b) parent cos didn't enter the
    //     recompute loop so the IV was never created either way.
    //   • Sub-44 prereq #1 (2026-05-03) closed (b): `recompute-trigger.ts`
    //     opts-in level=1 parent cos for any indicator carrying a
    //     `rollup:` requiredInput → parent-co IVs are written to DB.
    //   • Sub-44 cont'd render-path (2026-05-03) closed (a) + matrix
    //     visibility: `src/app/api/indicators/matrix/route.ts` now
    //     (i) keeps rollup-bearing internal indicators in the visible
    //     indicators list, (ii) emits real parent-co cells with drill-
    //     downable `indicatorValueId` (priority over Turn 33.5 synthetic
    //     averages), (iii) suppresses op-co cells for rollup-bearing
    //     internals so the misleading amber-everywhere is gone.
    //   • The seed STAYS `category: "internal"` because the relaxed
    //     matrix-side filter is the correct gate point: "internal"
    //     remains the seed-author signal for "not user-facing on op-co
    //     rows", and the matrix endpoint promotes it to visible iff
    //     rollup-bearing. End-to-end pipeline IS LIVE — visible only
    //     for orgs that have at least one parent (level=1, sub-group)
    //     company with the IV in DB.
    category: "internal",
    industries: [],
    unit: "AZN",
    direction: "higher_better",
    // Cross-company sum across direct children's IND_REVENUE_TOTAL.
    // Empty-children case returns 0 (rollup contract), which falls in
    // the amber band — useful UX signal at parent-co level ("no children
    // contributing yet"). Threshold values are demo-level placeholders;
    // real holdings would tune via the C6 alert-thresholds-config layer.
    formula: 'rollup("IND_REVENUE_TOTAL")',
    thresholds: {
      green: { op: ">=", value: 1000000 },
      amber: { op: ">=", value: 0 },
      red: { op: "<", value: 0 },
    },
    hintTemplateEn:
      "Holding-wide revenue {value} AZN, summed across direct children. 0 = no operational sub-cos contributing yet. Most meaningful at parent (level=1) companies.",
    hintTemplateRu:
      "Выручка холдинга {value} AZN, суммарно по прямым дочерним компаниям. 0 = ни одна операционная саб-ко не дала вклад.",
    hintTemplateAz:
      "Holdinqin gəliri {value} AZN, birbaşa törəmə şirkətlər üzrə cəmi. 0 = heç bir əməliyyat törəməsi töhfə verməyib.",
    requiredInputs: ["rollup:IND_REVENUE_TOTAL"],
    sortOrder: 2,
  },
  {
    code: "IND_NET_MARGIN_VS_2025",
    nameEn: "Net Margin vs 2025 baseline",
    nameAz: "Xalis Marja 2025-ə nisbətən",
    nameRu: "Чистая маржа vs базис 2025",
    // Industrial-only because it references IND_NET_MARGIN (industrial-
    // sector indicator). Cross-sector versions would need per-sector
    // copies of this seed, which is fine but defers v2 — keep the
    // demonstration narrow to one sector + one historical baseline.
    category: "operational",
    industries: ["industrial"],
    unit: "pp", // percentage points (delta of two %s)
    direction: "higher_better",
    // Year-over-year margin delta vs a fixed 2025 baseline. Returns NaN
    // (→ status='unknown') unless the same company has an IND_NET_MARGIN
    // IV at period="2025" — backfill required for the indicator to fire.
    formula: '(net_income / revenue * 100) - fact("IND_NET_MARGIN", "2025")',
    thresholds: {
      green: { op: ">=", value: 0 },
      amber: { op: ">=", value: -3 },
      red: { op: "<", value: -3 },
    },
    hintTemplateEn:
      "Net margin moved {value}pp vs 2025 baseline. -3pp+ deterioration = red — investigate cost mix or pricing. Requires backfilled 2025 IND_NET_MARGIN to fire.",
    requiredInputs: ["budgetLine", "fact:IND_NET_MARGIN@2025"],
    sortOrder: 3,
  },
];

// ─── Industrial pack (4) ───────────────────────────────────────────────────

export const industrialIndicators: IndicatorSeed[] = [
  {
    code: "IND_GROSS_MARGIN",
    nameEn: "Gross Margin",
    nameAz: "Ümumi Marja",
    nameRu: "Валовая маржа",
    category: "operational",
    industries: ["industrial"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 30 },
      amber: { op: ">=", value: 15 },
      red: { op: "<", value: 15 },
    },
    hintTemplateEn:
      "Gross margin {value}% — revenue left after COGS. Industrial benchmark 25–35%; below 15% means pricing or input-cost discipline is broken.",
    hintTemplateRu:
      "Валовая маржа {value}% — доход после прямых затрат. Промышленный бенчмарк 25–35%; ниже 15% значит сломан pricing или контроль затрат.",
    hintTemplateAz:
      "Ümumi mənfəət {value}% — gəlirin COGS-dan sonrakı qalığı. Sənaye benchmark 25–35%; 15%-dən aşağı qiymətləmə və ya giriş-xərc nizamı pozulub.",
    requiredInputs: ["budgetLine"],
    sortOrder: 10,
  },
  {
    code: "IND_NET_MARGIN",
    nameEn: "Net Margin",
    nameAz: "Xalis Marja",
    nameRu: "Чистая маржа",
    category: "operational",
    industries: ["industrial"],
    unit: "%",
    direction: "higher_better",
    formula: "net_income / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 10 },
      amber: { op: ">=", value: 3 },
      red: { op: "<", value: 3 },
    },
    hintTemplateEn:
      "Net margin {value}%. Below 3% — a single input-cost spike or FX move erases profit. Fix OpEx or revenue mix.",
    hintTemplateRu:
      "Чистая маржа {value}%. Ниже 3% — один скачок цен на сырьё или FX-движение съедает прибыль. Чините OpEx или микс выручки.",
    hintTemplateAz:
      "Xalis mənfəət {value}%. 3%-dən aşağı — bir giriş-xərc sıçrayışı və ya FX hərəkəti mənfəəti silir. OpEx-i və ya gəlir miksini düzəltməlisiniz.",
    requiredInputs: ["budgetLine"],
    sortOrder: 20,
  },
  {
    code: "IND_OPEX_RATIO",
    nameEn: "OpEx Ratio",
    nameAz: "Əməliyyat Xərcləri Nisbəti",
    nameRu: "Доля операционных расходов",
    category: "operational",
    industries: ["industrial"],
    unit: "%",
    direction: "lower_better",
    formula: "opex / revenue * 100",
    thresholds: {
      green: { op: "<=", value: 20 },
      amber: { op: "<=", value: 35 },
      red: { op: ">", value: 35 },
    },
    hintTemplateEn:
      "Operating expenses are {value}% of revenue. Above 35% suggests overhead bloat — review payroll, rent, SG&A.",
    hintTemplateRu:
      "Операционные расходы — {value}% от выручки. Выше 35% — раздутый overhead, проверьте ФОТ, аренду, SG&A.",
    hintTemplateAz:
      "Əməliyyat xərcləri gəlirin {value}%-dir. 35%-dən yuxarı şişmiş overhead — əmək haqqı fondu, icarə, SG&A-nı yoxlayın.",
    requiredInputs: ["budgetLine"],
    sortOrder: 30,
  },
  {
    code: "IND_COGS_INTENSITY",
    nameEn: "COGS Intensity",
    nameAz: "Maya Dəyərinin Payı",
    nameRu: "Себестоимость к выручке",
    category: "operational",
    industries: ["industrial"],
    unit: "%",
    direction: "lower_better",
    formula: "cogs / revenue * 100",
    thresholds: {
      green: { op: "<=", value: 70 },
      amber: { op: "<=", value: 85 },
      red: { op: ">", value: 85 },
    },
    hintTemplateEn:
      "COGS is {value}% of revenue. Above 85% — one bad raw-material cycle flips the company to a loss.",
    hintTemplateRu:
      "Себестоимость {value}% от выручки. Выше 85% — один неудачный цикл сырья переводит компанию в убыток.",
    hintTemplateAz:
      "COGS gəlirin {value}%-dir. 85%-dən yuxarı — bir uğursuz xammal dövrü şirkəti zərərə keçirir.",
    requiredInputs: ["budgetLine"],
    sortOrder: 40,
  },
  // ── Real-data saturation extension (sub-27 cont'd) ──────────────────
  // 4 new industrial indicators that consume context vars already
  // exposed by `budgetLineResolver` (gross_profit / opex / total_input_cost
  // / imported_input_cost / revenue_line_hhi). No new resolver work or
  // new data import required — pure formula additions that turn the
  // existing AZMADE BudgetLine import into 4 more lit cells per
  // industrial company on the HeatMap.
  {
    code: "IND_OPERATING_LEVERAGE",
    nameEn: "Operating Leverage",
    nameAz: "Əməliyyat Leverajı",
    nameRu: "Операционный леверидж",
    category: "operational",
    industries: ["industrial"],
    unit: "ratio",
    direction: "higher_better",
    formula: "gross_profit / opex",
    thresholds: {
      green: { op: ">=", value: 2 },
      amber: { op: ">=", value: 1 },
      red: { op: "<", value: 1 },
    },
    hintTemplateEn:
      "Operating leverage = {value}. Above 2.0 means gross profit comfortably covers fixed-cost overhead; below 1.0 every revenue dip eats payroll/rent/admin.",
    hintTemplateRu:
      "Операционный рычаг = {value}. Выше 2.0 — валовая прибыль уверенно покрывает постоянные расходы; ниже 1.0 любое падение выручки съедает ФОТ/аренду/админ.",
    hintTemplateAz:
      "Əməliyyat leveric = {value}. 2.0-dən yuxarı ümumi mənfəət sabit xərcləri rahat örtür; 1.0-dən aşağı hər gəlir azalması əmək haqqı/icarə/inzibatı yeyir.",
    requiredInputs: ["budgetLine"],
    sortOrder: 50,
  },
  // ── IND_FX_INPUT_RISK retired (sub-27 cont'd Round-7 closure) ──────
  // Architect Round-6 flagged: AZMADE xlsx import doesn't tag
  // `currencyCode` on BudgetLines (10169/10169 NULL), so the formula
  // structurally returned 0% across all op-cos — a fake green that
  // would mislead demo. Re-enable AFTER `scripts/import-azmade-budgets.ts`
  // is extended to detect and persist xlsx FX columns. Definition
  // preserved here as a comment block so a future contributor doesn't
  // re-derive thresholds from scratch:
  //
  //   formula: "imported_input_cost / total_input_cost * 100"
  //   green: <=30 / amber: <=60 / red: >60
  //   requiredInputs: ["budgetLine"]
  //   sortOrder: 60
  {
    code: "IND_REVENUE_HHI",
    nameEn: "Revenue Concentration (HHI)",
    nameAz: "Gəlir Konsentrasiyası (HHI)",
    nameRu: "Концентрация выручки (HHI)",
    category: "geopolitical",
    industries: ["industrial"],
    unit: "index",
    direction: "lower_better",
    formula: "revenue_line_hhi",
    thresholds: {
      green: { op: "<=", value: 1500 },
      amber: { op: "<=", value: 3000 },
      red: { op: ">", value: 3000 },
    },
    hintTemplateEn:
      "Revenue HHI = {value}. Above 3000 means a single product/customer dominates — diversify the pipeline before regulatory or demand shock.",
    hintTemplateRu:
      "HHI выручки = {value}. Выше 3000 — один продукт/клиент доминирует; диверсифицируйте pipeline до регуляторного или спросового шока.",
    hintTemplateAz:
      "Gəlir HHI = {value}. 3000-dən yuxarı bir məhsul/müştəri üstünlük təşkil edir — tənzimləyici və ya tələb şokundan əvvəl pipeline-ı diversifikasiya edin.",
    requiredInputs: ["budgetLine.revenue_line_hhi"],
    sortOrder: 70,
  },
  {
    code: "IND_OPEX_TO_COGS",
    nameEn: "OpEx-to-COGS Balance",
    nameAz: "OpEx/COGS Balansı",
    nameRu: "OpEx к себестоимости",
    category: "operational",
    industries: ["industrial"],
    unit: "%",
    direction: "lower_better",
    formula: "opex / cogs * 100",
    thresholds: {
      green: { op: "<=", value: 25 },
      amber: { op: "<=", value: 50 },
      red: { op: ">", value: 50 },
    },
    hintTemplateEn:
      "OpEx is {value}% of COGS. Industrial baseline 15-30%; above 50% means non-production costs are too heavy relative to direct production — restructure or reclassify.",
    hintTemplateRu:
      "OpEx составляет {value}% от COGS. Промышленный baseline 15–30%; выше 50% — непроизводственные расходы слишком тяжёлые относительно прямого производства, реструктуризируйте или переклассифицируйте.",
    hintTemplateAz:
      "OpEx COGS-un {value}%-dir. Sənaye baseline 15–30%; 50%-dən yuxarı — qeyri-istehsal xərcləri birbaşa istehsala nisbətən çox ağırdır, yenidən qurun və ya təsnif edin.",
    requiredInputs: ["budgetLine"],
    sortOrder: 80,
  },
];

// ─── Services pack (5) ─────────────────────────────────────────────────────

export const servicesIndicators: IndicatorSeed[] = [
  {
    code: "SVC_GROSS_MARGIN",
    nameEn: "Services Gross Margin",
    nameAz: "Xidmət Ümumi Marja",
    nameRu: "Валовая маржа сервисов",
    category: "operational",
    industries: ["services"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 45 },
      amber: { op: ">=", value: 25 },
      red: { op: "<", value: 25 },
    },
    hintTemplateEn:
      "Services gross margin {value}%. Healthy benchmarks run 40-60%; below 25% means pricing power is eroding or direct-service-delivery costs are out of line.",
    hintTemplateRu:
      "Валовая маржа услуг {value}%. Здоровые бенчмарки 40–60%; ниже 25% — pricing power размывается или прямые затраты на оказание услуг вышли из-под контроля.",
    hintTemplateAz:
      "Xidmət ümumi mənfəəti {value}%. Sağlam benchmark 40–60%; 25%-dən aşağı — qiymətləmə gücü aşınır və ya birbaşa xidmət-çatdırılma xərcləri sıradan çıxır.",
    requiredInputs: ["budgetLine"],
    sortOrder: 110,
  },
  {
    code: "SVC_NET_MARGIN",
    nameEn: "Services Net Margin",
    nameAz: "Xidmət Xalis Marja",
    nameRu: "Чистая маржа сервисов",
    category: "operational",
    industries: ["services"],
    unit: "%",
    direction: "higher_better",
    formula: "net_income / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 8 },
      amber: { op: ">=", value: 0 },
      red: { op: "<", value: 0 },
    },
    hintTemplateEn:
      "Net margin {value}%. Services businesses below 0% are losing money on operations — investigate pricing, utilization, and overhead allocation.",
    hintTemplateRu:
      "Чистая маржа {value}%. Сервисные бизнесы ниже 0% теряют деньги на операциях — проверьте pricing, утилизацию и распределение overhead.",
    hintTemplateAz:
      "Xalis mənfəət {value}%. 0%-dən aşağı xidmət bizneslər əməliyyatlarda pul itirir — qiymətləmə, utilizasiya və overhead bölgüsünü yoxlayın.",
    requiredInputs: ["budgetLine"],
    sortOrder: 120,
  },
  {
    code: "SVC_OPEX_RATIO",
    nameEn: "Services OpEx Ratio",
    nameAz: "Xidmət Əməliyyat Xərcləri Nisbəti",
    nameRu: "Доля операционных расходов (сервисы)",
    category: "operational",
    industries: ["services"],
    unit: "%",
    direction: "lower_better",
    formula: "opex / revenue * 100",
    thresholds: {
      green: { op: "<=", value: 60 },
      amber: { op: "<=", value: 85 },
      red: { op: ">", value: 85 },
    },
    hintTemplateEn:
      "OpEx {value}% of revenue. Services baseline 50-70% (personnel-heavy); above 85% suggests depreciation or overhead is too large for the revenue base.",
    hintTemplateRu:
      "OpEx — {value}% от выручки. Сервисный baseline 50–70% (персонал-центричный); выше 85% — амортизация или overhead слишком велики для базы выручки.",
    hintTemplateAz:
      "OpEx gəlirin {value}%-dir. Xidmət baseline 50–70% (personalla yüklü); 85%-dən yuxarı — amortizasiya və ya overhead gəlir bazası üçün çox böyükdür.",
    requiredInputs: ["budgetLine"],
    sortOrder: 130,
  },
  {
    code: "SVC_COGS_INTENSITY",
    nameEn: "Services COGS Intensity",
    nameAz: "Xidmət Maya Dəyər Payı",
    nameRu: "Себестоимость к выручке (сервисы)",
    category: "operational",
    industries: ["services"],
    unit: "%",
    direction: "lower_better",
    formula: "cogs / revenue * 100",
    thresholds: {
      green: { op: "<=", value: 40 },
      amber: { op: "<=", value: 60 },
      red: { op: ">", value: 60 },
    },
    hintTemplateEn:
      "COGS {value}% of revenue. Services above 60% usually means low-margin re-selling or high third-party pass-through costs.",
    hintTemplateRu:
      "COGS {value}% от выручки. Услуги выше 60% — обычно низкомаржинальная перепродажа или высокие сторонние pass-through расходы.",
    hintTemplateAz:
      "COGS gəlirin {value}%-dir. Xidmətdə 60%-dən yuxarı — adətən aşağı-marja yenidən-satış və ya yüksək üçüncü-tərəf pass-through xərcləri.",
    requiredInputs: ["budgetLine"],
    sortOrder: 140,
  },
  {
    code: "SVC_REVENUE_CONCENTRATION",
    nameEn: "Revenue Concentration (HHI)",
    nameAz: "Gəlir Konsentrasiyası (HHI)",
    nameRu: "Концентрация выручки (HHI)",
    category: "geopolitical",
    industries: ["services"],
    unit: "index",
    direction: "lower_better",
    formula: "revenue_line_hhi",
    thresholds: {
      green: { op: "<=", value: 1500 },
      amber: { op: "<=", value: 3000 },
      red: { op: ">", value: 3000 },
    },
    hintTemplateEn:
      "Revenue HHI = {value}. Above 3000 means a single client dominates — losing them jeopardises the business. Diversify the pipeline.",
    hintTemplateRu:
      "HHI выручки = {value}. Выше 3000 — один клиент доминирует; его потеря угрожает бизнесу. Диверсифицируйте pipeline.",
    hintTemplateAz:
      "Gəlir HHI = {value}. 3000-dən yuxarı bir müştəri üstünlük təşkil edir — onu itirmək biznesi təhlükəyə atır. Pipeline-ı diversifikasiya edin.",
    requiredInputs: ["budgetLine.revenue_line_hhi"],
    sortOrder: 150,
  },
];

// ─── Pharma pack (5) ───────────────────────────────────────────────────────

export const pharmaIndicators: IndicatorSeed[] = [
  {
    code: "PHARMA_GROSS_MARGIN",
    nameEn: "Pharma Gross Margin",
    nameAz: "Farma Ümumi Marja",
    nameRu: "Валовая маржа фармы",
    category: "operational",
    industries: ["pharma"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 55 },
      amber: { op: ">=", value: 30 },
      red: { op: "<", value: 30 },
    },
    hintTemplateEn:
      "Pharma gross margin {value}%. Branded products run 70-80%, generics 40-55%, pure distribution 10-20%. Below 30% usually means no IP differentiation.",
    hintTemplateRu:
      "Валовая маржа фармы {value}%. Брендированные 70–80%, generics 40–55%, чистая дистрибуция 10–20%; ниже 8% — обычно дистрибуторская модель давит на цены.",
    hintTemplateAz:
      "Pharma ümumi mənfəəti {value}%. Brendli 70–80%, generics 40–55%, saf distribusiya 10–20%; 8%-dən aşağı — adətən distribütor modeli qiymətləri sıxır.",
    requiredInputs: ["budgetLine"],
    sortOrder: 210,
  },
  {
    code: "PHARMA_NET_MARGIN",
    nameEn: "Pharma Net Margin",
    nameAz: "Farma Xalis Marja",
    nameRu: "Чистая маржа фармы",
    category: "operational",
    industries: ["pharma"],
    unit: "%",
    direction: "higher_better",
    formula: "net_income / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 8 },
      amber: { op: ">=", value: 2 },
      red: { op: "<", value: 2 },
    },
    hintTemplateEn:
      "Net margin {value}%. Regulatory + R&D amortisation compress net margin; below 2% is structurally loss-prone.",
    hintTemplateRu:
      "Чистая маржа {value}%. Регуляторные + R&D амортизация сжимают net margin; ниже 2% — структурно убыточно.",
    hintTemplateAz:
      "Xalis mənfəət {value}%. Tənzimləyici + R&D amortizasiyası net margin-i sıxır; 2%-dən aşağı — strukturca zərərlidir.",
    requiredInputs: ["budgetLine"],
    sortOrder: 220,
  },
  {
    code: "PHARMA_RD_INTENSITY",
    nameEn: "R&D Intensity",
    nameAz: "ATİ Xərcləri Payı",
    nameRu: "Доля R&D в выручке",
    category: "operational",
    industries: ["pharma"],
    unit: "%",
    direction: "higher_better",
    formula: "rd_spend / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 10 },
      amber: { op: ">=", value: 5 },
      red: { op: "<", value: 5 },
    },
    hintTemplateEn:
      "R&D intensity {value}%. Industry avg 17%; below 5% means no new-product pipeline — revenue cliff risk when patents expire.",
    hintTemplateRu:
      "Интенсивность R&D {value}%. Среднее по индустрии 17%; ниже 5% — нет new-product pipeline → riск revenue cliff.",
    hintTemplateAz:
      "R&D intensivliyi {value}%. Sənaye orta göstəricisi 17%; 5%-dən aşağı — yeni-məhsul pipeline yoxdur → gəlir uçurumu riski.",
    requiredInputs: ["budgetLine.rd_spend"],
    sortOrder: 230,
  },
  {
    code: "PHARMA_INVENTORY_DAYS",
    nameEn: "Inventory Days",
    nameAz: "Anbarda Qalma Müddəti",
    nameRu: "Дни запасов",
    category: "operational",
    industries: ["pharma"],
    unit: "days",
    direction: "lower_better",
    formula: "inventory / cogs * 365",
    thresholds: {
      green: { op: "<=", value: 60 },
      amber: { op: "<=", value: 120 },
      red: { op: ">", value: 120 },
    },
    hintTemplateEn:
      "Inventory days = {value}. Above 120 means product is sitting on shelves — check for near-expiry stock or demand overestimation.",
    hintTemplateRu:
      "Inventory days = {value}. Выше 120 — продукт лежит на складе; проверьте near-expiry и pricing.",
    hintTemplateAz:
      "Anbar günləri = {value}. 120-dən yuxarı — məhsul rəfdə yatır; istifadə-müddəti yaxınlaşan və qiymətləməni yoxlayın.",
    requiredInputs: ["budgetLine.inventory"],
    sortOrder: 240,
  },
  {
    code: "PHARMA_OPEX_RATIO",
    nameEn: "Pharma OpEx Ratio",
    nameAz: "Farma Əməliyyat Xərcləri Nisbəti",
    nameRu: "Доля OpEx (фарма)",
    category: "operational",
    industries: ["pharma"],
    unit: "%",
    direction: "lower_better",
    formula: "opex / revenue * 100",
    thresholds: {
      green: { op: "<=", value: 30 },
      amber: { op: "<=", value: 45 },
      red: { op: ">", value: 45 },
    },
    hintTemplateEn:
      "OpEx {value}% of revenue. Pharma SG&A runs 25-40% with sales force + reg compliance. Above 45% suggests overhead isn't scaling with revenue.",
    hintTemplateRu:
      "OpEx {value}% от выручки. Pharma SG&A 25–40% (sales force + reg compliance). Выше 45% — sales-force overcapacity или compliance lag.",
    hintTemplateAz:
      "OpEx gəlirin {value}%-dir. Pharma SG&A 25–40% (sales force + reg compliance). 45%-dən yuxarı — sales-force həddən artıq və ya compliance gecikmələri.",
    requiredInputs: ["budgetLine"],
    sortOrder: 250,
  },
];

// ─── Real Estate pack (5) ──────────────────────────────────────────────────

export const realEstateIndicators: IndicatorSeed[] = [
  {
    code: "RE_GROSS_MARGIN",
    nameEn: "Real Estate NOI Margin",
    nameAz: "Əmlak NOI Marja",
    nameRu: "Маржа NOI недвижимости",
    category: "operational",
    industries: ["real_estate"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 65 },
      amber: { op: ">=", value: 45 },
      red: { op: "<", value: 45 },
    },
    hintTemplateEn:
      "NOI margin {value}%. Commercial real estate baseline 65-85%; below 45% signals high operating expenses (utilities, property tax, maintenance) relative to rent.",
    hintTemplateRu:
      "NOI margin {value}%. Коммерческая недвижимость baseline 65–85%; ниже 45% — высокие операционные расходы или ослабление аренды.",
    hintTemplateAz:
      "NOI marja {value}%. Kommersiya daşınmaz əmlak baseline 65–85%; 45%-dən aşağı — yüksək əməliyyat xərcləri və ya icarənin zəifləməsi.",
    requiredInputs: ["budgetLine"],
    sortOrder: 310,
  },
  {
    code: "RE_OCCUPANCY",
    nameEn: "Occupancy Rate",
    nameAz: "Doluluq Dərəcəsi",
    nameRu: "Уровень занятости",
    category: "operational",
    industries: ["real_estate"],
    unit: "%",
    direction: "higher_better",
    formula: "leased_area / total_area * 100",
    thresholds: {
      green: { op: ">=", value: 90 },
      amber: { op: ">=", value: 75 },
      red: { op: "<", value: 75 },
    },
    hintTemplateEn:
      "Occupancy {value}%. Stabilised commercial assets run 90%+; below 75% usually means pricing or product-market fit problem.",
    hintTemplateRu:
      "Заполняемость {value}%. Стабилизированные коммерческие активы 90%+; ниже 75% — проблемы pricing или продукта.",
    hintTemplateAz:
      "Doluluq {value}%. Sabitləşmiş kommersiya aktivlər 90%+; 75%-dən aşağı — qiymətləmə və ya məhsul problemləri.",
    requiredInputs: [
      "operationalFact:leased_area",
      "operationalFact:total_area",
    ],
    sortOrder: 320,
  },
  {
    code: "RE_DEBT_SERVICE_COVERAGE",
    nameEn: "Debt Service Coverage (DSCR)",
    nameAz: "Borc Xidmət Əhatə Əmsalı",
    nameRu: "Покрытие долга (DSCR)",
    category: "operational",
    industries: ["real_estate"],
    unit: "ratio",
    direction: "higher_better",
    formula: "gross_profit / debt_service",
    thresholds: {
      green: { op: ">=", value: 1.35 },
      amber: { op: ">=", value: 1.15 },
      red: { op: "<", value: 1.15 },
    },
    hintTemplateEn:
      "DSCR {value}. Below 1.15 means NOI barely covers interest + principal — any rent drop triggers default risk.",
    hintTemplateRu:
      "DSCR {value}. Ниже 1.15 — NOI едва покрывает проценты + principal; любое падение аренды триггерит default.",
    hintTemplateAz:
      "DSCR {value}. 1.15-dən aşağı — NOI faizləri + əsas borcu çətinliklə örtür; istənilən icarə azalması default-u tetikləyir.",
    requiredInputs: ["budgetLine.debt_service"],
    sortOrder: 330,
  },
  {
    code: "RE_RENT_COLLECTION",
    nameEn: "Rent Collection Rate",
    nameAz: "İcarə Toplanma Dərəcəsi",
    nameRu: "Доля собранной аренды",
    category: "operational",
    industries: ["real_estate"],
    unit: "%",
    direction: "higher_better",
    formula: "rent_collected / rent_billed * 100",
    thresholds: {
      green: { op: ">=", value: 98 },
      amber: { op: ">=", value: 92 },
      red: { op: "<", value: 92 },
    },
    hintTemplateEn:
      "Rent collection {value}%. Commercial target 98%+; below 92% means tenants can't pay — recession indicator.",
    hintTemplateRu:
      "Сбор аренды {value}%. Коммерческий target 98%+; ниже 92% — tenants не платят, индикатор рецессии.",
    hintTemplateAz:
      "İcarə yığımı {value}%. Kommersiya hədəfi 98%+; 92%-dən aşağı — kirayəçilər ödəyə bilmir, resessiya göstəricisi.",
    requiredInputs: [
      "operationalFact:rent_collected",
      "operationalFact:rent_billed",
    ],
    sortOrder: 340,
  },
  {
    code: "RE_OPEX_RATIO",
    nameEn: "Real Estate OpEx Ratio",
    nameAz: "Əmlak Əməliyyat Xərcləri Nisbəti",
    nameRu: "Доля OpEx (недвижимость)",
    category: "operational",
    industries: ["real_estate"],
    unit: "%",
    direction: "lower_better",
    formula: "opex / revenue * 100",
    thresholds: {
      green: { op: "<=", value: 30 },
      amber: { op: "<=", value: 50 },
      red: { op: ">", value: 50 },
    },
    hintTemplateEn:
      "OpEx {value}% of revenue. Commercial RE baseline 25-40% (property mgmt + utilities + tax). Above 50% cuts distributable cash flow.",
    hintTemplateRu:
      "OpEx {value}% от выручки. Коммерческая недвижимость baseline 25–40% (property mgmt + utilities + tax). Выше 50% — vacancy growing или maintenance unaddressed.",
    hintTemplateAz:
      "OpEx gəlirin {value}%-dir. Kommersiya daşınmaz əmlak baseline 25–40% (mülkiyyət idarəçiliyi + kommunal + vergi). 50%-dən yuxarı — boşluq artır və ya texniki xidmət həll edilməyib.",
    requiredInputs: ["budgetLine"],
    sortOrder: 350,
  },
];

// ─── Entertainment pack (4) ────────────────────────────────────────────────

export const entertainmentIndicators: IndicatorSeed[] = [
  {
    code: "ENT_ATTENDANCE_UTIL",
    nameEn: "Attendance Utilization",
    nameAz: "İştirak Dərəcəsi",
    nameRu: "Загруженность по посещениям",
    category: "operational",
    industries: ["entertainment"],
    unit: "%",
    direction: "higher_better",
    formula: "attendees / capacity * 100",
    thresholds: {
      green: { op: ">=", value: 70 },
      amber: { op: ">=", value: 50 },
      red: { op: "<", value: 50 },
    },
    hintTemplateEn:
      "Attendance utilization {value}%. Below 50% usually fails to cover fixed costs — pricing or marketing needs rework.",
    hintTemplateRu:
      "Утилизация посещений {value}%. Ниже 50% — обычно не покрывает фиксированные расходы; pricing или маркетинг misalignment.",
    hintTemplateAz:
      "İştirak utilizasiyası {value}%. 50%-dən aşağı — adətən sabit xərcləri ödəmir; qiymətləmə və ya marketinq yanlış uyğunlaşması.",
    requiredInputs: ["operationalFact:attendees", "operationalFact:capacity"],
    sortOrder: 410,
  },
  {
    code: "ENT_REVENUE_PER_VISIT",
    nameEn: "Revenue per Visit",
    nameAz: "Bir Səfərə Düşən Gəlir",
    nameRu: "Выручка с посещения",
    category: "operational",
    industries: ["entertainment"],
    unit: "AZN",
    direction: "higher_better",
    formula: "revenue / attendees",
    thresholds: {
      green: { op: ">=", value: 25 },
      amber: { op: ">=", value: 12 },
      red: { op: "<", value: 12 },
    },
    hintTemplateEn:
      "Revenue/visit = {value} AZN. Healthy venues drive ancillary revenue (F&B, merch) to 30-50% of total. Below 12 usually means the ancillary channel isn't working.",
    hintTemplateRu:
      "Выручка/визит = {value} AZN. Здоровые площадки выводят ancillary revenue (F&B, merch) до 30–50% общего.",
    hintTemplateAz:
      "Gəlir/ziyarət = {value} AZN. Sağlam məkanlar yardımçı gəlirləri (F&B, suvenir) ümuminin 30–50%-nə çıxarır.",
    requiredInputs: ["budgetLine", "operationalFact:attendees"],
    sortOrder: 420,
  },
  {
    code: "ENT_GROSS_MARGIN",
    nameEn: "Entertainment Gross Margin",
    nameAz: "Əyləncə Ümumi Marja",
    nameRu: "Валовая маржа развлечений",
    category: "operational",
    industries: ["entertainment"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 50 },
      amber: { op: ">=", value: 30 },
      red: { op: "<", value: 30 },
    },
    hintTemplateEn:
      "Gross margin {value}%. Entertainment operators run 50-65%; below 30% means costs-of-delivery (content, licensing, staff) are eating the ticket price.",
    hintTemplateRu:
      "Валовая маржа {value}%. Развлечения 50–65%; ниже 30% — costs-of-delivery (контент, площадка) выходят из-под контроля.",
    hintTemplateAz:
      "Ümumi mənfəət {value}%. Əyləncə 50–65%; 30%-dən aşağı — çatdırılma xərcləri (kontent, məkan) nəzarətdən çıxır.",
    requiredInputs: ["budgetLine"],
    sortOrder: 430,
  },
  {
    code: "ENT_SEASONALITY_CONCENTRATION",
    nameEn: "Seasonality Concentration (Top-3 Month Share)",
    nameAz: "Mövsümilik Konsentrasiyası",
    nameRu: "Сезонная концентрация",
    category: "operational",
    industries: ["entertainment"],
    unit: "%",
    direction: "lower_better",
    // The `revenueBySeason` sub-aggregation already returns the top-3
    // month share AS A PERCENTAGE (0..100), so the formula passes it
    // through unchanged. Multiplying by 100 again was a Phase-7.C-era
    // placeholder when the resolver returned a fraction; flipped to
    // identity when the actual sub-resolver landed.
    formula: "revenueBySeason",
    thresholds: {
      green: { op: "<=", value: 40 },
      amber: { op: "<=", value: 55 },
      red: { op: ">", value: 55 },
    },
    hintTemplateEn:
      "{value}% of revenue lands in the peak 3 months. Above 55% means a single bad season kills the year — diversify programming.",
    hintTemplateRu:
      "{value}% выручки в peak 3 месяца. Выше 55% — один плохой сезон убивает год; диверсифицируйте off-season offerings.",
    hintTemplateAz:
      "Gəlirin {value}%-i pik 3 ayda. 55%-dən yuxarı — bir pis mövsüm ili məhv edir; off-season təklifləri diversifikasiya edin.",
    requiredInputs: ["budgetLine.revenueBySeason"],
    sortOrder: 440,
  },
];

// ─── Education pack (4) ────────────────────────────────────────────────────

export const educationIndicators: IndicatorSeed[] = [
  {
    code: "EDU_ENROLLMENT_FILL",
    nameEn: "Enrollment Fill Rate",
    nameAz: "Qeydiyyat Dolgusu",
    nameRu: "Заполненность набора",
    category: "operational",
    industries: ["education"],
    unit: "%",
    direction: "higher_better",
    formula: "enrolled_students / target_enrollment * 100",
    thresholds: {
      green: { op: ">=", value: 95 },
      amber: { op: ">=", value: 80 },
      red: { op: "<", value: 80 },
    },
    hintTemplateEn:
      "Enrollment fill {value}%. Below 80% usually signals a pricing or reputation issue relative to competitors — fixed costs don't scale down.",
    hintTemplateRu:
      "Заполняемость зачисления {value}%. Ниже 80% — обычно сигнал pricing или репутации относительно конкурентов.",
    hintTemplateAz:
      "Qeydiyyat doluluğu {value}%. 80%-dən aşağı — adətən rəqiblərlə müqayisədə qiymətləmə və ya reputasiya siqnalıdır.",
    requiredInputs: [
      "operationalFact:enrolled_students",
      "operationalFact:target_enrollment",
    ],
    sortOrder: 510,
  },
  {
    code: "EDU_TUITION_COLLECTION",
    nameEn: "Tuition Collection Rate",
    nameAz: "Təhsil Haqqı Toplanma",
    nameRu: "Собираемость обучения",
    category: "operational",
    industries: ["education"],
    unit: "%",
    direction: "higher_better",
    formula: "tuition_collected / tuition_billed * 100",
    thresholds: {
      green: { op: ">=", value: 96 },
      amber: { op: ">=", value: 90 },
      red: { op: "<", value: 90 },
    },
    hintTemplateEn:
      "Tuition collection {value}%. Below 90% means arrears are building — tighten payment terms or risk cash-flow crunch.",
    hintTemplateRu:
      "Сбор обучения {value}%. Ниже 90% — задолженность растёт; ужесточите payment terms или risk cascade.",
    hintTemplateAz:
      "Təhsil haqqı yığımı {value}%. 90%-dən aşağı — borclar artır; ödəniş şərtlərini sərtləşdirin və ya risk kaskadı.",
    requiredInputs: [
      "operationalFact:tuition_collected",
      "operationalFact:tuition_billed",
    ],
    sortOrder: 520,
  },
  {
    code: "EDU_GROSS_MARGIN",
    nameEn: "Education Gross Margin",
    nameAz: "Təhsil Ümumi Marja",
    nameRu: "Валовая маржа образования",
    category: "operational",
    industries: ["education"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 40 },
      amber: { op: ">=", value: 20 },
      red: { op: "<", value: 20 },
    },
    hintTemplateEn:
      "Gross margin {value}%. Private education baselines 40-55%; below 20% means teacher cost + facility cost nearly equal tuition revenue.",
    hintTemplateRu:
      "Валовая маржа {value}%. Частное образование baseline 40–55%; ниже 20% — teacher cost + facility перевешивают tuition revenue.",
    hintTemplateAz:
      "Ümumi mənfəət {value}%. Özəl təhsil baseline 40–55%; 20%-dən aşağı — müəllim xərci + tikili təhsil haqqı gəlirini üstələyir.",
    requiredInputs: ["budgetLine"],
    sortOrder: 530,
  },
  {
    code: "EDU_STUDENT_TEACHER_RATIO",
    nameEn: "Student-Teacher Ratio",
    nameAz: "Tələbə/Müəllim Nisbəti",
    nameRu: "Соотношение студент/учитель",
    category: "operational",
    industries: ["education"],
    unit: "ratio",
    direction: "band",
    formula: "enrolled_students / teachers",
    thresholds: {
      green: { op: "between", value: [10, 20] },
      amber: { op: "between", value: [6, 25] },
      red: { op: ">", value: 25 },
    },
    hintTemplateEn:
      "Student-teacher ratio {value}. Sweet spot 10-20; above 25 erodes quality, 6-10 suggests over-staffing.",
    hintTemplateRu:
      "Соотношение студент-учитель {value}. Sweet spot 10–20; выше 25 эродирует качество, 6–10 — over-staffing.",
    hintTemplateAz:
      "Tələbə-müəllim nisbəti {value}. Sweet spot 10–20; 25-dən yuxarı keyfiyyəti aşır, 6–10 — həddən artıq personal.",
    requiredInputs: [
      "operationalFact:enrolled_students",
      "operationalFact:teachers",
    ],
    sortOrder: 540,
  },
];

// ─── Poultry pack (4) ──────────────────────────────────────────────────────

export const poultryIndicators: IndicatorSeed[] = [
  {
    code: "POULTRY_FCR",
    nameEn: "Feed Conversion Ratio",
    nameAz: "Yem Çevirmə Əmsalı",
    nameRu: "Коэффициент конверсии корма",
    category: "operational",
    industries: ["poultry"],
    unit: "ratio",
    direction: "lower_better",
    formula: "feed_consumed_kg / weight_gain_kg",
    thresholds: {
      green: { op: "<=", value: 1.7 },
      amber: { op: "<=", value: 1.9 },
      red: { op: ">", value: 1.9 },
    },
    hintTemplateEn:
      "FCR = {value}. Best-in-class 1.6-1.7; above 1.9 usually means feed formulation, water quality, or temperature management issues.",
    hintTemplateRu:
      "FCR = {value}. Best-in-class 1.6–1.7; выше 1.9 — обычно feed formulation, water quality или температура.",
    hintTemplateAz:
      "FCR = {value}. Best-in-class 1.6–1.7; 1.9-dən yuxarı — adətən yem formulyasiyası, su keyfiyyəti və ya temperatur.",
    requiredInputs: [
      "operationalFact:feed_consumed_kg",
      "operationalFact:weight_gain_kg",
    ],
    sortOrder: 610,
  },
  {
    code: "POULTRY_MORTALITY",
    nameEn: "Flock Mortality Rate",
    nameAz: "Sürünün Ölüm Dərəcəsi",
    nameRu: "Смертность птицы",
    category: "operational",
    industries: ["poultry"],
    unit: "%",
    direction: "lower_better",
    formula: "deaths / starting_flock * 100",
    thresholds: {
      green: { op: "<=", value: 4 },
      amber: { op: "<=", value: 7 },
      red: { op: ">", value: 7 },
    },
    hintTemplateEn:
      "Mortality {value}%. Target ≤4%; above 7% is a disease or environmental red flag — inspect ventilation, biosecurity, vaccination schedule.",
    hintTemplateRu:
      "Смертность {value}%. Цель ≤4%; выше 7% — болезнь или environmental red flag; проверяйте вентиляцию + биобезопасность.",
    hintTemplateAz:
      "Ölüm {value}%. Hədəf ≤4%; 7%-dən yuxarı — xəstəlik və ya ətraf-mühit qırmızı bayrağı; ventilyasiya + biotəhlükəsizliyi yoxlayın.",
    requiredInputs: [
      "operationalFact:deaths",
      "operationalFact:starting_flock",
    ],
    sortOrder: 620,
  },
  {
    code: "POULTRY_GROSS_MARGIN",
    nameEn: "Poultry Gross Margin",
    nameAz: "Quşçuluq Ümumi Marja",
    nameRu: "Валовая маржа птицеводства",
    category: "operational",
    industries: ["poultry"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 15 },
      amber: { op: ">=", value: 5 },
      red: { op: "<", value: 5 },
    },
    hintTemplateEn:
      "Gross margin {value}%. Poultry is thin-margin commodity (typical 12-20%); below 5% a feed-price spike turns the cycle to a loss.",
    hintTemplateRu:
      "Валовая маржа {value}%. Поултри — тонкомаржинальный коммодити (типично 12–20%); ниже 5% feed-price скачок флипает в loss.",
    hintTemplateAz:
      "Ümumi mənfəət {value}%. Quş əti incə-marjalı əmtəədir (tipik 12–20%); 5%-dən aşağı yem-qiymət sıçrayışı zərərə çevirir.",
    requiredInputs: ["budgetLine"],
    sortOrder: 630,
  },
  {
    code: "POULTRY_FEED_COST_SHARE",
    nameEn: "Feed Cost Share of COGS",
    nameAz: "Yemin Maya Dəyərdəki Payı",
    nameRu: "Доля корма в себестоимости",
    category: "commodity",
    industries: ["poultry"],
    unit: "%",
    direction: "band",
    formula: "feed_cost / cogs * 100",
    thresholds: {
      green: { op: "between", value: [58, 72] },
      amber: { op: "between", value: [50, 78] },
      red: { op: ">", value: 78 },
    },
    hintTemplateEn:
      "Feed is {value}% of COGS. Sweet spot 58-72%; above 78% means feed-price exposure is too high — hedge or forward-contract.",
    hintTemplateRu:
      "Feed = {value}% от COGS. Sweet spot 58–72%; выше 78% — feed-price exposure высокая, хеджируйте grain или закройте feed-mill.",
    hintTemplateAz:
      "Yem COGS-un {value}%-i. Sweet spot 58–72%; 78%-dən yuxarı — yem-qiymət riski yüksəkdir, dəni hedge edin və ya feed-mill bağlayın.",
    requiredInputs: ["budgetLine.feed_cost"],
    sortOrder: 640,
  },
];

// ─── Food Processing pack (4) ──────────────────────────────────────────────

export const foodProcessingIndicators: IndicatorSeed[] = [
  {
    code: "FP_YIELD_LOSS",
    nameEn: "Yield Loss Rate",
    nameAz: "Məhsuldarlıq Zayiatı",
    nameRu: "Потери выхода",
    category: "operational",
    industries: ["food_processing"],
    unit: "%",
    direction: "lower_better",
    formula: "(raw_input - finished_output) / raw_input * 100",
    thresholds: {
      green: { op: "<=", value: 6 },
      amber: { op: "<=", value: 10 },
      red: { op: ">", value: 10 },
    },
    hintTemplateEn:
      "Yield loss {value}%. Best-in-class 2-6%; above 10% means raw-material waste — inspect cutting, cooking, packaging lines.",
    hintTemplateRu:
      "Потеря выхода {value}%. Best-in-class 2–6%; выше 10% — отходы сырья; проверьте резку, варку, упаковку.",
    hintTemplateAz:
      "Çıxış itkisi {value}%. Best-in-class 2–6%; 10%-dən yuxarı — xammal tullantısı; kəsmə, bişirmə, qablaşdırma yoxlayın.",
    requiredInputs: [
      "operationalFact:raw_input",
      "operationalFact:finished_output",
    ],
    sortOrder: 710,
  },
  {
    code: "FP_GROSS_MARGIN",
    nameEn: "Food Processing Gross Margin",
    nameAz: "Qida Emalı Ümumi Marja",
    nameRu: "Валовая маржа пищепрома",
    category: "operational",
    industries: ["food_processing"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 25 },
      amber: { op: ">=", value: 12 },
      red: { op: "<", value: 12 },
    },
    hintTemplateEn:
      "Gross margin {value}%. Branded 30-40%, private-label 20-28%, commodity 10-18%. Below 12% means no pricing power.",
    hintTemplateRu:
      "Валовая маржа {value}%. Брендированный 30–40%, private-label 20–28%, commodity 10–18%. Ниже 12% — нет pricing power, продукт коммодити.",
    hintTemplateAz:
      "Ümumi mənfəət {value}%. Brendli 30–40%, private-label 20–28%, əmtəə 10–18%. 12%-dən aşağı — qiymətləmə gücü yoxdur, məhsul əmtəədir.",
    requiredInputs: ["budgetLine"],
    sortOrder: 720,
  },
  {
    code: "FP_INVENTORY_TURNS",
    nameEn: "Inventory Turnover",
    nameAz: "Anbar Dövriyyəsi",
    nameRu: "Оборот запасов",
    category: "operational",
    industries: ["food_processing"],
    unit: "turns/year",
    direction: "higher_better",
    formula: "cogs / inventory",
    thresholds: {
      green: { op: ">=", value: 12 },
      amber: { op: ">=", value: 8 },
      red: { op: "<", value: 8 },
    },
    hintTemplateEn:
      "Inventory turns = {value}/year. Perishable food targets 12-24; below 8 = spoilage risk.",
    hintTemplateRu:
      "Оборот инвентаря {value}/год. Скоропортящаяся еда target 12–24; ниже 8 = риск порчи.",
    hintTemplateAz:
      "Anbar dövriyyəsi {value}/il. Tezxarabolan qida hədəfi 12–24; 8-dən aşağı = xarablanma riski.",
    requiredInputs: ["budgetLine.inventory"],
    sortOrder: 730,
  },
  {
    code: "FP_OPEX_RATIO",
    nameEn: "Food Processing OpEx Ratio",
    nameAz: "Qida Emalı OpEx Payı",
    nameRu: "Доля OpEx (пищепром)",
    category: "operational",
    industries: ["food_processing"],
    unit: "%",
    direction: "lower_better",
    formula: "opex / revenue * 100",
    thresholds: {
      green: { op: "<=", value: 18 },
      amber: { op: "<=", value: 28 },
      red: { op: ">", value: 28 },
    },
    hintTemplateEn:
      "OpEx {value}% of revenue. Food processing runs 12-22%; above 28% is structurally heavy for the margin profile.",
    hintTemplateRu:
      "OpEx {value}% от выручки. Food processing 12–22%; выше 28% — структурно тяжело для маржи (логистика + стоимость холода).",
    hintTemplateAz:
      "OpEx gəlirin {value}%-dir. Qida emalı 12–22%; 28%-dən yuxarı — marja üçün strukturca ağır (logistika + soyuq saxlama).",
    requiredInputs: ["budgetLine"],
    sortOrder: 740,
  },
];

// ─── Beverage pack (2) ────────────────────────────────────────────────────
// Soft drinks, juice, beer, distilled spirits. Manufacturing-shape but
// thinner gross margins than branded food; SKU breadth + distribution
// concentration are the defining risks. Benchmarks: Statista Beverage
// Industry Report 2023, IWSR Drinks Market Analysis.

export const beverageIndicators: IndicatorSeed[] = [
  {
    code: "BEV_GROSS_MARGIN",
    nameEn: "Beverage Gross Margin",
    nameAz: "İçki Ümumi Marja",
    nameRu: "Валовая маржа напитков",
    category: "operational",
    industries: ["beverage"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    // Statista beverage composite spans 3 sub-segments: branded soft
    // drinks 50-60%, alcohol 35-50%, commodity (water/juice) 25-35%.
    // Phase 7.E hardening (Turn 10): thresholds re-calibrated to the
    // *lowest healthy floor* so a commodity-beverage company at 28% GM
    // reads green (normal for water/juice) instead of amber. Branded /
    // alcohol underperformers will still read green here — a sub-segment
    // split (BEV_GROSS_MARGIN_BRANDED, _COMMODITY, _ALCOHOL) is the next
    // calibration step but requires Phase 7.E sub-segment tagging on
    // Company.settings, deferred to a later turn.
    // Green ≥25 (every sub-segment can sustain), amber ≥15 (distress
    // band: below commodity floor with margin to operate), red <15
    // (no beverage sub-segment can sustain at this GM).
    thresholds: {
      green: { op: ">=", value: 25 },
      amber: { op: ">=", value: 15 },
      red: { op: "<", value: 15 },
    },
    hintTemplateEn:
      "Gross margin {value}%. Cross-segment floor: branded 50-60%, alcohol 35-50%, commodity 25-35%. Below 15% no sub-segment is sustainable; 15-25% verify against your sub-segment.",
    hintTemplateRu:
      "Валовая маржа {value}%. Cross-segment floor: брендированный 50–60%, alcohol 35–50%, commodity 25–35%. Ниже 20% — переключение на коммодити-сегмент.",
    hintTemplateAz:
      "Ümumi mənfəət {value}%. Cross-segment alt həddi: brendli 50–60%, alkoqol 35–50%, əmtəə 25–35%. 20%-dən aşağı — əmtəə-seqmentinə keçid.",
    requiredInputs: ["budgetLine"],
    sortOrder: 810,
  },
  {
    code: "BEV_OPEX_RATIO",
    nameEn: "Beverage OpEx Ratio",
    nameAz: "İçki Əməliyyat Xərcləri Nisbəti",
    nameRu: "Доля OpEx (напитки)",
    category: "operational",
    industries: ["beverage"],
    unit: "%",
    direction: "lower_better",
    formula: "opex / revenue * 100",
    // Beverage SG&A heavy on distribution + marketing. Statista: branded
    // 25-35%, distributor pure-play 15-22%. Green ≤25%, amber ≤35%, red >35%.
    thresholds: {
      green: { op: "<=", value: 25 },
      amber: { op: "<=", value: 35 },
      red: { op: ">", value: 35 },
    },
    hintTemplateEn:
      "OpEx {value}% of revenue. Beverage SG&A is distribution + marketing-heavy; above 35% means brand investment isn't translating to volume.",
    hintTemplateRu:
      "OpEx {value}% от выручки. Beverage SG&A — distribution + marketing-heavy; выше 35% — brand investment overshoots margin.",
    hintTemplateAz:
      "OpEx gəlirin {value}%-dir. Beverage SG&A — distribusiya + marketinq ağırlığı; 35%-dən yuxarı — brend investisiyası marjanı üstələyir.",
    requiredInputs: ["budgetLine"],
    sortOrder: 820,
  },
];

// ─── Retail pack (2) ──────────────────────────────────────────────────────
// Grocery, fashion, electronics, specialty stores. Inventory turn velocity
// + gross margin recovery (mark-down discipline) are the signal. Benchmark:
// Deloitte Global Powers of Retailing 2023, NRF retail composite.

export const retailIndicators: IndicatorSeed[] = [
  {
    code: "RETAIL_GROSS_MARGIN",
    nameEn: "Retail Gross Margin",
    nameAz: "Pərakəndə Ümumi Marja",
    nameRu: "Валовая маржа ретейла",
    category: "operational",
    industries: ["retail"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    // Deloitte composite: grocery 20-28%, fashion 45-55%, electronics 18-25%,
    // specialty 35-50%. Calibration favors mass-market mix (grocery +
    // electronics dominate AZ retail). Green ≥30%, amber ≥18%, red <18%.
    thresholds: {
      green: { op: ">=", value: 30 },
      amber: { op: ">=", value: 18 },
      red: { op: "<", value: 18 },
    },
    hintTemplateEn:
      "Gross margin {value}%. Grocery 20-28%, electronics 18-25%, fashion 45-55%, specialty 35-50%. Below 18% suggests pricing pressure or stale-inventory mark-downs.",
    hintTemplateRu:
      "Валовая маржа {value}%. Grocery 20–28%, electronics 18–25%, fashion 45–55%, specialty 35–50%. Ниже 12% — pricing pressure или mix shift.",
    hintTemplateAz:
      "Ümumi mənfəət {value}%. Grocery 20–28%, electronics 18–25%, moda 45–55%, specialty 35–50%. 12%-dən aşağı — qiymətləmə təzyiqi və ya miks dəyişikliyi.",
    requiredInputs: ["budgetLine"],
    sortOrder: 910,
  },
  {
    code: "RETAIL_INVENTORY_TURNS",
    nameEn: "Retail Inventory Turnover",
    nameAz: "Pərakəndə Anbar Dövriyyəsi",
    nameRu: "Оборот запасов (ретейл)",
    category: "operational",
    industries: ["retail"],
    unit: "turns/year",
    direction: "higher_better",
    formula: "cogs / inventory",
    // NRF retail composite spans 4 sub-segments: grocery 14-26 turns/yr
    // (perishable), electronics 6-12 (model cycles), fashion 4-8
    // (seasonal), specialty 3-6 (slow). Phase 7.E hardening (Turn 10):
    // thresholds re-calibrated to the *lowest healthy floor* so a
    // fashion or specialty retailer isn't false-redded for normal
    // sub-segment velocity. A sub-segment split is the next step but
    // requires sub-segment tagging on Company.settings, deferred.
    // Green ≥6 (electronics floor — every sub-segment except specialty
    // is healthy here), amber ≥3 (specialty floor + safety margin, also
    // catches fashion underperformance), red <3 (no retail sub-segment
    // can sustain at this turn velocity → stale inventory risk).
    // Functionally dormant until balance-sheet ingest lands — same
    // constraint as PHARMA_INVENTORY_DAYS.
    thresholds: {
      green: { op: ">=", value: 6 },
      amber: { op: ">=", value: 3 },
      red: { op: "<", value: 3 },
    },
    hintTemplateEn:
      "Inventory turns = {value}/year. Cross-segment floor: grocery 14-26, electronics 6-12, fashion 4-8, specialty 3-6. Below 3 no sub-segment is healthy; 3-6 verify against your sub-segment (specialty / slow-moving = OK, fashion = warning).",
    hintTemplateRu:
      "Оборот инвентаря {value}/год. Cross-segment floor: grocery 14–26, electronics 6–12, fashion 4–8, specialty 3–6. Ниже floor — обычно мёртвый запас.",
    hintTemplateAz:
      "Anbar dövriyyəsi {value}/il. Cross-segment alt həddi: grocery 14–26, electronics 6–12, moda 4–8, specialty 3–6. Alt həddən aşağı — adətən ölü ehtiyat.",
    requiredInputs: ["budgetLine.inventory"],
    sortOrder: 920,
  },
];

// ─── Logistics pack (2) ───────────────────────────────────────────────────
// Trucking, warehousing, freight forwarding, last-mile delivery. Asset
// utilisation + fuel cost share are the early signals. Benchmark: ATA
// Trucking Industry Report 2023, Armstrong & Associates 3PL composite.

export const logisticsIndicators: IndicatorSeed[] = [
  {
    code: "LOG_OPEX_RATIO",
    nameEn: "Logistics OpEx Ratio",
    nameAz: "Logistika Əməliyyat Xərcləri Nisbəti",
    nameRu: "Доля OpEx (логистика)",
    category: "operational",
    industries: ["logistics"],
    unit: "%",
    direction: "lower_better",
    formula: "opex / revenue * 100",
    // ATA composite: trucking 80-90% (driver pay + fuel + maintenance),
    // 3PL warehousing 70-85%, freight forwarding 75-88%. High-OpEx is
    // structural, not waste. Green ≤80%, amber ≤90%, red >90% (margin
    // gone). Note: industrial thresholds would false-red every logistics
    // company — separate pack is essential here.
    thresholds: {
      green: { op: "<=", value: 80 },
      amber: { op: "<=", value: 90 },
      red: { op: ">", value: 90 },
    },
    hintTemplateEn:
      "OpEx {value}% of revenue. Trucking + warehousing run 70-90% structurally (driver pay, fuel, fleet); above 90% means margin is gone.",
    hintTemplateRu:
      "OpEx {value}% от выручки. Trucking + warehousing структурно 70–90% (driver pay, fuel, fleet); выше 92% — fleet underutilized или fuel hedge missing.",
    hintTemplateAz:
      "OpEx gəlirin {value}%-dir. Trucking + warehousing strukturca 70–90% (sürücü əmək haqqı, yanacaq, parkomat); 92%-dən yuxarı — parkomat dolu deyil və ya yanacaq hedge yoxdur.",
    requiredInputs: ["budgetLine"],
    sortOrder: 1010,
  },
  {
    code: "LOG_GROSS_MARGIN",
    nameEn: "Logistics Gross Margin",
    nameAz: "Logistika Ümumi Marja",
    nameRu: "Валовая маржа (логистика)",
    category: "operational",
    industries: ["logistics"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    // Armstrong & Associates: 3PL gross margins 12-20% (commodity service),
    // freight forwarding 8-15% (broker model), specialty 18-25%. Green ≥15%,
    // amber ≥7%, red <7% (likely loss-making after corporate overhead).
    thresholds: {
      green: { op: ">=", value: 15 },
      amber: { op: ">=", value: 7 },
      red: { op: "<", value: 7 },
    },
    hintTemplateEn:
      "Gross margin {value}%. 3PL 12-20%, freight forwarding 8-15%, specialty 18-25%. Below 7% likely loss-making post-overhead.",
    hintTemplateRu:
      "Валовая маржа {value}%. 3PL 12–20%, freight forwarding 8–15%, specialty 18–25%. Ниже 7% — likely loss-making контракты.",
    hintTemplateAz:
      "Ümumi mənfəət {value}%. 3PL 12–20%, freight forwarding 8–15%, specialty 18–25%. 7%-dən aşağı — çox güman ki zərərli müqavilələr.",
    requiredInputs: ["budgetLine"],
    sortOrder: 1020,
  },
];

// ─── Construction pack (2) ────────────────────────────────────────────────
// General contracting, project-based revenue. Margin recognition risk
// (% complete, change-order disputes) + project concentration are the
// signals. Benchmark: ENR Top 400 Contractors composite, McGraw-Hill
// Construction Outlook.

export const constructionIndicators: IndicatorSeed[] = [
  {
    code: "CONSTR_GROSS_MARGIN",
    nameEn: "Construction Gross Margin",
    nameAz: "İnşaat Ümumi Marja",
    nameRu: "Валовая маржа (строительство)",
    category: "operational",
    industries: ["construction"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    // ENR Top 400: heavy civil 8-14%, building general 10-18%, specialty
    // trade 18-25%, residential 15-22%. Green ≥15%, amber ≥8%, red <8%
    // (likely margin-of-safety gone on cost overruns).
    thresholds: {
      green: { op: ">=", value: 15 },
      amber: { op: ">=", value: 8 },
      red: { op: "<", value: 8 },
    },
    hintTemplateEn:
      "Gross margin {value}%. Heavy civil 8-14%, building 10-18%, specialty 18-25%. Below 8% means cost overruns are eating contingency.",
    hintTemplateRu:
      "Валовая маржа {value}%. Heavy civil 8–14%, building 10–18%, specialty 18–25%. Ниже 8% — cost overruns или mispriced bids.",
    hintTemplateAz:
      "Ümumi mənfəət {value}%. Ağır mülki 8–14%, tikili 10–18%, ixtisaslaşmış 18–25%. 8%-dən aşağı — xərc aşımı və ya yanlış qiymətləndirilmiş təkliflər.",
    requiredInputs: ["budgetLine"],
    sortOrder: 1110,
  },
  {
    code: "CONSTR_OPEX_RATIO",
    nameEn: "Construction OpEx Ratio",
    nameAz: "İnşaat Əməliyyat Xərcləri Nisbəti",
    nameRu: "Доля OpEx (строительство)",
    category: "operational",
    industries: ["construction"],
    unit: "%",
    direction: "lower_better",
    formula: "opex / revenue * 100",
    // ENR composite: general contractors 4-8% SG&A, specialty trades
    // 6-12%. Construction OpEx is light (project-cost is in COGS).
    // Above 12% suggests overhead growing faster than backlog.
    thresholds: {
      green: { op: "<=", value: 6 },
      amber: { op: "<=", value: 10 },
      red: { op: ">", value: 10 },
    },
    hintTemplateEn:
      "OpEx {value}% of revenue. Construction SG&A is structurally light (4-12%); above 10% means overhead growing faster than project backlog.",
    hintTemplateRu:
      "OpEx {value}% от выручки. Construction SG&A структурно лёгкий (4–12%); выше 10% — overhead растёт быстрее backlog.",
    hintTemplateAz:
      "OpEx gəlirin {value}%-dir. Tikinti SG&A strukturca yüngüldür (4–12%); 10%-dən yuxarı — overhead backlog-dan tez artır.",
    requiredInputs: ["budgetLine"],
    sortOrder: 1120,
  },
];

/**
 * Codes that used to be in the seed but were retired (merged, renamed,
 * dropped). Every seed run deactivates their rows + purges IndicatorValue
 * history so any DB on an older seed version converges. Append-only.
 */
export const RETIRED_CODES: readonly string[] = [
  // 2026-04-24 — renamed to FX_IMPORTED_INPUT (wider industries) and
  // moved to crossSectorIndicators.
  "AGRO_FX_RISK",
  // 2026-04-24 — merged into FX_IMPORTED_INPUT (identical formula).
  "IND_IMPORTED_INPUT",
  // 2026-04-29 sub-27 cont'd Round-7 — architect Round-6 flagged: AZMADE
  // xlsx import doesn't tag `currencyCode` on BudgetLines (then 10169/10169
  // NULL), so the formula structurally returned 0% across all op-cos —
  // a fake green that would mislead demo.
  //
  // Phase 7.G Turn XXXIX (2026-05-05) — RETIRED PERMANENTLY (architectural
  // decision, not parser-fix-pending): IND_FX_INPUT_RISK is functionally
  // identical to the active `FX_IMPORTED_INPUT` cross-sector indicator
  // (same formula `imported_input_cost / total_input_cost * 100`, same
  // resolver path, same data shape). The only difference was the
  // industrial-pack thresholds (green<=30 / amber<=60 / red>60 vs
  // FX_IMPORTED_INPUT's stricter green<=25 / amber<=50 / red>50).
  // Re-enabling would clutter the industrial heatmap with two near-
  // duplicate indicators that always agree on the band — net negative
  // for users. The underlying data fix (BudgetLine.currencyCode tagging
  // via `import-azmade-budgets.ts` + AI-mapper /apply route) ships in
  // this same turn, but BENEFITS the active `FX_IMPORTED_INPUT`
  // indicator, not this retired one. Definition preserved above
  // (formula + thresholds) for institutional memory.
  "IND_FX_INPUT_RISK",
];

/**
 * All active indicator seeds, in the order they should be presented
 * (sortOrder respected per pack; packs run in this top-level order).
 */
export const ALL_INDICATOR_SEEDS: readonly IndicatorSeed[] = [
  ...hospitalityIndicators,
  ...agroIndicators,
  ...industrialIndicators,
  ...servicesIndicators,
  ...pharmaIndicators,
  ...realEstateIndicators,
  ...entertainmentIndicators,
  ...educationIndicators,
  ...poultryIndicators,
  ...foodProcessingIndicators,
  ...beverageIndicators,
  ...retailIndicators,
  ...logisticsIndicators,
  ...constructionIndicators,
  ...crossSectorIndicators,
];
