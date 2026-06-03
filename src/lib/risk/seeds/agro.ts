import type { IndicatorSeed } from "./types";


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
    aggregation: "snapshot", // index snapshot — latest, not mean
    sortOrder: 20,
    weight: 1.3, // FX / macro exposure — drought is an existential agro macro risk
  },
  {
    code: "AGRO_COMMODITY_VOL",
    // Market-wide commodity signal (same sugar-volatility value for every
    // company) — tag as macro so it's labelled a broadcast, not a per-company
    // computed value (smoke check 3 / signal-confidence = medium).
    defaultValueSource: "macro",
    nameEn: "Commodity Price Volatility",
    nameAz: "Əmtəə Qiymət Dəyişkənliyi",
    nameRu: "Волатильность цен на товар",
    category: "commodity",
    industries: ["agro_crops", "poultry", "food_processing"],
    unit: "%",
    direction: "lower_better",
    formula: "sugar_price_stdev_12m / sugar_price_mean_12m * 100",
    thresholds: {
      green: { op: "<=", value: 10 },
      amber: { op: "<=", value: 25 },
      red: { op: ">", value: 25 },
    },
    hintTemplateEn:
      "Trailing-12M sugar price volatility is {value}% (CV). Above 25% — consider forward contracts to lock refining margins.",
    hintTemplateRu:
      "Скользящая 12-месячная волатильность цены сахара {value}% (CV). Выше 25% — рассмотрите форвардные контракты для фиксации маржи переработки.",
    hintTemplateAz:
      "Sürüşkən 12-aylıq şəkər qiyməti volatilliyi {value}% (CV). 25%-dən yuxarı — emal marjasını bağlamaq üçün forvard müqavilələrini nəzərdən keçirin.",
    requiredInputs: ["commodityPrice:sugar_price_stdev_12m", "commodityPrice:sugar_price_mean_12m"],
    sortOrder: 40,
  },
  // ─ Phase 7.I — AzerSheker / sugar pilot. Five new agro indicators that
  //   move the terminal from "P&L mirror" to "true ops & external dashboard"
  //   for harvest-cycle businesses. Each declares its real-feed source so
  //   the recompute pipeline can wire it once the resolvers (weather +
  //   commodityPrice) land — until then they evaluate to `unknown` and the
  //   HeatMap shows the legitimate "?" instead of a synthetic placeholder.
  {
    code: "AGRO_YIELD_PER_HA",
    nameEn: "Direct-entry Yield per Hectare",
    nameAz: "Birbaşa daxil edilmiş Hektar başına Məhsuldarlıq",
    nameRu: "Прямой ввод урожайности (т/га)",
    category: "operational",
    industries: ["agro_crops"],
    unit: "t/ha",
    direction: "higher_better",
    // Distinct from AGRO_YIELD (which divides harvest_tons / area_hectares):
    // this seed accepts the directly-entered yield_per_ha OperationalFact,
    // used by clients who aggregate per-field externally and submit the
    // weighted average. Thresholds re-calibrated for sugarcane (vs the
    // generic AGRO_YIELD which is calibrated for wheat-style crops).
    formula: "yield_per_ha",
    thresholds: {
      green: { op: ">=", value: 60 },
      amber: { op: ">=", value: 40 },
      red: { op: "<", value: 40 },
    },
    hintTemplateEn:
      "Yield {value} t/ha — {status}. Sugarcane: target 60+ t/ha; below 40 signals irrigation or variety drift.",
    hintTemplateRu:
      "Урожайность {value} т/га — {status}. Тростник: цель 60+; ниже 40 — ирригация или сорт.",
    hintTemplateAz:
      "Məhsuldarlıq {value} t/ha — {status}. Qamış: hədəf 60+; 40-dan aşağı — suvarma və ya sort.",
    requiredInputs: ["operationalFact:yield_per_ha"],
    aggregation: "snapshot", // intensive ratio (t/ha) — latest, not mean
    sortOrder: 45,
    defaultValueSource: "disclosed",
  },
  {
    code: "AGRO_SUGAR_CONTENT",
    nameEn: "Sugar Content of Harvest",
    nameAz: "Məhsulda Şəkər Miqdarı",
    nameRu: "Содержание сахара в урожае",
    category: "operational",
    industries: ["agro_crops", "food_processing"],
    unit: "%",
    direction: "higher_better",
    formula: "sugar_content_pct",
    thresholds: {
      // Calibrated for cane: 14%+ green, 10–14% amber, <10% red. Beet uses higher
      // bands but conservative cane defaults serve the AzerSheker baseline.
      green: { op: ">=", value: 14 },
      amber: { op: ">=", value: 10 },
      red: { op: "<", value: 10 },
    },
    hintTemplateEn:
      "Sucrose content {value}% — {status}. Below 10% usually means late harvest, drought stress, or variety drift.",
    hintTemplateRu:
      "Содержание сахарозы {value}% — {status}. Ниже 10% обычно — поздняя уборка, засушливый стресс или дрейф сорта.",
    hintTemplateAz:
      "Saxaroza miqdarı {value}% — {status}. 10%-dən aşağı: gec biçim, quraqlıq stresi və ya sort dreyfi.",
    requiredInputs: ["operationalFact:sugar_content_pct"],
    aggregation: "snapshot", // % snapshot — latest, not mean
    sortOrder: 50,
    defaultValueSource: "disclosed",
  },
  {
    code: "AGRO_WATER_INTENSITY",
    nameEn: "Water Use Intensity",
    nameAz: "Su İstifadəsinin İntensivliyi",
    nameRu: "Водоёмкость",
    category: "operational",
    industries: ["agro_crops"],
    unit: "m³/ha",
    direction: "lower_better",
    formula: "water_use_m3_per_ha",
    thresholds: {
      // Sugarcane benchmarks: <12,000 efficient, 12-18k typical, >18k wasteful.
      green: { op: "<=", value: 12_000 },
      amber: { op: "<=", value: 18_000 },
      red: { op: ">", value: 18_000 },
    },
    hintTemplateEn:
      "Water use {value} m³/ha — {status}. Above 18,000 signals irrigation inefficiency (canal losses, poor scheduling).",
    hintTemplateRu:
      "Расход воды {value} м³/га — {status}. Выше 18 000 — неэффективная ирригация (потери в каналах, плохое расписание).",
    hintTemplateAz:
      "Su istifadəsi {value} m³/ha — {status}. 18 000-dən yuxarı: səmərəsiz suvarma (kanal itkiləri, zəif planlaşdırma).",
    requiredInputs: ["operationalFact:water_use_m3_per_ha"],
    aggregation: "snapshot", // intensive ratio (m³/ha) — latest, not mean
    sortOrder: 60,
    defaultValueSource: "disclosed",
  },
  {
    code: "AGRO_FERTILIZER_INTENSITY",
    nameEn: "Fertilizer Use Intensity",
    nameAz: "Gübrə İstifadəsinin İntensivliyi",
    nameRu: "Удобрениеёмкость",
    category: "operational",
    industries: ["agro_crops"],
    unit: "kg/ha",
    direction: "lower_better",
    formula: "fertilizer_kg_per_ha",
    thresholds: {
      // Lower-is-better but only when yield is held constant. Hard-line cane
      // defaults: ≤400 efficient, 400-800 typical, >800 may signal nutrient
      // mismanagement or N-leaching risk.
      green: { op: "<=", value: 400 },
      amber: { op: "<=", value: 800 },
      red: { op: ">", value: 800 },
    },
    hintTemplateEn:
      "Fertilizer {value} kg/ha — {status}. High values without yield gain → N-leaching risk + cost drag.",
    hintTemplateRu:
      "Удобрений {value} кг/га — {status}. Высокий расход без роста урожая — риск вымывания азота + лишние затраты.",
    hintTemplateAz:
      "Gübrə {value} kq/ha — {status}. Məhsuldarlıq artmadan yüksək — azot yuyulması riski + əlavə xərc.",
    requiredInputs: ["operationalFact:fertilizer_kg_per_ha"],
    aggregation: "snapshot", // intensive ratio (kg/ha) — latest, not mean
    sortOrder: 70,
    defaultValueSource: "disclosed",
  },
  {
    code: "AGRO_WEATHER_RAINFALL",
    nameEn: "Trailing 90-day Rainfall",
    nameAz: "Son 90 günün Yağıntısı",
    nameRu: "Осадки за последние 90 дней",
    category: "macro",
    industries: ["agro_crops"],
    unit: "mm",
    direction: "higher_better",
    // Formula uses bare variable name — `weatherResolver` exposes
    // `rainfall_mm_90d` to the formula context after looking up the
    // region-keyed IntelDataPoint via company.settings.region.
    formula: "rainfall_mm_90d",
    thresholds: {
      // Calibrated for the Azerbaijani sugar belt (Salyan/Imishli/Sabirabad),
      // where 90-day climatological norm in growing season is ~120-180mm.
      // <60mm = drought stress; 60-150 = normal; >150 = abundant.
      green: { op: ">=", value: 60 },
      amber: { op: ">=", value: 30 },
      red: { op: "<", value: 30 },
    },
    hintTemplateEn:
      "Trailing 90-day rainfall {value} mm — {status}. Below 30 mm in growing season indicates drought stress on cane.",
    hintTemplateRu:
      "Осадки за 90 дней {value} мм — {status}. Меньше 30 мм в вегетацию — засушливый стресс на тростнике.",
    hintTemplateAz:
      "Son 90 günün yağıntısı {value} mm — {status}. Vegetasiyada 30 mm-dən aşağı qamış üçün quraqlıq stresidir.",
    requiredInputs: ["weather:rainfall_mm_90d"],
    sortOrder: 80,
    defaultValueSource: "macro",
  },
  {
    code: "AGRO_SUGAR_PRICE_TREND",
    nameEn: "Sugar Price (vs 12M mean)",
    nameAz: "Şəkər Qiyməti (12 aylıq ortalama ilə müqayisədə)",
    nameRu: "Цена сахара (отклонение от 12-мес среднего)",
    category: "commodity",
    industries: ["agro_crops", "food_processing"],
    unit: "%",
    direction: "higher_better",
    // Formula uses bare variable names exposed by `commodityPriceResolver`:
    //   sugar_price_latest    = latest monthly close (USD/tonne)
    //   sugar_price_mean_12m  = trailing-12-month arithmetic mean
    formula: "(sugar_price_latest - sugar_price_mean_12m) / sugar_price_mean_12m * 100",
    thresholds: {
      // Above 12M mean = revenue tailwind. Below 10% drop = pricing-margin
      // risk for unhedged exposure. Symmetric bands per finance recommendation.
      green: { op: ">=", value: 0 },
      amber: { op: ">=", value: -10 },
      red: { op: "<", value: -10 },
    },
    hintTemplateEn:
      "Sugar price {value}% vs 12M mean — {status}. Below −10% suggests forward-contract a slice of next-quarter output.",
    hintTemplateRu:
      "Цена сахара {value}% от 12-мес среднего — {status}. Ниже −10% — стоит застраховать часть выпуска следующего квартала.",
    hintTemplateAz:
      "Şəkər qiyməti 12 aylıq ortalamadan {value}% — {status}. −10%-dən aşağı: növbəti rübün bir hissəsini forvard etmək.",
    requiredInputs: [
      "commodityPrice:sugar_price_latest",
      "commodityPrice:sugar_price_mean_12m",
    ],
    sortOrder: 90,
    defaultValueSource: "macro",
    weight: 1.3, // FX / macro exposure — commodity tailwind/headwind signal
  },
  // ─ Phase 7.I cane-grower/seller indicators (AzerSheker pilot, 2026-05-16).
  //   AzerSheker grows and sells sugarcane to external sugar mills — they
  //   do NOT process to refined sugar themselves. The economics are
  //   different from a vertically-integrated producer:
  //     - Logistics urgency (every 12h cut-to-mill = ~2% sucrose loss → less $/ton)
  //     - Buyer concentration risk (revenue from 1-2 sugar mills is normal)
  //     - Harvest plan execution (the only window to monetise the crop)
  //   These three operational indicators surface the drivers the existing
  //   yield / sugar-content / weather seeds can't capture.
  {
    code: "AGRO_CUT_TO_MILL",
    nameEn: "Cut-to-Mill Time",
    nameAz: "Kəsim → Zavod Müddəti",
    nameRu: "Срез → завод (часы)",
    category: "operational",
    industries: ["agro_crops"],
    unit: "hours",
    direction: "lower_better",
    formula: "cane_cut_to_mill_hours",
    thresholds: {
      // <24h excellent (sucrose nearly fully preserved); 24-48h acceptable
      // (industry-standard for mills with regional supply); >48h material
      // sucrose loss → buyer price penalty + reputational hit.
      green: { op: "<=", value: 24 },
      amber: { op: "<=", value: 48 },
      red: { op: ">", value: 48 },
    },
    hintTemplateEn:
      "Cut-to-mill {value}h — {status}. Sucrose drops ~2% per 12h post-cut; >48h means visible Brix loss at mill assay.",
    hintTemplateRu:
      "Срез → завод {value} ч — {status}. Сахароза падает ~2% за 12 ч; >48 ч — заметная потеря Brix при приёмке.",
    hintTemplateAz:
      "Kəsim → zavod {value} saat — {status}. Saxaroza hər 12 saatda ~2% azalır; >48 saat — zavod analizində Brix itkisi.",
    requiredInputs: ["operationalFact:cane_cut_to_mill_hours"],
    sortOrder: 95,
    defaultValueSource: "disclosed",
  },
  {
    code: "AGRO_BUYER_CONCENTRATION",
    nameEn: "Sugar-Mill Buyer Concentration",
    nameAz: "Şəkər Zavodu Alıcı Cəmləşməsi",
    nameRu: "Концентрация покупателей-заводов",
    category: "commercial",
    industries: ["agro_crops"],
    unit: "%",
    direction: "lower_better",
    formula: "cane_buyer_concentration_pct",
    thresholds: {
      // <40% = diversified (3+ buyers, AR risk distributed); 40-70% =
      // monitored (top buyer dominant but secondary buyers cushion); >70%
      // = critical (one mill's payment delay = company cash crisis).
      green: { op: "<=", value: 40 },
      amber: { op: "<=", value: 70 },
      red: { op: ">", value: 70 },
    },
    hintTemplateEn:
      "Top-buyer share {value}% — {status}. >70% means a single mill's 30-day delay creates immediate cash crisis. Diversify or hedge with payment-term contracts.",
    hintTemplateRu:
      "Доля топ-покупателя {value}% — {status}. >70% — задержка одним заводом на 30 дней = кассовый разрыв. Диверсифицировать или хеджировать условиями оплаты.",
    hintTemplateAz:
      "Əsas alıcının payı {value}% — {status}. >70%: bir zavodun 30 günlük gecikməsi = pul böhranı. Diversifikasiya və ya ödəniş şərtləri ilə hedcinq.",
    requiredInputs: ["operationalFact:cane_buyer_concentration_pct"],
    aggregation: "snapshot", // % concentration snapshot — latest, not mean
    sortOrder: 96,
    defaultValueSource: "disclosed",
  },
  {
    code: "AGRO_HARVEST_PROGRESS",
    nameEn: "Harvest Plan Completion",
    nameAz: "Yığım Planının İcrası",
    nameRu: "Выполнение плана уборки",
    category: "operational",
    industries: ["agro_crops"],
    unit: "%",
    direction: "higher_better",
    // Harvest progress must be read with `cane_harvest_season_progress`
    // as context — 30% complete mid-season is fine; 30% complete at
    // season end is critical. v1 thresholds calibrated for end-of-season
    // reading; v2 will dual-axis against season_progress.
    formula: "cane_hectares_harvested_pct",
    thresholds: {
      green: { op: ">=", value: 95 },
      amber: { op: ">=", value: 70 },
      red: { op: "<", value: 70 },
    },
    hintTemplateEn:
      "Harvest completion {value}% — {status}. <70% near season end means standing crop will degrade (Brix drops past peak); investigate labor/weather/equipment.",
    hintTemplateRu:
      "Выполнение уборки {value}% — {status}. <70% к концу сезона — несобранный тростник теряет Brix; проверить трудовые ресурсы / погоду / технику.",
    hintTemplateAz:
      "Yığım icrası {value}% — {status}. Sezon sonu <70% — yığılmayan qamış Brix-i itirir; işçi qüvvəsi / hava / texnika yoxlayın.",
    requiredInputs: ["operationalFact:cane_hectares_harvested_pct"],
    aggregation: "snapshot", // % progress snapshot — latest, not mean
    sortOrder: 97,
    defaultValueSource: "disclosed",
  },
  // ─ Phase 7.N — AzerSheker pilot "per ha" economics ───────────────────────
  // Three sister indicators anchored on `company.settings.hectaresPlanted`
  // so any agro company that has set that setting gets them for free.
  // Thresholds calibrated from AZSEKER-EDEN Q2-Q4 2026 actuals (4 000 ha).
  {
    code: "AGRO_REVENUE_PER_HA",
    nameEn: "Revenue per Hectare",
    nameAz: "Hektara düşən Gəlir",
    nameRu: "Выручка на гектар",
    category: "operational",
    industries: ["agro_crops"],
    unit: "AZN/ha",
    direction: "higher_better",
    formula: "revenue / hectares_planted",
    thresholds: {
      green: { op: ">=", value: 3000 },
      amber: { op: ">=", value: 1500 },
      red: { op: "<", value: 1500 },
    },
    hintTemplateEn:
      "Revenue {value} AZN/ha — {status}. Below 1 500 AZN/ha per quarter usually signals under-planted area or weak farmgate pricing.",
    hintTemplateRu:
      "Выручка {value} AZN/га — {status}. Ниже 1 500 AZN/га в квартал: либо незасеянная площадь, либо слабая закупочная цена.",
    hintTemplateAz:
      "Gəlir {value} AZN/ha — {status}. Rübdə 1 500 AZN/ha-dan aşağı: əkilməmiş sahə və ya zəif əkin qiyməti.",
    requiredInputs: ["budgetLine", "company.settings.hectaresPlanted"],
    sortOrder: 98,
  },
  {
    code: "AGRO_COST_PER_HA",
    nameEn: "Input Cost per Hectare",
    nameAz: "Hektara düşən Dəyər",
    nameRu: "Себестоимость на гектар",
    category: "operational",
    industries: ["agro_crops"],
    unit: "AZN/ha",
    direction: "lower_better",
    formula: "cogs / hectares_planted",
    thresholds: {
      green: { op: "<=", value: 2500 },
      amber: { op: "<=", value: 3500 },
      red: { op: ">", value: 3500 },
    },
    hintTemplateEn:
      "Input cost {value} AZN/ha — {status}. Above 3 500 AZN/ha per quarter means direct production costs are outpacing revenue; audit seed, labour, and irrigation spend.",
    hintTemplateRu:
      "Себестоимость {value} AZN/га — {status}. Выше 3 500 AZN/га в квартал — прямые затраты опережают выручку; проверьте семена, труд и орошение.",
    hintTemplateAz:
      "Dəyər {value} AZN/ha — {status}. Rübdə 3 500 AZN/ha-dan yuxarı — birbaşa xərclər gəliri üstəlir; toxum, əmək, suvarma xərclərini yoxlayın.",
    requiredInputs: ["budgetLine", "company.settings.hectaresPlanted"],
    sortOrder: 99,
  },
  {
    code: "AGRO_YIELD_EFFICIENCY",
    nameEn: "Gross Profit per Hectare",
    nameAz: "Hektara düşən Ümumi Mənfəət",
    nameRu: "Валовая прибыль на гектар",
    category: "operational",
    industries: ["agro_crops"],
    unit: "AZN/ha",
    direction: "higher_better",
    // Gross profit per ha = (revenue − cogs) / planted_ha.
    // A direct measure of how much economic value each hectare generates
    // after stripping direct production inputs. Named "yield_efficiency"
    // in the client request — the nearest single-number proxy for that
    // concept without requiring a separate yield benchmark input.
    formula: "gross_profit / hectares_planted",
    thresholds: {
      green: { op: ">=", value: 1000 },
      amber: { op: ">=", value: 500 },
      red: { op: "<", value: 500 },
    },
    hintTemplateEn:
      "Gross profit {value} AZN/ha — {status}. Below 500 AZN/ha per quarter the land generates insufficient margin to cover overhead and capital costs.",
    hintTemplateRu:
      "Валовая прибыль {value} AZN/га — {status}. Ниже 500 AZN/га в квартал — земля не покрывает накладные и капитальные расходы.",
    hintTemplateAz:
      "Ümumi mənfəət {value} AZN/ha — {status}. Rübdə 500 AZN/ha-dan aşağı — ərazi yük və kapital xərclərini ödəmək üçün kifayət qədər marja yaratmır.",
    requiredInputs: ["budgetLine", "company.settings.hectaresPlanted"],
    sortOrder: 100,
  },
];
