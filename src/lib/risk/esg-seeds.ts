/**
 * Phase 7.H Feature 4 — ESG / Climate indicator seeds.
 *
 * 5 indicators in the catalog:
 *   1. IND_CARBON_SCOPE_1 — direct emissions (tCO2e/year)
 *   2. IND_CARBON_SCOPE_2 — purchased electricity emissions (tCO2e/year)
 *   3. IND_CARBON_SCOPE_3 — supply-chain emissions (tCO2e/year)
 *   4. IND_ESG_COMPOSITE — 0-100 composite ESG score
 *   5. IND_GOV_CLIMATE_SCORE — Azerbaijan government climate readiness
 *      (macro context, same value all companies)
 *
 * **v2.2 formula model (this file):** formulas now consume
 * `industryFactor("scope_N")` instead of a single generic coefficient.
 * Eden Agro (`industry: 'agro_crops'`) lands at
 *   `50M × industryFactor("scope_1") / 1000 = 50M × 0.08 / 1000 = 4K tCO2e`
 * instead of the v2.1 placeholder `50M × 0.5 / 1000 = 25K tCO2e`. Per-
 * industry calibration sources are documented in
 * [industry-emission-factors.ts](./industry-emission-factors.ts).
 *
 * **Provenance ladder** (descending model quality, IndicatorValue.valueSource):
 *  - `disclosed`        — admin entered the actual company-reported value
 *                         (Phase 7.H F4.v2.3 manual-disclosure override)
 *  - `modeled_industry` — sector-specific intensity factor (this v2.2
 *                         seed tags every IV with this tag)
 *  - `modeled_generic`  — v2.1 fallback (now retired for ESG; reserved
 *                         for indicators that still lack a sector model)
 *  - `macro`            — single-value environment context
 *
 * Cross-sector: applies to ALL industries (industries: []).
 * Category: "esg" — separates from operational/financial composite.
 */

