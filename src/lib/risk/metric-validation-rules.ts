/**
 * Phase 7.H F4.v2.3 — manual-input safety rails.
 *
 * Catalog of validation rules for every metric a non-engineer can enter
 * through `/budgeting/admin/data-entry`. Two streams feed off this:
 *
 *  - **OperationalFact** entry (13 KPIs across 7 sectors) — yields/
 *    occupancy/FCR/mortality/etc. that today have NO UI path and live
 *    only as direct-SQL inserts.
 *  - **IndicatorDisclosure** entry (4 ESG indicators) — manual override
 *    of the modeled-generic placeholder ESG values; when present, the
 *    recompute pipeline picks the disclosed value and stamps
 *    `valueSource: 'disclosed'` instead of `modeled_generic`.
 *
 * Each rule pins:
 *  - `unit` — single accepted unit string so a "kg" value doesn't get
 *    silently written into a "tonnes" slot
 *  - `min` / `max` — hard bounds (HTTP 400 on violation)
 *  - `warnMin` / `warnMax` — soft bounds (UI shows
 *    "обычно X–Y for this sector; уверены?" confirm-dialog before save)
 *  - `anomalyDeltaPct` — if a new value deviates from this metric's
 *    historical mean for the same company by more than this %, the UI
 *    requires a second confirm click. Defaults to 100% (i.e. 2×).
 *  - labels in EN/RU/AZ for the entry form
 *  - `sector` tag for grouping in the UI
 *
 * Pure module — no DB, no Prisma. Imported by API handlers (Zod refine)
 * and the admin UI (form schema). Tests at
 * `metric-validation-rules.test.ts` lock the catalog shape so a future
 * seed-author can't widen a bound by accident.
 */

export interface MetricValidationRule {
  /** Canonical metric key written into `OperationalFact.metric`. */
  metric: string;
  /** Single accepted unit (e.g. "tons", "%", "ratio"). */
  unit: string;
  /** Hard lower bound — HTTP 400 reject below this. */
  min: number;
  /** Hard upper bound — HTTP 400 reject above this. */
  max: number;
  /**
   * Soft lower bound — UI flags "обычно ≥ X" but still allows save
   * after explicit confirm. Optional; null = no soft floor.
   */
  warnMin?: number | null;
  /**
   * Soft upper bound — UI flags "обычно ≤ Y" but still allows save
   * after explicit confirm. Optional; null = no soft ceiling.
   */
  warnMax?: number | null;
  /**
   * Anomaly band as % deviation from historical mean. UI requires a
   * second confirm when |Δ| > this. Default 100% guards against
   * typo-magnitude errors (e.g. `25` entered when `2.5` was meant).
   */
  anomalyDeltaPct: number;
  /** Sector tag for UI tab grouping. */
  sector:
    | "agro"
    | "real_estate"
    | "entertainment"
    | "education"
    | "poultry"
    | "food_processing"
    | "hospitality"
    | "esg";
  /** Display labels for the entry form. */
  labelEn: string;
  labelRu: string;
  labelAz: string;
  /**
   * Optional one-line context shown next to the input ("typical range
   * for this sector"). Helps the client sanity-check before save.
   */
  hintEn?: string;
  hintRu?: string;
  hintAz?: string;
}

/**
 * Operational KPI rules — 13 metrics across 7 sectors. Values mirror
 * the indicators that today require manual data the system has no UI
 * to capture. Ranges sourced from public-domain sector benchmarks
 * (USDA agro yields, hotel-industry occupancy norms, World-Bank
 * education ratios, FAO poultry FCR norms, etc.).
 */
