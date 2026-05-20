/**
 * Phase 7.M Step 6 — reconciliation helper tests.
 *
 * These are the regression nets that prove "100% match" actually means
 * 100% — and that almost-100% degrades cleanly to yellow / red instead
 * of silently passing.
 */
import { describe, it, expect } from "vitest"
import {
  reconcile,
  buildReconKey,
  formatReconciliationSummary,
  DEFAULT_TOLERANCE_AZN,
} from "./reconciliation"

const K = buildReconKey

describe("reconcile — happy path", () => {
  it("exact-match maps → verdict green, matched=N, no drift/missing/extra", () => {
    const expected = new Map([
      [K("AZSF", "PLF.01.01.01", "2026-04"), 1000],
      [K("AZSF", "PLF.01.02.01", "2026-04"), 500],
      [K("AZSF", "PLF.03.01.01", "2026-04"), -200],
    ])
    const actual = new Map(expected)
    const r = reconcile(expected, actual)
    expect(r.verdict).toBe("green")
    expect(r.matched).toBe(3)
    expect(r.drift).toEqual([])
    expect(r.missing).toEqual([])
    expect(r.extra).toEqual([])
    expect(r.toleranceAzn).toBe(DEFAULT_TOLERANCE_AZN)
  })

  it("identical empty maps → verdict green, matched=0", () => {
    const r = reconcile(new Map(), new Map())
    expect(r.verdict).toBe("green")
    expect(r.matched).toBe(0)
  })
})

describe("reconcile — tolerance behaviour", () => {
  it("drift within default tolerance (0.001 AZN) → still matched", () => {
    const expected = new Map([[K("AZSF", "PLF.01", "2026-04"), 1234.56]])
    const actual = new Map([[K("AZSF", "PLF.01", "2026-04"), 1234.561]])
    const r = reconcile(expected, actual)
    expect(r.verdict).toBe("green")
    expect(r.matched).toBe(1)
    expect(r.drift).toEqual([])
  })

  it("drift exactly at tolerance boundary → matched (≤, not <)", () => {
    const expected = new Map([[K("AZSF", "PLF.01", "2026-04"), 1000]])
    const actual = new Map([
      [K("AZSF", "PLF.01", "2026-04"), 1000 + DEFAULT_TOLERANCE_AZN],
    ])
    const r = reconcile(expected, actual)
    expect(r.matched).toBe(1)
    expect(r.drift).toEqual([])
  })

  it("drift just past tolerance → reported with signed delta + pct", () => {
    const expected = new Map([[K("AZSF", "PLF.01", "2026-04"), 1000]])
    // 1000.50 — 50 qəpik off, well past 0.005 tolerance.
    const actual = new Map([[K("AZSF", "PLF.01", "2026-04"), 1000.5]])
    const r = reconcile(expected, actual)
    expect(r.drift).toHaveLength(1)
    expect(r.drift[0]).toMatchObject({
      key: K("AZSF", "PLF.01", "2026-04"),
      expected: 1000,
      actual: 1000.5,
      drift: 0.5,
    })
    expect(r.drift[0].driftPct).toBeCloseTo(0.0005, 6)
  })

  it("custom tolerance=0 enforces strict bit-perfect compare", () => {
    const expected = new Map([[K("AZSF", "PLF.01", "2026-04"), 1000]])
    const actual = new Map([[K("AZSF", "PLF.01", "2026-04"), 1000.0001]])
    const r = reconcile(expected, actual, { toleranceAzn: 0 })
    expect(r.matched).toBe(0)
    expect(r.drift).toHaveLength(1)
  })
})

