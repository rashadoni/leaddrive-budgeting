import type { IndicatorSeed } from "./types";


// ─── Cross-sector pack (4) ─────────────────────────────────────────────────

export const crossSectorIndicators: IndicatorSeed[] = [
  // Phase 7.J — counterparty concentration indicators driven by the
  // Counterparty register. HHI (Herfindahl-Hirschman Index) measures
  // market concentration as Σ(share_i)² where share_i is each
  // counterparty's % expressed as 0-1. Below 0.15 = competitive, 0.15-
  // 0.25 = moderate concentration, above 0.25 = high concentration.
  {
    code: "CUSTOMER_HHI",
    nameEn: "Customer Concentration (HHI)",
    nameAz: "Müştəri Konsentrasiyası (HHI)",
    nameRu: "Концентрация клиентов (HHI)",
    category: "concentration",
    industries: [
      "agro_crops",
      "food_processing",
      "industrial",
      "services",
      "real_estate",
      "retail",
      "logistics",
      "beverage",
      "pharma",
      "poultry",
    ],
    unit: "index",
    direction: "lower_better",
    // Phase 7.M Tier 4 (2026-05-19) bugfix — was "counterparty_hhi:customer"
    // (parse error, colon invalid in expression). Resolver writes a flat
    // alias `counterparty_hhi_customer` to context that the formula
    // engine reads as a variable. See recompute.ts:2381.
    formula: "counterparty_hhi_customer",
    thresholds: {
      green: { op: "<=", value: 0.15 },
      amber: { op: "<=", value: 0.25 },
      red: { op: ">", value: 0.25 },
    },
    hintTemplateEn:
      "Customer HHI is {value}. Above 0.25 = one buyer holds enough share to threaten cash flow on a single delayed payment.",
    hintTemplateRu:
      "HHI клиентов = {value}. Выше 0.25 — один покупатель держит достаточно доли, чтобы поставить под угрозу cash flow при единственной задержке платежа.",
    hintTemplateAz:
      "Müştəri HHI = {value}. 0.25-dən yuxarı — bir alıcının payı bir gecikmiş ödənişlə pul axınını təhdid etmək üçün kifayət edir.",
    requiredInputs: ["counterparty:customer"],
    sortOrder: 2,
  },
  // 2026-05-27 — Complement HHI with direct top-buyer concentration.
  // HHI is mathematically rigorous but hard to communicate ("0.45 ratio")
  // vs "Bakı Şirniyyat = 32% of revenue" which is immediately actionable.
  // Sourced from the counterpartyHhiResolver's `top_counterparty_share_customer`
  // alias (max sharePct across active customers, expressed as 0-100).
  {
    code: "TOP_CUSTOMER_SHARE",
    nameEn: "Top Customer Revenue Share",
    nameAz: "Ən böyük müştərinin gəlir payı",
    nameRu: "Доля крупнейшего клиента в выручке",
    category: "concentration",
    industries: [
      "agro_crops",
      "food_processing",
      "industrial",
      "services",
      "real_estate",
      "retail",
      "logistics",
      "beverage",
      "pharma",
      "poultry",
    ],
    unit: "%",
    direction: "lower_better",
    formula: "top_counterparty_share_customer",
    thresholds: {
      // 0-20% → diversified buyer base (green)
      // 20-30% → elevated concentration (amber); single buyer can hurt
      // >30% → systemic dependence (red); one delayed payment threatens liquidity
      green: { op: "<=", value: 20 },
      amber: { op: "<=", value: 30 },
      red: { op: ">", value: 30 },
    },
    hintTemplateEn:
      "Top customer accounts for {value}% of revenue. ≤20% = diversified; 20-30% = elevated; >30% = single delayed payment threatens cash flow.",
    hintTemplateRu:
      "Топ-клиент держит {value}% выручки. ≤20% — диверсифицировано; 20-30% — повышенная концентрация; >30% — одна задержка платежа угрожает cash flow.",
    hintTemplateAz:
      "Ən böyük müştəri gəlirin {value}%-ni təşkil edir. ≤20% — diversifikasiya; 20-30% — yüksəlmiş; >30% — bir gecikmiş ödəniş pul axınını təhdid edir.",
    requiredInputs: ["counterparty:customer"],
    sortOrder: 3,
  },
  // 2026-05-27 — REMOVED: LEGAL_MONEY_AT_RISK seed.
  // Original implementation regex-extracted AZN amounts from court case
  // descriptions, but coverage was only 4 of 54 cases (7%) — misleading
  // floor estimate. Per user direction «ничего выдуманного не нужно»,
  // removed entirely. Future: re-introduce as manual-entry indicator
  // when full client-supplied case ledger arrives, OR replace regex
  // extraction with LLM-based amount detection that handles labor/
  // regulatory dispute language. See ROADMAP Phase 8 → Group E
  // (Compliance Hub upgrades).
  //
  // 2026-05-27 — Revenue-side FX exposure. Distinct from FX_IMPORTED_INPUT
  // (cost-side): this measures what % of revenue is collected in non-AZN
  // currencies. High = AZN weakness boosts P&L; AZN strength compresses
  // margin. Symmetric exposure to FX_IMPORTED_INPUT — together they
  // express NET fx position.
  {
    code: "REVENUE_FX_EXPOSURE",
    nameEn: "Non-AZN Revenue Share (FX exposure)",
    nameAz: "Qeyri-AZN gəlir payı (FX riski)",
    nameRu: "Доля выручки не в AZN (FX-риск)",
    category: "fx",
    industries: [
      "agro_crops",
      "food_processing",
      "industrial",
      "services",
      "real_estate",
      "retail",
      "logistics",
      "beverage",
      "pharma",
      "poultry",
      "construction",
    ],
    unit: "%",
    direction: "lower_better",
    // 100 - AZN share = non-AZN share = FX exposure on revenue side.
    // Fallback: if fx_revenue_azn is missing, formula evaluates to NaN
    // → status='unknown', matching the system's "honest gap" policy.
    formula: "100 - fx_revenue_azn",
    thresholds: {
      // 0-20% non-AZN = mostly domestic, FX risk low
      // 20-50% = mixed exposure
      // >50% = majority non-AZN, FX moves dominate revenue translation
      green: { op: "<=", value: 20 },
      amber: { op: "<=", value: 50 },
      red: { op: ">", value: 50 },
    },
    hintTemplateEn:
      "{value}% of revenue is collected in non-AZN currency. ≤20% = domestic dominant; 20-50% = mixed; >50% = FX moves dominate revenue.",
    hintTemplateRu:
      "{value}% выручки в валюте отличной от AZN. ≤20% — внутренний рынок доминирует; 20-50% — смешанная; >50% — FX доминирует.",
    hintTemplateAz:
      "Gəlirin {value}%-i AZN olmayan valyutadadır. ≤20% — daxili bazar üstünlük təşkil edir; 20-50% — qarışıq; >50% — FX dəyişiklikləri üstünlük təşkil edir.",
    requiredInputs: ["company.settings.fxRevenueAzn"],
    sortOrder: 5,
  },
  {
    code: "TOP3_CUSTOMER_SHARE",
    nameEn: "Top-3 Customers Revenue Share",
    nameAz: "Top-3 müştərinin gəlir payı",
    nameRu: "Доля топ-3 клиентов в выручке",
    category: "concentration",
    industries: [
      "agro_crops",
      "food_processing",
      "industrial",
      "services",
      "real_estate",
      "retail",
      "logistics",
      "beverage",
      "pharma",
      "poultry",
    ],
    unit: "%",
    direction: "lower_better",
    formula: "top3_counterparty_share_customer",
    thresholds: {
      // Most B2B distributors carry top-3 = 40-60% naturally.
      // <50% = healthy long-tail; 50-75% = concentrated; >75% = oligopsony.
      green: { op: "<=", value: 50 },
      amber: { op: "<=", value: 75 },
      red: { op: ">", value: 75 },
    },
    hintTemplateEn:
      "Top-3 customers together account for {value}% of revenue. ≤50% = healthy long-tail; >75% = oligopsony — losing any one tips the equation.",
    hintTemplateRu:
      "Топ-3 клиента вместе держат {value}% выручки. ≤50% — здоровый длинный хвост; >75% — олигопсония, потеря любого роняет показатели.",
    hintTemplateAz:
      "Top-3 müştəri birlikdə gəlirin {value}%-ni təşkil edir. ≤50% — sağlam uzun quyruq; >75% — oliqopsoniya — birini itirmək balansı pozur.",
    requiredInputs: ["counterparty:customer"],
    sortOrder: 4,
  },
  {
    code: "SUPPLIER_HHI",
    nameEn: "Supplier Concentration (HHI)",
    nameAz: "Tədarükçü Konsentrasiyası (HHI)",
    nameRu: "Концентрация поставщиков (HHI)",
    category: "concentration",
    industries: [
      "agro_crops",
      "food_processing",
      "industrial",
      "services",
      "real_estate",
      "retail",
      "logistics",
      "beverage",
      "pharma",
      "poultry",
    ],
    unit: "index",
    direction: "lower_better",
    // Phase 7.M Tier 4 (2026-05-19) bugfix — see CUSTOMER_HHI comment.
    formula: "counterparty_hhi_supplier",
    thresholds: {
      green: { op: "<=", value: 0.2 },
      amber: { op: "<=", value: 0.35 },
      red: { op: ">", value: 0.35 },
    },
    hintTemplateEn:
      "Supplier HHI is {value}. Above 0.35 + presence of single-source suppliers makes COGS extremely fragile.",
    hintTemplateRu:
      "HHI поставщиков = {value}. Выше 0.35 + наличие single-source поставщиков делает COGS крайне хрупким.",
    hintTemplateAz:
      "Tədarükçü HHI = {value}. 0.35-dən yuxarı + tək mənbəli tədarükçülərin olması COGS-i çox kövrək edir.",
    requiredInputs: ["counterparty:supplier"],
    sortOrder: 3,
  },
  {
    code: "FX_IMPORTED_INPUT",
    nameEn: "Imported-Input FX Exposure",
    nameAz: "İdxal Girişlərinin FX Riski",
    nameRu: "Доля импорта во входах (FX-риск)",
    category: "fx",
    industries: [
      "agro_crops",
      "poultry",
      "food_processing",
      "industrial",
      "services",
    ],
    unit: "%",
    direction: "lower_better",
    formula: "imported_input_cost / total_input_cost * 100",
    thresholds: {
      green: { op: "<=", value: 25 },
      amber: { op: "<=", value: 50 },
      red: { op: ">", value: 50 },
    },
    hintTemplateEn:
      "{value}% of input costs are imported. AZN weakness hits gross margin directly.",
    hintTemplateRu:
      "{value}% затрат на сырьё — импорт. Ослабление AZN бьёт по валовой марже напрямую.",
    hintTemplateAz:
      "Giriş xərclərinin {value}%-i idxaldır. AZN-in zəifləməsi ümumi mənfəətə birbaşa təsir edir.",
    // Phase 7.M Tier 4 (2026-05-19) — fxExposureSource opt-in. Lets
    // companies that confirm 100% AZN exposure resolve to 0% green
    // (instead of unknown) via Company.settings.fxExposureSource =
    // "all_domestic". Default ("tagged_lines" or absent) keeps the
    // conservative unknown behaviour. See recompute.ts:2944 fx-guard.
    requiredInputs: ["budgetLine", "currencyRate", "company.settings.fxExposureSource"],
    sortOrder: 5,
    // FX shock is an external amplifier of profitability risk — weight above default.
    weight: 1.3,
  },
  // ── Phase 7.E phase 3 — building blocks for `rollup()` and `fact()` ────
  // demonstrations (sub-42, 2026-04-30). These indicators persist raw $$
  // values + fact()-baseline deltas so the formula engine has cross-period
  // and cross-company composites to evaluate.
  //
  // Operational prerequisites for end-to-end activation (tracked as 🔄):
  //   1. `IND_HOLDING_REVENUE` requires parent-company recompute support.
  //      Today `recompute-trigger.ts:filterOperationalCompanies` only feeds
  //      level=2+role='operational' cos to the recompute loop; parent-cos
  //      (level=1) are skipped, so their `IND_HOLDING_REVENUE` IV is never
  //      created. UI affordance "rollup formulas" needs the trigger to also
  //      walk parent cos with rollup-flagged indicators.
  //   2. `IND_NET_MARGIN_VS_2025` requires historical 2025 IND_NET_MARGIN
  //      IVs in DB. v1 runs `IND_NET_MARGIN` only at the current period;
  //      2025 IVs would have to be either backfilled by a separate
  //      compute-historical-ivs script OR seeded manually for demo orgs.
  //
  // For a Prisma adapter with no historical data + no parent-co recompute,
  // these indicators resolve to status='unknown' (fact returns null →
  // formula NaN; rollup on op-co with no children returns 0 which still
  // hits amber but is misleading). Hint templates document that.
  {
    code: "IND_REVENUE_TOTAL",
    nameEn: "Revenue (Total)",
    nameAz: "Ümumi Gəlir",
    nameRu: "Совокупная выручка",
    // Sub-42 architect Round-1 closure — `category: "internal"` excludes
    // this indicator from HeatMap rendering. Its job is to PERSIST raw $
    // for rollup() / fact() composites, not to be a user-facing risk row.
    // Without this gate the threshold "any positive revenue is green"
    // would emit a green-by-default column on every operational co —
    // signal-free noise polluting the matrix. The matrix endpoint at
    // `src/app/api/indicators/matrix/route.ts` filters out
    // `category: 'internal'` rows.
    category: "internal",
    industries: [],
    unit: "AZN",
    direction: "higher_better",
    // Persists raw revenue from `budgetLineResolver` as an IV. Building
    // block for `rollup("IND_REVENUE_TOTAL")` — parent cos sum across
    // children. Threshold "any positive revenue is green" is intentional:
    // the indicator's job is to PERSIST the number for cross-co rollup,
    // not to flag risk. Risk-bearing margin indicators (IND_NET_MARGIN,
    // IND_GROSS_MARGIN) live separately.
    formula: "revenue",
    thresholds: {
      green: { op: ">=", value: 0 },
      amber: { op: ">=", value: -1 },
      red: { op: "<", value: -1 },
    },
    hintTemplateEn:
      "Total revenue {value} AZN. Persists raw $ for rollup() and fact() composites; risk classification lives on margin indicators.",
    hintTemplateRu:
      "Общая выручка {value} AZN. Сохраняет сырые $ для rollup() и fact() композитов; классификация рисков на других индикаторах.",
    hintTemplateAz:
      "Ümumi gəlir {value} AZN. Rollup() və fact() kompozitləri üçün xam $ saxlayır; risk təsnifatı digər göstəricilərdə.",
    requiredInputs: ["budgetLine"],
    sortOrder: 1,
  },
  {
    code: "IND_HOLDING_REVENUE",
    nameEn: "Holding Revenue (rollup)",
    nameAz: "Holdinq Gəliri (rollup)",
    nameRu: "Выручка холдинга (rollup)",
    // Sub-42 architect Round-1 closure + sub-44 prereq-#1 + render-path:
    //   • Sub-42 set `category: "internal"` because (a) op-cos with no
    //     children compute rollup as 0 → amber (misleading "Holding
    //     Revenue 0" on a sub-co), (b) parent cos didn't enter the
    //     recompute loop so the IV was never created either way.
    //   • Sub-44 prereq #1 (2026-05-03) closed (b): `recompute-trigger.ts`
    //     opts-in level=1 parent cos for any indicator carrying a
    //     `rollup:` requiredInput → parent-co IVs are written to DB.
    //   • Sub-44 cont'd render-path (2026-05-03) closed (a) + matrix
    //     visibility. The canonical target fan-out now treats rollup-bearing
    //     definitions as structurally parent-only; the matrix endpoint
    //     (i) keeps rollup-bearing internal indicators in the visible
    //     indicators list, (ii) emits real parent-co cells with drill-
    //     downable `indicatorValueId` (priority over Turn 33.5 synthetic
    //     averages), and (iii) marks the leaf pair N/A rather than exposing a
    //     false missing/recompute affordance. Legacy leaf IVs are ignored.
    //   • The seed STAYS `category: "internal"` because the relaxed
    //     matrix-side filter is the correct gate point: "internal"
    //     remains the seed-author signal for "not user-facing on op-co
    //     rows", and the matrix endpoint promotes it to visible iff
    //     rollup-bearing. End-to-end pipeline IS LIVE — visible only
    //     for orgs that have at least one parent (level=1, sub-group)
    //     company with the IV in DB.
    category: "internal",
    industries: [],
    unit: "AZN",
    direction: "higher_better",
    // Cross-company sum across direct children's IND_REVENUE_TOTAL.
    // The empty cases no longer reach these bands, and the note that used to
    // sit here — "empty returns 0, which lands amber, a useful UX signal" —
    // was the bug, not the design. `amber: >= 0` scores an empty sum exactly
    // like a measured one, and a scored status passes `hasEvidencedValue`, so
    // PeerPanel ranked it and the board deck printed it. The pipeline now
    // demotes both empty shapes to `unknown` before classification:
    // `rollup_no_children` (no children at all) and `rollup_no_child_values`
    // (children present, none with a value this period) — see
    // `src/lib/risk/rollup-evidence.ts`. These bands therefore only ever score
    // a sum with at least one real child value behind it.
    // Threshold values are demo-level placeholders; real holdings would tune
    // via the C6 alert-thresholds-config layer.
    formula: 'rollup("IND_REVENUE_TOTAL")',
    thresholds: {
      green: { op: ">=", value: 1000000 },
      amber: { op: ">=", value: 0 },
      red: { op: "<", value: 0 },
    },
    hintTemplateEn:
      "Holding-wide revenue {value} AZN, summed across direct children. 0 = no operational sub-cos contributing yet. Most meaningful at parent (level=1) companies.",
    hintTemplateRu:
      "Выручка холдинга {value} AZN, суммарно по прямым дочерним компаниям. 0 = ни одна операционная саб-ко не дала вклад.",
    hintTemplateAz:
      "Holdinqin gəliri {value} AZN, birbaşa törəmə şirkətlər üzrə cəmi. 0 = heç bir əməliyyat törəməsi töhfə verməyib.",
    requiredInputs: ["rollup:IND_REVENUE_TOTAL"],
    sortOrder: 2,
  },
  {
    code: "IND_NET_MARGIN_VS_2025",
    nameEn: "Net Margin vs 2025 baseline",
    nameAz: "Xalis Marja 2025-ə nisbətən",
    nameRu: "Чистая маржа vs базис 2025",
    // Industrial-only because it references IND_NET_MARGIN (industrial-
    // sector indicator). Cross-sector versions would need per-sector
    // copies of this seed, which is fine but defers v2 — keep the
    // demonstration narrow to one sector + one historical baseline.
    category: "operational",
    industries: ["industrial"],
    unit: "pp", // percentage points (delta of two %s)
    direction: "higher_better",
    // Year-over-year margin delta vs a fixed 2025 baseline. Returns NaN
    // (→ status='unknown') unless the same company has an IND_NET_MARGIN
    // IV at period="2025" — backfill required for the indicator to fire.
    formula: '(net_income / revenue * 100) - fact("IND_NET_MARGIN", "2025")',
    thresholds: {
      green: { op: ">=", value: 0 },
      amber: { op: ">=", value: -3 },
      red: { op: "<", value: -3 },
    },
    hintTemplateEn:
      "Net margin moved {value}pp vs 2025 baseline. -3pp+ deterioration = red — investigate cost mix or pricing. Requires backfilled 2025 IND_NET_MARGIN to fire.",
    hintTemplateAz:
      "Xalis marja 2025 bazisinə nisbətən {value} faiz punktu dəyişib. -3 f.p. və daha çox pisləşmə qırmızıdır — xərc strukturunu və ya qiymət siyasətini araşdırın. İşləməsi üçün 2025-ci il IND_NET_MARGIN dəyəri geriyə doldurulmalıdır.",
    hintTemplateRu:
      "Чистая маржа изменилась на {value} п.п. относительно базы 2025 года. Ухудшение на 3 п.п. и более — красный: разберите структуру затрат или ценообразование. Для расчёта нужен загруженный задним числом IND_NET_MARGIN за 2025 год.",
    requiredInputs: ["budgetLine", "fact:IND_NET_MARGIN@2025"],
    sortOrder: 3,
  },
  // Phase 7.O — EBITDA margin. Uses `ebitda` context var exposed by
  // budgetLineResolver (= net_income + D&A add-back via 703-11/721-11 SAP
  // codes). For PLF-format data without identified D&A lines, ebitda ≈ EBIT;
  // the indicator is honest but may read slightly lower than true EBITDA for
  // those companies.
  {
    code: "IND_EBITDA_MARGIN",
    nameEn: "EBITDA Margin",
    nameAz: "FVƏA Marja",
    nameRu: "Рентабельность по EBITDA",
    category: "operational",
    industries: [
      "agro_crops",
      "food_processing",
      "industrial",
      "services",
      "hospitality",
      "real_estate",
      "retail",
      "logistics",
      "beverage",
      "pharma",
      "poultry",
      "construction",
    ],
    unit: "%",
    direction: "higher_better",
    formula: "ebitda / revenue * 100",
    thresholds: {
      // Standard industry benchmarks (SME / emerging market):
      // ≥20% = healthy operating leverage; 10-19% = adequate; <10% = thin
      green: { op: ">=", value: 20 },
      amber: { op: ">=", value: 10 },
      red: { op: "<", value: 10 },
    },
    hintTemplateEn:
      "EBITDA margin: {value}%. ≥20% = strong operating leverage; 10-19% = adequate; <10% = thin margin risk. D&A (703-11/721-11) is added back from budget lines — equals EBIT when D&A codes are absent.",
    hintTemplateRu:
      "Рентабельность EBITDA: {value}%. ≥20% = сильный операционный рычаг; 10-19% = приемлемо; <10% = риск тонкой маржи. D&A (703-11/721-11) добавляется обратно из бюджетных строк.",
    hintTemplateAz:
      "FVƏA marjası: {value}%. ≥20% = güclü əməliyyat leverage; 10-19% = qənaətbəxş; <10% = nazik marja riski. D&A (703-11/721-11) büdcə sətrlərindən geri əlavə edilir.",
    requiredInputs: ["budgetLine"],
    weight: 1.4, // same tier as gross/net margin indicators
    sortOrder: 3,
  },
  // Phase 7.N — Legal exposure indicators. Sourced from court-disputes
  // registry imported via scripts/import-court-disputes.ts into OperationalFact.
  // Both are cross-sector (any industry with court exposure).
  {
    code: "LEGAL_CASES_ACTIVE",
    nameEn: "Active Court Cases",
    nameAz: "Aktiv Məhkəmə İşləri",
    nameRu: "Активные судебные дела",
    category: "governance",
    industries: [
      "agro_crops",
      "food_processing",
      "industrial",
      "services",
      "hospitality",
      "real_estate",
      "retail",
      "logistics",
      "beverage",
      "pharma",
      "poultry",
      "construction",
    ],
    unit: "cases",
    direction: "lower_better",
    formula: "LEGAL_CASES_ACTIVE",
    thresholds: {
      // Benchmarks: 0-2 = normal for SME, 3-9 = elevated (active litigation),
      // 10+ = systemic legal risk (resource drain + reputational overhang).
      green: { op: "<=", value: 2 },
      amber: { op: "<=", value: 9 },
      red: { op: ">", value: 9 },
    },
    hintTemplateEn:
      "Active court cases: {value}. ≤2 = normal SME exposure; 3-9 = elevated; ≥10 = systemic legal risk (staff + legal fees + reputation drain).",
    hintTemplateRu:
      "Активных судебных дел: {value}. ≤2 — норма для СМБ; 3-9 — повышенная нагрузка; ≥10 — системный правовой риск (ресурсы + репутация).",
    hintTemplateAz:
      "Aktiv məhkəmə işləri: {value}. ≤2 — KOS üçün norm; 3-9 — yüksəlmiş; ≥10 — sistemli hüquqi risk (xərclər + nüfuz).",
    requiredInputs: ["operationalFact:LEGAL_CASES_ACTIVE"],
    aggregation: "snapshot", // point-in-time count — latest fact, not mean
    sortOrder: 4,
    defaultValueSource: "disclosed",
  },
  {
    code: "LEGAL_CASES_TOTAL",
    nameEn: "Total Court Cases (YTD)",
    nameAz: "Ümumi Məhkəmə İşləri (İlin başından)",
    nameRu: "Всего судебных дел (с начала года)",
    category: "governance",
    industries: [
      "agro_crops",
      "food_processing",
      "industrial",
      "services",
      "hospitality",
      "real_estate",
      "retail",
      "logistics",
      "beverage",
      "pharma",
      "poultry",
      "construction",
    ],
    unit: "cases",
    direction: "lower_better",
    formula: "LEGAL_CASES_TOTAL",
    thresholds: {
      green: { op: "<=", value: 5 },
      amber: { op: "<=", value: 20 },
      red: { op: ">", value: 20 },
    },
    hintTemplateEn:
      "Total court cases YTD: {value}. High count signals litigation-prone relationships or regulatory non-compliance.",
    hintTemplateRu:
      "Всего судебных дел с начала года: {value}. Высокое число — признак конфликтных отношений или нарушений регуляторики.",
    hintTemplateAz:
      "Ümumi məhkəmə işləri (il ərzində): {value}. Yüksək say — münaqişəli münasibətlər və ya normativ pozuntular.",
    requiredInputs: ["operationalFact:LEGAL_CASES_TOTAL"],
    aggregation: "snapshot", // point-in-time count — latest fact, not mean
    sortOrder: 5,
    defaultValueSource: "disclosed",
  },
  // Phase 7.O (2026-05-24) — PBC audit-follow-up indicators. Sourced from
  // "Follow up - For GTC.xlsx" imported via scripts/import-audit-followup.ts.
  // Governance tier — tracks internal-audit finding resolution rate.
  {
    code: "AUDIT_CLOSED_PCT",
    nameEn: "Audit Findings Closed (%)",
    nameAz: "Audit Tapıntılarının Bağlanması (%)",
    nameRu: "Закрытые аудиторские замечания (%)",
    category: "governance",
    industries: [
      "agro_crops",
      "food_processing",
      "industrial",
      "services",
      "hospitality",
      "real_estate",
      "retail",
      "logistics",
      "beverage",
      "pharma",
      "poultry",
      "construction",
    ],
    unit: "%",
    direction: "higher_better",
    formula: "AUDIT_CLOSED_PCT",
    thresholds: {
      // ≥80 % → management is on top of audit remediation
      // 60-79 % → acceptable but lagging — escalation warranted
      // <60 % → systemic non-remediation: audit value destroyed
      green: { op: ">=", value: 80 },
      amber: { op: ">=", value: 60 },
      red: { op: "<", value: 60 },
    },
    hintTemplateEn:
      "PBC audit findings closed: {value}%. ≥80% = on-track remediation; 60-79% = lagging; <60% = systemic non-compliance with audit actions.",
    hintTemplateRu:
      "Закрыто аудиторских замечаний: {value}%. ≥80% — своевременное устранение; 60-79% — отставание; <60% — системная неустранимость замечаний.",
    hintTemplateAz:
      "Audit tapıntılarından bağlananlar: {value}%. ≥80% — vaxtında aradan qaldırma; 60-79% — gecikmə; <60% — sistemli uyumsuzluq.",
    requiredInputs: ["operationalFact:AUDIT_CLOSED_PCT"],
    aggregation: "snapshot", // % snapshot — latest fact, not mean
    sortOrder: 6,
    defaultValueSource: "disclosed",
  },
  {
    code: "AUDIT_MAJOR_OPEN",
    nameEn: "Open Major Audit Findings",
    nameAz: "Açıq Əsas Audit Tapıntıları",
    nameRu: "Открытые серьёзные аудиторские замечания",
    category: "governance",
    industries: [
      "agro_crops",
      "food_processing",
      "industrial",
      "services",
      "hospitality",
      "real_estate",
      "retail",
      "logistics",
      "beverage",
      "pharma",
      "poultry",
      "construction",
    ],
    unit: "count",
    direction: "lower_better",
    formula: "AUDIT_MAJOR_OPEN",
    thresholds: {
      // Major = control deficiencies; even 1 is yellow; >5 = systemic
      green: { op: "<=", value: 1 },
      amber: { op: "<=", value: 5 },
      red: { op: ">", value: 5 },
    },
    hintTemplateEn:
      "Open major audit findings: {value}. 0-1 = controlled; 2-5 = elevated control risk; >5 = systemic weakness requiring board escalation.",
    hintTemplateRu:
      "Открытых серьёзных замечаний: {value}. 0-1 — под контролем; 2-5 — повышенный риск; >5 — системные недостатки, требуют эскалации.",
    hintTemplateAz:
      "Açıq əsas audit tapıntıları: {value}. 0-1 — nəzarət altında; 2-5 — yüksəlmiş risk; >5 — sistemli zəiflik, idarə heyətinə çatdırılmalı.",
    requiredInputs: ["operationalFact:AUDIT_MAJOR_OPEN"],
    aggregation: "snapshot", // point-in-time count — latest fact, not mean
    sortOrder: 7,
    defaultValueSource: "disclosed",
  },
];