export const OPERATIONAL_METRIC_RULES: readonly MetricValidationRule[] = [
  // --- Agro -----------------------------------------------------------
  {
    metric: "harvest_tons",
    unit: "tons",
    min: 0,
    max: 1_000_000,
    warnMax: 100_000,
    anomalyDeltaPct: 100,
    sector: "agro",
    labelEn: "Harvest (tons)",
    labelRu: "Урожай (тонн)",
    labelAz: "Məhsul (ton)",
    hintEn: "Total tonnage harvested for the period.",
    hintRu: "Общий тоннаж урожая за период.",
    hintAz: "Dövr üzrə yığılmış ümumi ton miqdarı.",
  },
  {
    metric: "area_hectares",
    unit: "hectares",
    min: 0,
    max: 100_000,
    warnMax: 10_000,
    anomalyDeltaPct: 50,
    sector: "agro",
    labelEn: "Cultivated area (hectares)",
    labelRu: "Засеянная площадь (га)",
    labelAz: "Əkin sahəsi (ha)",
    hintEn: "Hectares under cultivation. Drives yield/ha (harvest_tons ÷ area).",
    hintRu: "Площадь под посевами в гектарах. Используется для расчёта урожайности.",
    hintAz: "Əkin altında olan hektar. Məhsuldarlığı hesablamaq üçün istifadə olunur.",
  },
  {
    metric: "drought_index",
    unit: "index",
    min: 0,
    max: 10,
    warnMax: 7,
    anomalyDeltaPct: 100,
    sector: "agro",
    labelEn: "Drought index (0-10)",
    labelRu: "Индекс засухи (0-10)",
    labelAz: "Quraqlıq indeksi (0-10)",
    hintEn: "0 = no drought, 10 = severe. Source: regional meteorological feed or expert estimate.",
    hintRu: "0 — нет засухи, 10 — экстремальная. Источник: метео-сводка или экспертная оценка.",
    hintAz: "0 = quraqlıq yox, 10 = ekstremal. Mənbə: meteoroloji məlumat və ya ekspert qiymət.",
  },
  {
    metric: "commodity_price",
    unit: "AZN/ton",
    min: 0,
    max: 100_000,
    warnMax: 10_000,
    anomalyDeltaPct: 50,
    sector: "agro",
    labelEn: "Commodity price (AZN/ton)",
    labelRu: "Цена сырья (AZN/тонна)",
    labelAz: "Xammal qiyməti (AZN/ton)",
    hintEn: "Market price for the period. Drives revenue-volatility indicator.",
    hintRu: "Рыночная цена за период. Используется в индикаторе волатильности выручки.",
    hintAz: "Dövr üzrə bazar qiyməti. Gəlir dəyişkənliyi göstəricisində istifadə olunur.",
  },
  // Phase 7.I — sugar/agro pilot metrics. Yield/water/fertilizer per hectare
  // metrics drive Azerşəkər's AGRO_YIELD_PER_HA / AGRO_WATER_INTENSITY /
  // AGRO_FERTILIZER_INTENSITY indicators. yield_per_ha is also computable
  // from (harvest_tons ÷ area_hectares) but direct-entry support lets clients
  // sum granular per-field external data outside the system and submit the
  // aggregate.
  {
    // hectares_planted: planted area for the current crop cycle. Distinct
    // from `area_hectares` (cultivated/yielding area — those may differ if
    // some fields were planted but not harvested due to flooding/disease).
    // Used for company.settings + dashboards, NOT a direct indicator driver.
    metric: "hectares_planted",
    unit: "hectares",
    min: 0,
    max: 200_000,
    warnMin: 1,
    warnMax: 20_000,
    anomalyDeltaPct: 30,
    sector: "agro",
    labelEn: "Hectares planted",
    labelRu: "Засеяно (га)",
    labelAz: "Əkilmiş (ha)",
    hintEn: "Planted area at start of cycle (vs area_hectares = effective cultivated).",
    hintRu: "Засеянная площадь в начале цикла (vs area_hectares = эффективно возделываемая).",
    hintAz: "Dövrün başında əkilmiş sahə (vs area_hectares = effektiv əkin sahəsi).",
  },
  {
    metric: "yield_per_ha",
    unit: "tons/ha",
    min: 0,
    max: 200,
    warnMin: 5,
    warnMax: 100,
    anomalyDeltaPct: 40,
    sector: "agro",
    labelEn: "Yield per hectare (tons/ha)",
    labelRu: "Урожайность на гектар (т/га)",
    labelAz: "Hektar başına məhsuldarlıq (ton/ha)",
    hintEn: "Tons harvested per hectare. Sugarcane: typical 50–80 t/ha; sugar beet: 40–70 t/ha; wheat: 3–7 t/ha.",
    hintRu: "Тонн с гектара. Сахарный тростник: обычно 50–80 т/га; сахарная свёкла: 40–70; пшеница: 3–7.",
    hintAz: "Hektar başına ton. Şəkər qamışı: adətən 50–80 t/ha; şəkər çuğunduru: 40–70; buğda: 3–7.",
  },
  {
    metric: "sugar_content_pct",
    unit: "%",
    min: 0,
    max: 25,
    warnMin: 8,
    warnMax: 20,
    anomalyDeltaPct: 30,
    sector: "agro",
    labelEn: "Sugar content (%)",
    labelRu: "Содержание сахара (%)",
    labelAz: "Şəkər miqdarı (%)",
    hintEn: "Sucrose content of harvested cane/beet. Sugarcane: 10–18%; sugar beet: 16–20%.",
    hintRu: "Содержание сахарозы в собранном тростнике/свёкле. Тростник: 10–18%; свёкла: 16–20%.",
    hintAz: "Yığılan qamış/çuğundurda saxaroza miqdarı. Qamış: 10–18%; çuğundur: 16–20%.",
  },
  {
    metric: "water_use_m3_per_ha",
    unit: "m³/ha",
    min: 0,
    max: 20_000,
    warnMin: 1_000,
    warnMax: 15_000,
    anomalyDeltaPct: 50,
    sector: "agro",
    labelEn: "Water use (m³/ha)",
    labelRu: "Расход воды (м³/га)",
    labelAz: "Su istifadəsi (m³/ha)",
    hintEn: "Irrigation water applied per hectare per growing cycle. Sugarcane: 12,000–18,000 m³/ha annually.",
    hintRu: "Объём поливной воды на гектар за вегетационный цикл. Тростник: 12 000–18 000 м³/га в год.",
    hintAz: "Vegetasiya dövrü ərzində hektar başına suvarma suyu. Qamış: 12 000–18 000 m³/ha.",
  },
  {
    metric: "fertilizer_kg_per_ha",
    unit: "kg/ha",
    min: 0,
    max: 2_000,
    warnMin: 50,
    warnMax: 1_000,
    anomalyDeltaPct: 50,
    sector: "agro",
    labelEn: "Fertilizer applied (kg/ha)",
    labelRu: "Внесённые удобрения (кг/га)",
    labelAz: "Tətbiq edilən gübrə (kq/ha)",
    hintEn: "NPK (or urea) per hectare per growing cycle. Cane: ~300–600 kg/ha; beet: ~150–300 kg/ha.",
    hintRu: "NPK или мочевина на гектар за вегетационный цикл. Тростник: ~300–600 кг/га; свёкла: ~150–300.",
    hintAz: "Vegetasiya dövrü ərzində hektar başına NPK / karbamid. Qamış: ~300–600 kq/ha.",
  },
  // Phase 7.I — cane-grower/seller business model (AzerSheker pilot,
  // 2026-05-16). Four metrics that turn the cane operation's actual
  // profit and risk levers into measurable cells: how fast the cut cane
  // reaches the mill (Brix preservation), how concentrated revenue is
  // across sugar-mill buyers, how the harvest is tracking against plan,
  // and where in the harvest season the company sits.
  {
    metric: "cane_cut_to_mill_hours",
    unit: "hours",
    min: 0,
    max: 240,
    warnMax: 48,
    anomalyDeltaPct: 50,
    sector: "agro",
    labelEn: "Cut-to-mill (hours)",
    labelRu: "Срез → завод (часы)",
    labelAz: "Kəsim → zavod (saat)",
    hintEn: "Average hours from cane cut to mill receipt. Sucrose drops ~2% per 12h after cutting. <24h excellent; 24–48h acceptable; >48h sugar loss is material.",
    hintRu: "Средние часы от среза до приёма заводом. Сахароза падает ~2% за каждые 12 ч. <24 ч — отлично; 24–48 ч — приемлемо; >48 ч — потери существенны.",
    hintAz: "Kəsimdən zavoda qəbula qədər orta saat. Saxaroza hər 12 saatda ~2% azalır. <24 saat — əla; 24–48 saat — qəbul edilə bilər; >48 saat — itki ciddi.",
  },
  {
    metric: "cane_buyer_concentration_pct",
    unit: "%",
    min: 0,
    max: 100,
    warnMax: 70,
    anomalyDeltaPct: 25,
    sector: "agro",
    labelEn: "Top-buyer revenue share (%)",
    labelRu: "Доля топ-покупателя (%)",
    labelAz: "Əsas alıcının payı (%)",
    hintEn: "% of cane revenue from the single largest sugar-mill buyer. >70% concentrates AR risk — one delayed payment = cash crisis.",
    hintRu: "% выручки от крупнейшего сахарного завода-покупателя. >70% — высокий риск дебиторки: задержка одним заводом = кассовый разрыв.",
    hintAz: "Ən böyük şəkər zavodu alıcısından gəlirin payı. >70% — debitor riski; bir zavodun gecikməsi = pul böhranı.",
  },
  {
    metric: "cane_hectares_harvested_pct",
    unit: "%",
    min: 0,
    max: 100,
    warnMin: 80,
    anomalyDeltaPct: 25,
    sector: "agro",
    labelEn: "Harvest plan completion (%)",
    labelRu: "Выполнение плана уборки (%)",
    labelAz: "Yığım planının icrası (%)",
    hintEn: "Hectares harvested ÷ planted × 100. Lagging values mid-season suggest weather or labor shortfall; <80% by season end is material loss.",
    hintRu: "Убрано ÷ засеяно × 100. Отставание в середине сезона = погода/трудовые ресурсы; <80% к концу сезона — существенные потери.",
    hintAz: "Yığılmış ÷ əkilmiş × 100. Sezon ortasında geri qalma — hava/işçi qüvvəsi problemi; sezon sonuna <80% — ciddi itki.",
  },
  {
    metric: "cane_harvest_season_progress",
    unit: "%",
    min: 0,
    max: 100,
    anomalyDeltaPct: 30,
    sector: "agro",
    labelEn: "Harvest season progress (%)",
    labelRu: "Прогресс сезона уборки (%)",
    labelAz: "Yığım sezonunun gedişi (%)",
    hintEn: "Where the calendar sits inside the harvest window (0 = season start; 100 = season end). Used to read 'harvest plan completion' in context — 30% complete at 80% through season is a problem; same at 20% is fine.",
    hintRu: "Где календарь внутри окна уборки (0 — старт сезона; 100 — конец). Контекст для «выполнения плана»: 30% выполнения при 80% сезона = проблема; то же при 20% сезона — норма.",
    hintAz: "Yığım pəncərəsi içində təqvim mövqeyi (0 — sezon başlanğıcı; 100 — sonu). «Plan icrası»nı şərhdə oxumaq üçün: sezonun 80%-də 30% icra — problem; 20%-də eyni — normal.",
  },

  // --- Real Estate -----------------------------------------------------
  {
    metric: "leased_area",
    unit: "m²",
    min: 0,
    max: 1_000_000,
    warnMax: 200_000,
    anomalyDeltaPct: 50,
    sector: "real_estate",
    labelEn: "Leased area (m²)",
    labelRu: "Сданная площадь (м²)",
    labelAz: "İcarəyə verilmiş sahə (m²)",
  },
  {
    metric: "total_area",
    unit: "m²",
    min: 0,
    max: 1_000_000,
    warnMax: 200_000,
    anomalyDeltaPct: 20,
    sector: "real_estate",
    labelEn: "Total leasable area (m²)",
    labelRu: "Общая арендуемая площадь (м²)",
    labelAz: "Ümumi icarələnə bilən sahə (m²)",
  },
  {
    metric: "rent_collected",
    unit: "AZN",
    min: 0,
    max: 100_000_000,
    warnMax: 10_000_000,
    anomalyDeltaPct: 50,
    sector: "real_estate",
    labelEn: "Rent collected (AZN)",
    labelRu: "Собранная аренда (AZN)",
    labelAz: "Yığılmış icarə (AZN)",
  },
  {
    metric: "rent_billed",
    unit: "AZN",
    min: 0,
    max: 100_000_000,
    warnMax: 10_000_000,
    anomalyDeltaPct: 50,
    sector: "real_estate",
    labelEn: "Rent billed (AZN)",
    labelRu: "Выставленная аренда (AZN)",
    labelAz: "Hesablanmış icarə (AZN)",
  },

  // --- Entertainment ---------------------------------------------------
  {
    metric: "attendees",
    unit: "count",
    min: 0,
    max: 10_000_000,
    warnMax: 1_000_000,
    anomalyDeltaPct: 100,
    sector: "entertainment",
    labelEn: "Attendees (count)",
    labelRu: "Посетители (количество)",
    labelAz: "Ziyarətçilər (say)",
  },
  {
    metric: "capacity",
    unit: "count",
    min: 0,
    max: 10_000_000,
    warnMax: 1_000_000,
    anomalyDeltaPct: 20,
    sector: "entertainment",
    labelEn: "Capacity (count)",
    labelRu: "Вместимость (количество)",
    labelAz: "Tutum (say)",
  },

  // --- Education -------------------------------------------------------
  {
    metric: "enrolled_students",
    unit: "count",
    min: 0,
    max: 100_000,
    warnMax: 10_000,
    anomalyDeltaPct: 30,
    sector: "education",
    labelEn: "Enrolled students",
    labelRu: "Зачисленных студентов",
    labelAz: "Qeydiyyatda olan tələbələr",
  },
  {
    metric: "target_enrollment",
    unit: "count",
    min: 0,
    max: 100_000,
    warnMax: 10_000,
    anomalyDeltaPct: 20,
    sector: "education",
    labelEn: "Target enrollment",
    labelRu: "Целевое зачисление",
    labelAz: "Hədəf qeydiyyat",
  },
  {
    metric: "tuition_collected",
    unit: "AZN",
    min: 0,
    max: 100_000_000,
    warnMax: 10_000_000,
    anomalyDeltaPct: 50,
    sector: "education",
    labelEn: "Tuition collected (AZN)",
    labelRu: "Собранная плата за обучение (AZN)",
    labelAz: "Yığılmış təhsil haqqı (AZN)",
  },
  {
    metric: "tuition_billed",
    unit: "AZN",
    min: 0,
    max: 100_000_000,
    warnMax: 10_000_000,
    anomalyDeltaPct: 50,
    sector: "education",
    labelEn: "Tuition billed (AZN)",
    labelRu: "Выставленная плата за обучение (AZN)",
    labelAz: "Hesablanmış təhsil haqqı (AZN)",
  },
  {
    metric: "teachers",
    unit: "count",
    min: 0,
    max: 10_000,
    warnMax: 1_000,
    anomalyDeltaPct: 20,
    sector: "education",
    labelEn: "Teachers (count)",
    labelRu: "Преподаватели (количество)",
    labelAz: "Müəllimlər (say)",
  },

  // --- Poultry ---------------------------------------------------------
  {
    metric: "feed_consumed_kg",
    unit: "kg",
    min: 0,
    max: 10_000_000,
    warnMax: 1_000_000,
    anomalyDeltaPct: 50,
    sector: "poultry",
    labelEn: "Feed consumed (kg)",
    labelRu: "Потреблено корма (кг)",
    labelAz: "İstifadə edilmiş yem (kq)",
  },
  {
    metric: "weight_gain_kg",
    unit: "kg",
    min: 0,
    max: 10_000_000,
    warnMax: 1_000_000,
    anomalyDeltaPct: 50,
    sector: "poultry",
    labelEn: "Weight gain (kg)",
    labelRu: "Прирост веса (кг)",
    labelAz: "Çəki artımı (kq)",
  },
  {
    metric: "deaths",
    unit: "count",
    min: 0,
    max: 1_000_000,
    warnMax: 100_000,
    anomalyDeltaPct: 100,
    sector: "poultry",
    labelEn: "Deaths (count)",
    labelRu: "Падёж (количество)",
    labelAz: "Tələfat (say)",
    hintEn: "Mortality count for the period. Drives mortality-rate indicator.",
    hintRu: "Падёж за период. Используется в индикаторе смертности.",
    hintAz: "Dövr üzrə tələfat. Tələfat dərəcəsi göstəricisində istifadə olunur.",
  },
  {
    metric: "starting_flock",
    unit: "count",
    min: 0,
    max: 10_000_000,
    warnMax: 1_000_000,
    anomalyDeltaPct: 20,
    sector: "poultry",
    labelEn: "Starting flock (count)",
    labelRu: "Начальное поголовье (количество)",
    labelAz: "Başlanğıc sürü (say)",
  },

  // --- Food processing -------------------------------------------------
  {
    metric: "raw_input",
    unit: "kg",
    min: 0,
    max: 100_000_000,
    warnMax: 10_000_000,
    anomalyDeltaPct: 50,
    sector: "food_processing",
    labelEn: "Raw input (kg)",
    labelRu: "Сырьё (кг)",
    labelAz: "Xammal (kq)",
  },
  {
    metric: "finished_output",
    unit: "kg",
    min: 0,
    max: 100_000_000,
    warnMax: 10_000_000,
    anomalyDeltaPct: 50,
    sector: "food_processing",
    labelEn: "Finished output (kg)",
    labelRu: "Готовая продукция (кг)",
    labelAz: "Hazır məhsul (kq)",
  },
  // Phase 7.I — sugar refining extraction efficiency. Driver for
  // AGRO_EXTRACTION_RATE indicator. Tracks: finished_sugar / raw_cane × 100.
  {
    metric: "extraction_rate_pct",
    unit: "%",
    min: 0,
    max: 100,
    warnMin: 50,
    warnMax: 95,
    anomalyDeltaPct: 20,
    sector: "food_processing",
    labelEn: "Extraction rate (%)",
    labelRu: "Выход переработки (%)",
    labelAz: "Çıxım dərəcəsi (%)",
    hintEn: "Sugar yield from raw input. Modern cane refineries: 85–92%; older beet processing: 75–85%.",
    hintRu: "Выход сахара из сырья. Современные заводы по тростнику: 85–92%; старые свеклосахарные: 75–85%.",
    hintAz: "Xammaldan şəkər çıxımı. Müasir qamış zavodları: 85–92%; köhnə çuğundur zavodları: 75–85%.",
  },
];

