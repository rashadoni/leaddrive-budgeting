/**
 * Phase 7.M Step 7 — Farming Sales parser tests.
 *
 * Builds a synthetic xlsx workbook in-memory and asserts the parser
 * produces the expected facts + expectedSums map. Mirrors the
 * azseker-workbook-bs.test.ts pattern.
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import {
  parseFarmingSalesSheet,
  productNameToSlug,
} from "./azseker-workbook-sales"

// Helper — build a workbook from a 2-D array.
function wbFromAoa(name: string, aoa: unknown[][]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, name)
  return wb
}

// Excel serial for Y-M-D.
function xlDate(year: number, month: number, day: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000)
}

describe("productNameToSlug", () => {
  it("strips Azerbaijani diacritics + lowercases", () => {
    expect(productNameToSlug("Buğda")).toBe("bugda")
    expect(productNameToSlug("Şəkər Çuğunduru")).toBe("seker_cugunduru")
    expect(productNameToSlug("Qarğıdalı (Təkrar)")).toBe("qargidali_tekrar")
    expect(productNameToSlug("Pambıq")).toBe("pambiq")
    expect(productNameToSlug("Badam")).toBe("badam")
  })

  it("handles multiple consecutive separators + edge spaces", () => {
    expect(productNameToSlug("  Hello   World  ")).toBe("hello_world")
    expect(productNameToSlug("Test--Foo")).toBe("test_foo")
  })
})

describe("parseFarmingSalesSheet", () => {
  it("parses the canonical Farming Budget shape (Volume section)", () => {
    const sheet: unknown[][] = [
      // r0 — sheet title (skipped)
      ["ƏKİNÇİLİK MƏHSULLARIN SATIŞ PLANI"],
      // r1 — header row with 12 monthly dates + annual
      [
        "Məhsul",
        xlDate(2026, 1, 1),
        xlDate(2026, 2, 1),
        xlDate(2026, 3, 1),
        xlDate(2026, 4, 1),
        xlDate(2026, 5, 1),
        xlDate(2026, 6, 1),
        xlDate(2026, 7, 1),
        xlDate(2026, 8, 1),
        xlDate(2026, 9, 1),
        xlDate(2026, 10, 1),
        xlDate(2026, 11, 1),
        xlDate(2026, 12, 1),
        2026,
      ],
      // r2 — Volume section header
      ["Satış plan, Ton"],
      // r3 — Buğda (zeros for first 5 months, then 21401 + 21401)
      ["Buğda", 0, 0, 0, 0, 0, 21401, 21401, 0, 0, 0, 0, 0],
      // r4 — Arpa (full year)
      ["Arpa", 250, 250, 300, 350, 250, 450, 2300, 2250, 200, 150, 150, 200],
    ]
    const wb = wbFromAoa("Farming Budget sales plan", sheet)
    const result = parseFarmingSalesSheet(
      wb,
      "Farming Budget sales plan",
      XLSX,
      { preferYear: 2026, companyId: "c_eden" },
    )

    expect(result.warnings).toEqual([])
    // Buğda has 2 non-zero months; Arpa has 12 non-zero months.
    expect(result.facts).toHaveLength(2 + 12)
    expect(result.expectedSums.size).toBe(2 + 12)

    // Spot-check Buğda Jun = 21401 t.
    const bugdaJun = result.facts.find(
      (f) => f.metric === "farm_sales_bugda_ton" && f.date === "2026-06-30",
    )
    expect(bugdaJun?.value).toBe(21401)
    expect(bugdaJun?.unit).toBe("ton")

    // Spot-check expectedSums uses the company-id-keyed format.
    const arpaJan = result.expectedSums.get(
      "c_eden::farm_sales_arpa_ton::2026-01-31",
    )
    expect(arpaJan).toBe(250)
  })

  it("emits DIFFERENT metrics per section — Volume / Revenue / Price / Cost", () => {
    // Real-shape Farming sheet: 4 sections, same product names repeat.
    // Pre-fix bug: parser conflated all 4 under `farm_sales_arpa_ton`.
    const header = [
      "Məhsul",
      xlDate(2026, 1, 1),
      xlDate(2026, 2, 1),
      xlDate(2026, 3, 1),
      xlDate(2026, 4, 1),
      xlDate(2026, 5, 1),
      xlDate(2026, 6, 1),
      xlDate(2026, 7, 1),
      xlDate(2026, 8, 1),
      xlDate(2026, 9, 1),
      xlDate(2026, 10, 1),
      xlDate(2026, 11, 1),
      xlDate(2026, 12, 1),
    ]
    const sheet: unknown[][] = [
      ["title"],
      header,
      ["Satış plan, Ton"],
      ["Arpa", 250, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ["Satış plan, AZN"],
      ["Arpa", 140000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ["Satış plan, Qiymət"],
      ["Arpa", 560, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ["Maya dəyəri, AZN"],
      ["Arpa", 104062.94, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ]
    const wb = wbFromAoa("Farming Budget sales plan", sheet)
    const result = parseFarmingSalesSheet(
      wb,
      "Farming Budget sales plan",
      XLSX,
      { preferYear: 2026, companyId: "c_eden" },
    )
    expect(result.warnings).toEqual([])
    // 4 distinct metrics × 1 month = 4 facts.
    expect(result.facts).toHaveLength(4)
    const metrics = new Set(result.facts.map((f) => f.metric))
    expect(metrics).toEqual(
      new Set([
        "farm_sales_arpa_ton",
        "farm_sales_arpa_revenue_azn",
        "farm_sales_arpa_price_azn_per_ton",
        "farm_sales_arpa_cost_azn",
      ]),
    )
    // Unit attribution differs per section.
    const byMetric = Object.fromEntries(result.facts.map((f) => [f.metric, f]))
    expect(byMetric["farm_sales_arpa_ton"].value).toBe(250)
    expect(byMetric["farm_sales_arpa_ton"].unit).toBe("ton")
    expect(byMetric["farm_sales_arpa_revenue_azn"].value).toBe(140000)
    expect(byMetric["farm_sales_arpa_revenue_azn"].unit).toBe("AZN")
    expect(byMetric["farm_sales_arpa_price_azn_per_ton"].value).toBe(560)
    expect(byMetric["farm_sales_arpa_price_azn_per_ton"].unit).toBe("AZN/ton")
    expect(byMetric["farm_sales_arpa_cost_azn"].value).toBeCloseTo(104062.94, 2)
    expect(byMetric["farm_sales_arpa_cost_azn"].unit).toBe("AZN")
  })

  it("warns when a product row appears before any section header", () => {
    const sheet: unknown[][] = [
      ["title"],
      [
        "Məhsul",
        xlDate(2026, 1, 1),
        xlDate(2026, 2, 1),
        xlDate(2026, 3, 1),
        xlDate(2026, 4, 1),
        xlDate(2026, 5, 1),
        xlDate(2026, 6, 1),
        xlDate(2026, 7, 1),
        xlDate(2026, 8, 1),
        xlDate(2026, 9, 1),
        xlDate(2026, 10, 1),
        xlDate(2026, 11, 1),
        xlDate(2026, 12, 1),
      ],
      ["Buğda", 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ]
    const wb = wbFromAoa("Farming Budget sales plan", sheet)
    const result = parseFarmingSalesSheet(
      wb,
      "Farming Budget sales plan",
      XLSX,
      { preferYear: 2026, companyId: "c_eden" },
    )
    expect(result.facts).toEqual([])
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0].reason).toMatch(/before any section header/)
  })

  it("warns when no 12-month header row exists for the target year", () => {
    const sheet: unknown[][] = [
      ["title"],
      // Header has only 2025 dates — preferYear=2026 should miss.
      ["Məhsul", xlDate(2025, 1, 1), xlDate(2025, 2, 1)],
      ["Buğda", 100, 100],
    ]
    const wb = wbFromAoa("Farming Budget sales plan", sheet)
    const result = parseFarmingSalesSheet(
      wb,
      "Farming Budget sales plan",
      XLSX,
      { preferYear: 2026, companyId: "c_eden" },
    )
    expect(result.facts).toEqual([])
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0].reason).toMatch(/No 12-month header/)
  })

  it("returns empty + warning when sheet not in workbook", () => {
    const wb = wbFromAoa("Other", [["foo"]])
    const result = parseFarmingSalesSheet(
      wb,
      "Farming Budget sales plan",
      XLSX,
      { preferYear: 2026, companyId: "c_eden" },
    )
    expect(result.facts).toEqual([])
    expect(result.warnings[0].reason).toMatch(/not found/)
  })

  it("skips zero-amount cells (no clutter from empty months)", () => {
    const sheet: unknown[][] = [
      ["title"],
      [
        "Məhsul",
        xlDate(2026, 1, 1),
        xlDate(2026, 2, 1),
        xlDate(2026, 3, 1),
        xlDate(2026, 4, 1),
        xlDate(2026, 5, 1),
        xlDate(2026, 6, 1),
        xlDate(2026, 7, 1),
        xlDate(2026, 8, 1),
        xlDate(2026, 9, 1),
        xlDate(2026, 10, 1),
        xlDate(2026, 11, 1),
        xlDate(2026, 12, 1),
      ],
      ["Satış plan, Ton"],
      ["Pambıq", 0, 0, 0, 0, 0, 0, 0, 0, 0, 4090.7, 4090.7, 0],
    ]
    const wb = wbFromAoa("Farming Budget sales plan", sheet)
    const result = parseFarmingSalesSheet(
      wb,
      "Farming Budget sales plan",
      XLSX,
      { preferYear: 2026, companyId: "c_eden" },
    )
    expect(result.facts).toHaveLength(2)
    expect(result.facts.every((f) => f.value > 0)).toBe(true)
  })
})
