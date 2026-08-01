// @vitest-environment node
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import {
  parseCounterpartyRegister,
  mapCounterpartyEntity,
  counterpartyRoleFromSheet,
} from "./counterparty-register"

function wbFrom(aoa: unknown[][], sheet = "Customer"): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheet)
  return wb
}

// Top-10 shape: 3 entity blocks side by side (name | Turnover | gap | …).
const SHEET: unknown[][] = [
  ["AZƏRŞƏKƏR MMC", "Turnover", null, "EDEN AGRO MMC", "Turnover", null, "CPC MMC", "Turnover"],
  ["ATS FOOD MMC", 3000, null, "AZ ŞƏKƏR İTT", 1000, null, "Veysəloğlu", 2000],
  ["Bravo", 1000, null, "Bizim Market", 1000, null, "Araz", 2000],
  ["Total", 4000, null, "Total", 2000, null, "Total", 4000], // total row → skipped
]

describe("parseCounterpartyRegister", () => {
  it("detects every side-by-side block and maps entity headers to codes", () => {
    const r = parseCounterpartyRegister(wbFrom(SHEET), "Customer", XLSX, "customer")
    expect(r.blocks.map((b) => b.entityCode)).toEqual([
      "AZSEKER-AZSF",
      "AZSEKER-EDEN",
      "AZSEKER-CPC",
    ])
  })

  it("computes sharePct (0-100) per entity and skips the Total row", () => {
    const r = parseCounterpartyRegister(wbFrom(SHEET), "Customer", XLSX, "customer")
    const azsf = r.blocks[0]
    expect(azsf.counterparties).toHaveLength(2) // Total skipped
    expect(azsf.totalTurnover).toBe(4000)
    expect(azsf.counterparties[0]).toMatchObject({ name: "ATS FOOD MMC", turnover: 3000, sharePct: 75 })
    expect(azsf.counterparties[1]).toMatchObject({ name: "Bravo", turnover: 1000, sharePct: 25 })
  })

  it("warns (never guesses) on an unmappable entity header", () => {
    const sheet = [
      ["Some Unknown Co", "Turnover"],
      ["X", 100],
    ]
    const r = parseCounterpartyRegister(wbFrom(sheet), "Customer", XLSX, "customer")
    expect(r.blocks[0].entityCode).toBeNull()
    expect(r.warnings.some((w) => /not mapped/i.test(w))).toBe(true)
  })

  it("dedupes a name listed twice in a block by summing turnover (no @@unique clash)", () => {
    const sheet = [
      ["CPC MMC", "Turnover"],
      ["Veysəloğlu", 3000],
      ["Araz", 1000],
      ["Veysəloğlu", 1000], // same name again → combined to 4000
    ]
    const r = parseCounterpartyRegister(wbFrom(sheet), "Customer", XLSX, "customer")
    const cps = r.blocks[0].counterparties
    expect(cps).toHaveLength(2)
    const v = cps.find((c) => c.name === "Veysəloğlu")!
    expect(v.turnover).toBe(4000)
    expect(v.sharePct).toBe(80) // 4000 / 5000
  })

  it("ignores non-numeric / non-positive turnover cells", () => {
    const sheet = [
      ["CPC MMC", "Turnover"],
      ["Good", 500],
      ["Bad", "n/a"],
      ["Zero", 0],
      ["Neg", -10],
    ]
    const r = parseCounterpartyRegister(wbFrom(sheet), "Customer", XLSX, "customer")
    expect(r.blocks[0].counterparties.map((c) => c.name)).toEqual(["Good"])
  })
})

describe("mapCounterpartyEntity", () => {
  it("maps the known AzerSheker headers (holding-vs-AZSF disambiguated to AZSF)", () => {
    expect(mapCounterpartyEntity("AZƏRŞƏKƏR MMC")).toBe("AZSEKER-AZSF")
    expect(mapCounterpartyEntity("EDEN AGRO MMC")).toBe("AZSEKER-EDEN")
    expect(mapCounterpartyEntity("CPC MMC")).toBe("AZSEKER-CPC")
    expect(mapCounterpartyEntity("Promalt MMC")).toBe("AZSEKER-PROMALT")
  })
  it("returns null for an unmappable header", () => {
    expect(mapCounterpartyEntity("Random Trading LLC")).toBeNull()
  })
})

describe("counterpartyRoleFromSheet", () => {
  it("derives role from sheet name (multi-language)", () => {
    expect(counterpartyRoleFromSheet("Customer")).toBe("customer")
    expect(counterpartyRoleFromSheet("Müştəri")).toBe("customer")
    expect(counterpartyRoleFromSheet("Supplier")).toBe("supplier")
    expect(counterpartyRoleFromSheet("Təchizatçı")).toBe("supplier")
    expect(counterpartyRoleFromSheet("Random")).toBeNull()
  })
})

describe("TOTAL_RE — a surname is not a total row (11.85)", () => {
  /**
   * The register's name column holds Azerbaijani personal names. Matching
   * total-row keywords by PREFIX over that column drops real customers.
   * `Cəmilov Alim Amil oğlu` is row 232 of the client's own `Müştəri İcmalı`.
   */
  function sheetWith(names: Array<[string, number]>) {
    const aoa: unknown[][] = [["AZƏRŞƏKƏR MMC", "Turnover"]]
    for (const [n, v] of names) aoa.push([n, v])
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    return { SheetNames: ["S"], Sheets: { S: ws } } as never
  }

  it("keeps a customer whose name merely begins with a total keyword", () => {
    const res = parseCounterpartyRegister(
      sheetWith([
        ["Cəmilov Alim Amil oğlu", 500],
        ["Veysəloğlu MMC", 500],
      ]),
      "S",
      XLSX,
      "customer",
    )
    const names = res.blocks[0]?.counterparties.map((c) => c.name) ?? []
    expect(names).toContain("Cəmilov Alim Amil oğlu")
    // The share is the point: dropping the row removes it from the
    // denominator too, so the survivor reads 100% of a halved base.
    expect(res.blocks[0]?.totalTurnover).toBe(1000)
    for (const cp of res.blocks[0]?.counterparties ?? []) {
      expect(cp.sharePct).toBeCloseTo(50, 4)
    }
  })

  it("still drops an actual total row, with or without a trailing colon", () => {
    const res = parseCounterpartyRegister(
      sheetWith([
        ["Veysəloğlu MMC", 400],
        ["Cəmi:", 400],
        ["TOTAL", 400],
        ["Ümumi", 400],
      ]),
      "S",
      XLSX,
      "customer",
    )
    expect(res.blocks[0]?.counterparties.map((c) => c.name)).toEqual([
      "Veysəloğlu MMC",
    ])
  })
})
