// @vitest-environment node
/**
 * Phase 7.G CXXXIV — tests for `parseCfsSheet`. Covers section detection
 * (operating / investing / financing), opening_balance skip, sign-to-
 * entryType inference, all-zero row skip, and skip patterns (Cəmi totals).
 */

import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parseCfsSheet } from "./azmade-cfs"

function makeWorkbook(sheetName: string, aoa: unknown[][]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(aoa as (string | number | null)[][])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return wb
}

const MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "İyun", "İyul", "Avqust", "Sentyabr", "Oktyabr", "Noyabr", "Dekabr"]

describe("parseCfsSheet — error paths", () => {
  it("returns warning when sheet missing", () => {
    const wb = makeWorkbook("Other", [["x"]])
    const r = parseCfsSheet(wb, "CFS", XLSX)
    expect(r.entries).toEqual([])
    expect(r.warnings[0]?.reason).toMatch(/not found/)
  })

  it("returns warning when no 12-month header", () => {
    const wb = makeWorkbook("CFS", [["", "Pul axını", "open", "Yanvar"]]) // only 1 month
    const r = parseCfsSheet(wb, "CFS", XLSX)
    expect(r.entries).toEqual([])
    expect(r.warnings[0]?.reason).toMatch(/No header row/)
  })
})

describe("parseCfsSheet — section context + sign inference", () => {
  it("classifies entries by section + infers inflow/outflow from sign", () => {
    const wb = makeWorkbook("CFS", [
      [], // R1
      ["", "Pul axını hesabatı", "Open", ...MONTHS], // R2 header
      [], // R3
      ["", "Pul və pul vəsaiti", 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], // opening_balance section header
      ["", "Bank hesabı", 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], // skipped (in opening_balance)
      ["", "Əsas Fəaliyyəti ilə bağlı", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // operating section header
      ["", "Alıcılardan daxilolma", 1000, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100], // operating inflow (positive)
      ["", "Təchizatçılara ödənişlər", -500, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50, -50], // operating outflow (negative)
      ["", "Maliyyə Fəaliyyəti", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // financing section header
      ["", "Bank krediti alınması", 1000, 0, 0, 0, 0, 1000, 0, 0, 0, 0, 0, 0, 0], // financing inflow
      ["", "Investisiya Fəaliyyəti", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // investing section header
      ["", "Əsas vəsaitlərə investisiya", -200, 0, 0, 0, -100, -100, -100, 0, 0, 0, 0, 0, 0], // investing outflow
      ["", "Cəmi Mədaxil", 9999, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], // skip pattern (total)
    ])
    const r = parseCfsSheet(wb, "CFS", XLSX)
    expect(r.warnings).toEqual([])
    expect(r.entries).toHaveLength(4)

    expect(r.entries[0]).toMatchObject({
      label: "Alıcılardan daxilolma",
      activityType: "operating",
      entryType: "inflow",
    })
    expect(r.entries[0].perMonth).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100])

    expect(r.entries[1]).toMatchObject({
      label: "Təchizatçılara ödənişlər",
      activityType: "operating",
      entryType: "outflow",
    })
    // perMonth stores |value| — sign captured by entryType
    expect(r.entries[1].perMonth).toEqual([50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50])

    expect(r.entries[2]).toMatchObject({
      label: "Bank krediti alınması",
      activityType: "financing",
      entryType: "inflow",
    })

    expect(r.entries[3]).toMatchObject({
      label: "Əsas vəsaitlərə investisiya",
      activityType: "investing",
      entryType: "outflow",
    })
  })

  it("synthetic codes unique within sheet", () => {
    const wb = makeWorkbook("CFS", [
      ["", "Pul axını hesabatı", "Open", ...MONTHS],
      ["", "Əsas Fəaliyyəti", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ["", "Sair gəlir", 100, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      ["", "Sair gəlir", 200, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2], // duplicate label
    ])
    const r = parseCfsSheet(wb, "CFS", XLSX)
    expect(r.entries).toHaveLength(2)
    expect(r.entries[0].code).toBe("CF-sair-gelir")
    expect(r.entries[1].code).toBe("CF-sair-gelir-2")
  })

  it("skips all-zero rows even within an active section", () => {
    const wb = makeWorkbook("CFS", [
      ["", "Pul axını hesabatı", "Open", ...MONTHS],
      ["", "Əsas Fəaliyyəti", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      ["", "Empty inflow row", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // all-zero — skip
      ["", "Real inflow", 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ])
    const r = parseCfsSheet(wb, "CFS", XLSX)
    expect(r.entries).toHaveLength(1)
    expect(r.entries[0].label).toBe("Real inflow")
  })
})