describe("reconcile — verdict logic", () => {
  it("all-drift within 1% pct → yellow (small floating-point drift)", () => {
    const expected = new Map([
      [K("AZSF", "A", "p"), 1000],
      [K("AZSF", "B", "p"), 2000],
    ])
    // 0.5 AZN off on each — 0.05% and 0.025% drift.
    const actual = new Map([
      [K("AZSF", "A", "p"), 1000.5],
      [K("AZSF", "B", "p"), 2000.5],
    ])
    const r = reconcile(expected, actual)
    expect(r.verdict).toBe("yellow")
    expect(r.drift).toHaveLength(2)
  })

  it("any drift > 1% pct → red", () => {
    const expected = new Map([
      [K("AZSF", "A", "p"), 1000],
      [K("AZSF", "B", "p"), 2000],
    ])
    // First line off by 20 AZN = 2% drift.
    const actual = new Map([
      [K("AZSF", "A", "p"), 1020],
      [K("AZSF", "B", "p"), 2000],
    ])
    const r = reconcile(expected, actual)
    expect(r.verdict).toBe("red")
  })

  it("missing key → red regardless of remaining matches", () => {
    const expected = new Map([
      [K("AZSF", "A", "p"), 1000],
      [K("AZSF", "B", "p"), 2000],
    ])
    const actual = new Map([[K("AZSF", "A", "p"), 1000]])
    const r = reconcile(expected, actual)
    expect(r.verdict).toBe("red")
    expect(r.matched).toBe(1)
    expect(r.missing).toEqual([K("AZSF", "B", "p")])
  })

  it("extra key → red regardless of remaining matches", () => {
    const expected = new Map([[K("AZSF", "A", "p"), 1000]])
    const actual = new Map([
      [K("AZSF", "A", "p"), 1000],
      [K("AZSF", "ZOMBIE", "p"), 9999],
    ])
    const r = reconcile(expected, actual)
    expect(r.verdict).toBe("red")
    expect(r.extra).toEqual([K("AZSF", "ZOMBIE", "p")])
  })
})

describe("reconcile — drift sign + pct math", () => {
  it("negative drift (DB has less) is signed correctly", () => {
    const expected = new Map([[K("AZSF", "A", "p"), 1000]])
    const actual = new Map([[K("AZSF", "A", "p"), 950]])
    const r = reconcile(expected, actual)
    expect(r.drift[0].drift).toBe(-50)
    expect(r.drift[0].driftPct).toBeCloseTo(0.05, 5)
  })

  it("zero-expected with positive actual doesn't divide-by-zero", () => {
    const expected = new Map([[K("AZSF", "A", "p"), 0]])
    const actual = new Map([[K("AZSF", "A", "p"), 5]])
    const r = reconcile(expected, actual)
    expect(r.drift).toHaveLength(1)
    expect(Number.isFinite(r.drift[0].driftPct)).toBe(true)
  })
})

describe("formatReconciliationSummary", () => {
  it("renders green summary compactly", () => {
    const out = formatReconciliationSummary({
      matched: 3,
      drift: [],
      missing: [],
      extra: [],
      verdict: "green",
      toleranceAzn: DEFAULT_TOLERANCE_AZN,
    })
    expect(out).toContain("🟢")
    expect(out).toContain("GREEN")
    expect(out).toContain("matched:  3")
  })

  it("renders red summary with top drift detail", () => {
    const out = formatReconciliationSummary({
      matched: 0,
      drift: [
        {
          key: K("AZSF", "A", "p"),
          expected: 1000,
          actual: 1500,
          drift: 500,
          driftPct: 0.5,
        },
      ],
      missing: [K("AZSF", "B", "p")],
      extra: [],
      verdict: "red",
      toleranceAzn: DEFAULT_TOLERANCE_AZN,
    })
    expect(out).toContain("🔴")
    expect(out).toContain("RED")
    expect(out).toContain("drift=500")
    expect(out).toContain("missing samples")
  })
})

describe("buildReconKey", () => {
  it("composes with :: separator", () => {
    expect(K("AZSF", "PLF.01", "2026-04")).toBe("AZSF::PLF.01::2026-04")
  })
})