/**
 * ESG disclosure rules — 4 indicators where a company-reported actual
 * overrides the v2.1 modeled-generic placeholder. `indicatorCode` is
 * the IndicatorDefinition.code, not a free-form metric key — disclosure
 * is anchored to the indicator itself, not an arbitrary OperationalFact.
 */
export interface EsgDisclosureRule extends Omit<MetricValidationRule, "metric"> {
  /** Indicator code this disclosure overrides. */
  indicatorCode: string;
}

export const ESG_DISCLOSURE_RULES: readonly EsgDisclosureRule[] = [
  {
    indicatorCode: "IND_CARBON_SCOPE_1",
    unit: "tCO2e",
    min: 0,
    max: 10_000_000,
    warnMax: 100_000,
    anomalyDeltaPct: 50,
    sector: "esg",
    labelEn: "Scope 1 emissions (direct, tCO2e)",
    labelRu: "Выбросы Scope 1 (прямые, tCO2e)",
    labelAz: "Scope 1 emissiya (birbaşa, tCO2e)",
    hintEn: "Direct emissions from owned operations. Source: company sustainability report or CDP disclosure.",
    hintRu: "Прямые выбросы от собственных операций. Источник: отчёт об устойчивом развитии или CDP.",
    hintAz: "Öz əməliyyatlardan birbaşa emissiyalar. Mənbə: davamlılıq hesabatı və ya CDP.",
  },
  {
    indicatorCode: "IND_CARBON_SCOPE_2",
    unit: "tCO2e",
    min: 0,
    max: 10_000_000,
    warnMax: 50_000,
    anomalyDeltaPct: 50,
    sector: "esg",
    labelEn: "Scope 2 emissions (purchased energy, tCO2e)",
    labelRu: "Выбросы Scope 2 (покупная энергия, tCO2e)",
    labelAz: "Scope 2 emissiya (alınan enerji, tCO2e)",
    hintEn: "Indirect emissions from purchased electricity/heat. Source: utility bills × grid emission factor.",
    hintRu: "Косвенные выбросы от покупной электроэнергии/тепла. Источник: счета поставщиков × коэффициент сети.",
    hintAz: "Alınan elektrik/istilikdən dolayı emissiyalar. Mənbə: kommunal hesablar × şəbəkə əmsalı.",
  },
  {
    indicatorCode: "IND_CARBON_SCOPE_3",
    unit: "tCO2e",
    min: 0,
    max: 50_000_000,
    warnMax: 500_000,
    anomalyDeltaPct: 100,
    sector: "esg",
    labelEn: "Scope 3 emissions (supply chain, tCO2e)",
    labelRu: "Выбросы Scope 3 (цепочка поставок, tCO2e)",
    labelAz: "Scope 3 emissiya (təchizat zənciri, tCO2e)",
    hintEn: "Upstream & downstream value-chain emissions. Source: supplier surveys or sector spend-based estimate.",
    hintRu: "Выбросы цепочки поставок (входящие + исходящие). Источник: опросы поставщиков или secterная оценка.",
    hintAz: "Təchizat zənciri emissiyaları. Mənbə: təchizatçı sorğuları və ya sektor üzrə qiymət.",
  },
  {
    indicatorCode: "IND_ESG_COMPOSITE",
    unit: "score",
    min: 0,
    max: 100,
    warnMin: 20,
    warnMax: 95,
    anomalyDeltaPct: 30,
    sector: "esg",
    labelEn: "ESG composite score (0-100)",
    labelRu: "Композитный ESG-балл (0-100)",
    labelAz: "ESG kompozit balı (0-100)",
    hintEn: "External rating-agency score (MSCI / Sustainalytics / S&P Global) or internal weighted E+S+G.",
    hintRu: "Внешняя оценка рейтингового агентства (MSCI / Sustainalytics / S&P Global) или внутренняя взвешенная E+S+G.",
    hintAz: "Xarici reytinq agentliyinin balı və ya daxili E+S+G çəkili qiymət.",
  },
];

