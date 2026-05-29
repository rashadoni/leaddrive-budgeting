import type { IndicatorSeed } from "./types";


// ─── Beverage pack (2) ────────────────────────────────────────────────────
// Soft drinks, juice, beer, distilled spirits. Manufacturing-shape but
// thinner gross margins than branded food; SKU breadth + distribution
// concentration are the defining risks. Benchmarks: Statista Beverage
// Industry Report 2023, IWSR Drinks Market Analysis.

export const beverageIndicators: IndicatorSeed[] = [
  {
    code: "BEV_GROSS_MARGIN",
    nameEn: "Beverage Gross Margin",
    nameAz: "İçki Ümumi Marja",
    nameRu: "Валовая маржа напитков",
    category: "operational",
    industries: ["beverage"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    // Statista beverage composite spans 3 sub-segments: branded soft
    // drinks 50-60%, alcohol 35-50%, commodity (water/juice) 25-35%.
    // Phase 7.E hardening (Turn 10): thresholds re-calibrated to the
    // *lowest healthy floor* so a commodity-beverage company at 28% GM
    // reads green (normal for water/juice) instead of amber. Branded /
    // alcohol underperformers will still read green here — a sub-segment
    // split (BEV_GROSS_MARGIN_BRANDED, _COMMODITY, _ALCOHOL) is the next
    // calibration step but requires Phase 7.E sub-segment tagging on
    // Company.settings, deferred to a later turn.
    // Green ≥25 (every sub-segment can sustain), amber ≥15 (distress
    // band: below commodity floor with margin to operate), red <15
    // (no beverage sub-segment can sustain at this GM).
    thresholds: {
      green: { op: ">=", value: 25 },
      amber: { op: ">=", value: 15 },
      red: { op: "<", value: 15 },
    },
    hintTemplateEn:
      "Gross margin {value}%. Cross-segment floor: branded 50-60%, alcohol 35-50%, commodity 25-35%. Below 15% no sub-segment is sustainable; 15-25% verify against your sub-segment.",
    hintTemplateRu:
      "Валовая маржа {value}%. Cross-segment floor: брендированный 50–60%, alcohol 35–50%, commodity 25–35%. Ниже 20% — переключение на коммодити-сегмент.",
    hintTemplateAz:
      "Ümumi mənfəət {value}%. Cross-segment alt həddi: brendli 50–60%, alkoqol 35–50%, əmtəə 25–35%. 20%-dən aşağı — əmtəə-seqmentinə keçid.",
    requiredInputs: ["budgetLine"],
    sortOrder: 810,
    weight: 1.4, // Core profitability
  },
  {
    code: "BEV_OPEX_RATIO",
    nameEn: "Beverage OpEx Ratio",
    nameAz: "İçki Əməliyyat Xərcləri Nisbəti",
    nameRu: "Доля OpEx (напитки)",
    category: "operational",
    industries: ["beverage"],
    unit: "%",
    direction: "lower_better",
    formula: "opex / revenue * 100",
    // Beverage SG&A heavy on distribution + marketing. Statista: branded
    // 25-35%, distributor pure-play 15-22%. Green ≤25%, amber ≤35%, red >35%.
    thresholds: {
      green: { op: "<=", value: 25 },
      amber: { op: "<=", value: 35 },
      red: { op: ">", value: 35 },
    },
    hintTemplateEn:
      "OpEx {value}% of revenue. Beverage SG&A is distribution + marketing-heavy; above 35% means brand investment isn't translating to volume.",
    hintTemplateRu:
      "OpEx {value}% от выручки. Beverage SG&A — distribution + marketing-heavy; выше 35% — brand investment overshoots margin.",
    hintTemplateAz:
      "OpEx gəlirin {value}%-dir. Beverage SG&A — distribusiya + marketinq ağırlığı; 35%-dən yuxarı — brend investisiyası marjanı üstələyir.",
    requiredInputs: ["budgetLine"],
    sortOrder: 820,
  },
];
