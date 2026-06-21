import { describe, it, expect } from "vitest"
import { computeControlTotals } from "./control-totals"

describe("computeControlTotals", () => {
  it("green when there are mismatches only within tolerance", () => {
    const r = computeControlTotals(
      [{ code: "PLF.01", plannedAnnual: 1000 }],
      [{ parentCode: "PLF.01", plannedAnnual: 0.004 }], // < 0.005 tol
    )
    expect(r.verdict).toBe("green")
    expect(r.controlTotals).toHaveLength(0)
    expect(r.worst).toBeNull()
  })

  it("green when every parent reconciles (no synthetic deltas)", () => {
    const r = computeControlTotals([{ code: "PLF.01", plannedAnnual: 1000 }], [])
    expect(r.verdict).toBe("green")
    expect(r.noControl).toBe(false)
  })

  it("yellow for a small (<=1%) rounding drift", () => {
    const r = computeControlTotals(
      [{ code: "PLF.01", plannedAnnual: 1000 }],
      [{ parentCode: "PLF.01", plannedAnnual: 5 }], // 0.5%
    )
    expect(r.verdict).toBe("yellow")
    expect(r.worst?.statedTotal).toBe(1000)
    expect(r.worst?.leafSum).toBe(995)
  })

  it("red for a large (>1%) mismatch — the mis-mapped-column signature", () => {
    const r = computeControlTotals(
      [{ code: "PLF.01", plannedAnnual: 1000 }],
      [{ parentCode: "PLF.01", plannedAnnual: 1000 }], // leaves summed to 0 → 100% off
    )
    expect(r.verdict).toBe("red")
    expect(r.worst?.deltaPct).toBe(1)
    expect(r.worst?.leafSum).toBe(0)
  })

  it("ranks the worst mismatch first and reports verdict from it", () => {
    const r = computeControlTotals(
      [
        { code: "PLF.01", plannedAnnual: 1000 },
        { code: "PLF.02", plannedAnnual: 1000 },
      ],
      [
        { parentCode: "PLF.01", plannedAnnual: 5 }, // 0.5% (yellow alone)
        { parentCode: "PLF.02", plannedAnnual: 300 }, // 30% (red)
      ],
    )
    expect(r.verdict).toBe("red")
    expect(r.worst?.code).toBe("PLF.02")
    expect(r.controlTotals[0].code).toBe("PLF.02")
  })

  it("flags noControl when the file had no parent rows", () => {
    const r = computeControlTotals([], [])
    expect(r.noControl).toBe(true)
    expect(r.verdict).toBe("green") // no mismatches, but caller shows "manual review only"
  })

  // ── Computed-subtotal mode (deep dotted hierarchies) ──────────────────────
  // dedup tags SECTION-ROOT parents with an explicit `leafSum` = Σ deepest
  // leaves, and emits NO synthetics. The control reconciles the section's
  // stated total against its TRUE leaves, ignoring intermediate subtotals.
  describe("computed-subtotal mode (leafSum-bearing dropped rows)", () => {
    it("green when the section's stated total equals its deepest-leaf sum", () => {
      const r = computeControlTotals(
        [
          { code: "PLF.05", plannedAnnual: -158887, leafSum: -158887 },
          // Intermediate subtotal: dropped but NOT checked (no leafSum) even
          // though its own stated value is inconsistent with its children.
          { code: "PLF.05.01", plannedAnnual: -999999 },
        ],
        [], // no synthetics in computed-subtotal mode
      )
      expect(r.verdict).toBe("green")
      expect(r.controlTotals).toHaveLength(0)
      expect(r.noControl).toBe(false) // parents existed → there WAS a control
    })

    it("red when the deepest leaves do not reconcile to the section total", () => {
      const r = computeControlTotals(
        [{ code: "PLF.05", plannedAnnual: -100, leafSum: -90 }],
        [],
      )
      expect(r.verdict).toBe("red")
      expect(r.worst?.code).toBe("PLF.05")
      expect(r.worst?.statedTotal).toBe(-100)
      expect(r.worst?.leafSum).toBe(-90)
      expect(r.worst?.delta).toBe(-10)
    })

    it("ranks the worst section across multiple roots", () => {
      const r = computeControlTotals(
        [
          { code: "PLF.01", plannedAnnual: 1000, leafSum: 995 }, // 0.5% → yellow alone
          { code: "PLF.05", plannedAnnual: 1000, leafSum: 700 }, // 30% → red
        ],
        [],
      )
      expect(r.verdict).toBe("red")
      expect(r.controlTotals[0].code).toBe("PLF.05")
    })
  })
})
