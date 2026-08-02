/**
 * Phase 14.6 (2026-08-02) — what an empty cell is actually waiting for.
 *
 * Clicking an empty cell has always said the same sentence, whatever the cell:
 *
 *   «{indicator} ещё не вычислен для {company}.
 *    Загрузите данные через /budgeting/onboarding или запустите пересчёт.»
 *
 * For most cells that advice is wrong, and for some it is worse than nothing —
 * "run a recompute" on a cell whose input does not exist sends a person to do
 * something that cannot possibly help, and then to wonder what they did wrong.
 *
 * The product already knows the answer. `IndicatorDefinition.requiredInputs`
 * names exactly what each formula reads, and every one of those namespaces has
 * a different remedy in a different place. Measured on production for 2026 —
 * 580 (company × indicator) pairs with no value at all:
 *
 *     276  budgetLine          → the workbook, re-imported
 *     172  operationalFact     → the agronomy panel, which already exists
 *     161  commodity / weather / news → a feed run, not an upload
 *      35  booking             → not applicable to this holding
 *      28  company.settings    → the settings form, which already exists
 *      18  balanceSheetLine    → a balance sheet for that company
 *
 * Only the first group is served by the sentence everyone gets. Two of the
 * groups have a surface that already exists and nothing points at it.
 *
 * Pure and side-effect free: the panel renders it, and any other surface that
 * wants to explain a gap can use the same answer rather than inventing a
 * second vocabulary.
 */

/** Where the missing input comes from, and therefore who can supply it. */
export type RemedyKind =
  /** A workbook the client sends. Re-import fixes it. */
  | "import_workbook"
  /** A figure a person types — the surface exists. */
  | "manual_entry"
  /** A per-company setting a person picks — the surface exists. */
  | "company_setting"
  /** An external series. No upload and no recompute will conjure it. */
  | "external_feed"
  /** Computed from other cells; fix those and this follows. */
  | "derived"
  /** Nothing to supply — the pair does not apply to this business. */
  | "not_applicable"
  /** The namespace is not one this module knows. */
  | "unknown"

export interface Remedy {
  kind: RemedyKind
  /** The input namespace that decided it, for the caller to show verbatim. */
  input: string
}

/**
 * Which remedy a single required input implies.
 *
 * Ordered longest-prefix-first where namespaces overlap, so `company.settings.`
 * is not swallowed by a broader `company` rule if one is ever added.
 */
function remedyForInput(input: string): RemedyKind {
  if (input.startsWith("operationalFact")) return "manual_entry"
  if (input.startsWith("company.settings")) return "company_setting"
  if (
    input.startsWith("budgetLine") ||
    input.startsWith("balanceSheetLine") ||
    input.startsWith("cashFlow") ||
    input.startsWith("budgetActual") ||
    input.startsWith("salesBudgetLine") ||
    input.startsWith("counterparty")
  ) {
    return "import_workbook"
  }
  if (
    input.startsWith("commodity") ||
    input.startsWith("weather") ||
    input.startsWith("newsSentiment") ||
    input.startsWith("currencyRate") ||
    input.startsWith("industryFactor")
  ) {
    return "external_feed"
  }
  if (input.startsWith("rollup") || input.startsWith("fact")) return "derived"
  if (input.startsWith("booking")) return "not_applicable"
  return "unknown"
}

/**
 * How much a reader can do about it, worst-actionable first.
 *
 * When a formula reads several namespaces the cell needs ALL of them, so the
 * advice has to name the one the reader can act on. A cell waiting on both a
 * workbook and a feed is unblocked by the workbook only after the feed runs —
 * but telling someone "run the feed" when they also owe a file leaves them
 * stuck a second time. Ranking by what a person can personally do puts the
 * actionable remedy first and keeps the rest visible in `alsoNeeds`.
 */
const ACTIONABILITY: RemedyKind[] = [
  "manual_entry",
  "company_setting",
  "import_workbook",
  "external_feed",
  "derived",
  "not_applicable",
  "unknown",
]

export interface MissingCellExplanation {
  /** The remedy to lead with. Null when the indicator declares no inputs. */
  primary: Remedy | null
  /** Every other distinct remedy this cell also waits on. */
  alsoNeeds: Remedy[]
}

/**
 * Explain an empty cell from its indicator's declared inputs.
 *
 * Returns `primary: null` rather than guessing when `requiredInputs` is empty —
 * an indicator that declares nothing is a seed-data problem, and inventing
 * advice for it would send someone to fix the wrong thing.
 */
export function explainMissingCell(
  requiredInputs: readonly string[] | null | undefined,
): MissingCellExplanation {
  const inputs = (requiredInputs ?? []).filter((i) => typeof i === "string" && i)
  if (inputs.length === 0) return { primary: null, alsoNeeds: [] }

  const byKind = new Map<RemedyKind, string>()
  for (const input of inputs) {
    const kind = remedyForInput(input)
    if (!byKind.has(kind)) byKind.set(kind, input)
  }
  const ranked = ACTIONABILITY.filter((k) => byKind.has(k)).map((k) => ({
    kind: k,
    input: byKind.get(k)!,
  }))
  return { primary: ranked[0] ?? null, alsoNeeds: ranked.slice(1) }
}

/** The i18n key for a remedy, under `terminal.indicatorDetail.remedy`. */
export function remedyKey(kind: RemedyKind): string {
  return `indicatorDetail.remedy.${kind}`
}
