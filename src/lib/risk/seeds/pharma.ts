import type { IndicatorSeed } from "./types";


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
    weight: 1.4, // Core profitability
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
    weight: 1.4, // Core profitability
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
    // Phase 7.O — switched from "budgetLine.inventory" (dormant — no
    // accountType='asset' BudgetLine rows ever written) to
    // "balanceSheetLine.inventory" (reads BalanceSheetLine.companyId rows).
    requiredInputs: ["budgetLine.cogs", "balanceSheetLine.inventory"],
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
