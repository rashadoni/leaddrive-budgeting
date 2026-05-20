/**
 * Phase 7.M Step 2 — `deriveSignalConfidence` unit tests.
 *
 * Locks the decision table so a future "let's downgrade computed cells
 * to medium" change is a deliberate edit + test update, not an
 * accidental UX regression.
 */
import { describe, it, expect } from "vitest"
import { deriveSignalConfidence } from "./heatmap-matrix"

describe("deriveSignalConfidence", () => {
  it("any error → 'low' regardless of valueSource", () => {
    expect(
      deriveSignalConfidence({
        valueSource: "disclosed",
        error: { code: "out_of_range", reason: "" },
      }),
    ).toBe("low")
    expect(
      deriveSignalConfidence({
        valueSource: "computed",
        error: { code: "no_budget_lines", reason: "" },
      }),
    ).toBe("low")
    expect(
      deriveSignalConfidence({
        valueSource: "modeled_industry",
        error: { code: "rollup_no_children", reason: "" },
      }),
    ).toBe("low")
  })

  it("disclosed (manual finance entry) → 'high'", () => {
    expect(deriveSignalConfidence({ valueSource: "disclosed" })).toBe("high")
  })

  it("computed (real budget/booking/operationalFact data) → 'high'", () => {
    expect(deriveSignalConfidence({ valueSource: "computed" })).toBe("high")
  })

  it("modeled_industry / modeled_generic / macro → 'medium'", () => {
    expect(deriveSignalConfidence({ valueSource: "modeled_industry" })).toBe(
      "medium",
    )
    expect(deriveSignalConfidence({ valueSource: "modeled_generic" })).toBe(
      "medium",
    )
    expect(deriveSignalConfidence({ valueSource: "macro" })).toBe("medium")
  })

  it("undefined valueSource defaults to 'high' (back-compat for pre-7.H cells)", () => {
    expect(deriveSignalConfidence({})).toBe("high")
  })
})
