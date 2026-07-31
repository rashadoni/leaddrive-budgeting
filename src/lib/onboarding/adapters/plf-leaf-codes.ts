/**
 * Which P&L codes are LEAVES — the rows whose money must be imported.
 *
 * 2026-07-31 (11.70) — a row-level reconciliation of production against
 * `actual-budget-v1.xlsx` found real money missing:
 *
 *   PLF Budget 2026!E768 / G768  AZSF  PLF.09.01  −40,000.00 ×2  = 80,000.00
 *   PLF Actual 2026!F768         EDEN  PLF.09.01  −34,500.00
 *
 * `PLF.09.01` "Shareholders' expense" reached no database row at all. The
 * cause is that leafness was decided by the SHAPE of the code —
 *
 *   /^(PLF|CF)\.\d{2}\.\d{2}\.([0-9]{1,2}|[A-Za-z]{1,2})$/
 *
 * — i.e. "four segments". `PLF.09.01` has three, so it was read as a
 * subtotal and skipped, even though it has no children anywhere in the sheet
 * while its siblings `PLF.09.02/03/04` all do. Depth is a proxy for leafness;
 * this file uses the real thing — a code is a leaf when nothing descends
 * from it.
 *
 * 80,000 is 0.06% of the sheet and **10.8% of AZSF's entire activity**: it
 * understated that company's budgeted loss by a third. And the import
 * reported GREEN with `evidence: db-readback`, because post-write
 * reconciliation compares what was PARSED against what was WRITTEN — a row
 * dropped during parsing never enters the expected set, so there is nothing
 * for it to disagree with. See 11.71.
 *
 * Two traps this must not fall into, both real codes in this workbook:
 *
 *   `PLF.05.R`        childless by naive prefix search, yet a PARENT: `.R`
 *                     ("Regions") is a SUFFIX marking a parallel namespace,
 *                     so its children are `PLF.05.01.R`, not `PLF.05.R.xx`.
 *                     Importing it would double-count every region.
 *   `PLF.05.01.01.R`  a genuine childless leaf, but its ancestor
 *                     `PLF.05.01.R` is ALREADY imported by the shape rule.
 *                     Importing both would double-count again.
 *
 * Hence the rule is deliberately additive: the shape rule keeps deciding
 * everything it already decided, and a code it REJECTS is rescued only when
 * it has no descendants and no already-imported ancestor. Nothing that is
 * imported today stops being imported.
 *
 * ---------------------------------------------------------------------------
 * 2026-07-31 (11.74) — the first version of the above was WRONG, and a dry-run
 * against the real workbook caught it before it reached the database.
 *
 * "Childless" is not the same as "leaf". A statement SECTION code carries the
 * section's computed subtotal and has no children when nothing is broken out
 * beneath it:
 *
 *   PLF.03  GROSS MARGIN     childless in all three PLF sheets
 *   PLF.08  EBITDA           childless in the 2026 chart of accounts
 *   PLF.10  NET PROFIT       childless everywhere
 *
 * `plfAccountType` special-cased only `PLF.10`, so rescuing by childlessness
 * alone emitted GROSS MARGIN and EBITDA as ordinary expense lines —
 * 34,393,596 AZN of phantom cost in `PLF Budget 2026` alone, on top of the
 * real numbers it was already double-counting elsewhere.
 *
 * Worse, those two rows are POSITIVE in a sheet whose costs are negative, so
 * they poisoned the cost-sign evidence: six business-unit blocks fell from
 * `negative_costs` to `ambiguous`, which fails Gate A and aborts the whole
 * import before a transaction opens. The bug's own side effect was the only
 * thing stopping it from landing.
 *
 * The distinguishing property is DEPTH, and it is structural rather than
 * cosmetic: `PLF.NN` is a section of the statement, never a posting account.
 * Every posting account in this chart lives at `PLF.NN.NN` or deeper. So a
 * rescue additionally requires at least two numeric segments.
 *
 * Why the original tests missed it: they asserted `PLF.03` and `PLF.10` were
 * not rescued, but supplied invented children (`PLF.03.01.01`) that do not
 * exist in the workbook. The fixture disagreed with the file sitting next to
 * it, and the shape of the assertion hid that. The codes below are now read
 * out of the real sheets.
 */

/** The historical shape rule. Everything it accepts stays a leaf. */
export const LEAF_CODE_RE =
  /^(PLF|CF)\.\d{2}\.\d{2}\.([0-9]{1,2}|[A-Za-z]{1,2})$/

/**
 * Split a code into its numeric path and its namespace suffix.
 *
 * `PLF.05.01.R` → path `PLF.05.01`, ns `R`
 * `PLF.09.01`   → path `PLF.09.01`, ns `""`
 *
 * Without this, `PLF.05.R` looks childless and `PLF.05.01.R` looks like its
 * sibling rather than its child.
 */
function splitNamespace(code: string): { path: string; ns: string } {
  const m = code.match(/^((?:PLF|CF)(?:\.\d{2})+)\.([A-Za-z]{1,2})$/)
  return m ? { path: m[1], ns: m[2] } : { path: code, ns: "" }
}

/**
 * A rescued code must be at least `PLF.NN.NN` deep.
 *
 * One numeric segment is a statement SECTION — REVENUE, GROSS MARGIN, EBITDA,
 * NET PROFIT. Sections whose detail is broken out have children and are
 * excluded by `hasDescendant`; sections that state only a computed subtotal
 * have none, and depth is the only thing separating them from a real account.
 * Applies to the namespace-stripped path, so `PLF.05.R` (path `PLF.05`) is a
 * section too.
 */
const RESCUE_MIN_DEPTH_RE = /^(?:PLF|CF)(?:\.\d{2}){2,}$/

/**
 * Decide leafness for every code on a sheet at once.
 *
 * Needs the WHOLE code set: "has no descendants" is not a property of a code
 * in isolation. Returns a predicate so the caller keeps its single pass.
 */
export function buildLeafPredicate(
  allCodes: readonly string[],
): (code: string) => boolean {
  const parsed = allCodes
    .filter((c): c is string => typeof c === "string" && c.length > 0)
    .map((c) => ({ code: c, ...splitNamespace(c) }))

  const shapeAccepted = new Set(
    parsed.filter((p) => LEAF_CODE_RE.test(p.code)).map((p) => p.code),
  )

  /** Any other code in the SAME namespace sitting below this one. */
  const hasDescendant = (p: { path: string; ns: string }) =>
    parsed.some(
      (o) => o.ns === p.ns && o.path !== p.path && o.path.startsWith(`${p.path}.`),
    )

  /** An ancestor in the same namespace that the shape rule already imports. */
  const hasImportedAncestor = (p: { path: string; ns: string }) =>
    parsed.some(
      (o) =>
        o.ns === p.ns &&
        o.path !== p.path &&
        p.path.startsWith(`${o.path}.`) &&
        shapeAccepted.has(o.code),
    )

  const rescued = new Set(
    parsed
      .filter(
        (p) =>
          !shapeAccepted.has(p.code) &&
          RESCUE_MIN_DEPTH_RE.test(p.path) &&
          !hasDescendant(p) &&
          !hasImportedAncestor(p),
      )
      .map((p) => p.code),
  )

  return (code: string) => shapeAccepted.has(code) || rescued.has(code)
}
