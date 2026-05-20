import { describe, it, expect } from "vitest"
import {
  detectCrossFileConflicts,
  formatConflictLine,
} from "./conflict-detector"

describe("detectCrossFileConflicts", () => {
  it("returns empty array when 2 files have non-overlapping keys", () => {
    const result = detectCrossFileConflicts(
      new Map([
        ["fileA.xlsx", new Map([["k1", 100], ["k2", 200]])],
        ["fileB.xlsx", new Map([["k3", 300], ["k4", 400]])],
      ]),
    )
    expect(result).toEqual([])
  })

  it("returns empty array when 2 files share keys with identical values", () => {
    const result = detectCrossFileConflicts(
      new Map([
        ["fileA.xlsx", new Map([["k1", 100], ["k2", 200]])],
        ["fileB.xlsx", new Map([["k1", 100], ["k2", 200]])],
      ]),
    )
    expect(result).toEqual([])
  })

  it("flags one conflict when 2 files disagree on one cell", () => {
    const result = detectCrossFileConflicts(
      new Map([
        ["fileA.xlsx", new Map([["k1", 100], ["k2", 200]])],
        ["fileB.xlsx", new Map([["k1", 150], ["k2", 200]])],
      ]),
    )
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe("k1")
    expect(result[0].spread).toBe(50)
    expect(result[0].occurrences).toEqual([
      { filename: "fileA.xlsx", value: 100 },
      { filename: "fileB.xlsx", value: 150 },
    ])
  })

  it("flags triangle conflict when 3 files have 3 different values", () => {
    const result = detectCrossFileConflicts(
      new Map([
        ["fileA.xlsx", new Map([["k1", 100]])],
        ["fileB.xlsx", new Map([["k1", 150]])],
        ["fileC.xlsx", new Map([["k1", 200]])],
      ]),
    )
    expect(result).toHaveLength(1)
    expect(result[0].occurrences).toHaveLength(3)
    expect(result[0].spread).toBe(100) // max(200) - min(100)
  })

  it("respects default tolerance (0.005 AZN)", () => {
    const matching = detectCrossFileConflicts(
      new Map([
        ["fileA", new Map([["k1", 100.000]])],
        ["fileB", new Map([["k1", 100.005]])], // exactly tolerance
      ]),
    )
    expect(matching).toEqual([])

    const justOver = detectCrossFileConflicts(
      new Map([
        ["fileA", new Map([["k1", 100.000]])],
        ["fileB", new Map([["k1", 100.006]])], // exceeds tolerance
      ]),
    )
    expect(justOver).toHaveLength(1)
  })

  it("respects custom tolerance override", () => {
    const result = detectCrossFileConflicts(
      new Map([
        ["fileA", new Map([["k1", 100]])],
        ["fileB", new Map([["k1", 110]])], // diff = 10
      ]),
      20, // tolerance 20 AZN
    )
    expect(result).toEqual([]) // 10 ≤ 20 → match
  })

  it("sorts conflicts by spreadPct descending (worst first)", () => {
    const result = detectCrossFileConflicts(
      new Map([
        // k1: small absolute diff but huge pct (1 vs 100 → 99% spread)
        ["fileA", new Map([["k1", 1], ["k2", 1_000_000]])],
        // k2: large absolute diff but small pct (1M vs 1.05M → 5% spread)
        ["fileB", new Map([["k1", 100], ["k2", 1_050_000]])],
      ]),
    )
    expect(result).toHaveLength(2)
    expect(result[0].key).toBe("k1") // k1's spreadPct (99%) > k2's (~5%)
    expect(result[1].key).toBe("k2")
  })

  it("handles single file (no comparisons possible)", () => {
    const result = detectCrossFileConflicts(
      new Map([["only.xlsx", new Map([["k1", 100], ["k2", 200]])]]),
    )
    expect(result).toEqual([])
  })

  it("handles empty file maps", () => {
    const result = detectCrossFileConflicts(new Map())
    expect(result).toEqual([])
  })

  it("formatConflictLine renders human-readable diff string", () => {
    const conflict = {
      key: "AZSEKER-AZSF::PLF.01::2026-01",
      occurrences: [
        { filename: "fileA.xlsx", value: 530000 },
        { filename: "fileB.xlsx", value: 550000 },
      ],
      spread: 20000,
      spreadPct: 0.0364,
    }
    const line = formatConflictLine(conflict)
    expect(line).toContain("AZSEKER-AZSF::PLF.01::2026-01")
    expect(line).toContain("fileA.xlsx=530,000")
    expect(line).toContain("fileB.xlsx=550,000")
    expect(line).toContain("3.64%")
  })
})
