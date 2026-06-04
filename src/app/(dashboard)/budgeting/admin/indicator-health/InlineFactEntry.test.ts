import { describe, it, expect } from "vitest"
import {
  buildOperationalFactBody,
  summarizeRecompute,
} from "./InlineFactEntry"

describe("buildOperationalFactBody", () => {
  it("expands a YYYY-MM-DD date to a midnight-UTC ISO datetime (API wants offset)", () => {
    const body = buildOperationalFactBody({
      companyId: "c1",
      metric: "yield_per_ha",
      unit: "t/ha",
      dateYmd: "2026-06-04",
      value: 5.2,
      forceConfirm: false,
    })
    expect(body.date).toBe("2026-06-04T00:00:00.000Z")
    expect(body).toMatchObject({
      companyId: "c1",
      metric: "yield_per_ha",
      unit: "t/ha",
      value: 5.2,
      forceConfirm: false,
    })
  })

  it("defaults sourceNote to the inline provenance marker", () => {
    const body = buildOperationalFactBody({
      companyId: "c1",
      metric: "harvest_tons",
      unit: "tons",
      dateYmd: "2026-01-15",
      value: 100,
      forceConfirm: true,
    })
    expect(body.sourceNote).toBe("inline:indicator-health")
    expect(body.forceConfirm).toBe(true)
  })

  it("passes an explicit sourceNote through unchanged", () => {
    const body = buildOperationalFactBody({
      companyId: "c1",
      metric: "harvest_tons",
      unit: "tons",
      dateYmd: "2026-01-15",
      value: 100,
      forceConfirm: false,
      sourceNote: "custom note",
    })
    expect(body.sourceNote).toBe("custom note")
  })

  it("keeps value as a number (not stringified)", () => {
    const body = buildOperationalFactBody({
      companyId: "c1",
      metric: "occupancy_rate",
      unit: "%",
      dateYmd: "2026-03-01",
      value: 0,
      forceConfirm: false,
    })
    expect(body.value).toBe(0)
    expect(typeof body.value).toBe("number")
  })
})

describe("summarizeRecompute", () => {
  it("returns null for a null/absent recompute payload (best-effort recompute failed)", () => {
    expect(summarizeRecompute(null)).toBeNull()
    expect(summarizeRecompute(undefined)).toBeNull()
  })

  it("sums ok+unknown+failed into the total and keeps ok", () => {
    expect(summarizeRecompute({ ok: 5, unknown: 2, failed: 1 })).toEqual({
      ok: 5,
      total: 8,
    })
  })

  it("handles an all-ok recompute", () => {
    expect(summarizeRecompute({ ok: 12, unknown: 0, failed: 0 })).toEqual({
      ok: 12,
      total: 12,
    })
  })
})
