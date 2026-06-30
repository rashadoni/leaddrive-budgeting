import { describe, expect, it } from "vitest"
import {
  buildEbitdaBridge,
  buildPnlPerformancePoint,
  executionPct,
} from "./pnl-performance"

describe("pnl performance helpers", () => {
  it("builds monthly budget-vs-actual points", () => {
    expect(buildPnlPerformancePoint({ month: "Jan", budget: 100, actual: 120 })).toEqual({
      month: "Jan",
      budget: 100,
      actual: 120,
      variance: 20,
      executionPct: 120,
    })
  })

  it("returns null execution when both budget and actual are zero", () => {
    expect(executionPct(0, 0)).toBeNull()
  })

  it("builds an EBITDA bridge from budget to actual", () => {
    const bridge = buildEbitdaBridge({
      budget: { revenue: 1_000, cogs: 400, opex: 300, da: 20, ebitda: 320 },
      actual: { revenue: 1_120, cogs: 430, opex: 260, da: 30, ebitda: 460 },
    })

    expect(bridge.map((step) => ({
      key: step.key,
      delta: step.delta,
      value: step.value,
      range: step.range,
      kind: step.kind,
    }))).toEqual([
      { key: "budget", delta: 0, value: 320, range: [0, 320], kind: "endpoint" },
      { key: "revenue", delta: 120, value: 440, range: [320, 440], kind: "positive" },
      { key: "cogs", delta: -30, value: 410, range: [410, 440], kind: "negative" },
      { key: "opex", delta: 40, value: 450, range: [410, 450], kind: "positive" },
      { key: "da", delta: 10, value: 460, range: [450, 460], kind: "positive" },
      { key: "actual", delta: 0, value: 460, range: [0, 460], kind: "endpoint" },
    ])
  })
})