/**
 * Lookup by metric key — used by `POST /api/operational-facts` Zod
 * refine to validate the (metric, value, unit) triple in one shot.
 * Returns `null` for unknown metrics (caller should reject with 400 —
 * we don't want anonymous metric strings landing in the table).
 */
export function getOperationalRule(
  metric: string,
): MetricValidationRule | null {
  return OPERATIONAL_METRIC_RULES.find((r) => r.metric === metric) ?? null;
}

/**
 * Lookup by indicator code — used by
 * `POST /api/indicator-disclosures`. Only the 4 ESG indicators tagged
 * `modeled_generic` are eligible for disclosure override today; v2.4
 * adds more (industry-specific modeled cells).
 */
export function getEsgDisclosureRule(
  indicatorCode: string,
): EsgDisclosureRule | null {
  return (
    ESG_DISCLOSURE_RULES.find((r) => r.indicatorCode === indicatorCode) ?? null
  );
}

/**
 * Validation result for a single (rule, value, unit) check. The caller
 * decides what to do with the warnings — API rejects on `errors`,
 * surfaces `warnings` and `anomalyWarning` to the UI as a confirm-
 * required state. Anomaly check is opt-in: caller passes
 * `historicalMean` if available; absence = no anomaly check.
 */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Set when |value − historicalMean| / historicalMean > anomalyDeltaPct. */
  anomalyWarning: string | null;
}

