/**
 * Unit tests for Guvven KPI sheet adapters.
 *
 * Builds in-memory mock workbooks to exercise:
 *   - Farming KPI: header detection, cost-center→entity resolution,
 *     per-entity aggregation (Σ harvest ÷ Σ area), year filter
 *   - CPC KPI: month column detection, metric whitelist, "%" handling
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import {
  parseGuvvenFarmingKpiSheet,
  parseGuvvenProcessingKpiSheet,
} from "./azseker-guvven-kpi"

function buildWb(sheetName: string, rows: unknown[][]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return wb
}

// Excel serial for 2026-01-01 .. 2026-12-01 (year-agnostic helper)
function serial(year: number, month0: number): number {
  // 25569 = 1970-01-01 in Excel serial; convert ms→days
  const ms = Date.UTC(year, month0, 1)
  return ms / 86400_000 + 25569
}

describe("parseGuvvenFarmingKpiSheet", () => {
  it("aggregates per-entity harvest and computes weighted yield_per_ha", () => {
    // Mimic Farming KPI shape (Russian-ish header for predictability).
    // Cols: 0 İl, 1 Məhsul, 2 Sezon, 3 Suvarma, 4 Təsərrüfatlar,
    //       5 Xərc mərkəzi 1C, 6 Code, 7 Check, 8 Sahə həcmi. HA,
    //       9 Net Məhsuldarlıq Ton.kip/HA, 10 Cəmi məhsuldarlıq,Ton/Kip
    const rows = [
      [null, null, "KPI 1"], // R1 — junk
      [
        "İl", "Məhsul", "Sezon", "Suvarma növü", "Təsərrüfatlar",
        "Xərc mərkəzi 1C", "Unikal Kod", "Check",
        "Sahə həcmi. HA", "Net Məhsuldarlıq Ton.kip/HA", "Cəmi məhsuldarlıq,Ton/Kip",
      ],
      // EDN — 2 rows (Füzuli, Ağcabədi)
      [2026, "Buğda", "Payız-25", "Pivot", "Füzuli", "EDN – Füzuli Qayıdış Əkinçilik", "k1", "YES", 800, 5.5, 4400],
      [2026, "Qarğıdalı", "Yaz-26", "Pivot", "Ağcabədi", "EDN – Ağcabədi təsərrüfatı", "k2", "YES", 500, 9.5, 4750],
      // AZS — 1 row
      [2026, "Buğda", "Payız-25", "Pivot", "Yevlax", "AZS- Əkinçilik Yevlax", "k3", "YES", 570, 5.5, 3135],
      // Different-year row (filtered out by preferYear=2026)
      [2025, "Buğda", "Payız-24", "Pivot", "Füzuli", "EDN – Füzuli Qayıdış", "k4", "YES", 100, 4, 400],
    ]
    const wb = buildWb("Farming KPI", rows)
    const result = parseGuvvenFarmingKpiSheet(wb, "Farming KPI", XLSX, { preferYear: 2026 })
    expect(result.warnings).toEqual([])
    // EDEN expected: area=1300, harvest=9150, yield=9150/1300≈7.04
    const eden = result.facts.filter((f) => f.companyCode === "AZSEKER-EDEN")
    expect(eden.find((f) => f.metric === "area_hectares")?.value).toBe(1300)
    expect(eden.find((f) => f.metric === "harvest_tons")?.value).toBe(9150)
    expect(eden.find((f) => f.metric === "yield_per_ha")?.value).toBeCloseTo(7.04, 2)
    // AZSF expected: area=570, harvest=3135, yield=3135/570=5.5
    const azsf = result.facts.filter((f) => f.companyCode === "AZSEKER-AZSF")
    expect(azsf.find((f) => f.metric === "area_hectares")?.value).toBe(570)
    expect(azsf.find((f) => f.metric === "yield_per_ha")?.value).toBe(5.5)
    // 2025 row filtered out — no entity facts at that date
    for (const f of result.facts) {
      expect(f.date).toBe("2026-12-31")
    }
  })

  it("warns on unresolved cost-center labels", () => {
    const rows = [
      [
        "İl", "Məhsul", "Sezon", "Suvarma növü", "Təsərrüfatlar",
        "Xərc mərkəzi 1C", "Unikal Kod", "Check",
        "Sahə həcmi. HA", "Net Məhsuldarlıq Ton.kip/HA", "Cəmi məhsuldarlıq,Ton/Kip",
      ],
      [2026, "X", "Y", "Pivot", "Z", "Unknown-Farm-Label", "k1", "YES", 100, 5, 500],
    ]
    const wb = buildWb("Farming KPI", rows)
    const result = parseGuvvenFarmingKpiSheet(wb, "Farming KPI", XLSX, { preferYear: 2026 })
    expect(result.facts).toEqual([])
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0].reason).toContain("Unknown-Farm-Label")
  })

  it("returns warning when header row not found", () => {
    const rows = [["junk", null, null], [null, null, null]]
    const wb = buildWb("Farming KPI", rows)
    const result = parseGuvvenFarmingKpiSheet(wb, "Farming KPI", XLSX)
    expect(result.facts).toEqual([])
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0].reason).toContain("header")
  })

  it("skips all-zero rows", () => {
    const rows = [
      [
        "İl", "Məhsul", "Sezon", "Suvarma növü", "Təsərrüfatlar",
        "Xərc mərkəzi 1C", "Unikal Kod", "Check",
        "Sahə həcmi. HA", "Net Məhsuldarlıq Ton.kip/HA", "Cəmi məhsuldarlıq,Ton/Kip",
      ],
      [2026, "X", "Y", "Pivot", "Z", "EDN – Test", "k1", "YES", 0, 0, 0],
      [2026, "X", "Y", "Pivot", "Z", "EDN – Test", "k2", "YES", 100, 5, 500],
    ]
    const wb = buildWb("Farming KPI", rows)
    const result = parseGuvvenFarmingKpiSheet(wb, "Farming KPI", XLSX, { preferYear: 2026 })
    const eden = result.facts.filter((f) => f.companyCode === "AZSEKER-EDEN")
    // Only the non-zero row aggregates in
    expect(eden.find((f) => f.metric === "area_hectares")?.value).toBe(100)
    expect(eden.find((f) => f.metric === "harvest_tons")?.value).toBe(500)
  })
})

describe("parseGuvvenProcessingKpiSheet", () => {
  it("emits 12 monthly facts for whitelisted metrics", () => {
    // CPC KPI shape: R1 has 12 monthly date cells starting at col 6.
    // R3 = "Capacity utilization rate" / "%" / ... with 12 values.
    const dates = Array.from({ length: 12 }, (_, m) => serial(2026, m))
    const rows = [
      ["Description", null, "Measure", null, "Factor", null, ...dates],
      ["Production step 1"],
      ["Daily crushing capacity", null, "ton", null, null, null, ...Array(12).fill(84.2)],
      ["Capacity utilization rate", null, "%", null, null, null, ...[0.87, 0.96, 0.87, 0.89, 0.87, 0.89, 0.87, 0, 0.87, 0.89, 0.87, 0.89]],
    ]
    const wb = buildWb("CPC KPI", rows)
    const result = parseGuvvenProcessingKpiSheet(wb, "CPC KPI", XLSX, { preferYear: 2026 })
    // "Daily crushing capacity" not in v1 whitelist → skipped.
    // "Capacity utilization rate %" maps to cane_hectares_harvested_pct.
    const utilFacts = result.facts.filter((f) => f.metric === "cane_hectares_harvested_pct")
    // 11 non-zero months (one is 0)
    expect(utilFacts.length).toBe(11)
    // First month value 0.87 → 87% after fraction-conversion
    expect(utilFacts.find((f) => f.date === "2026-01-01")?.value).toBe(87)
    for (const f of utilFacts) {
      expect(f.companyCode).toBe("AZSEKER-CPC")
      expect(f.unit).toBe("%")
    }
  })

  it("returns warning when entity cannot be resolved from sheet name", () => {
    const wb = buildWb("Unknown KPI", [["x"]])
    const result = parseGuvvenProcessingKpiSheet(wb, "Unknown KPI", XLSX)
    expect(result.facts).toEqual([])
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0].reason).toMatch(/Unknown/i)
  })
})
