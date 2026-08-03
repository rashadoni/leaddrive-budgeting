/**
 * 2026-05-27 — Pure mapping from AI Import `SheetDataType` to the
 * indicators that consume the data written by that dataType's handler.
 *
 * Used by the AI Auto Import preview UI to answer "под какие индикаторы
 * попадут эти данные?" before the user clicks Apply. The classifier
 * already returns `confidence` per sheet (0..1); this module adds the
 * downstream impact projection so the user can sanity-check both the
 * classification AND its effect at the same time.
 *
 * Source of truth: `ALL_INDICATOR_SEEDS` — each seed declares
 * `requiredInputs: string[]` listing the resolver tokens it depends on
 * (`budgetLine`, `operationalFact:yield_per_ha`, `counterparty:customer`,
 * `company.settings.hectaresPlanted`, etc.). We bucket those tokens by
 * dataType using `DATATYPE_INPUT_PATTERNS` below.
 *
 * Coverage notes:
 *   • PLF / BS / CF — match the writer table (`budgetLine` /
 *     `balanceSheetLine` / `cashFlowEntry` prefixes).
 *   • KPI_FARMING / KPI_PROCESSING / LAND_REGISTRY / OPS_FACTS — all write
 *     to OperationalFact, so they overlap on `operationalFact:*`. We
 *     narrow KPI buckets by metric name (the AZSEKER parsers write a
 *     known finite set; see adapters/azseker-workbook-kpi.ts).
 *   • SALES / CAPEX / BUDGET_ACTUALS / SALES_FORECAST — handlers write
 *     to tables (operational_facts farm_sales_*, company.settings.capexPlan,
 *     budget_actuals, sales_forecasts) that no current seed consumes.
 *     Affected list = empty + clear "no indicator currently consumes
 *     this writer" note so the user knows the data still lands.
 *   • DESCRIPTIONS / INFO_SUMMARY / COMPANIES / UNKNOWN — soft / structural,
 *     no indicator impact.
 *
 * Pure module: no Prisma, no React, no LLM calls. Safe to import in API
 * routes AND test-mocked UI render.
 */
import type { SheetDataType } from "./sheet-classifier"
import { ALL_INDICATOR_SEEDS } from "@/lib/risk/indicator-seeds"

export interface AffectedIndicator {
  /** Stable indicator code (e.g. CUSTOMER_HHI). */
  code: string
  /** English display name from the seed. */
  nameEn: string
  /** Optional Russian display name — preferred in UI when present. */
  nameRu: string | null
  /** Optional Azerbaijani display name. */
  nameAz: string | null
  /** Indicator category (operational / concentration / profitability / …). */
  category: string
  /** Industries this indicator applies to. Empty array = cross-sector. */
  industries: string[]
  /** Which requiredInput token matched (for transparency / debugging). */
  matchedInput: string
}

export interface DataTypeImpact {
  dataType: SheetDataType
  /** One-line plain summary of what tables / fields the handler writes. */
  writes: string
  /** Optional caveat displayed in the UI (e.g. "no indicator currently consumes this"). */
  note: string | null
  /** Indicators this dataType's writes will feed into. */
  indicators: AffectedIndicator[]
}

/**
 * Per-dataType matcher. Each entry decides whether a given indicator
 * `requiredInput` token should count as "affected when this dataType is
 * imported". Pure function of the input string — no extra state.
 */
type InputMatcher = (input: string) => boolean

interface DataTypeRule {
  writes: string
  /** Optional UI caveat. */
  note?: string
  /** Matches indicator requiredInput tokens that this dataType's writes feed. */
  match: InputMatcher
}

// Farming KPI metrics — set matches `parseWorkbookFarmingKpiSheet` writes
// in src/lib/onboarding/adapters/azseker-workbook-kpi.ts.
const FARMING_KPI_METRICS = new Set<string>([
  "area_hectares",
  "harvest_tons",
  "yield_per_ha",
  "sugar_brix_pct",
  "sugar_pol_pct",
  "sugar_content_pct",
  "drought_index",
  "water_use_m3_per_ha",
  "fertilizer_kg_per_ha",
  "cane_cut_to_mill_hours",
  "cane_buyer_concentration_pct",
  "cane_hectares_harvested_pct",
  "cane_harvest_season_progress",
])

// Processing KPI metrics — matches `parseWorkbookProcessingKpiSheet`.
const PROCESSING_KPI_METRICS = new Set<string>([
  "extraction_rate_pct",
  "capacity",
  "raw_input",
  "finished_output",
  "harvest_tons", // processing reuses for processed quantity
  "cane_harvest_season_progress",
])

// Land registry metrics — `parseLandRegistrySheet` writes these.
const LAND_REGISTRY_METRICS = new Set<string>([
  "area_hectares",
  "leased_area",
  "total_area",
])

/** Strip the `operationalFact:` prefix and return the bare metric name. */
function opFactName(input: string): string | null {
  if (!input.startsWith("operationalFact:")) return null
  return input.slice("operationalFact:".length)
}