/**
 * Validate a value against a rule. Returns ok=false on hard-bound
 * violation OR unit mismatch (both should reject the request).
 * Soft-bound violations + anomaly only populate the warnings/anomaly
 * fields; ok stays true so the UI can show "уверены?" rather than
 * blocking the entry.
 */
export function validateValue(
  rule: MetricValidationRule | EsgDisclosureRule,
  value: number,
  unit: string,
  historicalMean?: number,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let anomalyWarning: string | null = null;

  if (!Number.isFinite(value)) {
    errors.push("Value must be a finite number.");
  } else {
    if (value < rule.min) {
      errors.push(`Value ${value} is below the minimum (${rule.min}).`);
    }
    if (value > rule.max) {
      errors.push(`Value ${value} is above the maximum (${rule.max}).`);
    }
    if (rule.warnMin != null && value < rule.warnMin && value >= rule.min) {
      warnings.push(
        `Value ${value} is unusually low (typical floor: ${rule.warnMin}).`,
      );
    }
    if (rule.warnMax != null && value > rule.warnMax && value <= rule.max) {
      warnings.push(
        `Value ${value} is unusually high (typical ceiling: ${rule.warnMax}).`,
      );
    }
  }

  if (unit !== rule.unit) {
    errors.push(
      `Unit "${unit}" does not match expected unit "${rule.unit}".`,
    );
  }

  if (
    historicalMean != null &&
    Number.isFinite(historicalMean) &&
    historicalMean !== 0 &&
    Number.isFinite(value)
  ) {
    const deltaPct =
      (Math.abs(value - historicalMean) / Math.abs(historicalMean)) * 100;
    if (deltaPct > rule.anomalyDeltaPct) {
      anomalyWarning = `Value ${value} deviates ${deltaPct.toFixed(0)}% from this company's historical mean ${historicalMean.toFixed(2)} (anomaly threshold: ${rule.anomalyDeltaPct}%). Double-check before saving.`;
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    anomalyWarning,
  };
}

/** All operational metric keys (for UI grouping / dropdowns). */
export const OPERATIONAL_METRIC_KEYS: readonly string[] =
  OPERATIONAL_METRIC_RULES.map((r) => r.metric);

/** All ESG indicator codes eligible for disclosure override. */
export const ESG_DISCLOSABLE_INDICATOR_CODES: readonly string[] =
  ESG_DISCLOSURE_RULES.map((r) => r.indicatorCode);
