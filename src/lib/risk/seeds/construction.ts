import type { IndicatorSeed } from "./types";


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
    weight: 1.4, // Core profitability
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
