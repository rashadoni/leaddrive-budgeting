/**
 * Where an indicator's number actually comes from.
 *
 * 2026-07-31 (11.66) — the question this answers was asked live: after a reset
 * that provably emptied every financial table, the Risk Terminal still showed
 * scores and lit tiles. «при удалении почему риск терминал не удален?»
 *
 * The reset was correct. What the screen never said is that an indicator's
 * inputs need not come from the client's workbook at all. Measured on
 * production the morning after the reset — 531 of 6,426 values were non-unknown,
 * and every one of them came from something the import does not write:
 *
 *   204  IND_GOV_CLIMATE_SCORE          ← a CONSTANT (formula `38`, no inputs)
 *    87  FP_WHEAT_PRICE_SIGNAL          ← commodity feed
 *    87  FP_GRAIN_COST_PRESSURE_BLEND   ← commodity feed
 *    42  AGRO_SUGAR_PRICE_TREND         ← commodity feed
 *    42  AGRO_COMMODITY_VOL             ← commodity feed
 *    36  FP_FAO_FOOD_INDEX_SIGNAL       ← index feed
 *    33  AGRO_SALYAN_RAINFALL_14D_FCST  ← weather feed
 *
 * A value shown without its provenance is the same defect this phase has been
 * closing all week in the import pipeline — the number is right and its
 * standing is invisible. Here it is worse than cosmetic: a viewer concludes
 * the delete failed.
 *
 * The prefix taxonomy below is read off PRODUCTION rather than guessed —
 * `SELECT split_part(inp,':',1) … FROM indicator_definitions, unnest(requiredInputs)`
 * on 2026-07-31 returned exactly these families.
 */

/**
 * Input families that arrive from OUTSIDE the client's data — market feeds,
 * weather, FX, news and industry reference tables. None is written by any
 * import path, so all of them survive a reset by design.
 */
const EXTERNAL_INPUT_PREFIXES = [
  "commodityPrice",
  "industryFactor",
  "currencyRate",
  "weather",
  "news",
] as const

export type IndicatorProvenance =
  /** At least one input is data the client supplied (P&L, balance sheet,
   *  operational facts, counterparties, bookings, company settings). */
  | "client-data"
  /** EVERY input is an external feed. Lights up on an empty database. */
  | "external-feed"
  /** No inputs at all — the formula is a literal. Not a measurement. */
  | "constant"

/**
 * The catalog uses BOTH separators — `commodityPrice:sugar_no11` and
 * `news.sentiment30d`, `budgetLine.cogs`, `company.settings.totalRooms` — so
 * the family is whatever precedes the first `:` or `.`. Splitting on the colon
 * alone silently mis-classified `news.sentiment30d` as client data; caught by
 * the test that walks the real production families rather than a fixture.
 */
function inputFamily(input: string): string {
  return input.split(/[:.]/)[0]
}

function isExternalInput(input: string): boolean {
  return (EXTERNAL_INPUT_PREFIXES as readonly string[]).includes(
    inputFamily(input),
  )
}

/**
 * Classify one indicator definition.
 *
 * "external-feed" requires that ALL inputs be external, deliberately: an
 * indicator blending a commodity price with `budgetLine` still needs the
 * client's figures and stays dark on an empty database, so calling it
 * external would be a lie. Checked against production — the all-external rule
 * selects 27 definitions, and the six that were lit after the reset are all
 * among them (the other 21 belong to industries these companies are not in).
 *
 * Lenient on shape, like `isRollupIndicator`: a malformed entry is treated as
 * non-external rather than crashing a render.
 */