const DATATYPE_RULES: Record<SheetDataType, DataTypeRule> = {
  PLF: {
    writes: "BudgetLine.plannedAmount (P&L 12 месяцев)",
    match: (i) => i === "budgetLine" || i.startsWith("budgetLine."),
  },
  BS: {
    writes: "BalanceSheetLine.plannedAmount (баланс 12 месяцев)",
    match: (i) => i.startsWith("balanceSheetLine"),
  },
  BS_ELIMINATIONS: {
    writes:
      "BalanceSheetLine с isElimination=true и companyId=null (внутригрупповые элиминации клиента)",
    note: "не принадлежит ни одной компании: элиминация гасит расчёты МЕЖДУ участниками группы. Читается только в групповом виде баланса, из карточки компании исключается",
    match: (i) => i.startsWith("balanceSheetLine"),
  },
  CF: {
    writes: "CashFlowEntry.plannedAmount (cash flow 12 месяцев)",
    note: "ни один seeded индикатор пока не читает CashFlowEntry напрямую — данные сохраняются для FCF / Operating CF в будущем",
    match: (i) => i.startsWith("cashFlowEntry"),
  },
  KPI_FARMING: {
    writes: "OperationalFact (area_hectares, harvest_tons, yield_per_ha, sugar Brix/Pol, ...)",
    match: (i) => {
      const m = opFactName(i)
      return m !== null && FARMING_KPI_METRICS.has(m)
    },
  },
  KPI_PROCESSING: {
    writes: "OperationalFact (extraction_rate_pct, capacity, raw_input, finished_output, harvest_tons)",
    match: (i) => {
      const m = opFactName(i)
      return m !== null && PROCESSING_KPI_METRICS.has(m)
    },
  },
  CAPEX: {
    writes: "Company.settings.capexPlan (план капитальных расходов)",
    note: "ни один индикатор пока не читает capex напрямую — данные сохраняются для CAPEX/Revenue ratio в будущем",
    match: () => false,
  },
  SALES: {
    writes: "OperationalFact (farm_sales_<product>_<suffix>) — продажи продуктов помесячно",
    note: "ни один индикатор пока не читает farm_sales напрямую — данные сохраняются для customer/product mix в будущем",
    match: () => false,
  },
  LAND_REGISTRY: {
    writes: "Company.settings.landRegistry + OperationalFact (area_hectares, leased_area)",
    match: (i) => {
      if (i === "company.settings.hectaresPlanted") return true
      const m = opFactName(i)
      return m !== null && LAND_REGISTRY_METRICS.has(m)
    },
  },
  DESCRIPTIONS: {
    writes: "Company.settings.description (текстовое описание бизнеса)",
    note: "не задевает ни один индикатор — только narrative для AI Brief / Variance Explainer",
    match: () => false,
  },
  INFO_SUMMARY: {
    writes: "Ничего — это section separator (заголовок раздела в книге)",
    note: "лист пропускается без записи в БД",
    match: () => false,
  },
  COMPANIES: {
    writes: "Company (создание / обновление структуры холдинга)",
    note: "структурные изменения; индикаторы пересчитываются после, но напрямую не задеваются",
    match: () => false,
  },
  OPS_FACTS: {
    writes: "OperationalFact (любые метрики — flat tabular sheet)",
    match: (i) => i.startsWith("operationalFact:"),
  },
  BUDGET_ACTUALS: {
    writes: "BudgetActual.amount (фактические транзакции по дате)",
    note: "ни один seeded индикатор пока не читает BudgetActual напрямую — для variance в будущем",
    match: () => false,
  },
  SALES_PRODUCTS: {
    writes: "SalesBudgetLine.quantity / unitPrice / amount (объём + цена по продукту × месяц)",
    // 2026-08-01 (11.85) — «индикаторы читают P&L, а не эту таблицу» было
    // неправдой ровно наполовину, и эта половина стоила дня работы.
    //
    // `makeSalesProductsHandler` выводит концентрацию контрагентов ИЗ ЭТИХ ЖЕ
    // строк: каждая строка факта называет своего покупателя, поэтому обработчик
    // пишет `Counterparty` и питает CUSTOMER_HHI / TOP_CUSTOMER_SHARE /
    // TOP3_CUSTOMER_SHARE / SUPPLIER_HHI — по каждой компании отдельно. На
    // проде это и лежало: 276 строк по AZSEKER-CPC за 2025, 203 за 2026.
    //
    // Пока здесь стояло `false`, вкладка анализа утверждала, что листы фактов
    // продаж не задевают ни одного индикатора, а предупреждение о нечитаемой
    // сводке `Müştəri İcmalı` объявляло те же четыре индикатора потерянными.
    // Оба утверждения были ложны, и второе едва не привело к записи третьего,
    // несогласованного набора цифр по той же выручке.
    note: "питает вкладку «Продажи»; P&L-индикаторы читают P&L, но концентрация контрагентов выводится отсюда — каждая строка факта называет покупателя",
    match: (i) => i.startsWith("counterparty:"),
  },
  SALES_FORECAST: {
    writes: "SalesForecast.amount (прогноз продаж по департаменту × месяц)",
    note: "ни один индикатор пока не читает sales_forecasts напрямую",
    match: () => false,
  },
  COUNTERPARTY: {
    writes: "Counterparty (топ клиенты/поставщики по обороту → доля %)",
    note: "питает CUSTOMER_HHI / SUPPLIER_HHI через counterpartyHhiResolver",
    match: (i) => i.startsWith("counterparty:"),
  },
  LEGAL_CASES: {
    writes: "Company.settings.courtDisputes (реестр судебных дел)",
    note: "питает LEGAL_CASES_ACTIVE",
    match: () => false,
  },
  AUDIT_FINDINGS: {
    writes: "Company.settings.auditFindings (реестр аудиторских находок)",
    note: "питает AUDIT_CLOSED_PCT / AUDIT_MAJOR_OPEN",
    match: () => false,
  },
  RISK_REGISTER: {
    writes: "Company.settings.riskRegister (KRI taxonomy)",
    note: "распознаётся, но реальный импортёр преждевременен — нет индикатора-потребителя",
    match: () => false,
  },
  UNKNOWN: {
    writes: "Не определено классификатором",
    note: "AI не смог определить тип листа — данные не будут импортированы",
    match: () => false,
  },
}

