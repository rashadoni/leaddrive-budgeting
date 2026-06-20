import { describe, it, expect } from "vitest"
import { validateImport } from "./validate-import"
import type { ParseResult } from "../adapters/azmade-sopl"
import type { ControlTotalReport } from "./control-totals"

type Line = ParseResult["lines"][number]
const line = (accountType: string, plannedAnnual: number): Line =>
  ({ code: "X", label: "X", accountType, plannedAnnual, perMonth: Array(12).fill(plannedAnnual / 12) }) as Line

function result(lines: Line[], extra: Partial<ParseResult> = {}): ParseResult {
  return {
    sheetName: "S",
    lines,
    warnings: [],
    skippedRowCount: 0,
    parentRollupsDropped: [],
    parentRollupsUnallocated: [],
    rowTotalMismatches: [],
    ...extra,
  }
}
const control = (over: Partial<ControlTotalReport> = {}): ControlTotalReport => ({
  controlTotals: [],
  verdict: "green",
  worst: null,
  noControl: false,
  ...over,
})

const healthy = [line("revenue", 1000), line("cogs", 600), line("expense", 200)]

describe("validateImport", () => {
  it("certifies a clean P&L (revenue+cogs+expense, green control, no mismatches)", () => {
    const r = validateImport(result(healthy), control())
    expect(r.verdict).toBe("certified")
    expect(r.findings.filter((f) => f.severity !== "info")).toHaveLength(0)
  })

  it("blocks when no revenue was parsed", () => {
    const r = validateImport(result([line("cogs", 600), line("expense", 200)]), control())
    expect(r.verdict).toBe("blocked")
    expect(r.findings.some((f) => f.category === "coverage" && f.severity === "blocker")).toBe(true)
  })

  it("blocks on a RED control-total verdict", () => {
    const r = validateImport(result(healthy), control({ verdict: "red" }))
    expect(r.verdict).toBe("blocked")
  })

  it("warns on a YELLOW control-total verdict", () => {
    const r = validateImport(result(healthy), control({ verdict: "yellow" }))
    expect(r.verdict).toBe("warn")
  })

  it("warns when rows fail the Total-column tie-out", () => {
    const r = validateImport(
      result(healthy, { rowTotalMismatches: [{ code: "601", stated: 999, computed: 100, delta: -899 }] }),
      control(),
    )
    expect(r.verdict).toBe("warn")
    expect(r.findings.some((f) => f.category === "total_mismatch")).toBe(true)
  })

  it("is uncertifiable when there is no internal control and no other signal", () => {
    const r = validateImport(result(healthy), control({ noControl: true }))
    expect(r.verdict).toBe("uncertifiable")
    expect(r.findings.some((f) => f.category === "no_control")).toBe(true)
  })

  it("warns on an implausible gross margin (cogs ≫ revenue)", () => {
    const r = validateImport(result([line("revenue", 100), line("cogs", 500)]), control())
    expect(r.verdict).toBe("warn")
    expect(r.findings.some((f) => f.category === "margin")).toBe(true)
  })

  it("reports the aggregate totals + gross margin", () => {
    const r = validateImport(result(healthy), control())
    expect(r.totals).toMatchObject({ revenue: 1000, cogs: 600, expense: 200 })
    expect(r.totals.grossMarginPct).toBeCloseTo(0.4, 5)
  })
})
