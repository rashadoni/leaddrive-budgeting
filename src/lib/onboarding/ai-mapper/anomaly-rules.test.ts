// @vitest-environment node
/**
 * Phase 7.G Turn LXXXXIV — heuristic anomaly pre-pass tests.
 * Per Phase 7.B v2 Day 2 plan: 7 rules × ~2 cases each + merge tests.
 */

import { describe, it, expect } from "vitest"
import { detectHeuristicAnomalies, mergeAnomalies } from "./anomaly-rules"
import type { MapperInput, MappingProposal, Anomaly } from "./types"

const baseInput = (overrides: Partial<MapperInput> = {}): MapperInput => ({
  sourceFile: "test.xlsx",
  sourceSheet: "P&L",
  columns: [
    { index: 0, headerText: "KOD", samples: ["601-01", "701-01"] },
    { index: 1, headerText: "Jan", samples: [100, -50] },
  ],
  sampleRows: [],
  ...overrides,
})

const baseProposal = (overrides: Partial<MappingProposal> = {}): MappingProposal => ({
  sourceFile: "test.xlsx",
  sourceSheet: "P&L",
  summary: "test",
  overallConfidence: 0.9,
  columns: [
    { sourceIndex: 0, role: "code", confidence: 1, reasoning: "code col" },
    { sourceIndex: 1, role: "amount:Jan", confidence: 1, reasoning: "Jan amount" },
  ],
  accountTypeOverrides: [],
  anomalies: [],
  ...overrides,
})

describe("Rule 1: sign_inversion", () => {
  it("flags revenue code with majority negative values", () => {
    const input = baseInput({
      columns: [
        { index: 0, headerText: "KOD", samples: [] },
        { index: 1, headerText: "Jan", samples: [] },
        { index: 2, headerText: "Feb", samples: [] },
        { index: 3, headerText: "Mar", samples: [] },
      ],
      sampleRows: [["601-01", -100, -200, 50]],
    })
    const proposal = baseProposal({
      columns: [
        { sourceIndex: 0, role: "code", confidence: 1, reasoning: "" },
        { sourceIndex: 1, role: "amount:Jan", confidence: 1, reasoning: "" },
        { sourceIndex: 2, role: "amount:Feb", confidence: 1, reasoning: "" },
        { sourceIndex: 3, role: "amount:Mar", confidence: 1, reasoning: "" },
      ],
    })
    const found = detectHeuristicAnomalies(input, proposal)
    expect(found.find((a) => a.category === "sign_inversion")).toBeDefined()
  })

  it("does NOT flag revenue code with mostly positive values", () => {
    const input = baseInput({
      columns: [
        { index: 0, headerText: "KOD", samples: [] },
        { index: 1, headerText: "Jan", samples: [] },
        { index: 2, headerText: "Feb", samples: [] },
        { index: 3, headerText: "Mar", samples: [] },
      ],
      sampleRows: [["601-01", 100, 200, -50]],
    })
    const proposal = baseProposal({
      columns: [
        { sourceIndex: 0, role: "code", confidence: 1, reasoning: "" },
        { sourceIndex: 1, role: "amount:Jan", confidence: 1, reasoning: "" },
        { sourceIndex: 2, role: "amount:Feb", confidence: 1, reasoning: "" },
        { sourceIndex: 3, role: "amount:Mar", confidence: 1, reasoning: "" },
      ],
    })
    const found = detectHeuristicAnomalies(input, proposal)
    expect(found.find((a) => a.category === "sign_inversion")).toBeUndefined()
  })
})

describe("Rule 2: magnitude_outlier", () => {
  it("flags single value ≥99% of column total", () => {
    const input = baseInput({
      columns: [{ index: 0, headerText: "Jan", samples: [] }],
      sampleRows: [[1], [1], [1], [1], [1], [10000]],
    })
    const proposal = baseProposal({
      columns: [{ sourceIndex: 0, role: "amount:Jan", confidence: 1, reasoning: "" }],
    })
    const found = detectHeuristicAnomalies(input, proposal)
    expect(found.find((a) => a.category === "magnitude_outlier")).toBeDefined()
  })

  it("does NOT flag balanced columns", () => {
    const input = baseInput({
      columns: [{ index: 0, headerText: "Jan", samples: [] }],
      sampleRows: [[100], [100], [100], [100], [100], [100]],
    })
    const proposal = baseProposal({
      columns: [{ sourceIndex: 0, role: "amount:Jan", confidence: 1, reasoning: "" }],
    })
    const found = detectHeuristicAnomalies(input, proposal)
    expect(found.find((a) => a.category === "magnitude_outlier")).toBeUndefined()
  })
})

describe("Rule 3: category_mismatch", () => {
  it("flags LLM-proposed type disagreeing with code prefix", () => {
    const proposal = baseProposal({
      accountTypeOverrides: [
        { code: "701-01", accountType: "revenue", confidence: 0.9, reasoning: "test" },
      ],
    })
    const found = detectHeuristicAnomalies(baseInput(), proposal)
    expect(found.find((a) => a.category === "category_mismatch")).toBeDefined()
  })

  it("does NOT flag agreement", () => {
    const proposal = baseProposal({
      accountTypeOverrides: [
        { code: "701-01", accountType: "cogs", confidence: 0.9, reasoning: "test" },
      ],
    })
    const found = detectHeuristicAnomalies(baseInput(), proposal)
    expect(found.find((a) => a.category === "category_mismatch")).toBeUndefined()
  })
})

