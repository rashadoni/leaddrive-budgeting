import type { IndicatorSeed } from "./types";


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
    weight: 1.4, // Core profitability
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
    // Phase 7.O — switched from "budgetLine.inventory" (dormant) to
    // "balanceSheetLine.inventory" (reads BalanceSheetLine.companyId rows).
    requiredInputs: ["budgetLine.cogs", "balanceSheetLine.inventory"],
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
  // ─ Phase 7.I — sugar refining extraction efficiency. Pairs with
  //   AGRO_SUGAR_CONTENT (cane side) — together they tell the whole
  //   field-to-warehouse value chain story for AzerSheker's AZSF + CPC.
  {
    code: "FP_EXTRACTION_RATE",
    nameEn: "Extraction / Recovery Rate",
    nameAz: "Çıxım / Bərpa Dərəcəsi",
    nameRu: "Выход переработки",
    category: "operational",
    industries: ["food_processing"],
    unit: "%",
    direction: "higher_better",
    formula: "extraction_rate_pct",
    thresholds: {
      // Cane refining: modern plants 85–92%, older 75–85%. Baseline for
      // AZSF/CPC. Sub-75% is industrial-red.
      green: { op: ">=", value: 85 },
      amber: { op: ">=", value: 75 },
      red: { op: "<", value: 75 },
    },
    hintTemplateEn:
      "Extraction rate {value}% — {status}. Below 75% signals juice loss in mills, bagasse moisture too high, or evaporator scale.",
    hintTemplateRu:
      "Выход {value}% — {status}. Меньше 75% — потери сока на мельницах, влажность жома, накипь в выпарных.",
    hintTemplateAz:
      "Çıxım {value}% — {status}. 75%-dən aşağı: dəyirmanda şirə itkisi, baqas nəmlik, evaporatorda təbəqə.",
    requiredInputs: ["operationalFact:extraction_rate_pct"],
    sortOrder: 750,
    defaultValueSource: "disclosed",
  },
];
