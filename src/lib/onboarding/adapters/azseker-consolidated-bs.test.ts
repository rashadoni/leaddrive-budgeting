import { describe, it, expect } from "vitest"
import {
  parseConsolidatedBs,
  excelSerialToYearMonth,
  consolidatedAccountCode,
} from "./azseker-consolidated-bs"

// Synthetic mirror of the real `BS` tab: ASSETS/EQUITY/LIABILITIES section
// headers carry the subtotal cell; intermediate subtotals (CURRENT ASSETS,
// Inventories, NON/CURRENT LIABILITIES) are skipped; leaves sit under a section.
// Values are in THOUSANDS (the parser ×1000s them). One month: serial 46023 = 2026-01.
function fixture(): unknown[][] {
  const rows: unknown[][] = []
  const set = (r: number, label: unknown, val?: number) => {
    rows[r] = [label, null, val ?? null]
  }
  set(0, "Consolidated Balance Sheet")
  rows[2] = [null, null, 46023] // date row, col 2 = 2026-01
  set(4, "ASSETS", 100)
  set(6, "Property, Plant and Equipment", 60)
  set(8, "CURRENT ASSETS", 40)
  set(9, "Cash and Cash Equivalents", 25)
  set(11, "Inventories", 15)
  set(12, "Finished Goods", 10)
  set(13, "Raw Materials", 5)
  set(15, "EQUITY", -80)
  set(16, "Share/Charter capital", -80)
  set(18, "LIABILITIES", -20)
  set(19, "NON-CURRENT LIABILITIES", -12)
  set(20, "Loans & Borrowings, Long-Term", -12)
  set(22, "CURRENT LIABILITIES", -8)
  set(23, "Payables, Short-Term", -8)
  return rows
}

describe("excelSerialToYearMonth", () => {
  it("converts Excel serials to YYYY-MM (1900 date system)", () => {
    expect(excelSerialToYearMonth(46023)).toBe("2026-01")
    expect(excelSerialToYearMonth(45658)).toBe("2025-01")
  })
})

describe("parseConsolidatedBs", () => {
  it("extracts 7 verbatim leaves with section + subType, ×1000 applied", () => {
    const { leaves, months } = parseConsolidatedBs(fixture())
    expect(months).toEqual(["2026-01"])
    expect(leaves).toHaveLength(7)

    const byLabel = new Map(leaves.map((l) => [l.label, l]))
    const ppe = byLabel.get("Property, Plant and Equipment")!
    expect(ppe.section).toBe("asset")
    expect(ppe.subType).toBe("non_current")
    expect(ppe.byMonth.get("2026-01")).toBe(60_000) // ×1000

    expect(byLabel.get("Cash and Cash Equivalents")!.subType).toBe("current")
    expect(byLabel.get("Finished Goods")!.subType).toBe("current")
    expect(byLabel.get("Share/Charter capital")!.section).toBe("equity")
    expect(byLabel.get("Share/Charter capital")!.subType).toBeNull()
    expect(byLabel.get("Loans & Borrowings, Long-Term")!.subType).toBe("long_term")
    expect(byLabel.get("Payables, Short-Term")!.subType).toBe("short_term")
  })

  it("never stores subtotal/header rows as leaves", () => {
    const labels = parseConsolidatedBs(fixture()).leaves.map((l) => l.label)
    for (const sub of [
      "ASSETS",
      "CURRENT ASSETS",
      "Inventories",
      "EQUITY",
      "LIABILITIES",
      "NON-CURRENT LIABILITIES",
      "CURRENT LIABILITIES",
    ]) {
      expect(labels).not.toContain(sub)
    }
  })

  it("captures the official subtotal cells (×1000) per month", () => {
    const { officialTotals } = parseConsolidatedBs(fixture())
    const t = officialTotals.get("2026-01")!
    expect(t.asset).toBe(100_000)
    expect(t.equity).toBe(-80_000)
    expect(t.liability).toBe(-20_000)
  })

  it("THROWS when leaves do not reconcile to the subtotal cell (money guard)", () => {
    const bad = fixture()
    // Tamper one asset leaf so Σ(assets) ≠ ASSETS subtotal, leaving the
    // subtotal cell untouched — the guard must refuse to write.
    bad[6] = ["Property, Plant and Equipment", null, 70] // was 60
    expect(() => parseConsolidatedBs(bad)).toThrow(/reconciliation FAILED.*asset/i)
  })

  it("throws when no date row is present", () => {
    expect(() => parseConsolidatedBs([["ASSETS", null, 1]])).toThrow(/no date row/i)
  })
})

describe("consolidatedAccountCode", () => {
  it("derives a stable CONS.BS.* code from the official label", () => {
    expect(consolidatedAccountCode("Property, Plant and Equipment")).toBe(
      "CONS.BS.PROPERTY_PLANT_AND_EQUIPMENT",
    )
    expect(consolidatedAccountCode("Cash and Cash Equivalents")).toBe(
      "CONS.BS.CASH_AND_CASH_EQUIVALENTS",
    )
  })
})
