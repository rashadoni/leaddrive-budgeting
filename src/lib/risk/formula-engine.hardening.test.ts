/**
 * Phase 12 / A09 (2026-08-02) — `expr-eval` has two open advisories and NO
 * fixed version. This pins why that is survivable here.
 *
 *   GHSA-8gw3-rxh4-v6jx  prototype pollution                     CVSS 7.3
 *   GHSA-jc85-fpwf-qm7x  does not restrict functions passed to evaluate
 *
 * Two facts make them unreachable in this product, and both are the kind that
 * quietly stop being true:
 *
 *  1. The parser is constructed with `assignment: false`. Prototype pollution
 *     in expr-eval goes through assignment expressions; without the operator
 *     there is no expression to write. Someone tidying that options object
 *     would re-open a CVSS 7.3 without touching anything named "security".
 *
 *  2. Formulas are not user input. There is no API anywhere in `src/app` that
 *     creates or updates an `IndicatorDefinition` — verified by search on
 *     2026-08-02 — so a formula reaches this engine only from a seed script
 *     run by someone who already has database access.
 *
 * This suite guards (1), which is code. (2) is guarded by there being no
 * route, which nothing can assert; if an indicator-editing API is ever added,
 * this file is the reason to revisit the dependency rather than the reason to
 * relax about it.
 */
import { describe, it, expect } from "vitest"
import { tryEvaluateFormula } from "./formula-engine"

describe("formula engine — the expr-eval mitigations", () => {
  it("refuses assignment, which is how the prototype-pollution PoC is written", () => {
    for (const formula of [
      "x = 1",
      "a.__proto__.polluted = 1",
      "constructor.prototype.polluted = 1",
    ]) {
      const res = tryEvaluateFormula(formula, { x: 1, a: 1 })
      expect(res.ok, `${formula} must not evaluate`).toBe(false)
    }
    // And nothing leaked onto Object.prototype along the way.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it("refuses the operators the engine never needed", () => {
    // Each was disabled deliberately; a formula using one must fail rather
    // than quietly acquire a capability the threat model excluded.
    expect(tryEvaluateFormula('"a" || "b"', {}).ok).toBe(false) // concatenate
    expect(tryEvaluateFormula("5!", {}).ok).toBe(false) // factorial
    expect(tryEvaluateFormula("1 in [1,2]", {}).ok).toBe(false) // in
  })

  it("still computes the arithmetic every indicator depends on", () => {
    // The mitigations must not be so broad that they break the product; this
    // is what stops a future reader loosening them for the wrong reason.
    const r = tryEvaluateFormula("(revenue - cogs) / revenue * 100", {
      revenue: 58_880_102.23,
      cogs: 38_699_923.16,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBeCloseTo(34.27, 1)
    expect(tryEvaluateFormula("a > b ? a : b", { a: 3, b: 7 })).toEqual({
      ok: true,
      value: 7,
    })
  })

  it("returns a typed failure instead of throwing, whatever it is handed", () => {
    // `tryEvaluateFormula` is the variant recompute uses precisely because it
    // does not throw: it runs over thousands of pairs, and an exception
    // escaping would abort a whole tenant's run rather than mark one cell.
    // (`evaluateFormula` is the throwing sibling, for the scenario preview.)
    for (const junk of ["", "((", "1 +", "totally not a formula"]) {
      expect(() => tryEvaluateFormula(junk, {})).not.toThrow()
      expect(tryEvaluateFormula(junk, {}).ok).toBe(false)
    }
  })
})
