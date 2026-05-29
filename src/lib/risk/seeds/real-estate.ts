import type { IndicatorSeed } from "./types";


// ─── Real Estate pack (5) ──────────────────────────────────────────────────

export const realEstateIndicators: IndicatorSeed[] = [
  {
    code: "RE_GROSS_MARGIN",
    nameEn: "Real Estate NOI Margin",
    nameAz: "Əmlak NOI Marja",
    nameRu: "Маржа NOI недвижимости",
    category: "operational",
    industries: ["real_estate"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 65 },
      amber: { op: ">=", value: 45 },
      red: { op: "<", value: 45 },
    },
    hintTemplateEn:
      "NOI margin {value}%. Commercial real estate baseline 65-85%; below 45% signals high operating expenses (utilities, property tax, maintenance) relative to rent.",
    hintTemplateRu:
      "NOI margin {value}%. Коммерческая недвижимость baseline 65–85%; ниже 45% — высокие операционные расходы или ослабление аренды.",
    hintTemplateAz:
      "NOI marja {value}%. Kommersiya daşınmaz əmlak baseline 65–85%; 45%-dən aşağı — yüksək əməliyyat xərcləri və ya icarənin zəifləməsi.",
    requiredInputs: ["budgetLine"],
    sortOrder: 310,
    weight: 1.4, // Core profitability
  },
  {
    code: "RE_OCCUPANCY",
    nameEn: "Occupancy Rate",
    nameAz: "Doluluq Dərəcəsi",
    nameRu: "Уровень занятости",
    category: "operational",
    industries: ["real_estate"],
    unit: "%",
    direction: "higher_better",
    formula: "leased_area / total_area * 100",
    thresholds: {
      green: { op: ">=", value: 90 },
      amber: { op: ">=", value: 75 },
      red: { op: "<", value: 75 },
    },
    hintTemplateEn:
      "Occupancy {value}%. Stabilised commercial assets run 90%+; below 75% usually means pricing or product-market fit problem.",
    hintTemplateRu:
      "Заполняемость {value}%. Стабилизированные коммерческие активы 90%+; ниже 75% — проблемы pricing или продукта.",
    hintTemplateAz:
      "Doluluq {value}%. Sabitləşmiş kommersiya aktivlər 90%+; 75%-dən aşağı — qiymətləmə və ya məhsul problemləri.",
    requiredInputs: [
      "operationalFact:leased_area",
      "operationalFact:total_area",
    ],
    sortOrder: 320,
  },
  {
    code: "RE_DEBT_SERVICE_COVERAGE",
    nameEn: "Debt Service Coverage (DSCR)",
    nameAz: "Borc Xidmət Əhatə Əmsalı",
    nameRu: "Покрытие долга (DSCR)",
    category: "operational",
    industries: ["real_estate"],
    unit: "ratio",
    direction: "higher_better",
    formula: "gross_profit / debt_service",
    thresholds: {
      green: { op: ">=", value: 1.35 },
      amber: { op: ">=", value: 1.15 },
      red: { op: "<", value: 1.15 },
    },
    hintTemplateEn:
      "DSCR {value}. Below 1.15 means NOI barely covers interest + principal — any rent drop triggers default risk.",
    hintTemplateRu:
      "DSCR {value}. Ниже 1.15 — NOI едва покрывает проценты + principal; любое падение аренды триггерит default.",
    hintTemplateAz:
      "DSCR {value}. 1.15-dən aşağı — NOI faizləri + əsas borcu çətinliklə örtür; istənilən icarə azalması default-u tetikləyir.",
    requiredInputs: ["budgetLine.debt_service"],
    sortOrder: 330,
    weight: 1.5, // Liquidity / debt coverage — highest tier
  },
  {
    code: "RE_RENT_COLLECTION",
    nameEn: "Rent Collection Rate",
    nameAz: "İcarə Toplanma Dərəcəsi",
    nameRu: "Доля собранной аренды",
    category: "operational",
    industries: ["real_estate"],
    unit: "%",
    direction: "higher_better",
    formula: "rent_collected / rent_billed * 100",
    thresholds: {
      green: { op: ">=", value: 98 },
      amber: { op: ">=", value: 92 },
      red: { op: "<", value: 92 },
    },
    hintTemplateEn:
      "Rent collection {value}%. Commercial target 98%+; below 92% means tenants can't pay — recession indicator.",
    hintTemplateRu:
      "Сбор аренды {value}%. Коммерческий target 98%+; ниже 92% — tenants не платят, индикатор рецессии.",
    hintTemplateAz:
      "İcarə yığımı {value}%. Kommersiya hədəfi 98%+; 92%-dən aşağı — kirayəçilər ödəyə bilmir, resessiya göstəricisi.",
    requiredInputs: [
      "operationalFact:rent_collected",
      "operationalFact:rent_billed",
    ],
    sortOrder: 340,
  },
  {
    code: "RE_OPEX_RATIO",
    nameEn: "Real Estate OpEx Ratio",
    nameAz: "Əmlak Əməliyyat Xərcləri Nisbəti",
    nameRu: "Доля OpEx (недвижимость)",
    category: "operational",
    industries: ["real_estate"],
    unit: "%",
    direction: "lower_better",
    formula: "opex / revenue * 100",
    thresholds: {
      green: { op: "<=", value: 30 },
      amber: { op: "<=", value: 50 },
      red: { op: ">", value: 50 },
    },
    hintTemplateEn:
      "OpEx {value}% of revenue. Commercial RE baseline 25-40% (property mgmt + utilities + tax). Above 50% cuts distributable cash flow.",
    hintTemplateRu:
      "OpEx {value}% от выручки. Коммерческая недвижимость baseline 25–40% (property mgmt + utilities + tax). Выше 50% — vacancy growing или maintenance unaddressed.",
    hintTemplateAz:
      "OpEx gəlirin {value}%-dir. Kommersiya daşınmaz əmlak baseline 25–40% (mülkiyyət idarəçiliyi + kommunal + vergi). 50%-dən yuxarı — boşluq artır və ya texniki xidmət həll edilməyib.",
    requiredInputs: ["budgetLine"],
    sortOrder: 350,
  },
];
