// @vitest-environment node
/**
 * Locks Workbook mapping classifier rules per docs/codes inventory from
 * the 2026-05-17 Session 9 inspection of "Copy of Guvven Fin.xlsx".
 * 681 distinct codes (PLF: 382, BS: 229, CF: 70) all classified by
 * prefix tree.
 */

import { describe, it, expect } from "vitest"
import {
  isWorkbookCode,
  classifyWorkbookCode,
  classifyWorkbookCashFlowActivity,
  resolveEntityFromSheetName,
  classifyWorkbookSheetFamily,
} from "./azseker-workbook-mapping"

describe("isWorkbookCode", () => {
  it.each([
    ["PLF.01", true],
    ["PLF.01.01", true],
    ["PLF.01.01.05", true],
    ["BS.01.01.01.01", true],
    ["CF.01.02", true],
    ["PLF.05.R", true],
  ])("recognises %s as Workbook", (code, expected) => {
    expect(isWorkbookCode(code)).toBe(expected)
  })

  it.each([
    "601-01",       // SAP-style
    "REVENUE",      // bare label
    "",             // empty
    null,           // null
    undefined,      // undefined
    "PLF",          // bare family (no digit)
    "BSx.01",       // family with extra letter
  ])("rejects %s", (code) => {
    expect(isWorkbookCode(code as string)).toBe(false)
  })
})

describe("classifyWorkbookCode — PLF P&L family", () => {
  it("PLF.01* → revenue", () => {
    expect(classifyWorkbookCode("PLF.01")).toBe("revenue")
    expect(classifyWorkbookCode("PLF.01.01")).toBe("revenue")
    expect(classifyWorkbookCode("PLF.01.02.05")).toBe("revenue")
  })

  it("PLF.02* → cogs", () => {
    expect(classifyWorkbookCode("PLF.02")).toBe("cogs")
    expect(classifyWorkbookCode("PLF.02.01")).toBe("cogs")
    expect(classifyWorkbookCode("PLF.02.03")).toBe("cogs")
  })

  it("PLF.03 (Gross Margin) → skip — computed", () => {
    expect(classifyWorkbookCode("PLF.03")).toBe("skip")
  })

  it("PLF.04* + PLF.05* (S&M + G&A) → expense", () => {
    expect(classifyWorkbookCode("PLF.04")).toBe("expense")
    expect(classifyWorkbookCode("PLF.04.03")).toBe("expense")
    expect(classifyWorkbookCode("PLF.05")).toBe("expense")
    expect(classifyWorkbookCode("PLF.05.R")).toBe("expense")
    expect(classifyWorkbookCode("PLF.05.12")).toBe("expense")
  })

  it("PLF.07 (parent) → skip; 07.01 + 07.02 → revenue; 07.03 + 07.04 → expense", () => {
    expect(classifyWorkbookCode("PLF.07")).toBe("skip")
    expect(classifyWorkbookCode("PLF.07.01")).toBe("revenue")
    expect(classifyWorkbookCode("PLF.07.02")).toBe("revenue")
    expect(classifyWorkbookCode("PLF.07.03")).toBe("expense")
    expect(classifyWorkbookCode("PLF.07.04")).toBe("expense")
  })

  it("PLF.08 (EBITDA) → skip", () => {
    expect(classifyWorkbookCode("PLF.08")).toBe("skip")
  })

  it("PLF.09* (D&A + tax + interest + shareholder) → expense", () => {
    expect(classifyWorkbookCode("PLF.09.01")).toBe("expense")
    expect(classifyWorkbookCode("PLF.09.02")).toBe("expense")
    expect(classifyWorkbookCode("PLF.09.03")).toBe("expense")
    expect(classifyWorkbookCode("PLF.09.04")).toBe("expense")
  })

  it("PLF.10 (Net Profit) → skip", () => {
    expect(classifyWorkbookCode("PLF.10")).toBe("skip")
  })

  it("PLF.12* (Provisions) → expense", () => {
    expect(classifyWorkbookCode("PLF.12")).toBe("expense")
    expect(classifyWorkbookCode("PLF.12.01")).toBe("expense")
  })
})

describe("classifyWorkbookCode — BS family", () => {
  it("BS.01* → asset", () => {
    expect(classifyWorkbookCode("BS.01")).toBe("asset")
    expect(classifyWorkbookCode("BS.01.01")).toBe("asset")
    expect(classifyWorkbookCode("BS.01.01.01.01")).toBe("asset")
  })

  it("BS.02* → equity", () => {
    expect(classifyWorkbookCode("BS.02")).toBe("equity")
    expect(classifyWorkbookCode("BS.02.04")).toBe("equity")
  })

  it("BS.03* → liability", () => {
    expect(classifyWorkbookCode("BS.03")).toBe("liability")
    expect(classifyWorkbookCode("BS.03.01")).toBe("liability")
    expect(classifyWorkbookCode("BS.03.02")).toBe("liability")
  })
})