describe("Rule 4: duplicate_row", () => {
  it("flags same code appearing twice with different totals", () => {
    const input = baseInput({
      columns: [
        { index: 0, headerText: "KOD", samples: [] },
        { index: 1, headerText: "Jan", samples: [] },
      ],
      sampleRows: [
        ["601-01", 100],
        ["601-01", 200],
      ],
    })
    const found = detectHeuristicAnomalies(input, baseProposal())
    expect(found.find((a) => a.category === "duplicate_row")).toBeDefined()
  })

  it("does NOT flag identical totals (likely re-export same data)", () => {
    const input = baseInput({
      columns: [
        { index: 0, headerText: "KOD", samples: [] },
        { index: 1, headerText: "Jan", samples: [] },
      ],
      sampleRows: [
        ["601-01", 100],
        ["601-01", 100],
      ],
    })
    const found = detectHeuristicAnomalies(input, baseProposal())
    expect(found.find((a) => a.category === "duplicate_row")).toBeUndefined()
  })
})

describe("Rule 6: currency_mix", () => {
  it("flags multiple currency symbols in column samples", () => {
    const input = baseInput({
      columns: [
        { index: 0, headerText: "Jan", samples: ["100$", "200₼", "50€"] },
      ],
    })
    const found = detectHeuristicAnomalies(input, baseProposal())
    expect(found.find((a) => a.category === "currency_mix")).toBeDefined()
  })

  it("does NOT flag single currency", () => {
    const input = baseInput({
      columns: [
        { index: 0, headerText: "Jan", samples: ["100₼", "200₼"] },
      ],
    })
    const found = detectHeuristicAnomalies(input, baseProposal())
    expect(found.find((a) => a.category === "currency_mix")).toBeUndefined()
  })
})

describe("Rule 7: implausible_ratio", () => {
  it("flags gross margin > 100%", () => {
    const input = baseInput({
      columns: [
        { index: 0, headerText: "KOD", samples: [] },
        { index: 1, headerText: "Jan", samples: [] },
      ],
      sampleRows: [
        ["601-01", 1000],
        ["701-01", 100], // GM = (1000 - 100) / 1000 = 90% — OK
      ],
    })
    // This case should NOT flag (GM=90%). Adjust to flag-case:
    const inputBad = baseInput({
      columns: [
        { index: 0, headerText: "KOD", samples: [] },
        { index: 1, headerText: "Jan", samples: [] },
      ],
      sampleRows: [
        ["601-01", 100],
        ["701-01", 800], // GM = (100 - 800) / 100 = -700% — flag
      ],
    })
    expect(detectHeuristicAnomalies(input, baseProposal()).find((a) => a.category === "implausible_ratio")).toBeUndefined()
    expect(detectHeuristicAnomalies(inputBad, baseProposal()).find((a) => a.category === "implausible_ratio")).toBeDefined()
  })
})

describe("Rule 8: other (invalid code pattern)", () => {
  it("flags code without SAP-style digit prefix", () => {
    const proposal = baseProposal({
      accountTypeOverrides: [
        { code: "REV-2026", accountType: "revenue", confidence: 0.5, reasoning: "" },
      ],
    })
    const found = detectHeuristicAnomalies(baseInput(), proposal)
    expect(found.find((a) => a.category === "other")).toBeDefined()
  })

  it("accepts valid SAP code", () => {
    const proposal = baseProposal({
      accountTypeOverrides: [
        { code: "601-01-02", accountType: "revenue", confidence: 0.9, reasoning: "" },
      ],
    })
    const found = detectHeuristicAnomalies(baseInput(), proposal)
    expect(found.find((a) => a.category === "other")).toBeUndefined()
  })
})

describe("mergeAnomalies", () => {
  it("dedupes by (row, category) — LLM wins on description", () => {
    const llm: Anomaly[] = [
      { row: 5, severity: "critical", category: "sign_inversion", description: "LLM said this" },
    ]
    const heuristic: Anomaly[] = [
      { row: 5, severity: "critical", category: "sign_inversion", description: "Heuristic also said this" },
      { row: 7, severity: "warning", category: "magnitude_outlier", description: "Only heuristic" },
    ]
    const merged = mergeAnomalies(llm, heuristic)
    expect(merged).toHaveLength(2)
    expect(merged.find((a) => a.row === 5)?.description).toBe("LLM said this")
    expect(merged.find((a) => a.row === 7)?.description).toBe("Only heuristic")
  })

  it("preserves both when row OR category differs", () => {
    const llm: Anomaly[] = [
      { row: 5, severity: "critical", category: "sign_inversion", description: "A" },
    ]
    const heuristic: Anomaly[] = [
      { row: 5, severity: "warning", category: "magnitude_outlier", description: "B" },
    ]
    expect(mergeAnomalies(llm, heuristic)).toHaveLength(2)
  })

  it("empty inputs return empty array", () => {
    expect(mergeAnomalies([], [])).toEqual([])
  })
})
