/**
 * Phase 11.33 — the cross-entity soft registers resolve against the ORG's own
 * companies instead of a literal list of AzerSheker's five.
 *
 * The failure these pin is not a wrong number, it is an empty import: for any
 * organization other than AzerSheker, every row of a court-case or audit
 * register matched nothing. The court parser then dropped it with a bare
 * `continue`, so the whole register landed as zero cases under a green report.
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { buildCompanyMatcher, companyTokens } from "./soft-entity-match"
import { parseCourtDisputes, attributeCompanies } from "./court-disputes-parse"
import { mapAuditCompany } from "./audit-findings-parse"

const OTHER_ORG = [
  { code: "ATL-LOGISTICS", name: "Atlas Logistics LLC" },
  { code: "ATL-RETAIL", name: "Atlas Retail MMC" },
]
const AZSEKER_ORG = [
  { code: "AZSEKER-AZSF", name: "Azərşəkər MMC" },
  { code: "AZSEKER-EDEN", name: "Eden Agro MMC" },
  { code: "AZSEKER-CPC", name: "CPC MMC" },
]

describe("companyTokens", () => {
  it("takes the code, its trailing segment and the name's real words", () => {
    expect(companyTokens({ code: "ATL-LOGISTICS", name: "Atlas Logistics LLC" }).sort()).toEqual(
      ["ATL LOGISTICS", "ATLAS", "LOGISTICS"].sort(),
    )
  })

  it("drops legal-form suffixes — they identify nobody", () => {
    const tokens = companyTokens({ code: "X-CO", name: "Bright MMC" })
    expect(tokens).toContain("BRIGHT")
    expect(tokens).not.toContain("MMC")
  })
})

describe("buildCompanyMatcher", () => {
  const matcher = buildCompanyMatcher(OTHER_ORG)

  it("resolves a company of a NON-AzerSheker org by its registered name", () => {
    // Pre-11.33 this returned nothing: the matchers were literally
    // /cpc/, /eden\s*agro/, /promalt/, /\bmalt\b/, /azərşəkər/.
    expect(matcher("Atlas Logistics LLC v. Ministry").codes).toEqual(["ATL-LOGISTICS"])
  })

  it("does not apply AzerSheker patterns to an org that has no such company", () => {
    expect(matcher("CPC MMC").codes).toEqual([])
  })

  it("still resolves AzerSheker exactly as before, for the org that has it", () => {
    const az = buildCompanyMatcher(AZSEKER_ORG)
    expect(az("Azərşəkər MMC").codes).toEqual(["AZSEKER-AZSF"])
    expect(az("CPC MMC").codes).toEqual(["AZSEKER-CPC"])
    expect(az("Eden Agro").codes).toEqual(["AZSEKER-EDEN"])
  })

  it("requires a word boundary — 'CPC' does not match inside a longer word", () => {
    const az = buildCompanyMatcher([{ code: "AZSEKER-CPC", name: "CPC MMC" }])
    // The legacy /cpc/i pattern matches the substring; the token rule does not,
    // and the legacy pattern is only reachable because the org HAS that code.
    // Guard the generic path directly instead:
    const generic = buildCompanyMatcher([{ code: "X-CPC", name: "CPC Trading" }])
    expect(generic("Concepcion Holdings").codes).toEqual([])
    expect(az("CPC MMC").codes).toEqual(["AZSEKER-CPC"])
  })

  it("reports two hits as ambiguous rather than picking the first", () => {
    const m = buildCompanyMatcher(OTHER_ORG)
    const res = m("Atlas Logistics LLC v. Atlas Retail MMC")
    expect(res.codes.sort()).toEqual(["ATL-LOGISTICS", "ATL-RETAIL"])
    expect(res.ambiguous).toBe(true)
  })
})

describe("court disputes — a non-AzerSheker register no longer imports as zero", () => {
  function buildSheet(): XLSX.WorkBook {
    const aoa: unknown[][] = [
      ["Court disputes register"],
      [],
      ["#", "Date", "Court", "Claimant", "Defendant", "Type", "Description", "", "", "Status"],
      [
        1,
        "2026-03-01",
        "Baku Commercial Court",
        "Atlas Logistics LLC",
        "Some Counterparty OJSC",
        "pul tələbi",
        "borc",
        "",
        "",
        "baxılır",
      ],
      [
        2,
        "2026-04-02",
        "Baku Commercial Court",
        "Another Party",
        "Atlas Retail MMC",
        "kommersiya",
        "borc",
        "",
        "",
        "icraata xitam verilib",
      ],
    ]
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    return { SheetNames: ["Court"], Sheets: { Court: ws } } as XLSX.WorkBook
  }

  it("attributes both cases to the org's own companies", () => {
    const res = parseCourtDisputes(buildSheet(), "Court", XLSX, buildCompanyMatcher(OTHER_ORG))
    expect(Object.keys(res.byCompany).sort()).toEqual(["ATL-LOGISTICS", "ATL-RETAIL"])
    expect(res.byCompany["ATL-LOGISTICS"].total).toBe(1)
    expect(res.byCompany["ATL-LOGISTICS"].open).toBe(1)
    expect(res.byCompany["ATL-RETAIL"].open).toBe(0)
  })

  it("without the matcher the same sheet resolves to nothing — and now SAYS so", () => {
    const res = parseCourtDisputes(buildSheet(), "Court", XLSX)
    expect(Object.keys(res.byCompany)).toEqual([])
    // Pre-11.33 this was a bare `continue`: no warning, no count, zero cases
    // reported as a successful import.
    expect(res.warnings.some((w) => /named no company known to this organization/.test(w))).toBe(
      true,
    )
    expect(res.warnings.some((w) => /^2 of 2 court cases/.test(w))).toBe(true)
  })

  it("keeps multi-company attribution — a case naming two group companies counts for both", () => {
    expect(
      attributeCompanies(
        "Atlas Logistics LLC",
        "Atlas Retail MMC",
        buildCompanyMatcher(OTHER_ORG),
      ).sort(),
    ).toEqual(["ATL-LOGISTICS", "ATL-RETAIL"])
  })
})

describe("audit findings — the Şirkət cell resolves against the org", () => {
  it("maps a non-AzerSheker company name", () => {
    expect(mapAuditCompany("Atlas Retail MMC", buildCompanyMatcher(OTHER_ORG))).toBe("ATL-RETAIL")
  })

  it("returns null when the cell names two companies, instead of picking one", () => {
    // The Şirkət column carries ONE owner per finding, so two hits means the
    // cell is not the signal it was assumed to be.
    expect(
      mapAuditCompany("Atlas Logistics / Atlas Retail", buildCompanyMatcher(OTHER_ORG)),
    ).toBeNull()
  })

  it("legacy behaviour is unchanged when no matcher is supplied", () => {
    expect(mapAuditCompany("CPC MMC")).toBe("AZSEKER-CPC")
    expect(mapAuditCompany("Atlas Retail MMC")).toBeNull()
  })
})
