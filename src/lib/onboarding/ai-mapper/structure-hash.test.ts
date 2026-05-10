// @vitest-environment node
import { describe, it, expect } from "vitest"
import { computeStructureHash } from "./structure-hash"
import type { MapperInput } from "./types"

const baseInput = (overrides: Partial<MapperInput> = {}): MapperInput => ({
  sourceFile: "test.xlsx",
  sourceSheet: "P&L",
  columns: [
    { index: 0, headerText: "KOD", samples: ["601-01"] },
    { index: 1, headerText: "Jan", samples: [100] },
  ],
  sampleRows: [["601-01", 100]],
  ...overrides,
})

describe("computeStructureHash", () => {
  it("deterministic — identical input → identical hash", () => {
    const a = computeStructureHash(baseInput())
    const b = computeStructureHash(baseInput())
    expect(a).toBe(b)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it("value-independent — different sample VALUES → same hash", () => {
    const a = computeStructureHash(
      baseInput({
        columns: [{ index: 0, headerText: "KOD", samples: ["601-01"] }],
      }),
    )
    const b = computeStructureHash(
      baseInput({
        columns: [{ index: 0, headerText: "KOD", samples: ["701-99"] }],
      }),
    )
    expect(a).toBe(b) // same TYPE (string) → same hash
  })

  it("type-sensitive — different sample TYPES → different hash", () => {
    const a = computeStructureHash(
      baseInput({
        columns: [{ index: 0, headerText: "KOD", samples: ["601-01"] }],
      }),
    )
    const b = computeStructureHash(
      baseInput({
        columns: [{ index: 0, headerText: "KOD", samples: [60101] }],
      }),
    )
    expect(a).not.toBe(b) // string vs number
  })

  it("header-text-sensitive — same types, different header → different hash", () => {
    const a = computeStructureHash(
      baseInput({
        columns: [{ index: 0, headerText: "KOD", samples: ["x"] }],
      }),
    )
    const b = computeStructureHash(
      baseInput({
        columns: [{ index: 0, headerText: "Code", samples: ["x"] }],
      }),
    )
    expect(a).not.toBe(b)
  })

  it("industry-sensitive", () => {
    const a = computeStructureHash(
      baseInput({ companyContext: { industry: "hospitality" } }),
    )
    const b = computeStructureHash(
      baseInput({ companyContext: { industry: "agro" } }),
    )
    expect(a).not.toBe(b)
  })

  it("language-sensitive", () => {
    const a = computeStructureHash(baseInput(), "en")
    const b = computeStructureHash(baseInput(), "ru")
    expect(a).not.toBe(b)
  })

  it("file/sheet/company name independent", () => {
    const a = computeStructureHash(
      baseInput({
        sourceFile: "AAC-rev6.xlsx",
        sourceSheet: "P&L AAC",
        companyContext: { name: "AAC", industry: "hospitality" },
      }),
    )
    const b = computeStructureHash(
      baseInput({
        sourceFile: "LLS-rev7.xlsx",
        sourceSheet: "P&L LLS",
        companyContext: { name: "LLS", industry: "hospitality" },
      }),
    )
    expect(a).toBe(b) // same template, different files/companies → same hash
  })
})
