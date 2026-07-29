/**
 * Phase 11.31 residue — the seven adapters that still carried their own
 * string→number parser now go through `parseNumericCell`.
 *
 * Every one of them did `replace(",", ".")` (or, for the KPI sheet, the exact
 * opposite: strip every comma). Both are a hard-coded assumption about what a
 * comma means, and these workbooks mix the two conventions between sheets.
 * The shape that breaks them is the ordinary `"1,234"`:
 *
 *   under `replace(",", ".")`   → 1.234   (1000× too small)
 *   under `replace(/[,\s]/g,"")` → 1234   (correct here, 10× wrong on "1,5")
 *
 * These tests drive each migrated site through its PUBLIC entry point with a
 * comma-grouped string cell and assert the number that reaches the caller.
 * Each was checked to FAIL against the pre-migration parser — this file is
 * the evidence for the migration, not decoration for it.
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"

import { parseLandRegistryFromAoa } from "./adapters/azseker-land-registry"
import { parseCapexFarmSheetFromAoa } from "./adapters/azseker-workbook-capex"
import { parseIcmalFromAoa } from "./adapters/azseker-farming-strategy"
import { parseWorkbookFarmingKpiSheet } from "./adapters/azseker-workbook-kpi"

describe("11.31 — land registry reads a comma-grouped area and rent", () => {
  const HEADER = [
    "S/S",
    "Qeydiyyat nömrəsi",
    "Yüklü edilən əmlakın reyestr nömrəsi",
    "Qeydiyyat tarixi",
    "Bələdiyyə",
    "Şirkətin əvvəlki adı",
    "Əsas öhdəliyin mahiyyəti",
    "Torpaq sahəsinin ölçüsü -ha",
    "İllik ödənişi",
    "Müddəti",
    "Yüklü edilən torpaq sahəsinin kateqoriya",
    "Daşınmaz əmlak üzərində qüvvədə olan dig",
    "Ünvanı",
  ]

  it("reads '4,800' as 4800 ha, not 4.8", () => {
    const aoa: unknown[][] = [
      ['"EDEN AGRO" MƏHDUD MƏSULİYYƏTLİ CƏMİYYƏT'],
      HEADER,
      [
        1,
        "1725022423",
        "608011001798",
        "31.10.2025",
        "Ağcabədi rayon İcra Hakimiyyəti",
        "Əkinçi BOFT MMC",
        "Ağcabədi rayon İHB-nın 11.07.2017-ci il sərəncamı",
        "4,800",
        "72,000",
        "11.07.2017-49 (qırx doqquz ) il",
        "Ehtiyat fondu torpaqları",
        "İcarə",
        "Ağcabədi rayon",
      ],
    ]
    const p = parseLandRegistryFromAoa(aoa).parcels[0]
    // Pre-migration: 4.8 ha and ₼72 — a 4800-hectare holding recorded as a
    // back garden, and its annual rent off by three orders of magnitude.
    expect(p.hectares).toBe(4800)
    expect(p.annualRentAzn).toBe(72000)
  })

  it("reads the European '1.234,56' shape too", () => {
    const aoa: unknown[][] = [
      ["title"],
      HEADER,
      [1, "x", "y", "31.10.2025", "İH", "prev", "obligation", "1.234,56", "9.876,54", "5 il", "cat", "İcarə", "addr"],
    ]
    const p = parseLandRegistryFromAoa(aoa).parcels[0]
    expect(p.hectares).toBeCloseTo(1234.56, 2)
    expect(p.annualRentAzn).toBeCloseTo(9876.54, 2)
  })
})

describe("11.31 — CAPEX reads a comma-grouped amount", () => {
  const HEADER_ROW = [
    "Group",
    "Source",
    "Summary Group",
    "Financing",
    "Capexin təyinatı",
    "Capexin təyinatı_Prezentasiya",
    "PLF #",
    "CF #",
    "Xərc mərkəzi 1C",
    "Sayı",
    "Dəyər (CCY)",
    "Məbləğ (CCY)",
  ]

  it("reads '69,881.36' as 69881.36, not 69.88136", () => {
    const aoa: unknown[][] = [
      [],
      HEADER_ROW,
      [
        "CAPEX",
        "Legal",
        "GENERAL ADMIN",
        "Internal",
        "Toyota RAV 4",
        "Toyota RAV 4",
        "---",
        "CF.02.02.05",
        "EDN – Admin",
        1,
        "69,881.36",
        "69,881.36",
      ],
    ]
    const res = parseCapexFarmSheetFromAoa(aoa)
    expect(res.initiatives).toHaveLength(1)
    // Pre-migration `replace(",", ".")` turned this into "69.881.36" → NaN → 0,
    // i.e. a ₼69.9K vehicle silently booked as a ₼0 CAPEX line.
    expect(res.initiatives[0].amountAzn).toBeCloseTo(69881.36, 2)
  })
})

describe("11.31 — forward forecast reads a comma-grouped revenue", () => {
  it("reads '15,836,740' as 15836740, not 0", () => {
    const aoa: unknown[][] = [
      [],
      [null, "Business Unit"],
      [null, "All"],
      [null, null, 2026, 2027],
      ["Revenue", "Buğda", "15,836,740", 19_273_447],
    ]
    const f2026 = parseIcmalFromAoa(aoa).forecast.find((f) => f.year === 2026)!
    // Pre-migration: "15.836,740" → NaN → 0, and a zero is then skipped as
    // "no revenue for this BU", so the business unit vanished from the
    // forecast entirely rather than showing a wrong number.
    expect(f2026.totalRevenueAzn).toBe(15_836_740)
    expect(f2026.breakdown.find((b) => b.businessUnit === "Buğda")?.revenueAzn).toBe(15_836_740)
  })
})

describe("11.31 — farming KPI no longer treats every comma as grouping", () => {
  function buildWb(sheetName: string, rows: unknown[][]): XLSX.WorkBook {
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
    return wb
  }

  // `yield_per_ha` is DERIVED (Σharvest ÷ Σarea), so the cell that actually
  // exercises the migrated parser is the AREA, not the yield column.
  it("reads '1,5' ha as 1.5, not 15", () => {
    const rows = [
      [null, null, "KPI 1"],
      [
        "İl",
        "Məhsul",
        "Sezon",
        "Suvarma növü",
        "Təsərrüfatlar",
        "Xərc mərkəzi 1C",
        "Unikal Kod",
        "Check",
        "Sahə həcmi. HA",
        "Net Məhsuldarlıq Ton.kip/HA",
        "Cəmi məhsuldarlıq,Ton/Kip",
      ],
      [2026, "Buğda", "Payızlıq", "Suvarma", "Farm A", "EDN – Farming", "K1", null, "1,5", "4", "6"],
    ]
    const res = parseWorkbookFarmingKpiSheet(buildWb("Farming KPI", rows), "Farming KPI", XLSX, {
      preferYear: 2026,
    })
    const areaFact = res.facts.find((f) => f.metric === "area_hectares")
    const yieldFact = res.facts.find((f) => f.metric === "yield_per_ha")
    // Pre-migration this adapter stripped EVERY comma, so 1,5 ha became 15 ha
    // and the derived yield collapsed from 4.0 t/ha to 0.4 t/ha.
    expect(areaFact?.value).toBeCloseTo(1.5, 3)
    expect(yieldFact?.value).toBeCloseTo(4, 3)
  })
})