export function indicatorProvenance(def: {
  requiredInputs?: string[] | null
}): IndicatorProvenance {
  // An ABSENT field is not the same fact as an EMPTY one.
  //
  // `requiredInputs` is a non-nullable `String[]`, so every real definition
  // carries an array and the matrix always ships it. `undefined` therefore
  // means "this caller did not tell us" — a partial projection, a fixture, a
  // future call site — and answering "constant" there would silently drop the
  // indicator out of every composite score. Caught by four HeatMap tests whose
  // fixtures omit the field: the rule as first written blanked their scores.
  //
  // Unknown provenance defaults to `client-data`, the option that changes
  // nothing: the indicator keeps scoring and gets no provenance marker. A
  // guess must not cost a score.
  if (def.requiredInputs === undefined) return "client-data"
  const inputs = (def.requiredInputs ?? []).filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  )
  if (inputs.length === 0) return "constant"
  return inputs.every(isExternalInput) ? "external-feed" : "client-data"
}

/**
 * Categories whose indicators are INFORMATIONAL — displayed, drill-downable,
 * exported, alertable on their own colour, and deliberately weightless in the
 * financial composite.
 *
 * 2026-07-31 (11.71) — product directive from the owner, not a bug report:
 *
 *   «судебные думаю они были лишние для финансовой платформы»
 *   «они как-то должны быть отдельными и не взаимодействовать с финансовой
 *    частью»
 *
 * The `governance` category holds exactly four definitions — LEGAL_CASES_TOTAL,
 * LEGAL_CASES_ACTIVE, AUDIT_MAJOR_OPEN, AUDIT_CLOSED_PCT (seeded in
 * `seeds/cross-sector.ts`, verified against production: the category contains
 * these four and nothing else). Until now they were ordinary cells averaged
 * alongside gross margin and debt coverage, so importing a court register moved
 * a company's financial score. That is the coupling the directive removes.
 *
 * Note the difference from the constants rule below, because it changes how the
 * exclusion should be read: a constant is INCAPABLE of measuring anything, so
 * dropping it corrects an error. `LEGAL_CASES_ACTIVE` measures something real
 * and is dropped as a matter of POLICY — legal exposure is a fact about the
 * company that the Compliance Hub owns, not an input to a financial number.
 * The indicators stay visible, keep their heat-map columns, keep their red/amber
 * status, keep feeding the red-count alert. Only the arithmetic loses them.
 *
 * Keyed on the CATEGORY rather than a code list on purpose: a fifth legal or
 * audit indicator seeded next month inherits the rule by default. A code list
 * would readmit it to the score silently — the exact failure the directive is
 * asking us to prevent. The four codes are pinned in
 * `indicator-seeds.test.ts` so a rename or an unreviewed addition fails a test
 * instead of quietly changing every score on the terminal.
 */
const NON_SCORING_CATEGORIES = ["governance"] as const

/**
 * True when this category is informational-only (see NON_SCORING_CATEGORIES).
 *
 * Absent / null category ⇒ `false` ⇒ the indicator keeps scoring. Same rule as
 * `indicatorProvenance`'s absent-`requiredInputs` guard: unknown defaults to the
 * option that changes nothing. `IndicatorDefinition.category` is NOT NULL in the
 * schema, so `undefined` here only ever means "this caller did not project the
 * column", and a projection gap must not silently blank a score.
 */
export function isNonScoringCategory(category?: string | null): boolean {
  if (typeof category !== "string") return false
  return (NON_SCORING_CATEGORIES as readonly string[]).includes(category)
}

/**
 * Should this indicator count toward a company's composite risk score?
 *
 * Two independent reasons to say no, composed here so every surface asks one
 * question:
 *
 * 1. Constants must not. `IND_GOV_CLIMATE_SCORE` returns 38 for every company in
 *    every period — 204 identical rows on production — and an amber cell that
 *    can never move was dragging the composite of companies with no data at all.
 *    Averaging a literal into a risk score makes the score partly a statement
 *    about nothing.
 *
 * 2. Informational categories must not — the 11.71 legal/compliance directive
 *    documented on NON_SCORING_CATEGORIES. This one is a product decision about
 *    what a financial score MEANS, not a correctness fix, so it is expressed as
 *    its own predicate rather than folded into the provenance taxonomy. The
 *    taxonomy is load-bearing for the HeatMap `~` / `=` provenance markers
 *    (`HeatMapCellTd.tsx`); teaching it that court cases are "not client data"
 *    would be a lie told to make an unrelated rule fit.
 *
 * External feeds DO count: a sugar price is a real measurement of real risk,
 * merely not one the client reported. Excluding those would throw away the
 * genuine market signal this product exists to surface.
 */
