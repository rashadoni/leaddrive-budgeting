import type { IndicatorSeed } from "./types";


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
    weight: 1.4, // Core profitability
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
