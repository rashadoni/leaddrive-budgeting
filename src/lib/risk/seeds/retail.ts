import type { IndicatorSeed } from "./types";


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
    weight: 1.4, // Core profitability
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
    // Phase 7.O — switched from "budgetLine.inventory" (dormant) to
    // "balanceSheetLine.inventory" (reads BalanceSheetLine.companyId rows).
    requiredInputs: ["budgetLine.cogs", "balanceSheetLine.inventory"],
    sortOrder: 920,
  },
];
