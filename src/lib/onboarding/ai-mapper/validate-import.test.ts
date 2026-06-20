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

describe("validateImport — cost-sign convention (Phase C C3.1)", () => {
  const conv = (c: string) => ({ convention: c, evidence: { negRows: 0, posRows: 0, negAbs: 0, posAbs: 0, netSum: 0 } }) as never

  it("hard-blocks when costs look stored POSITIVE (the flip would corrupt)", () => {
    const r = validateImport(result(healthy, { signConventions: { cogs: conv("positive_costs") } }), control())
    expect(r.verdict).toBe("blocked")
    expect(r.findings.some((f) => f.category === "sign" && f.severity === "blocker")).toBe(true)
  })

  it("hard-blocks on an AMBIGUOUS cost-sign convention", () => {
    const r = validateImport(result(healthy, { signConventions: { expense: conv("ambiguous") } }), control())
    expect(r.verdict).toBe("blocked")
  })

  it("does NOT block on the clear negative-cost convention (today's behaviour)", () => {
    const r = validateImport(result(healthy, { signConventions: { cogs: conv("negative_costs"), expense: conv("negative_costs") } }), control())
    expect(r.findings.some((f) => f.category === "sign" && f.severity === "blocker")).toBe(false)
    expect(r.verdict).toBe("certified")
  })

  it("does NOT block when there is no cost-sign evidence", () => {
    const r = validateImport(result(healthy, { signConventions: { cogs: conv("no_evidence") } }), control())
    expect(r.findings.some((f) => f.category === "sign" && f.severity === "blocker")).toBe(false)
  })
})

describe("validateImport — semantic section↔type", () => {
  it("warns when rows are classified against their visual section", () => {
    const r = validateImport(
      result(healthy, { sectionTypeConflicts: [{ code: "PLF.01.99", resolvedType: "cogs", sectionType: "revenue" }] }),
      control(),
    )
    expect(r.verdict).toBe("warn")
    expect(r.findings.some((f) => f.category === "semantic")).toBe(true)
  })
})
