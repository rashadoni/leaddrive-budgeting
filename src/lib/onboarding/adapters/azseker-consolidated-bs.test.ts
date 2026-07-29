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

  it("THROWS when a whole section header is missing (else the section drops silently)", () => {
    const rows = fixture()
    for (const r of [18, 19, 20, 22, 23]) rows[r] = [] // remove the LIABILITIES section
    expect(() => parseConsolidatedBs(rows)).toThrow(/no "liability" section header/i)
  })

  it("THROWS on a numeric leaf before the first section header", () => {
    const rows = fixture()
    rows[3] = ["Stray Number", null, 42] // numeric row before ASSETS (r4)
    expect(() => parseConsolidatedBs(rows)).toThrow(/before any.*section header/i)
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

// ─── Phase 11.18 — the scale assumption is no longer silent ─────────────
//
// The ×1000 thousands→manat factor is an ASSUMPTION about the sheet, and the
// reconciliation guard cannot verify it: that guard compares Σ(leaves) with
// the sheet's own subtotal cell, and BOTH sides pass through the factor, so it
// is scale-invariant by construction and stays green for any multiplier.
describe("parseConsolidatedBs — scale plausibility", () => {
  /** The canonical fixture with every numeric cell scaled by `k`. */
  function scaled(k: number): unknown[][] {
    return fixture().map((row) =>
      Array.isArray(row)
        ? row.map((cell, idx) =>
            // col 2 of the date row is an Excel serial, never an amount.
            typeof cell === "number" && !(idx === 2 && cell === 46023)
              ? cell * k
              : cell,
          )
        : row,
    )
  }

  it("stays quiet when the totals land in the expected band", () => {
    // assets 100 × 1000 (sheet) × 1000 (factor) = ₼100M — normal for this holding.
    const r = parseConsolidatedBs(scaled(1000))
    expect(r.scaleWarnings).toEqual([])
  })

  it("WARNS when the result is implausibly small — the factor is likely wrong", () => {
    // assets 100 × 1000 = ₼100k. Every internal cross-foot still ties, which
    // is exactly why this needed its own signal.
    const r = parseConsolidatedBs(fixture())
    expect(r.scaleWarnings.length).toBeGreaterThan(0)
    expect(r.scaleWarnings.join(" ")).toMatch(/CONFIRM the sheet's units/)
  })

  it("WARNS when the result is implausibly large", () => {
    const r = parseConsolidatedBs(scaled(10_000_000))
    expect(r.scaleWarnings.length).toBeGreaterThan(0)
  })

  it("never THROWS on a scale problem — only the owner can confirm units", () => {
    // Refusing the import on a heuristic would block a legitimate one.
    expect(() => parseConsolidatedBs(fixture())).not.toThrow()
  })
})
