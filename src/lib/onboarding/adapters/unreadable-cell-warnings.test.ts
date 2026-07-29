/**
 * Phase 11.38 — an unreadable cell is reported, not booked as ₼0.
 *
 * 11.31 made the PARSE correct in these three adapters; the `?? 0` kept the
 * other half of the defect. A cell holding unreadable text and a cell holding
 * a real 0.00 reached the caller as the same number, so a dropped amount was
 * indistinguishable from a genuine zero — the fabricated-zero class 11.31
 * closed in `applier.ts` and left standing here.
 *
 * `parseNumericCell` already reported WHY it failed. These helpers discarded
 * that reason. Every assertion below is on a warning that did not exist
 * before this change.
 */
import { describe, it, expect } from "vitest"
import { parseLandRegistryFromAoa } from "./azseker-land-registry"
import { parseCapexFarmSheetFromAoa } from "./azseker-workbook-capex"
import { parseIcmalFromAoa } from "./azseker-farming-strategy"

const LAND_HEADER = [
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
  "Kateqoriya",
  "Digər",
  "Ünvanı",
]

function landRow(hectares: unknown, rent: unknown): unknown[] {
  return [
    1,
    "1725022423",
    "608011001798",
    "31.10.2025",
    "Ağcabədi rayon İH",
    "Əkinçi BOFT MMC",
    "sərəncam",
    hectares,
    rent,
    "11.07.2017-49 il",
    "Ehtiyat fondu",
    "İcarə",
    "Ağcabədi rayon",
  ]
}

describe("land registry", () => {
  it("reports an unreadable RENT instead of recording ₼0 of rent", () => {
    const res = parseLandRegistryFromAoa([["title"], LAND_HEADER, landRow(4800, "təxminən")])
    expect(res.parcels[0].annualRentAzn).toBe(0)
    expect(res.warnings.some((w) => /annual rent/.test(w) && /read as 0/.test(w))).toBe(true)
  })

  it("stays silent on an EMPTY cell — absent is not invalid", () => {
    const res = parseLandRegistryFromAoa([["title"], LAND_HEADER, landRow(4800, null)])
    expect(res.parcels[0].annualRentAzn).toBe(0)
    expect(res.warnings.some((w) => /annual rent/.test(w))).toBe(false)
  })

  it("reports the AMBIGUOUS shape even though a value was produced", () => {
    // "1,234" is 1234 under grouping and 1.234 under a decimal reading. The
    // parser picks grouping and flags it; a flag nobody surfaces is no flag.
    const res = parseLandRegistryFromAoa([["title"], LAND_HEADER, landRow(4800, "1,234")])
    expect(res.parcels[0].annualRentAzn).toBe(1234)
    expect(res.warnings.some((w) => /annual rent/.test(w) && /grouping/.test(w))).toBe(true)
  })
})

describe("CAPEX", () => {
  const HEADER_ROW = [
    "Group",
    "Source",
    "Summary Group",
    "Financing",
    "Capexin təyinatı",
    "Prezentasiya",
    "PLF #",
    "CF #",
    "Xərc mərkəzi 1C",
    "Sayı",
    "Dəyər (CCY)",
    "Məbləğ (CCY)",
  ]

  it("reports an unreadable AMOUNT rather than a silent ₼0 initiative", () => {
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
        "n/a",
        "təsdiqlənməyib",
      ],
    ]
    const res = parseCapexFarmSheetFromAoa(aoa)
    expect(res.initiatives[0].amountAzn).toBe(0)
    expect(res.warnings.some((w) => /CAPEX amount/.test(w) && /read as 0/.test(w))).toBe(true)
  })
})

describe("forward forecast", () => {
  it("reports an unreadable revenue — the zero would DELETE the business unit", () => {
    // The caller skips a 0 as "no revenue for this BU", so an unreadable cell
    // removes the unit from the forecast instead of showing a wrong number.
    // Without a warning there is nothing at all to see.
    const aoa: unknown[][] = [
      [],
      [null, "Business Unit"],
      [null, "All"],
      [null, null, 2026],
      ["Revenue", "Buğda", "dəqiqləşdirilir"],
    ]
    const res = parseIcmalFromAoa(aoa)
    expect(res.forecast[0].breakdown).toHaveLength(0)
    expect(res.warnings.some((w) => /revenue 2026/.test(w) && /read as 0/.test(w))).toBe(true)
  })
})
