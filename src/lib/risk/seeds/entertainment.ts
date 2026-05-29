import type { IndicatorSeed } from "./types";


// ─── Entertainment pack (4) ────────────────────────────────────────────────

export const entertainmentIndicators: IndicatorSeed[] = [
  {
    code: "ENT_ATTENDANCE_UTIL",
    nameEn: "Attendance Utilization",
    nameAz: "İştirak Dərəcəsi",
    nameRu: "Загруженность по посещениям",
    category: "operational",
    industries: ["entertainment"],
    unit: "%",
    direction: "higher_better",
    formula: "attendees / capacity * 100",
    thresholds: {
      green: { op: ">=", value: 70 },
      amber: { op: ">=", value: 50 },
      red: { op: "<", value: 50 },
    },
    hintTemplateEn:
      "Attendance utilization {value}%. Below 50% usually fails to cover fixed costs — pricing or marketing needs rework.",
    hintTemplateRu:
      "Утилизация посещений {value}%. Ниже 50% — обычно не покрывает фиксированные расходы; pricing или маркетинг misalignment.",
    hintTemplateAz:
      "İştirak utilizasiyası {value}%. 50%-dən aşağı — adətən sabit xərcləri ödəmir; qiymətləmə və ya marketinq yanlış uyğunlaşması.",
    requiredInputs: ["operationalFact:attendees", "operationalFact:capacity"],
    sortOrder: 410,
  },
  {
    code: "ENT_REVENUE_PER_VISIT",
    nameEn: "Revenue per Visit",
    nameAz: "Bir Səfərə Düşən Gəlir",
    nameRu: "Выручка с посещения",
    category: "operational",
    industries: ["entertainment"],
    unit: "AZN",
    direction: "higher_better",
    formula: "revenue / attendees",
    thresholds: {
      green: { op: ">=", value: 25 },
      amber: { op: ">=", value: 12 },
      red: { op: "<", value: 12 },
    },
    hintTemplateEn:
      "Revenue/visit = {value} AZN. Healthy venues drive ancillary revenue (F&B, merch) to 30-50% of total. Below 12 usually means the ancillary channel isn't working.",
    hintTemplateRu:
      "Выручка/визит = {value} AZN. Здоровые площадки выводят ancillary revenue (F&B, merch) до 30–50% общего.",
    hintTemplateAz:
      "Gəlir/ziyarət = {value} AZN. Sağlam məkanlar yardımçı gəlirləri (F&B, suvenir) ümuminin 30–50%-nə çıxarır.",
    requiredInputs: ["budgetLine", "operationalFact:attendees"],
    sortOrder: 420,
  },
  {
    code: "ENT_GROSS_MARGIN",
    nameEn: "Entertainment Gross Margin",
    nameAz: "Əyləncə Ümumi Marja",
    nameRu: "Валовая маржа развлечений",
    category: "operational",
    industries: ["entertainment"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 50 },
      amber: { op: ">=", value: 30 },
      red: { op: "<", value: 30 },
    },
    hintTemplateEn:
      "Gross margin {value}%. Entertainment operators run 50-65%; below 30% means costs-of-delivery (content, licensing, staff) are eating the ticket price.",
    hintTemplateRu:
      "Валовая маржа {value}%. Развлечения 50–65%; ниже 30% — costs-of-delivery (контент, площадка) выходят из-под контроля.",
    hintTemplateAz:
      "Ümumi mənfəət {value}%. Əyləncə 50–65%; 30%-dən aşağı — çatdırılma xərcləri (kontent, məkan) nəzarətdən çıxır.",
    requiredInputs: ["budgetLine"],
    sortOrder: 430,
    weight: 1.4, // Core profitability
  },
  {
    code: "ENT_SEASONALITY_CONCENTRATION",
    nameEn: "Seasonality Concentration (Top-3 Month Share)",
    nameAz: "Mövsümilik Konsentrasiyası",
    nameRu: "Сезонная концентрация",
    category: "operational",
    industries: ["entertainment"],
    unit: "%",
    direction: "lower_better",
    // The `revenueBySeason` sub-aggregation already returns the top-3
    // month share AS A PERCENTAGE (0..100), so the formula passes it
    // through unchanged. Multiplying by 100 again was a Phase-7.C-era
    // placeholder when the resolver returned a fraction; flipped to
    // identity when the actual sub-resolver landed.
    formula: "revenueBySeason",
    thresholds: {
      green: { op: "<=", value: 40 },
      amber: { op: "<=", value: 55 },
      red: { op: ">", value: 55 },
    },
    hintTemplateEn:
      "{value}% of revenue lands in the peak 3 months. Above 55% means a single bad season kills the year — diversify programming.",
    hintTemplateRu:
      "{value}% выручки в peak 3 месяца. Выше 55% — один плохой сезон убивает год; диверсифицируйте off-season offerings.",
    hintTemplateAz:
      "Gəlirin {value}%-i pik 3 ayda. 55%-dən yuxarı — bir pis mövsüm ili məhv edir; off-season təklifləri diversifikasiya edin.",
    requiredInputs: ["budgetLine.revenueBySeason"],
    sortOrder: 440,
  },
];
