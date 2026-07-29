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

// ─── Phase 11.25 — columns located by label, not by position ────────────
describe("parseAuditFindings — header detection", () => {
  const labelled = (rows: unknown[][]): XLSX.WorkBook => {
    const header = [
      "No",
      "Severity",
      "Struktur",
      "Company",
      "Audit",
      "Plan date",
      "Management status",
      "Grouping",
      "",
      "Jan status",
    ]
    const ws = XLSX.utils.aoa_to_sheet([["Title"], header, ...rows])
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, ws, "Follow-up")
    return book
  }

  it("reads a labelled header and needs no fallback", () => {
    const r = parseAuditFindings(
      labelled([row("Major", "Azərşəkər", "davam edir")]),
      "Follow-up",
      XLSX,
    )
    expect(r.byCompany["AZSEKER-AZSF"]).toMatchObject({ total: 1, major_open: 1 })
    expect(r.warnings.some((w) => w.includes("legacy position"))).toBe(false)
  })

  it("still reads correctly when a column is INSERTED", () => {
    // The whole point. Positionally this shifts severity/company one to the
    // right; the old parser would have read the inserted column as severity
    // and the severity as company — silently, with the import reporting
    // success and AUDIT_* indicators moving.
    const header = [
      "No",
      "NEW COLUMN",
      "Severity",
      "Struktur",
      "Company",
      "Audit",
      "Plan date",
      "Management status",
      "Grouping",
      "",
      "Jan status",
    ]
    const shifted = [1, "x", "Major", "HR", "Azərşəkər", "Audit X", "2026-01", "davam edir", "Grp", "", "open"]
    const ws = XLSX.utils.aoa_to_sheet([["Title"], header, shifted])
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, ws, "Follow-up")

    const r = parseAuditFindings(book, "Follow-up", XLSX)
    expect(r.byCompany["AZSEKER-AZSF"]).toMatchObject({ total: 1, major_open: 1 })
  })

  it("WARNS when it has to fall back to fixed positions", () => {
    // An unlabelled sheet still parses — behaviour is unchanged — but the
    // fallback is now visible instead of assumed.
    const r = parseAuditFindings(
      wb([row("Major", "Azərşəkər", "davam edir")]),
      "Follow-up",
      XLSX,
    )
    expect(r.byCompany["AZSEKER-AZSF"]).toMatchObject({ total: 1 })
    expect(r.warnings.some((w) => w.includes("fixed column positions"))).toBe(true)
  })
})