describe("classifyWorkbookCode — CF family", () => {
  it("CF.* → skip (handled separately via activity classifier)", () => {
    expect(classifyWorkbookCode("CF.01")).toBe("skip")
    expect(classifyWorkbookCode("CF.02.01")).toBe("skip")
    expect(classifyWorkbookCode("CF.07")).toBe("skip")
  })
})

describe("classifyWorkbookCashFlowActivity", () => {
  it("CF.01* → operating", () => {
    expect(classifyWorkbookCashFlowActivity("CF.01")).toBe("operating")
    expect(classifyWorkbookCashFlowActivity("CF.01.02")).toBe("operating")
  })

  it("CF.02* → investing", () => {
    expect(classifyWorkbookCashFlowActivity("CF.02")).toBe("investing")
    expect(classifyWorkbookCashFlowActivity("CF.02.01")).toBe("investing")
  })

  it("CF.03* → financing", () => {
    expect(classifyWorkbookCashFlowActivity("CF.03")).toBe("financing")
    expect(classifyWorkbookCashFlowActivity("CF.03.02")).toBe("financing")
  })

  it("CF.04/05/06/07 (bridge rows) → skip", () => {
    expect(classifyWorkbookCashFlowActivity("CF.04")).toBe("skip")
    expect(classifyWorkbookCashFlowActivity("CF.05")).toBe("skip")
    expect(classifyWorkbookCashFlowActivity("CF.06")).toBe("skip")
    expect(classifyWorkbookCashFlowActivity("CF.07")).toBe("skip")
  })

  it("non-CF code → skip", () => {
    expect(classifyWorkbookCashFlowActivity("PLF.01")).toBe("skip")
    expect(classifyWorkbookCashFlowActivity("BS.01")).toBe("skip")
  })
})

describe("resolveEntityFromSheetName", () => {
  it.each([
    ["PLF CPC", "AZSEKER-CPC"],
    ["BS CPC", "AZSEKER-CPC"],
    ["CF CPC", "AZSEKER-CPC"],
    ["PLF AZSF", "AZSEKER-AZSF"],
    ["BS AZSF", "AZSEKER-AZSF"],
    ["CF AZSF", "AZSEKER-AZSF"],
    ["PLF EDEN", "AZSEKER-EDEN"],
    ["BS EDEN", "AZSEKER-EDEN"],
    ["CF EDEN", "AZSEKER-EDEN"],
    ["PL Malt", "AZSEKER-MALT"], // "PL" not "PLF" in source sheet name
    ["BS Malt", "AZSEKER-MALT"],
    ["CF Malt", "AZSEKER-MALT"],
  ])("maps '%s' → %s", (sheet, entity) => {
    expect(resolveEntityFromSheetName(sheet)).toBe(entity)
  })

  it("returns null for non-financial sheets", () => {
    expect(resolveEntityFromSheetName("Farming Budget sales plan")).toBeNull()
    expect(resolveEntityFromSheetName("Actual >>>")).toBeNull()
    expect(resolveEntityFromSheetName("KPI >>>")).toBeNull()
    expect(resolveEntityFromSheetName("Farming KPI")).toBeNull()
    expect(resolveEntityFromSheetName("CPC KPI")).toBeNull()
    expect(resolveEntityFromSheetName("Satış ProMalt")).toBeNull()
    expect(resolveEntityFromSheetName("")).toBeNull()
  })
})

describe("classifyWorkbookSheetFamily", () => {
  it.each([
    ["PLF CPC", "PLF"],
    ["PL Malt", "PLF"], // alias — "PL" treated same as "PLF"
    ["BS CPC", "BS"],
    ["BS Malt", "BS"],
    ["CF EDEN", "CF"],
  ])("maps '%s' → %s", (sheet, fam) => {
    expect(classifyWorkbookSheetFamily(sheet)).toBe(fam)
  })

  it("returns null for non-statement / non-KPI sheets", () => {
    // Sales plan dispatch deferred — stays null until SALES_PLAN adapter wired.
    expect(classifyWorkbookSheetFamily("Farming Budget sales plan")).toBeNull()
    expect(classifyWorkbookSheetFamily("Actual >>>")).toBeNull()
  })

  it("maps KPI sheets to KPI_FARMING / KPI_PROCESSING (Phase 7.I)", () => {
    expect(classifyWorkbookSheetFamily("Farming KPI")).toBe("KPI_FARMING")
    // Single-entity processing KPI sheets (entity encoded in name prefix).
    expect(classifyWorkbookSheetFamily("CPC KPI")).toBe("KPI_PROCESSING")
    expect(classifyWorkbookSheetFamily("AZSF KPI")).toBe("KPI_PROCESSING")
    expect(classifyWorkbookSheetFamily("EDEN KPI")).toBe("KPI_PROCESSING")
    expect(classifyWorkbookSheetFamily("MALT KPI")).toBe("KPI_PROCESSING")
    // Unknown prefix → still null (would need a map extension)
    expect(classifyWorkbookSheetFamily("Unknown KPI")).toBeNull()
  })
})
