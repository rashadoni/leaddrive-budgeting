import { describe, it, expect } from "vitest"
import { resolveSheetRouting } from "./sheet-routing"
import type { SheetDataType } from "./sheet-classifier"
import {
  REPORTING_PACK_SHEET_MAP,
  looksLikeReportingPack,
} from "./reporting-pack-sheet-map"

function route(sheetName: string, dataType: SheetDataType = "PLF") {
  return resolveSheetRouting({
    dataType,
    sheetName,
    section: null,
    config: REPORTING_PACK_SHEET_MAP,
  })
}

describe("REPORTING_PACK_SHEET_MAP", () => {
  it("routes the structured sources to the correct plan kind", () => {
    expect(route("Actual PLF", "PLF")).toMatchObject({ planKind: "actual", role: "source" })
    // Raw "Budget PLF" is now a DERIVED skip (2026-06-23): it is 5 stacked
    // per-entity blocks, so the route PRE-SPLITS it into one virtual per-entity
    // sheet each (applyBudgetPlfSplit) and removes the raw sheet. This entry is
    // the safe fallback for when the split can't run — skip, never holding-stack.
    expect(route("Budget PLF", "PLF")).toMatchObject({ role: "derived_summary" })
    expect(route("BS Actual", "BS")).toMatchObject({ planKind: "actual", role: "source" })
    expect(route("CF Actual", "CF")).toMatchObject({ planKind: "actual", role: "source" })
    // Budget CF is intentionally NOT a source (2026-06-23): budget is P&L-only,
    // and routing this consolidated CF to the holding inflated CashFlowEntry ~10×.
    expect(route("Budget CF", "CF")).toMatchObject({ role: "derived_summary" })
  })

  it("the virtual per-entity Budget PLF sheets route to budget/source with the right entity + dataType override", () => {
    // applyBudgetPlfSplit emits these sheet-map entries; verify routing pins them
    // deterministically (planKind=budget, role=source, dataType=PLF, entity).
    const cfg = [
      {
        match: "Budget PLF [AZSEKER-EDEN]",
        dataType: "PLF" as SheetDataType,
        planKind: "budget" as const,
        role: "source" as const,
        entityCode: "AZSEKER-EDEN",
      },
    ]
    const r = resolveSheetRouting({
      dataType: "UNKNOWN",
      sheetName: "Budget PLF [AZSEKER-EDEN]",
      section: null,
      config: cfg,
    })
    expect(r).toMatchObject({
      planKind: "budget",
      role: "source",
      entityCodeOverride: "AZSEKER-EDEN",
      dataTypeOverride: "PLF",
    })
  })

  it("skips every derived / summary / elimination / flat-feed view", () => {
    for (const name of [
      "Actual",
      "Budget",
      "CONS PL_1",
      "CONS PL_2",
      "PL EDEN",
      "BU PL",
      "Marginality",
      "PL Comparison",
      "BS",
      "BS EDEN",
      "BS EDEN EJE",
      "BS Pivot",
      "BS Data",
      "Farming Revenue",
      "Farming COGS",
    ]) {
      expect(route(name).role, name).toBe("derived_summary")
    }
  })

  it("is a no-op on a non-reporting-pack workbook (exact-name match)", () => {
    // Guvven's "PLF CPC" matches no entry → resolved by heuristics, not config.
    expect(route("PLF CPC", "PLF").roleSignal).toBe("default")
  })
})

describe("looksLikeReportingPack", () => {
  it("detects the pack by its two structured-source PLF tabs", () => {
    expect(looksLikeReportingPack(["Actual PLF", "Budget PLF", "CONS PL_1"])).toBe(true)
  })
  it("does not match Guvven Fin or a partial set", () => {
    expect(looksLikeReportingPack(["PLF CPC", "BS CPC"])).toBe(false)
    expect(looksLikeReportingPack(["Actual PLF"])).toBe(false) // budget tab absent
  })
})
