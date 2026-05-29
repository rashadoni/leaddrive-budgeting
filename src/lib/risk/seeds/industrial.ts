import type { IndicatorSeed } from "./types";


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
    weight: 1.4, // Core profitability — highest composite weight
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
    weight: 1.4, // Core profitability — highest composite weight
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
    weight: 1.2, // Core operational efficiency
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
  // Earlier xlsx imports didn't tag `currencyCode` on BudgetLines, so
  // the formula structurally returned 0% across all op-cos — a fake
  // green that would mislead demo. Re-enable once imports populate
  // BudgetLine.currencyCode. Definition preserved here as a comment
  // block so a future contributor doesn't re-derive thresholds from
  // scratch:
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
