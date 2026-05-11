/**
 * Phase 7.H Feature 4 — ESG / Climate indicator seeds.
 *
 * 5 indicators added to the catalog:
 *   1. IND_CARBON_SCOPE_1 — direct emissions estimate (tCO2e/year)
 *   2. IND_CARBON_SCOPE_2 — purchased electricity emissions (tCO2e/year)
 *   3. IND_CARBON_SCOPE_3 — supply-chain emissions estimate (tCO2e/year)
 *   4. IND_ESG_COMPOSITE — 0-100 composite ESG score
 *   5. IND_GOV_CLIMATE_SCORE — Azerbaijan government climate readiness
 *      (macro context, same value all companies)
 *
 * For v1, formulas are heuristic placeholders that reference existing
 * `revenue` from the budgetLine resolver multiplied by a generic
 * emission factor. Real-world Scope 1/2/3 disclosure requires either
 * (a) per-company manual input via admin UI, OR (b) industry-specific
 * factor tables wired through a new resolver. Both deferred to v2 —
 * for now the indicators surface in the matrix as new columns and
 * land "unknown" until the formula resolves successfully.
 *
 * Cross-sector: applies to ALL industries (industries: []).
 * Category: "esg" — separates from operational/financial composite.
 */

import type { IndicatorSeed } from "./indicator-seeds"

// Generic emission factor (kgCO2e per AZN of revenue).
// V1 placeholder; v2 swaps for industry-specific table.
const GENERIC_FACTOR_KG_PER_AZN = 0.5

