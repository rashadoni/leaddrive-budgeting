import { describe, it, expect } from "vitest"
import {
  resolveSheetRouting,
  type SheetMap,
  type RoutingInput,
} from "./sheet-routing"

function route(p: Partial<RoutingInput> & { sheetName: string }) {
  return resolveSheetRouting({
    dataType: p.dataType ?? "PLF",
    sheetName: p.sheetName,
    section: p.section ?? null,
    config: p.config,
  })
}

describe("resolveSheetRouting — planKind authority chain", () => {
  it("section separator is highest authority (budget)", () => {
    const r = route({ sheetName: "Anything", section: "budget" })
    expect(r.planKind).toBe("budget")
    expect(r.planKindSignal).toBe("section")
  })

  it("section separator is highest authority (actual)", () => {
    const r = route({ sheetName: "Anything", section: "actual" })
    expect(r.planKind).toBe("actual")
    expect(r.planKindSignal).toBe("section")
  })

  it("section beats a conflicting config", () => {
    const config: SheetMap = [{ match: "X", planKind: "budget" }]
    const r = route({ sheetName: "X", section: "actual", config })
    expect(r.planKind).toBe("actual")
    expect(r.planKindSignal).toBe("section")
  })

  it("config beats a conflicting name keyword", () => {
    const config: SheetMap = [{ match: "Actual special", planKind: "budget" }]
    const r = route({ sheetName: "Actual special", config })
    expect(r.planKind).toBe("budget")
    expect(r.planKindSignal).toBe("config")
  })

  it("tab-name keyword resolves budget (the reporting-pack fix)", () => {
    const r = route({ sheetName: "Budget PLF" })
    expect(r.planKind).toBe("budget")
    expect(r.planKindSignal).toBe("keyword")
  })

  it("tab-name keyword resolves actual", () => {
    const r = route({ sheetName: "Actual PLF" })
    expect(r.planKind).toBe("actual")
    expect(r.planKindSignal).toBe("keyword")
  })

  it("dataType rule routes sales/forecast/budget-actuals to budget", () => {
    for (const dataType of ["SALES", "SALES_FORECAST", "BUDGET_ACTUALS"] as const) {
      const r = route({ sheetName: "Some sheet", dataType })
      expect(r.planKind).toBe("budget")
      expect(r.planKindSignal).toBe("dataType")
    }
  })

  it("NEVER silently defaults to actual — no signal yields null (caller blocks)", () => {
    const r = route({ sheetName: "Guvven Fin", dataType: "PLF" })
    expect(r.planKind).toBeNull()
    expect(r.planKindSignal).toBe("unresolved")
  })

  it("a bare 'PLF' tab with no signal is unresolved, not actual", () => {
    const r = route({ sheetName: "PLF", dataType: "PLF" })
    expect(r.planKind).toBeNull()
  })
})

describe("resolveSheetRouting — role (source vs derived_summary)", () => {
  it("plain source statements are role=source", () => {
    expect(route({ sheetName: "Actual PLF" }).role).toBe("source")
    expect(route({ sheetName: "Budget CF", dataType: "CF" }).role).toBe("source")
    expect(route({ sheetName: "BS EDEN", dataType: "BS" }).role).toBe("source")
  })

  it("consolidations / pivots / comparisons / margins are derived_summary", () => {
    for (const name of [
      "CONS PL_1",
      "CONS PL_2",
      "BS Pivot",
      "PL Comparison",
      "Marginality",
      "BU PL",
      "BS Data",
    ]) {
      const r = route({ sheetName: name })
      expect(r.role, name).toBe("derived_summary")
      expect(r.roleSignal, name).toBe("name-pattern")
    }
  })

  it("config can force a role the name pattern would miss", () => {
    const config: SheetMap = [{ match: "PL EDEN", role: "derived_summary" }]
    const r = route({ sheetName: "PL EDEN", config })
    expect(r.role).toBe("derived_summary")
    expect(r.roleSignal).toBe("config")
  })

  it("does not misfire derived on a source name", () => {
    expect(route({ sheetName: "Actual PLF" }).roleSignal).toBe("default")
  })
})

describe("resolveSheetRouting — reporting-pack shape (regression)", () => {
  it("separates the two P&L tabs into different plans", () => {
    const actual = route({ sheetName: "Actual PLF" })
    const budget = route({ sheetName: "Budget PLF" })
    expect(actual.planKind).toBe("actual")
    expect(budget.planKind).toBe("budget")
    expect(actual.role).toBe("source")
    expect(budget.role).toBe("source")
  })

  it("the derived P&L/BS views are skipped (so they cannot collide)", () => {
    const derived = ["CONS PL_1", "CONS PL_2", "BU PL", "Marginality", "PL Comparison", "BS Pivot", "BS Data"]
    for (const name of derived) {
      expect(route({ sheetName: name }).role, name).toBe("derived_summary")
    }
  })
})