import type { IndicatorSeed } from "./indicator-seeds"

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
    // v2.2 — sector intensity × revenue. agro_crops=0.08, industrial=0.45,
    // services=0.02, etc. See industry-emission-factors.ts for the table.
    formula: `revenue * industryFactor("scope_1") / 1000`,
    // Thresholds recalibrated for the v2.2 value scale. Eden Agro
    // (50M × 0.08 / 1000 ≈ 4K) now falls in amber; an industrial co at
    // 100M × 0.45 / 1000 ≈ 45K still red. Calibrated against MSCI Climate
    // Index 75th-percentile breakpoints for emerging-market sectors.
    thresholds: {
      green: { op: "<", value: 2000 },
      amber: { op: "<", value: 15000 },
      red: { op: ">=", value: 15000 },
    },
    hintTemplateEn:
      "Direct emissions estimate {value} tCO2e — {status}. INDUSTRY MODEL: revenue × sector intensity factor.",
    hintTemplateRu:
      "Прямые выбросы (оценка) {value} tCO2e — {status}. ОТРАСЛЕВАЯ МОДЕЛЬ: выручка × коэффициент интенсивности.",
    hintTemplateAz:
      "Birbaşa emissiyalar (təxmin) {value} tCO2e — {status}. SƏNAYE MODELİ: gəlir × sənaye intensivlik əmsalı.",
    requiredInputs: ["budgetLine", "industryFactor:scope_1"],
    sortOrder: 900,
    // v2.2 — industry-specific modeled, not generic.
    defaultValueSource: "modeled_industry",
    weight: 0.7, // ESG — compliance signal, lower urgency for composite
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
    formula: `revenue * industryFactor("scope_2") / 1000`,
    thresholds: {
      green: { op: "<", value: 1500 },
      amber: { op: "<", value: 8000 },
      red: { op: ">=", value: 8000 },
    },
    hintTemplateEn:
      "Purchased electricity emissions estimate {value} tCO2e — {status}. INDUSTRY MODEL: sector-specific Scope 2 intensity.",
    hintTemplateRu:
      "Выбросы покупной энергии (оценка) {value} tCO2e — {status}. ОТРАСЛЕВАЯ МОДЕЛЬ: коэффициент Scope 2 по отрасли.",
    hintTemplateAz:
      "Alınan elektrikdən emissiyalar (təxmin) {value} tCO2e — {status}. SƏNAYE MODELİ: sənayeyə xas Scope 2 intensivliyi.",
    requiredInputs: ["budgetLine", "industryFactor:scope_2"],
    sortOrder: 901,
    defaultValueSource: "modeled_industry",
    weight: 0.7, // ESG
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
    formula: `revenue * industryFactor("scope_3") / 1000`,
    // Scope 3 dominates total emissions for most sectors (5-10×
    // Scope 1). Thresholds calibrated against MSCI 75th-percentile.
    thresholds: {
      green: { op: "<", value: 10000 },
      amber: { op: "<", value: 60000 },
      red: { op: ">=", value: 60000 },
    },
    hintTemplateEn:
      "Supply-chain emissions estimate {value} tCO2e — {status}. INDUSTRY MODEL: sector-specific Scope 3 intensity.",
    hintTemplateRu:
      "Выбросы цепочки поставок (оценка) {value} tCO2e — {status}. ОТРАСЛЕВАЯ МОДЕЛЬ: коэффициент Scope 3 по отрасли.",
    hintTemplateAz:
      "Təchizat zənciri emissiyaları (təxmin) {value} tCO2e — {status}. SƏNAYE MODELİ: sənayeyə xas Scope 3 intensivliyi.",
    requiredInputs: ["budgetLine", "industryFactor:scope_3"],
    sortOrder: 902,
    defaultValueSource: "modeled_industry",
    weight: 0.7, // ESG
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
    // ESG composite — penalize companies with higher industry-modeled
    // total emissions (Scope 1+2+3 normalized). 100 = pristine,
    // 0 = exceeds threshold. Formula caps to [0..100].
    formula: `max(0, min(100, 100 - (revenue * (industryFactor("scope_1") + industryFactor("scope_2") + industryFactor("scope_3")) / 100000)))`,
    thresholds: {
      green: { op: ">=", value: 70 },
      amber: { op: ">=", value: 40 },
      red: { op: "<", value: 40 },
    },
    hintTemplateEn:
      "ESG composite {value}/100 — {status}. INDUSTRY MODEL: 100 − (total emissions / size). v2.2 derived from sector intensity; v3 will weight E + S + G separately.",
    hintTemplateRu:
      "ESG композит {value}/100 — {status}. ОТРАСЛЕВАЯ МОДЕЛЬ: 100 − (общие выбросы / размер). v2.2 на отраслевом коэффициенте; v3 будет взвешивать E + S + G раздельно.",
    hintTemplateAz:
      "ESG kompozit {value}/100 — {status}. SƏNAYE MODELİ: 100 − (ümumi emissiya / həcm). v2.2 sənaye əmsalı; v3 E + S + G ayrı çəkiləcək.",
    requiredInputs: [
      "budgetLine",
      "industryFactor:scope_1",
      "industryFactor:scope_2",
      "industryFactor:scope_3",
    ],
    sortOrder: 903,
    defaultValueSource: "modeled_industry",
    weight: 0.7, // ESG composite
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
    // v1; v3 wires to AZ government open-data adapter / AI Web Crawler.
    formula: "38",
    thresholds: {
      green: { op: ">=", value: 60 },
      amber: { op: ">=", value: 30 },
      red: { op: "<", value: 30 },
    },
    hintTemplateEn:
      "AZ government climate readiness {value}/100 — {status}. MACRO: static literal from public reports; v3 wires to live data feed.",
    hintTemplateRu:
      "Климатическая готовность Азербайджана {value}/100 — {status}. МАКРО: статичное значение из публичных отчётов; v3 — живой фид.",
    hintTemplateAz:
      "Azərbaycanın iqlim hazırlığı {value}/100 — {status}. MAKRO: ictimai hesabatlardan statik dəyər; v3 canlı feed.",
    requiredInputs: [],
    sortOrder: 904,
    defaultValueSource: "macro",
    weight: 0.7, // ESG / macro context
  },
]