/**
 * Compute the impact of importing one sheet of a given dataType.
 * Optionally narrowed by entity industry (so KPI_FARMING sheet for a
 * food_processing entity doesn't show agro_crops indicators).
 *
 * @param dataType  Classification result from sheet-classifier.
 * @param options.industries  Optional industries of the target entity —
 *   when present, indicators are filtered to those whose `industries` set
 *   overlaps. Cross-sector indicators (empty `industries`) always pass.
 * @param options.limit  Cap on the returned `indicators` array (default 50).
 */
export function affectedIndicatorsForDataType(
  dataType: SheetDataType,
  options?: { industries?: string[]; limit?: number },
): DataTypeImpact {
  const rule = DATATYPE_RULES[dataType]
  const limit = options?.limit ?? 50
  const targetIndustries = options?.industries

  const out: AffectedIndicator[] = []
  const seen = new Set<string>()

  // ALL_INDICATOR_SEEDS is the union of every industry seed pack + cross-
  // sector. Iterate once; cap by `limit` to keep payload bounded.
  for (const seed of ALL_INDICATOR_SEEDS) {
    if (seen.has(seed.code)) continue
    if (out.length >= limit) break

    // Industry narrow: skip seeds whose industry list doesn't intersect
    // the entity's industries (when an entity industry was provided).
    // Cross-sector seeds (industries: []) are always included.
    if (
      targetIndustries &&
      targetIndustries.length > 0 &&
      seed.industries.length > 0
    ) {
      const hit = seed.industries.some((i) => targetIndustries.includes(i))
      if (!hit) continue
    }

    // Find the first requiredInput that matches the dataType rule.
    let matchedInput: string | null = null
    for (const input of seed.requiredInputs) {
      if (rule.match(input)) {
        matchedInput = input
        break
      }
    }
    if (matchedInput === null) continue

    seen.add(seed.code)
    out.push({
      code: seed.code,
      nameEn: seed.nameEn,
      nameRu: seed.nameRu ?? null,
      nameAz: seed.nameAz ?? null,
      category: seed.category,
      industries: seed.industries,
      matchedInput,
    })
  }

  return {
    dataType,
    writes: rule.writes,
    note: rule.note ?? null,
    indicators: out,
  }
}

/**
 * Map a classifier-returned confidence (0..1) to a coarse trust band the
 * UI can render as red/amber/green. Thresholds match `Indicator Health`'s
 * traffic light scheme.
 *
 *   ≥ 0.85  high   — LLM clearly recognised the sheet structure
 *   ≥ 0.65  medium — pattern matched but several columns ambiguous
 *   <  0.65 low    — LLM was guessing; admin should double-check
 */
export type ConfidenceBand = "high" | "medium" | "low"

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.85) return "high"
  if (confidence >= 0.65) return "medium"
  return "low"
}

/** Human-readable label for a confidence band, in Russian (matches UI lang). */
export function confidenceBandLabel(band: ConfidenceBand): string {
  if (band === "high") return "высокая"
  if (band === "medium") return "средняя"
  return "низкая"
}

/**
 * Convenience for UI: combine band + numeric percentage in one string.
 * "высокая · 92%"
 */
export function confidenceLabel(confidence: number): string {
  const pct = Math.round(Math.max(0, Math.min(1, confidence)) * 100)
  return `${confidenceBandLabel(confidenceBand(confidence))} · ${pct}%`
}
