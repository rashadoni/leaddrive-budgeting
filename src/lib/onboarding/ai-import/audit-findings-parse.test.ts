// @vitest-environment node
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parseAuditFindings, mapAuditCompany, auditCompletedPct } from "./audit-findings-parse"

// cols: 0=num 1=severity 2=struktur 3=company 4=audit 5=planDate 6=statusMng 7=grouping 8=_ 9=findingStatusJan
function wb(rows: unknown[][]): XLSX.WorkBook {
  const aoa = [["H"], ["H"], ...rows] // 2 header rows, data from idx 2
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, ws, "Follow-up")
  return book
}
const row = (severity: string, company: string, status: string) =>
  [1, severity, "HR", company, "Audit X", "2026-01", status, "Grp", "", "open"]

describe("parseAuditFindings", () => {
  it("buckets open findings by severity and counts completed", () => {
    const r = parseAuditFindings(
      wb([
        row("Major", "Azərşəkər", "davam edir"),
        row("Minor", "Azərşəkər", "Yerinə yetirilib"), // completed → not minor_open
        row("Observation", "Azərşəkər", "davam edir"),
      ]),
      "Follow-up",
      XLSX,
    )
    expect(r.byCompany["AZSEKER-AZSF"]).toMatchObject({
      total: 3,
      completed: 1,
      major_open: 1,
      minor_open: 0,
      observation_open: 1,
    })
    expect(auditCompletedPct(r.byCompany["AZSEKER-AZSF"])).toBe(33) // 1/3
  })

  it("maps companies and skips unmapped ones with a warning", () => {
    const r = parseAuditFindings(
      wb([row("Major", "CPC MMC", "davam edir"), row("Minor", "Totally Unknown Co", "davam edir")]),
      "Follow-up",
      XLSX,
    )
    expect(r.byCompany["AZSEKER-CPC"].major_open).toBe(1)
    expect(Object.keys(r.byCompany)).toEqual(["AZSEKER-CPC"])
    expect(r.warnings.some((w) => /Unmapped.*Totally Unknown/i.test(w))).toBe(true)
  })

  it("ignores rows missing severity or company", () => {
    const r = parseAuditFindings(wb([row("", "Azərşəkər", "x"), row("Major", "", "x")]), "Follow-up", XLSX)
    expect(Object.keys(r.byCompany)).toHaveLength(0)
  })
})

describe("mapAuditCompany", () => {
  it("maps the AzerSheker entities, null for unknown", () => {
    expect(mapAuditCompany("Azərşəkər")).toBe("AZSEKER-AZSF")
    expect(mapAuditCompany("CPC MMC")).toBe("AZSEKER-CPC")
    expect(mapAuditCompany("Eden Agro")).toBe("AZSEKER-EDEN")
    expect(mapAuditCompany("Foo Bar LLC")).toBeNull()
  })
})
