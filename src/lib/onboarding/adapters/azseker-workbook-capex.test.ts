import { describe, it, expect } from "vitest"
import {
  parseCapexFarmSheetFromAoa,
  parseCapexCpcSheetFromAoa,
} from "./azseker-workbook-capex"

describe("parseCapexFarmSheetFromAoa", () => {
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
  it("parses CAPEX rows from real-world layout", () => {
    const aoa: unknown[][] = [
      [], // blank row 0
      HEADER_ROW, // row 1
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
        69881.36,
        69881.36,
      ],
      [
        "CAPEX",
        "Warehouse",
        "GENERAL ADMIN",
        "Internal",
        "Mini Loader (forklift)",
        "Mini Loader (forklift)",
        "---",
        "CF.02.02.05",
        "AZS- Yevlax təsərrüfatı",
        1,
        27118.64,
        27118.64,
      ],
      [
        "OPEX",
        "Warehouse",
        "OPEX",
        "Internal",
        "Anbar qapılarının təmiri",
        "---",
        "PLF.05.10.02.R",
        "CF.01.02.23",
        "EDN – Admin",
        8,
        2000,
        16000,
      ],
    ]
    const result = parseCapexFarmSheetFromAoa(aoa)
    expect(result.initiatives).toHaveLength(3)
    expect(result.initiatives[0].companyCode).toBe("AZSEKER-EDEN") // EDN prefix
    expect(result.initiatives[0].initiativeType).toBe("CAPEX")
    expect(result.initiatives[0].amountAzn).toBeCloseTo(69881.36)
    expect(result.initiatives[0].plfCode).toBeNull() // "---"
    expect(result.initiatives[0].cfCode).toBe("CF.02.02.05")

    expect(result.initiatives[1].companyCode).toBe("AZSEKER-AZSF") // AZS prefix
    expect(result.initiatives[1].description).toMatch(/Mini Loader/)

    expect(result.initiatives[2].initiativeType).toBe("OPEX")
    expect(result.initiatives[2].plfCode).toBe("PLF.05.10.02.R")
    expect(result.initiatives[2].amountAzn).toBe(16000)
  })

  it("skips rows where Group is neither CAPEX nor OPEX", () => {
    const aoa: unknown[][] = [
      [],
      HEADER_ROW,
      [
        "SUMMARY",
        "—",
        "—",
        "—",
        "Total row should be ignored",
        "",
        "",
        "",
        "",
        "",
        "",
        100000,
      ],
      [
        "CAPEX",
        "HR",
        "GENERAL ADMIN",
        "Internal",
        "Haval H6",
        "",
        "---",
        "CF.02.02.05",
        "EDN – Admin",
        1,
        38898,
        38898,
      ],
    ]
    const result = parseCapexFarmSheetFromAoa(aoa)
    expect(result.initiatives).toHaveLength(1)
    expect(result.initiatives[0].description).toBe("Haval H6")
  })

  it("falls back to AZSEKER-EDEN when cost-centre unknown", () => {
    const aoa: unknown[][] = [
      [],
      HEADER_ROW,
      [
        "CAPEX",
        "Lab",
        "GENERAL ADMIN",
        "Internal",
        "Lab Shaking Rotator",
        "Sair",
        "---",
        "CF.02.02.05",
        "Unknown Cost Center",
        1,
        1000,
        1000,
      ],
    ]
    const result = parseCapexFarmSheetFromAoa(aoa)
    expect(result.initiatives[0].companyCode).toBe("AZSEKER-EDEN")
  })

  it("emits warning for zero amount but keeps the row", () => {
    const aoa: unknown[][] = [
      [],
      HEADER_ROW,
      [
        "CAPEX",
        "Legal",
        "—",
        "Internal",
        "Free item",
        "",
        "---",
        "CF.02.02.05",
        "EDN – Admin",
        1,
        0,
        0,
      ],
    ]
    const result = parseCapexFarmSheetFromAoa(aoa)
    expect(result.initiatives).toHaveLength(1)
    expect(result.warnings.length).toBe(1)
    expect(result.warnings[0]).toMatch(/zero amount/)
  })
})

describe("parseCapexCpcSheetFromAoa", () => {
  const HEADER_ROW = [
    "Source",
    "CF #",
    "Capexin təyinatı",
    "Əsas vəsaitin qrupu",
    "Alışın təyinatı",
    "Sayı",
    "Alış dəyəri (valyuta)",
    "Məbləğ (CCY)",
    "Valyuta",
    "X-rate",
    "Məbləğ (AZN)",
    "ƏDV",
  ]
  it("parses CPC rows with multi-currency support", () => {
    const aoa: unknown[][] = [
      HEADER_ROW,
      [
        "Shareholder",
        "CF.02.02.01",
        "İstehsalat həcmin artırılması",
        "İstehsalat avadanlıqları",
        "Su arıtma sistemi",
        1,
        750000,
        750000,
        "AZN",
        1,
        750000,
      ],
      [
        "Shareholder",
        "CF.02.02.01",
        "İstehsalat həcmin artırılması",
        "İstehsalat avadanlıqları",
        "Su arıtma sistemin avadanlığı",
        1,
        600000,
        600000,
        "EUR",
        1.86,
        1116000,
        0.15,
      ],
    ]
    const result = parseCapexCpcSheetFromAoa(aoa)
    expect(result.initiatives).toHaveLength(2)
    expect(result.initiatives[0].companyCode).toBe("AZSEKER-CPC")
    expect(result.initiatives[0].currency).toBe("AZN")
    expect(result.initiatives[0].amountAzn).toBe(750000)
    expect(result.initiatives[1].currency).toBe("EUR")
    expect(result.initiatives[1].amountAzn).toBe(1116000)
    expect(result.initiatives[1].vatRate).toBe(0.15)
  })

  it("handles empty sheet gracefully", () => {
    const aoa: unknown[][] = [HEADER_ROW]
    const result = parseCapexCpcSheetFromAoa(aoa)
    expect(result.initiatives).toEqual([])
  })
})
