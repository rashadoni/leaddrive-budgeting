import type { IndicatorSeed } from "./types";


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
    weight: 1.4, // Core profitability
  },
];