export const esgIndicators: IndicatorSeed[] = [
  {
    code: "IND_CARBON_SCOPE_1",
    nameEn: "Carbon emissions — Scope 1 (direct)",
    nameRu: "Углеродные выбросы — Scope 1 (прямые)",
    nameAz: "Karbon emissiyaları — Scope 1 (birbaşa)",
    category: "esg",
    industries: [], // cross-sector
    unit: "tCO2e",
    direction: "lower_better",
    // Estimate: revenue × factor / 1000 = tonnes. V2 will read industry-
    // specific factor from a resolver.
    formula: `revenue * ${GENERIC_FACTOR_KG_PER_AZN} / 1000`,
    thresholds: {
      green: { op: "<", value: 1000 },
      amber: { op: "<", value: 5000 },
      red: { op: ">=", value: 5000 },
    },
    hintTemplateEn:
      "Direct emissions estimate {value} tCO2e — {status}. ESTIMATE: revenue × generic factor; v2 uses industry-specific factor.",
    hintTemplateRu:
      "Прямые выбросы (оценка) {value} tCO2e — {status}. ОЦЕНКА: выручка × общий коэффициент; v2 использует коэффициент по отрасли.",
    hintTemplateAz:
      "Birbaşa emissiyalar (təxmin) {value} tCO2e — {status}. TƏXMİN: gəlir × ümumi əmsal; v2 sənaye əmsalı istifadə edir.",
    requiredInputs: ["budgetLine"],
    sortOrder: 900,
  },
  {
    code: "IND_CARBON_SCOPE_2",
    nameEn: "Carbon emissions — Scope 2 (purchased electricity)",
    nameRu: "Углеродные выбросы — Scope 2 (покупная энергия)",
    nameAz: "Karbon emissiyaları — Scope 2 (alınan elektrik)",
    category: "esg",
    industries: [],
    unit: "tCO2e",
    direction: "lower_better",
    // ~30% of Scope 1 as crude proxy (industry average ratio).
    formula: `revenue * ${GENERIC_FACTOR_KG_PER_AZN * 0.3} / 1000`,
    thresholds: {
      green: { op: "<", value: 300 },
      amber: { op: "<", value: 1500 },
      red: { op: ">=", value: 1500 },
    },
    hintTemplateEn:
      "Purchased electricity emissions estimate {value} tCO2e — {status}. ESTIMATE: ~30% of Scope 1.",
    hintTemplateRu:
      "Выбросы покупной энергии (оценка) {value} tCO2e — {status}. ОЦЕНКА: ~30% от Scope 1.",
    hintTemplateAz:
      "Alınan elektrikdən emissiyalar (təxmin) {value} tCO2e — {status}. TƏXMİN: Scope 1-in ~30%-i.",
    requiredInputs: ["budgetLine"],
    sortOrder: 901,
  },
  {
    code: "IND_CARBON_SCOPE_3",
    nameEn: "Carbon emissions — Scope 3 (supply chain)",
    nameRu: "Углеродные выбросы — Scope 3 (цепочка поставок)",
    nameAz: "Karbon emissiyaları — Scope 3 (təchizat zənciri)",
    category: "esg",
    industries: [],
    unit: "tCO2e",
    direction: "lower_better",
    // Scope 3 typically 5-10× Scope 1 for industrial; use 5× as conservative.
    formula: `revenue * ${GENERIC_FACTOR_KG_PER_AZN * 5} / 1000`,
    thresholds: {
      green: { op: "<", value: 5000 },
      amber: { op: "<", value: 25000 },
      red: { op: ">=", value: 25000 },
    },
    hintTemplateEn:
      "Supply-chain emissions estimate {value} tCO2e — {status}. ESTIMATE: ~5× Scope 1.",
    hintTemplateRu:
      "Выбросы цепочки поставок (оценка) {value} tCO2e — {status}. ОЦЕНКА: ~5× Scope 1.",
    hintTemplateAz:
      "Təchizat zənciri emissiyaları (təxmin) {value} tCO2e — {status}. TƏXMİN: Scope 1-in ~5 misli.",
    requiredInputs: ["budgetLine"],
    sortOrder: 902,
  },
  {
    code: "IND_ESG_COMPOSITE",
    nameEn: "ESG composite score",
    nameRu: "Композитный ESG-балл",
    nameAz: "ESG kompozit balı",
    category: "esg",
    industries: [],
    unit: "score",
    direction: "higher_better",
    // V1 placeholder: 100 - (scope1 / 100) clamped at 0..100. As Scope 1
    // grows, ESG score drops. Formula intentionally simple — v2 swaps for
    // weighted (E + S + G) sub-scores.
    formula: `100 - (revenue * ${GENERIC_FACTOR_KG_PER_AZN} / 100000)`,
    thresholds: {
      green: { op: ">=", value: 70 },
      amber: { op: ">=", value: 40 },
      red: { op: "<", value: 40 },
    },
    hintTemplateEn:
      "ESG composite {value}/100 — {status}. V1 PLACEHOLDER: derived from Scope 1 estimate; v2 will weight E + S + G separately.",
    hintTemplateRu:
      "ESG композит {value}/100 — {status}. V1 ЗАГЛУШКА: производная от оценки Scope 1; v2 будет взвешивать E + S + G раздельно.",
    hintTemplateAz:
      "ESG kompozit {value}/100 — {status}. V1 KEÇİCİ: Scope 1 təxminindən törəyir; v2 E + S + G ayrı çəkiləcək.",
    requiredInputs: ["budgetLine"],
    sortOrder: 903,
  },
  {
    code: "IND_GOV_CLIMATE_SCORE",
    nameEn: "Azerbaijan government climate readiness",
    nameRu: "Готовность Азербайджана к климатическим изменениям",
    nameAz: "Azərbaycan iqlim hazırlığı",
    category: "esg",
    industries: [],
    unit: "score",
    direction: "higher_better",
    // Macro indicator — same value for all companies. Static literal for
    // v1; v2 wires to AZ government open-data adapter.
    formula: "38",
    thresholds: {
      green: { op: ">=", value: 60 },
      amber: { op: ">=", value: 30 },
      red: { op: "<", value: 30 },
    },
    hintTemplateEn:
      "AZ government climate readiness {value}/100 — {status}. V1: static literal from public reports; v2 wires to live data feed.",
    hintTemplateRu:
      "Климатическая готовность Азербайджана {value}/100 — {status}. V1: статичное значение из публичных отчётов; v2 — живой фид.",
    hintTemplateAz:
      "Azərbaycanın iqlim hazırlığı {value}/100 — {status}. V1: ictimai hesabatlardan statik dəyər; v2 canlı feed.",
    requiredInputs: [],
    sortOrder: 904,
  },
]
