/**
 * Currency evidence normalisation for generic AI-import writes.
 *
 * `plannedAmount` is always the reported/base-currency amount. A foreign
 * source amount is admissible only with its ISO code and explicit historical
 * conversion rate; this module never consults a current rate or assumes 1:1.
 */

export interface CurrencyEvidenceInput {
  plannedAmount: number
  baseCurrencyCode: string
  currencyCode?: string | null
  originalAmount?: number | null
  exchangeRate?: number | null
}

export interface NormalizedCurrencyEvidence {
  plannedAmount: number
  currencyCode: string
  originalAmount: number | null
  exchangeRate: number | null
}

export interface ParsedLineCurrencyEvidence {
  currencyCode?: string | null
  exchangeRate?: number | null
  originalPerMonth?: Array<number | null>
}

/** One basis point, floored at one minor unit, is the deterministic tie-out tolerance. */
export const CURRENCY_EVIDENCE_TOLERANCE_BPS = 1

function normalizedIso(value: string, label: string): string {
  const normalized = value.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error(`${label} must be a three-letter ISO currency code`)
  }
  return normalized
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function allowedDelta(expectedBase: number): number {
  return Math.max(0.01, Math.abs(expectedBase) * (CURRENCY_EVIDENCE_TOLERANCE_BPS / 10_000))
}

/**
 * `amount:*` is the canonical reporting/base amount. A currency tag on those
 * selected columns may disambiguate parallel columns, but it may not turn the
 * canonical amount into a foreign amount. Foreign currency belongs only in
 * the separate source evidence fields.
 */
export function assertReportingCurrencyMatchesBase(
  reportingCurrencyCode: string | null | undefined,
  baseCurrencyCode: string,
): void {
  if (reportingCurrencyCode == null || reportingCurrencyCode.trim() === "") return
  const reporting = normalizedIso(reportingCurrencyCode, "Reporting currency")
  const base = normalizedIso(baseCurrencyCode, "Base currency")
  if (reporting !== base) {
    throw new Error(
      `Reported amount currency ${reporting} must equal company base currency ${base}`,
    )
  }
}

/**
 * Normalise one row/month's currency evidence for persistence.
 *
 * Base and untagged rows preserve their reported base amount without a rate.
 * Foreign rows require finite source amount + finite positive rate, and the
 * reported base amount must tie to source × rate within the stated tolerance.
 */
export function normalizeCurrencyEvidence(
  input: CurrencyEvidenceInput,
): NormalizedCurrencyEvidence {
  if (!finite(input.plannedAmount)) {
    throw new Error("Reported base amount must be finite")
  }
  const baseCurrencyCode = normalizedIso(input.baseCurrencyCode, "Base currency")
  if (
    (input.currencyCode == null || input.currencyCode.trim() === "") &&
    (input.originalAmount != null || input.exchangeRate != null)
  ) {
    throw new Error("Source amount/rate evidence requires an explicit source currency")
  }
  const currencyCode = input.currencyCode == null || input.currencyCode.trim() === ""
    ? baseCurrencyCode
    : normalizedIso(input.currencyCode, "Currency")

  if (currencyCode === baseCurrencyCode) {
    return {
      plannedAmount: input.plannedAmount,
      currencyCode: baseCurrencyCode,
      originalAmount: null,
      exchangeRate: null,
    }
  }

  if (!finite(input.originalAmount)) {
    throw new Error(`Foreign ${currencyCode} row requires a finite source amount`)
  }
  if (!finite(input.exchangeRate) || input.exchangeRate <= 0) {
    throw new Error(`Foreign ${currencyCode} row requires a finite positive historical exchange rate`)
  }

  const expectedBase = input.originalAmount * input.exchangeRate
  if (
    !Number.isFinite(expectedBase) ||
    Math.abs(input.plannedAmount - expectedBase) > allowedDelta(expectedBase)
  ) {
    throw new Error(
      `Foreign ${currencyCode} row source/base/rate evidence does not tie within ${CURRENCY_EVIDENCE_TOLERANCE_BPS}bp`,
    )
  }

  return {
    plannedAmount: input.plannedAmount,
    currencyCode,
    originalAmount: input.originalAmount,
    exchangeRate: input.exchangeRate,
  }
}

/** Adapts a parsed P&L line to the per-row persistence contract. */
export function normalizeParsedLineCurrencyEvidence(input: {
  plannedAmount: number
  monthIndex: number
  baseCurrencyCode: string
  evidence?: ParsedLineCurrencyEvidence
  defaultCurrencyCode?: string | null
}): NormalizedCurrencyEvidence {
  const evidence = input.evidence
  return normalizeCurrencyEvidence({
    plannedAmount: input.plannedAmount,
    baseCurrencyCode: input.baseCurrencyCode,
    currencyCode: evidence?.currencyCode ?? input.defaultCurrencyCode,
    originalAmount: evidence?.originalPerMonth?.[input.monthIndex] ?? null,
    exchangeRate: evidence?.exchangeRate ?? null,
  })
}

/** Validate every monthly write before a caller starts a destructive transaction. */
export function assertParsedLinesCurrencyEvidence(
  lines: ReadonlyArray<{
    perMonth: number[]
    currencyEvidence?: ParsedLineCurrencyEvidence
  }>,
  baseCurrencyCode: string,
  defaultCurrencyCode?: string | null,
): void {
  for (const line of lines) {
    if (!line.currencyEvidence) {
      normalizeCurrencyEvidence({
        plannedAmount: 0,
        baseCurrencyCode,
        currencyCode: defaultCurrencyCode,
      })
      continue
    }
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      normalizeParsedLineCurrencyEvidence({
        plannedAmount: line.perMonth[monthIndex] ?? 0,
        monthIndex,
        baseCurrencyCode,
        evidence: line.currencyEvidence,
        defaultCurrencyCode,
      })
    }
  }
}
