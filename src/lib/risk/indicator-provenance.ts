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
 * Should this indicator count toward a company's composite risk score?
 *
 * Constants must not. `IND_GOV_CLIMATE_SCORE` returns 38 for every company in
 * every period — 204 identical rows on production — and an amber cell that can
 * never move was dragging the composite of companies with no data at all.
 * Averaging a literal into a risk score makes the score partly a statement
 * about nothing.
 *
 * External feeds DO count: a sugar price is a real measurement of real risk,
 * merely not one the client reported. Excluding those would throw away the
 * genuine market signal this product exists to surface.
 */
export function countsTowardComposite(def: {
  requiredInputs?: string[] | null
}): boolean {
  return indicatorProvenance(def) !== "constant"
}

/**
 * Drop the cells that must not reach `computeCompositeScore`.
 *
 * Shared so the CompanyTree badge and the HeatMap row header cannot diverge —
 * the same worry that produced `buildRiskTagsByCompanyId`. A score that
 * differs between two panels of one screen is worse than either number.
 *
 * Only constants are dropped, and `totalCount` shrinks with them: the coverage
 * a company sees ("5 / 104") must count the indicators that COULD have scored,
 * not ones that are incapable of measuring anything.
 */
export function excludeNonScoringCells<C extends { indicatorId: string }>(
  cells: readonly C[],
  indicators: ReadonlyArray<{ id: string; requiredInputs?: string[] | null }>,
): C[] {
  const nonScoring = new Set(
    indicators.filter((i) => !countsTowardComposite(i)).map((i) => i.id),
  )
  if (nonScoring.size === 0) return [...cells]
  return cells.filter((c) => !nonScoring.has(c.indicatorId))
}
