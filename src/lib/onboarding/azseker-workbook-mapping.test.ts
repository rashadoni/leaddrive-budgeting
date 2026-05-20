// @vitest-environment node
/**
 * Locks Guvven mapping classifier rules per docs/codes inventory from
 * the 2026-05-17 Session 9 inspection of "Copy of Guvven Fin.xlsx".
 * 681 distinct codes (PLF: 382, BS: 229, CF: 70) all classified by
 * prefix tree.
 */

import { describe, it, expect } from "vitest"
import {
  isGuvvenCode,
  classifyGuvvenCode,
  classifyGuvvenCashFlowActivity,
  resolveEntityFromSheetName,
  classifyGuvvenSheetFamily,
} from "./azseker-guvven-mapping"

describe("isGuvvenCode", () => {
  it.each([
    ["PLF.01", true],
    ["PLF.01.01", true],
    ["PLF.01.01.05", true],
    ["BS.01.01.01.01", true],
    ["CF.01.02", true],
    ["PLF.05.R", true],
  ])("recognises %s as Guvven", (code, expected) => {
    expect(isGuvvenCode(code)).toBe(expected)
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
    expect(isGuvvenCode(code as string)).toBe(false)
  })
})

describe("classifyGuvvenCode — PLF P&L family", () => {
  it("PLF.01* → revenue", () => {
    expect(classifyGuvvenCode("PLF.01")).toBe("revenue")
    expect(classifyGuvvenCode("PLF.01.01")).toBe("revenue")
    expect(classifyGuvvenCode("PLF.01.02.05")).toBe("revenue")
  })

  it("PLF.02* → cogs", () => {
    expect(classifyGuvvenCode("PLF.02")).toBe("cogs")
    expect(classifyGuvvenCode("PLF.02.01")).toBe("cogs")
    expect(classifyGuvvenCode("PLF.02.03")).toBe("cogs")
  })

  it("PLF.03 (Gross Margin) → skip — computed", () => {
    expect(classifyGuvvenCode("PLF.03")).toBe("skip")
  })

  it("PLF.04* + PLF.05* (S&M + G&A) → expense", () => {
    expect(classifyGuvvenCode("PLF.04")).toBe("expense")
    expect(classifyGuvvenCode("PLF.04.03")).toBe("expense")
    expect(classifyGuvvenCode("PLF.05")).toBe("expense")
    expect(classifyGuvvenCode("PLF.05.R")).toBe("expense")
    expect(classifyGuvvenCode("PLF.05.12")).toBe("expense")
  })

  it("PLF.07 (parent) → skip; 07.01 + 07.02 → revenue; 07.03 + 07.04 → expense", () => {
    expect(classifyGuvvenCode("PLF.07")).toBe("skip")
    expect(classifyGuvvenCode("PLF.07.01")).toBe("revenue")
    expect(classifyGuvvenCode("PLF.07.02")).toBe("revenue")
    expect(classifyGuvvenCode("PLF.07.03")).toBe("expense")
    expect(classifyGuvvenCode("PLF.07.04")).toBe("expense")
  })

  it("PLF.08 (EBITDA) → skip", () => {
    expect(classifyGuvvenCode("PLF.08")).toBe("skip")
  })

  it("PLF.09* (D&A + tax + interest + shareholder) → expense", () => {
    expect(classifyGuvvenCode("PLF.09.01")).toBe("expense")
    expect(classifyGuvvenCode("PLF.09.02")).toBe("expense")
    expect(classifyGuvvenCode("PLF.09.03")).toBe("expense")
    expect(classifyGuvvenCode("PLF.09.04")).toBe("expense")
  })

  it("PLF.10 (Net Profit) → skip", () => {
    expect(classifyGuvvenCode("PLF.10")).toBe("skip")
  })

  it("PLF.12* (Provisions) → expense", () => {
    expect(classifyGuvvenCode("PLF.12")).toBe("expense")
    expect(classifyGuvvenCode("PLF.12.01")).toBe("expense")
  })
})

