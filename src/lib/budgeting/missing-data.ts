/**
 * Why a budgeting comparison has nothing to compare against — as a code, not
 * a sentence.
 *
 * 2026-08-02 (11.90) — three routes built these notices as English prose and
 * returned them in `missingData: string[]`; four components printed them
 * verbatim. On an Azerbaijani page the amber "no data" callout therefore read
 * in English, directly beside copy that 11.75 had just translated. The sweep
 * that fixed the components could not reach these, because they are assembled
 * on the server where no `t()` exists.
 *
 * The server names the situation; the client says it in the reader's language.
 * That is the only split that works here — a locale is a property of the
 * viewer, and the API has several viewers.
 *
 * Kept deliberately small. Three codes cover every case the three routes
 * produce, and a fourth would need a reason: a growing enum of near-identical
 * "X is missing" strings is the prose problem again with extra steps.
 */

/** Which dataset a notice is about. Names the business object, not the table. */
export type MissingDataset = "pnl" | "cogs" | "product"

export type MissingDataNotice =
  /** The other side of the comparison has no plan at all for this year. */
  | { code: "counterpartPlan"; kind: "budget" | "actual"; year: number }
  /** A plan exists but carries no budget rows of this dataset. */
  | { code: "budgetRows"; dataset: MissingDataset }
  /** A plan exists but carries no actual rows of this dataset. */
  | { code: "actualRows"; dataset: MissingDataset }

/**
 * Assemble the notices for one comparison.
 *
 * Takes booleans rather than the rows themselves so the three call sites
 * cannot drift on what "has rows" means — `cogs` counted `cogsLines.length`,
 * `sales-budget` counted `lines.length` and `pnl` had two different
 * conditions, and every one of them was re-implemented inline.
 */
export function buildMissingData(input: {
  dataset: MissingDataset
  /** Absent counterpart plan → its kind; null when the plan exists. */
  missingCounterpartKind: "budget" | "actual" | null
  year: number
  hasBudgetRows: boolean
  hasActualRows: boolean
}): MissingDataNotice[] {
  const out: MissingDataNotice[] = []
  if (input.missingCounterpartKind) {
    out.push({
      code: "counterpartPlan",
      kind: input.missingCounterpartKind,
      year: input.year,
    })
  }
  if (!input.hasBudgetRows) out.push({ code: "budgetRows", dataset: input.dataset })
  if (!input.hasActualRows) out.push({ code: "actualRows", dataset: input.dataset })
  return out
}

/**
 * The i18n key a notice renders through, under the `budgeting` namespace.
 *
 * The dataset travels as a PARAM rather than being baked into the key, so a
 * translator writes "no budget {dataset} rows for this year" once instead of
 * three times and cannot leave one of the three behind — which is how
 * `pnlMarginCaption` survived a whole catalogue sweep in lowercase.
 */
export function missingDataKey(n: MissingDataNotice): string {
  // The counterpart's kind picks the KEY rather than travelling as a param:
  // "no budget plan" and "no actual plan" decline differently in Azerbaijani
  // and Russian, and a translator handed `{kind}` can only guess a case.
  if (n.code === "counterpartPlan") {
    return n.kind === "budget"
      ? "missing.counterpartPlanBudget"
      : "missing.counterpartPlanActual"
  }
  return `missing.${n.code}`
}

/** ICU params for `missingDataKey(n)`. Dataset resolves to its own key. */
export function missingDataParams(
  n: MissingDataNotice,
  datasetLabel: (d: MissingDataset) => string,
): Record<string, string | number> {
  if (n.code === "counterpartPlan") {
    return { kind: n.kind, year: n.year }
  }
  return { dataset: datasetLabel(n.dataset) }
}
