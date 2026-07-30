/**
 * Phase 11.9 (2026-07-29) — shared cost-sign resolution for the AI import path.
 *
 * The split this closes
 * ─────────────────────
 * `ai-mapper/sign-infer.ts` was written in Phase C precisely against the
 * "always flip costs" bug, and it was wired into ONE path: the staging
 * applier (`ai-mapper/applier.ts`). The AI Auto Import production adapters
 * never got it — `azseker-plf.ts`, `dynamic-plf-adapter.ts` and
 * `reporting-pack-detail.ts` each apply an unconditional `-raw` to every
 * cogs/expense cell.
 *
 * So the same workbook produces OPPOSITE signs depending on which tab the
 * user uploaded it through. For the current AZSEKER files (costs stored
 * negative) the unconditional flip happens to be correct, which is exactly
 * why this stayed invisible. Any debit-convention file — the typical SAP or
 * 1C export, i.e. the shape a second client arrives with — is silently
 * corrupted: negating an already-positive cost turns gross profit into
 * revenue PLUS cost.
 *
 * What this adds over calling `classifyCostSign` directly: the two cost
 * sections are classified INDEPENDENTLY (a file can store COGS negative and
 * opex positive), and the ambiguous verdict is turned into a blocking reason
 * rather than a silent choice — guessing the sign of every cost in a
 * financial statement is not a decision an importer gets to make quietly.
 */
import {
  classifyCostSign,
  type SignConvention,
} from "../ai-mapper/sign-infer"

export interface CostSignDecision {
  /** Negate raw COGS cells to reach the DB's positive-cost convention. */
  flipCogs: boolean
  /** Negate raw expense cells. */
  flipExpense: boolean
  cogsConvention: SignConvention
  expenseConvention: SignConvention
  /**
   * Set when a section's convention could not be established. The caller
   * must surface this as `blocked` so the import aborts before any write
   * instead of committing numbers whose sign is a coin flip.
   */
  blockedReason: string | null
  /** Human-readable trail for the import warnings list. */
  notes: string[]
}

function describe(section: string, convention: SignConvention): string {
  switch (convention) {
    case "negative_costs":
      return `${section}: stored NEGATIVE — flipping to positive`
    case "positive_costs":
      return `${section}: stored POSITIVE (debit convention) — NOT flipping`
    case "no_evidence":
      return `${section}: no non-zero rows — default convention kept`
    case "ambiguous":
      return `${section}: AMBIGUOUS — mixed signs with no clear majority`
  }
}

/**
 * Decide, per cost section, whether raw cells must be negated.
 *
 * @param cogsRawAnnuals    Per-row RAW (pre-flip) annual totals of COGS rows.
 * @param expenseRawAnnuals Same for expense rows.
 *
 * Pass RAW annuals — the classifier's whole job is to read the file's stored
 * convention, so feeding it already-flipped values would just confirm
 * whatever the caller assumed.
 */

/**
 * 2026-07-30 — is this line INCOME, sitting inside a cost section?
 *
 * The defect this closes
 * ──────────────────────
 * A chart of accounts routinely files income under a section the mapper
 * classifies as expense — AzerSheker's `PLF.07` is literally titled "OTHER
 * OPERATING INCOME/EXPENSES" and holds Subsidies and Interest Income. Those
 * lines are legitimately POSITIVE while real costs are stored negative, so
 * feeding them to the sign classifier poisons the very evidence it reasons
 * over.
 *
 * Measured on `actual-budget-v1.xlsx`, entity EDEN: four income leaves worth
 * ₼3.25M against ₼6.7M of real costs dragged the negative share to 0.673 —
 * under the 0.70 floor — so the classifier correctly refused to guess and the
 * routing gate blocked the whole import. The data was never wrong; the
 * evidence population was.
 *
 * This is deliberately about EVIDENCE only. An income line still receives the
 * section's decision, so its sign keeps behaving exactly as before — a
 * negative expense IS income, which is what the historical, bit-verified
 * import produced. What changes is that it no longer VOTES on how costs are
 * stored.
 *
 * Cross-language and prefix-free on purpose: the next client's chart will not
 * be numbered `PLF.xx`, but its labels will still say income / gəlir / доход.
 */
const INCOME_NATURED =
  /(income|subsid|grant|rebate|reimburse|g[əe]lir|dotasiya|доход|субсид|дотац|возмещ)/i

/**
 * Words that make an income-looking label an EXPENSE after all. "Income tax"
 * is the case that matters: it contains "income" and is a cost.
 */
const NOT_INCOME = /(tax|vergi|налог|expense|x[əe]rc|расход|cost|maya)/i

export function isIncomeNaturedLabel(label: string | null | undefined): boolean {
  if (!label) return false
  return INCOME_NATURED.test(label) && !NOT_INCOME.test(label)
}

/**
 * Drop income-natured rows from a sign-evidence population.
 *
 * `labels` is positional against `annuals`; a missing label keeps the row (an
 * unlabelled line is not evidence that it is income).
 */
function costEvidenceOnly(
  annuals: readonly number[],
  labels: readonly (string | null | undefined)[] | undefined,
): number[] {
  if (!labels) return [...annuals]
  return annuals.filter((_, i) => !isIncomeNaturedLabel(labels[i]))
}

export function resolveCostSigns(
  cogsRawAnnuals: readonly number[],
  expenseRawAnnuals: readonly number[],
  /**
   * 2026-07-30 — row labels, positional against the arrays above. When given,
   * income-natured lines are excluded from the EVIDENCE (see
   * {@link isIncomeNaturedLabel}); the resulting decision still applies to
   * every row. Omitting them keeps the pre-2026-07-30 behaviour exactly.
   */
  labels?: {
    cogs?: readonly (string | null | undefined)[]
    expense?: readonly (string | null | undefined)[]
  },
): CostSignDecision {
  const cogs = classifyCostSign(costEvidenceOnly(cogsRawAnnuals, labels?.cogs))
  const expense = classifyCostSign(
    costEvidenceOnly(expenseRawAnnuals, labels?.expense),
  )

  const ambiguous: string[] = []
  if (cogs.convention === "ambiguous") ambiguous.push("COGS")
  if (expense.convention === "ambiguous") ambiguous.push("expenses")

  return {
    // `no_evidence` keeps the historical default (flip). It only occurs when
    // every row in the section is zero, so the choice cannot change a number.
    flipCogs: cogs.convention !== "positive_costs",
    flipExpense: expense.convention !== "positive_costs",
    cogsConvention: cogs.convention,
    expenseConvention: expense.convention,
    blockedReason:
      ambiguous.length > 0
        ? `cost-sign convention is ambiguous for ${ambiguous.join(" and ")} — ` +
          `mixed positive and negative rows with no clear majority. Importing ` +
          `would guess the sign of every cost in this statement. Split the ` +
          `contra/correction rows out, or confirm the convention explicitly.`
        : null,
    notes: [describe("COGS", cogs.convention), describe("Expenses", expense.convention)],
  }
}
