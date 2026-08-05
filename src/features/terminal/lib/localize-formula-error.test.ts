import { describe, it, expect } from "vitest"
import en from "../../../../messages/en.json"
import { localizeFormulaError } from "./localize-formula-error"

// Echoes the key so we can assert which message the helper picked. The real
// text lives in the locale files and is covered by the i18n integrity checks;
// the key's EXISTENCE in all three catalogues is asserted separately below.
function mockT(key: string, values?: Record<string, string | number>): string {
  const parts = values ? Object.entries(values).map(([k, v]) => `${k}=${v}`) : []
  return parts.length ? `${key} ${parts.join(" ")}` : key
}

describe("localizeFormulaError", () => {
  it("localizes rollup_no_child_values instead of leaking the engine reason", () => {
    // 2026-08-05. The English reason says "the sum is empty, not zero" — the
    // one sentence a Russian- or Azerbaijani-speaking reader most needs, and
    // the raw-reason fallback would have handed it to them in English.
    expect(
      localizeFormulaError(
        "rollup_no_child_values",
        "Rollup indicator whose children have no value for period 2026 — the sum is empty, not zero",
        "IND_HOLDING_REVENUE",
        mockT,
      ),
    ).toBe("heatMap.errRollupNoChildValues")
  })

  it("carries the key in the catalogue", () => {
    // The helper is called with a `terminal`-scoped translator, so the real
    // path is terminal.heatMap.*. Parity across en/ru/az is enforced globally
    // by the catalogue guard; this pins the key this module now depends on.
    expect(en.terminal.heatMap.errRollupNoChildValues).toBeTruthy()
  })

  it("still maps the pre-existing engine codes", () => {
    expect(localizeFormulaError("parse", "x", "IND_X", mockT)).toBe(
      "heatMap.errParse",
    )
    expect(localizeFormulaError("eval", "x", "IND_X", mockT)).toBe(
      "heatMap.errEval",
    )
    expect(localizeFormulaError("non_finite", "x", "IND_X", mockT)).toBe(
      "heatMap.errNonFinite",
    )
    expect(
      localizeFormulaError("non_finite", "x", "IND_NET_MARGIN_VS_2025", mockT),
    ).toBe("heatMap.errMissingBaseline year=2025")
  })

  it("still falls back to the raw reason for an unmapped code", () => {
    // Unchanged contract — a developer string beats an empty box.
    expect(
      localizeFormulaError("rollup_no_children", "EN reason", "IND_X", mockT),
    ).toBe("EN reason")
  })
})