describe("classifyGuvvenCode — BS family", () => {
  it("BS.01* → asset", () => {
    expect(classifyGuvvenCode("BS.01")).toBe("asset")
    expect(classifyGuvvenCode("BS.01.01")).toBe("asset")
    expect(classifyGuvvenCode("BS.01.01.01.01")).toBe("asset")
  })

  it("BS.02* → equity", () => {
    expect(classifyGuvvenCode("BS.02")).toBe("equity")
    expect(classifyGuvvenCode("BS.02.04")).toBe("equity")
  })

  it("BS.03* → liability", () => {
    expect(classifyGuvvenCode("BS.03")).toBe("liability")
    expect(classifyGuvvenCode("BS.03.01")).toBe("liability")
    expect(classifyGuvvenCode("BS.03.02")).toBe("liability")
  })
})

describe("classifyGuvvenCode — CF family", () => {
  it("CF.* → skip (handled separately via activity classifier)", () => {
    expect(classifyGuvvenCode("CF.01")).toBe("skip")
    expect(classifyGuvvenCode("CF.02.01")).toBe("skip")
    expect(classifyGuvvenCode("CF.07")).toBe("skip")
  })
})

describe("classifyGuvvenCashFlowActivity", () => {
  it("CF.01* → operating", () => {
    expect(classifyGuvvenCashFlowActivity("CF.01")).toBe("operating")
    expect(classifyGuvvenCashFlowActivity("CF.01.02")).toBe("operating")
  })

  it("CF.02* → investing", () => {
    expect(classifyGuvvenCashFlowActivity("CF.02")).toBe("investing")
    expect(classifyGuvvenCashFlowActivity("CF.02.01")).toBe("investing")
  })

  it("CF.03* → financing", () => {
    expect(classifyGuvvenCashFlowActivity("CF.03")).toBe("financing")
    expect(classifyGuvvenCashFlowActivity("CF.03.02")).toBe("financing")
  })

  it("CF.04/05/06/07 (bridge rows) → skip", () => {
    expect(classifyGuvvenCashFlowActivity("CF.04")).toBe("skip")
    expect(classifyGuvvenCashFlowActivity("CF.05")).toBe("skip")
    expect(classifyGuvvenCashFlowActivity("CF.06")).toBe("skip")
    expect(classifyGuvvenCashFlowActivity("CF.07")).toBe("skip")
  })

  it("non-CF code → skip", () => {
    expect(classifyGuvvenCashFlowActivity("PLF.01")).toBe("skip")
    expect(classifyGuvvenCashFlowActivity("BS.01")).toBe("skip")
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

describe("classifyGuvvenSheetFamily", () => {
  it.each([
    ["PLF CPC", "PLF"],
    ["PL Malt", "PLF"], // alias — "PL" treated same as "PLF"
    ["BS CPC", "BS"],
    ["BS Malt", "BS"],
    ["CF EDEN", "CF"],
  ])("maps '%s' → %s", (sheet, fam) => {
    expect(classifyGuvvenSheetFamily(sheet)).toBe(fam)
  })

  it("returns null for non-statement / non-KPI sheets", () => {
    // Sales plan dispatch deferred — stays null until SALES_PLAN adapter wired.
    expect(classifyGuvvenSheetFamily("Farming Budget sales plan")).toBeNull()
    expect(classifyGuvvenSheetFamily("Actual >>>")).toBeNull()
  })

  it("maps KPI sheets to KPI_FARMING / KPI_PROCESSING (Phase 7.I)", () => {
    expect(classifyGuvvenSheetFamily("Farming KPI")).toBe("KPI_FARMING")
    // Single-entity processing KPI sheets (entity encoded in name prefix).
    expect(classifyGuvvenSheetFamily("CPC KPI")).toBe("KPI_PROCESSING")
    expect(classifyGuvvenSheetFamily("AZSF KPI")).toBe("KPI_PROCESSING")
    expect(classifyGuvvenSheetFamily("EDEN KPI")).toBe("KPI_PROCESSING")
    expect(classifyGuvvenSheetFamily("MALT KPI")).toBe("KPI_PROCESSING")
    // Unknown prefix → still null (would need a map extension)
    expect(classifyGuvvenSheetFamily("Unknown KPI")).toBeNull()
  })
})
