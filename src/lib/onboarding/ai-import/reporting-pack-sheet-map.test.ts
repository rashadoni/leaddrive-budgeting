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
    expect(route("Budget PLF", "PLF")).toMatchObject({ planKind: "budget", role: "source" })
    expect(route("BS Actual", "BS")).toMatchObject({ planKind: "actual", role: "source" })
    expect(route("CF Actual", "CF")).toMatchObject({ planKind: "actual", role: "source" })
    expect(route("Budget CF", "CF")).toMatchObject({ planKind: "budget", role: "source" })
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
