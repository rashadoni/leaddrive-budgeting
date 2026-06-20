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
})
