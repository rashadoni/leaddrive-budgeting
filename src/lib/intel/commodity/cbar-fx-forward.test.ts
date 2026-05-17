/**
 * Unit tests for CBAR forward curve adapter.
 *
 * Verifies:
 *  - Interest-rate-parity math (F = S × (1+r_AZN·t) / (1+r_q·t))
 *  - All 6 expected points per run (USD + EUR × 3/6/12-month tenors)
 *  - Metric naming convention (FX_FORWARD_<quote>_AZN_<n>M)
 *  - Adapter contract (source / fetch / dataPoints / errors / fetched)
 */
import { describe, it, expect } from "vitest"
import { buildForwardCurve, createCBARForwardAdapter } from "./cbar-fx-forward"

describe("buildForwardCurve (IRP)", () => {
  it("computes IRP forward correctly for USD 3-month tenor", () => {
    // F = 1.7 × (1 + 0.08×0.25) / (1 + 0.0475×0.25)
    //   = 1.7 × 1.02 / 1.011875 = 1.7136... (rounded to 4dp)
    const points = buildForwardCurve(
      { USD: 1.7 },
      { AZN: 0.08, USD: 0.0475 },
      new Date("2026-05-17"),
    )
    expect(points.length).toBe(3) // 3 tenors × 1 currency
    const m3 = points.find((p) => p.metric === "FX_FORWARD_USD_AZN_3M")
    expect(m3).toBeTruthy()
    // Approx 1.7136 — assert within ±0.001
    expect(m3!.value).toBeGreaterThan(1.71)
    expect(m3!.value).toBeLessThan(1.72)
    expect(m3!.unit).toBe("AZN/USD")
    expect(m3!.sourceCode).toBe("cbar-fx-forward-irp")
  })

  it("12-month tenor moves further from spot than 3-month (rate diff positive)", () => {
    // Since r_AZN > r_USD, the forward should be HIGHER than spot
    // (AZN expected to depreciate per IRP).
    const points = buildForwardCurve(
      { USD: 1.7 },
      { AZN: 0.08, USD: 0.0475 },
    )
    const m3 = points.find((p) => p.metric === "FX_FORWARD_USD_AZN_3M")!.value
    const m12 = points.find((p) => p.metric === "FX_FORWARD_USD_AZN_12M")!.value
    expect(m12).toBeGreaterThan(m3)
    expect(m3).toBeGreaterThan(1.7) // both above spot
  })

  it("emits 6 points for USD + EUR pairs × 3 tenors", () => {
    const points = buildForwardCurve(
      { USD: 1.7, EUR: 1.85 },
      { AZN: 0.08, USD: 0.0475, EUR: 0.0275 },
    )
    expect(points.length).toBe(6)
    const metrics = points.map((p) => p.metric).sort()
    expect(metrics).toEqual([
      "FX_FORWARD_EUR_AZN_12M",
      "FX_FORWARD_EUR_AZN_3M",
      "FX_FORWARD_EUR_AZN_6M",
      "FX_FORWARD_USD_AZN_12M",
      "FX_FORWARD_USD_AZN_3M",
      "FX_FORWARD_USD_AZN_6M",
    ])
  })
})

describe("createCBARForwardAdapter", () => {
  it("returns adapter conforming to CommodityAdapter contract", async () => {
    const adapter = createCBARForwardAdapter()
    expect(adapter.source).toBe("cbar-fx-forward-irp")
    expect(adapter.label).toContain("forward")
    const result = await adapter.fetch(new Date("2026-05-17"))
    expect(result.source).toBe("cbar-fx-forward-irp")
    expect(result.errors).toEqual([])
    expect(result.fetched).toBe(true)
    expect(result.dataPoints.length).toBe(6) // 3 tenors × USD+EUR
    for (const p of result.dataPoints) {
      expect(p.sourceCode).toBe("cbar-fx-forward-irp")
      expect(p.metric).toMatch(/^FX_FORWARD_(USD|EUR)_AZN_(3|6|12)M$/)
      expect(Number.isFinite(p.value)).toBe(true)
    }
  })
})
