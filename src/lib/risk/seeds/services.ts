import type { IndicatorSeed } from "./types";


// ─── Services pack (5) ─────────────────────────────────────────────────────

export const servicesIndicators: IndicatorSeed[] = [
  {
    code: "SVC_GROSS_MARGIN",
    nameEn: "Services Gross Margin",
    nameAz: "Xidmət Ümumi Marja",
    nameRu: "Валовая маржа сервисов",
    category: "operational",
    industries: ["services"],
    unit: "%",
    direction: "higher_better",
    formula: "gross_profit / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 45 },
      amber: { op: ">=", value: 25 },
      red: { op: "<", value: 25 },
    },
    hintTemplateEn:
      "Services gross margin {value}%. Healthy benchmarks run 40-60%; below 25% means pricing power is eroding or direct-service-delivery costs are out of line.",
    hintTemplateRu:
      "Валовая маржа услуг {value}%. Здоровые бенчмарки 40–60%; ниже 25% — pricing power размывается или прямые затраты на оказание услуг вышли из-под контроля.",
    hintTemplateAz:
      "Xidmət ümumi mənfəəti {value}%. Sağlam benchmark 40–60%; 25%-dən aşağı — qiymətləmə gücü aşınır və ya birbaşa xidmət-çatdırılma xərcləri sıradan çıxır.",
    requiredInputs: ["budgetLine"],
    sortOrder: 110,
    weight: 1.4, // Core profitability — highest composite weight
  },
  {
    code: "SVC_NET_MARGIN",
    nameEn: "Services Net Margin",
    nameAz: "Xidmət Xalis Marja",
    nameRu: "Чистая маржа сервисов",
    category: "operational",
    industries: ["services"],
    unit: "%",
    direction: "higher_better",
    formula: "net_income / revenue * 100",
    thresholds: {
      green: { op: ">=", value: 8 },
      amber: { op: ">=", value: 0 },
      red: { op: "<", value: 0 },
    },
    hintTemplateEn:
      "Net margin {value}%. Services businesses below 0% are losing money on operations — investigate pricing, utilization, and overhead allocation.",
    hintTemplateRu:
      "Чистая маржа {value}%. Сервисные бизнесы ниже 0% теряют деньги на операциях — проверьте pricing, утилизацию и распределение overhead.",
    hintTemplateAz:
      "Xalis mənfəət {value}%. 0%-dən aşağı xidmət bizneslər əməliyyatlarda pul itirir — qiymətləmə, utilizasiya və overhead bölgüsünü yoxlayın.",
    requiredInputs: ["budgetLine"],
    sortOrder: 120,
    weight: 1.4, // Core profitability
  },
  {
    code: "SVC_OPEX_RATIO",
    nameEn: "Services OpEx Ratio",
    nameAz: "Xidmət Əməliyyat Xərcləri Nisbəti",
    nameRu: "Доля операционных расходов (сервисы)",
    category: "operational",
    industries: ["services"],
    unit: "%",
    direction: "lower_better",
    formula: "opex / revenue * 100",
    thresholds: {
      green: { op: "<=", value: 60 },
      amber: { op: "<=", value: 85 },
      red: { op: ">", value: 85 },
    },
    hintTemplateEn:
      "OpEx {value}% of revenue. Services baseline 50-70% (personnel-heavy); above 85% suggests depreciation or overhead is too large for the revenue base.",
    hintTemplateRu:
      "OpEx — {value}% от выручки. Сервисный baseline 50–70% (персонал-центричный); выше 85% — амортизация или overhead слишком велики для базы выручки.",
    hintTemplateAz:
      "OpEx gəlirin {value}%-dir. Xidmət baseline 50–70% (personalla yüklü); 85%-dən yuxarı — amortizasiya və ya overhead gəlir bazası üçün çox böyükdür.",
    requiredInputs: ["budgetLine"],
    sortOrder: 130,
  },
  {
    code: "SVC_COGS_INTENSITY",
    nameEn: "Services COGS Intensity",
    nameAz: "Xidmət Maya Dəyər Payı",
    nameRu: "Себестоимость к выручке (сервисы)",
    category: "operational",
    industries: ["services"],
    unit: "%",
    direction: "lower_better",
    formula: "cogs / revenue * 100",
    thresholds: {
      green: { op: "<=", value: 40 },
      amber: { op: "<=", value: 60 },
      red: { op: ">", value: 60 },
    },
    hintTemplateEn:
      "COGS {value}% of revenue. Services above 60% usually means low-margin re-selling or high third-party pass-through costs.",
    hintTemplateRu:
      "COGS {value}% от выручки. Услуги выше 60% — обычно низкомаржинальная перепродажа или высокие сторонние pass-through расходы.",
    hintTemplateAz:
      "COGS gəlirin {value}%-dir. Xidmətdə 60%-dən yuxarı — adətən aşağı-marja yenidən-satış və ya yüksək üçüncü-tərəf pass-through xərcləri.",
    requiredInputs: ["budgetLine"],
    sortOrder: 140,
  },
  {
    code: "SVC_REVENUE_CONCENTRATION",
    nameEn: "Revenue Concentration (HHI)",
    nameAz: "Gəlir Konsentrasiyası (HHI)",
    nameRu: "Концентрация выручки (HHI)",
    category: "geopolitical",
    industries: ["services"],
    unit: "index",
    direction: "lower_better",
    formula: "revenue_line_hhi",
    thresholds: {
      green: { op: "<=", value: 1500 },
      amber: { op: "<=", value: 3000 },
      red: { op: ">", value: 3000 },
    },
    hintTemplateEn:
      "Revenue HHI = {value}. Above 3000 means a single client dominates — losing them jeopardises the business. Diversify the pipeline.",
    hintTemplateRu:
      "HHI выручки = {value}. Выше 3000 — один клиент доминирует; его потеря угрожает бизнесу. Диверсифицируйте pipeline.",
    hintTemplateAz:
      "Gəlir HHI = {value}. 3000-dən yuxarı bir müştəri üstünlük təşkil edir — onu itirmək biznesi təhlükəyə atır. Pipeline-ı diversifikasiya edin.",
    requiredInputs: ["budgetLine.revenue_line_hhi"],
    sortOrder: 150,
  },
];
