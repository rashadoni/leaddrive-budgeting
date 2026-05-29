import type { IndicatorSeed } from "./types";


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
    weight: 1.3, // FX / macro exposure
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
