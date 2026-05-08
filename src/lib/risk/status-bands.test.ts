// @vitest-environment node
/**
 * Phase 7.G Turn LXIV — guard tests for shared status-band classifier.
 *
 * Locks the canonical 10/5 thresholds + override path + class/text
 * map shape. Catches accidental threshold drift.
 */

import { describe, it, expect } from "vitest"
import {
  varianceBand,
  VARIANCE_BAND_THRESHOLDS,
  VARIANCE_BAND_CLASS,
  VARIANCE_BAND_TEXT,
  type VarianceBand,
} from "./status-bands"

describe("varianceBand — canonical thresholds (10/5)", () => {
  it("returns 'green' for absPct < 5", () => {
    expect(varianceBand(0)).toBe("green")
    expect(varianceBand(2.5)).toBe("green")
    expect(varianceBand(4.99)).toBe("green")
  })

  it("returns 'amber' for 5 <= absPct < 10", () => {
    expect(varianceBand(5)).toBe("amber")
    expect(varianceBand(7.5)).toBe("amber")
    expect(varianceBand(9.99)).toBe("amber")
  })

  it("returns 'red' for absPct >= 10", () => {
    expect(varianceBand(10)).toBe("red")
    expect(varianceBand(25)).toBe("red")
    expect(varianceBand(100)).toBe("red")
  })

  it("treats boundary values inclusively at the floor", () => {
    // exact-5 → amber (not green); exact-10 → red (not amber)
    expect(varianceBand(5)).toBe("amber")
    expect(varianceBand(10)).toBe("red")
  })
})

describe("varianceBand — custom thresholds override", () => {
  it("applies tighter thresholds when provided", () => {
    const tight = { red: 5, amber: 2 }
    expect(varianceBand(1)).toBe("green")
    expect(varianceBand(1, tight)).toBe("green")
    expect(varianceBand(3, tight)).toBe("amber")
    expect(varianceBand(7, tight)).toBe("red")
  })

  it("applies looser thresholds when provided", () => {
    const loose = { red: 25, amber: 15 }
    expect(varianceBand(10)).toBe("red") // canonical: red
    expect(varianceBand(10, loose)).toBe("green") // loose: green
    expect(varianceBand(20, loose)).toBe("amber")
    expect(varianceBand(30, loose)).toBe("red")
  })
})

describe("VARIANCE_BAND_THRESHOLDS — canonical contract", () => {
  it("matches project-wide materiality convention", () => {
    expect(VARIANCE_BAND_THRESHOLDS.red).toBe(10)
    expect(VARIANCE_BAND_THRESHOLDS.amber).toBe(5)
  })
})

describe("VARIANCE_BAND_CLASS / VARIANCE_BAND_TEXT — class shape", () => {
  it("has entries for all 3 bands", () => {
    const bands: VarianceBand[] = ["red", "amber", "green"]
    for (const b of bands) {
      expect(VARIANCE_BAND_CLASS[b]).toBeTruthy()
      expect(VARIANCE_BAND_CLASS[b]).toMatch(/border-l-/)
      expect(VARIANCE_BAND_TEXT[b]).toBeTruthy()
      expect(VARIANCE_BAND_TEXT[b]).toMatch(/text-/)
    }
  })
})
