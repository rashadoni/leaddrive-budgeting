/**
 * Regression coverage for the LEGACY multiplier path (simulateScenario).
 *
 * This is the path the seeded `adjustments` scenarios use via the always-rendered
 * "quickCalc" simulate button (no `mode=drivers`). The key invariant: an
 * "unknown"-status baseline (a no-data indicator persisted with value:0) must NEVER
 * be counted as a status change — otherwise STATUS_ORDER.unknown=0 makes every
 * unknown→real transition score as an "improvement", reporting a crisis applied to
 * a no-data indicator as a gain. This mirrors the guard already in the driver path
 * (scenario-rederive.test.ts).
 */
import { describe, it, expect } from "vitest"
import { simulateScenario, buildDeltaMap, type SimulatableOverrides } from "./scenario-simulator"

// IND_EBITDA_MARGIN: higher_better — green ≥20, amber ≥10, red <10.
const CODE = "IND_EBITDA_MARGIN"

function row(value: number, status: string) {
  return {
    companyId: "c1",
    companyCode: "AZSF",
    companyName: "AzerSheker Sugar Factory",
    code: CODE,
    value,
    status,
  }
}

const crisis: SimulatableOverrides = {
  adjustments: [{ codes: [CODE], multiply: 0.5, note: "−50% margin shock" }],
}

describe("simulateScenario — legacy multiplier path", () => {
  it("counts a real green→amber flip as worsened (sanity: path works)", () => {
    // 30 (green) × 0.5 = 15 (amber) → genuine downgrade.
    const res = simulateScenario(crisis, [row(30, "green")], "TEST", "2026")
    expect(res.worsened).toBe(1)
    expect(res.improved).toBe(0)
    expect(res.changed).toBe(1)
    expect(res.deltas[0]?.changed).toBe(true)
  })

  it("does NOT count an unknown-baseline row as improved (the bug)", () => {
    // No-data indicator: value 0, status "unknown". 0 × 0.5 = 0 → classifies as
    // red (0 < 10). Without the both-ends-real guard, unknown(0)→red(1) scored as
    // an improvement. It must now be excluded from changed/improved/worsened.
    const res = simulateScenario(crisis, [row(0, "unknown")], "TEST", "2026")
    expect(res.improved).toBe(0)
    expect(res.worsened).toBe(0)
    expect(res.changed).toBe(0)
    expect(res.deltas[0]?.changed).toBe(false)
  })

  it("excludes unknown rows from the HeatMap delta overlay", () => {
    const res = simulateScenario(crisis, [row(0, "unknown")], "TEST", "2026")
    const overlay = buildDeltaMap(res)
    expect(overlay.size).toBe(0)
  })

  it("keeps real flips while dropping unknown noise in a mixed batch", () => {
    const res = simulateScenario(
      crisis,
      [row(30, "green"), row(0, "unknown"), row(25, "green")],
      "TEST",
      "2026",
    )
    // Two real green→amber downgrades count; the unknown row is ignored entirely.
    expect(res.worsened).toBe(2)
    expect(res.improved).toBe(0)
    expect(res.changed).toBe(2)
  })
})