export function countsTowardComposite(def: {
  requiredInputs?: string[] | null
  category?: string | null
}): boolean {
  if (isNonScoringCategory(def.category)) return false
  return indicatorProvenance(def) !== "constant"
}

/** Shape every caller can supply — both fields optional, both defaulting to
 *  "this indicator scores" when the caller did not project them. */
export interface ScoringGateIndicator {
  id: string
  requiredInputs?: string[] | null
  category?: string | null
}

/** The ids whose cells must not move a composite. One pass, shared so no two
 *  surfaces can compute a different set. */
export function nonScoringIndicatorIds(
  indicators: ReadonlyArray<ScoringGateIndicator>,
): Set<string> {
  return new Set(
    indicators.filter((i) => !countsTowardComposite(i)).map((i) => i.id),
  )
}

/**
 * Stamp `scoring: false` on the cells that must not move a composite.
 *
 * THIS is how the rule reaches every surface. 11.66 shipped
 * `excludeNonScoringCells` (below) and wired it at 2 of the 12 places a
 * composite is computed — not through neglect, but because a caller-side filter
 * is invisible by omission and `tsc` cannot notice its absence. The result was
 * that the HeatMap row header and the Panel-3 badge on the SAME SCREEN already
 * disagreed for any company holding an `IND_GOV_CLIMATE_SCORE` cell.
 *
 * Marking instead of filtering moves the decision onto the cell, where
 * `computeCompositeScore` enforces it for every caller including ones written
 * next month. Exactly the pattern `kind` / `isAggregateRollup` already uses for
 * rollup double-aggregation, and `weight` uses for weighted averaging: the cell
 * builder copies a fact off the definition, the aggregator reads it, and no
 * consumer has to remember anything.
 *
 * Idempotent and safe to apply twice (server stamp + client re-stamp).
 */
export function markNonScoringCells<
  C extends { indicatorId: string; scoring?: boolean },
>(cells: readonly C[], indicators: ReadonlyArray<ScoringGateIndicator>): C[] {
  const nonScoring = nonScoringIndicatorIds(indicators)
  if (nonScoring.size === 0) return [...cells]
  return cells.map((c) =>
    nonScoring.has(c.indicatorId) ? { ...c, scoring: false } : c,
  )
}

/**
 * Drop the cells that must not reach `computeCompositeScore`.
 *
 * Equivalent to `markNonScoringCells` in every number it produces — the
 * aggregator skips a marked cell AND leaves it out of `totalCount`, so removing
 * the cell up front yields the identical `score` / `contributingCount` /
 * `totalCount` triple. Kept for callers that genuinely want the shorter list
 * (and for the tests that pin the equivalence); prefer marking, so the cell
 * survives for rendering and the gate stays enforceable downstream.
 *
 * `totalCount` shrinks either way. For constants the justification is that
 * coverage must count the indicators that COULD have scored, not ones incapable
 * of measuring anything. For the governance four it is a deliberate second
 * decision with a different justification, spelled out in `composite-score.ts`:
 * the coverage fraction answers "of the indicators that feed this score, how
 * many have data", so an indicator excluded from the score must leave the
 * denominator too — otherwise "5 / 104" describes a population of 104 that the
 * 5 were never averaged against.
 */
export function excludeNonScoringCells<C extends { indicatorId: string }>(
  cells: readonly C[],
  indicators: ReadonlyArray<ScoringGateIndicator>,
): C[] {
  const nonScoring = nonScoringIndicatorIds(indicators)
  if (nonScoring.size === 0) return [...cells]
  return cells.filter((c) => !nonScoring.has(c.indicatorId))
}
