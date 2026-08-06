// @vitest-environment node
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import {
  parseAssumptions,
  parseAssumptionNumber,
  slugifyAssumptionKey,
  canonicalAssumptionKey,
} from "./assumptions-parse"
import { buildCompanyMatcher } from "./soft-entity-match"

const SHEET = "Assumptions"

function wb(aoa: unknown[][]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, ws, SHEET)
  return book
}

/** Standard header + rows. */
function sheet(rows: unknown[][], header = ["Parameter", "Value", "Unit", "Period", "Notes"]) {
  return wb([header, ...rows])
}

const ORG = [
  { code: "AZSEKER-CPC", name: "CPC MMC" },
  { code: "AZSEKER-EDEN", name: "Eden Agro MMC" },
]
const matcher = buildCompanyMatcher(ORG)

describe("parseAssumptionNumber", () => {
  it("reads plain numbers and numeric strings", () => {
    expect(parseAssumptionNumber(1.7)).toBe(1.7)
    expect(parseAssumptionNumber("1.7")).toBe(1.7)
    expect(parseAssumptionNumber(0)).toBe(0)
  });

  it("reads a comma decimal mark", () => {
    expect(parseAssumptionNumber("1,7")).toBe(1.7)
  })

  it("drops a comma used as a thousands separator when a dot is present", () => {
    expect(parseAssumptionNumber("1,234.5")).toBe(1234.5)
  })

  it("drops space and non-breaking-space thousand separators", () => {
    expect(parseAssumptionNumber("1 234")).toBe(1234)
    expect(parseAssumptionNumber("1 234")).toBe(1234)
  })

  it("reads a parenthesised negative", () => {
    expect(parseAssumptionNumber("(250)")).toBe(-250)
  })

  it("strips a trailing percent sign without rescaling", () => {
    // Rescaling here would be a silent 100× on a scenario input.
    expect(parseAssumptionNumber("6%")).toBe(6)
  })

  it("returns null — never 0 — for anything unreadable", () => {
    for (const bad of ["", "  ", "n/a", "—", "abc", null, undefined, {}, NaN, Infinity]) {
      expect(parseAssumptionNumber(bad)).toBeNull()
    }
  })
})

describe("slugifyAssumptionKey / canonicalAssumptionKey", () => {
  it("slugifies latin and cyrillic labels stably", () => {
    expect(slugifyAssumptionKey("USD / AZN rate")).toBe("usd_azn_rate")
    expect(slugifyAssumptionKey("  Доля импортных затрат  ")).toBe("доля_импортных_затрат")
  })

  it("recognises a well-known driver in three languages", () => {
    expect(canonicalAssumptionKey("Imported input share")?.key).toBe("import_share")
    expect(canonicalAssumptionKey("Доля импортных затрат")?.key).toBe("import_share")
    expect(canonicalAssumptionKey("Inflyasiya")?.key).toBe("inflation")
  })

  it("refuses to guess when a label matches two families", () => {
    // "USD inflation" hits both fx_usd and inflation — a wrong canonical key is
    // worse than a derived one, because a scenario would silently read it.
    expect(canonicalAssumptionKey("USD inflation")).toBeNull()
  })

  it("returns null for a label matching nothing", () => {
    expect(canonicalAssumptionKey("Truck washing frequency")).toBeNull()
  })
})

describe("parseAssumptions — happy path", () => {
  it("parses label/value/unit/period/notes", () => {
    const r = parseAssumptions(
      sheet([["USD / AZN rate", 1.7, "AZN", "annual", "CBAR forecast"]]),
      SHEET,
      XLSX,
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({
      key: "fx_usd",
      label: "USD / AZN rate",
      value: 1.7,
      unit: "AZN",
      period: "annual",
      notes: "CBAR forecast",
      companyCode: null,
      keySource: "canonical",
    })
  })

  it("prefers an explicit key column over the canonical match", () => {
    const r = parseAssumptions(
      wb([
        ["Key", "Parameter", "Value"],
        ["house_usd_rate", "USD / AZN rate", 1.7],
      ]),
      SHEET,
      XLSX,
    )
    expect(r.rows[0].key).toBe("house_usd_rate")
    expect(r.rows[0].keySource).toBe("column")
  })

  it("derives a key from the label when nothing else is available", () => {
    const r = parseAssumptions(sheet([["Truck washing frequency", 4]]), SHEET, XLSX)
    expect(r.rows[0]).toMatchObject({ key: "truck_washing_frequency", keySource: "derived" })
    expect(r.warnings.join(" ")).toMatch(/no formula or scenario looks them up/)
  })

  it("locates columns by label, not position (leading index column)", () => {
    const r = parseAssumptions(
      wb([
        ["#", "Parameter", "Value", "Unit"],
        [1, "Inflation", 6, "%"],
      ]),
      SHEET,
      XLSX,
    )
    expect(r.rows[0]).toMatchObject({ key: "inflation", value: 6, unit: "%" })
  })

  it("finds a header that is not on the first row", () => {
    const r = parseAssumptions(
      wb([
        ["Budget assumptions 2026"],
        [],
        ["Parameter", "Value"],
        ["Inflation", 6],
      ]),
      SHEET,
      XLSX,
    )
    expect(r.rows).toHaveLength(1)
  })

  it("reads Russian and Azerbaijani headers", () => {
    const ru = parseAssumptions(wb([["Параметр", "Значение"], ["Инфляция", 6]]), SHEET, XLSX)
    expect(ru.rows[0]).toMatchObject({ key: "inflation", value: 6 })
    const az = parseAssumptions(wb([["Göstərici", "Dəyər"], ["Inflyasiya", 6]]), SHEET, XLSX)
    expect(az.rows[0]).toMatchObject({ key: "inflation", value: 6 })
  })

  it("normalizes period vocabulary to the closed set", () => {
    const r = parseAssumptions(
      sheet([
        ["A", 1, "", "ежемесячно", ""],
        ["B", 2, "", "Quarterly", ""],
        ["C", 3, "", "illik", ""],
        ["D", 4, "", "shrug", ""],
      ]),
      SHEET,
      XLSX,
    )
    expect(r.rows.map((x) => x.period)).toEqual(["monthly", "quarterly", "annual", null])
  })

  it("keeps a zero as a value rather than treating it as absent", () => {
    const r = parseAssumptions(sheet([["Imported input share", 0, "%"]]), SHEET, XLSX)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].value).toBe(0)
  })
})

describe("parseAssumptions — category sections", () => {
  it("treats a label-only row as a section heading and carries it forward", () => {
    const r = parseAssumptions(
      sheet([
        ["FX rates", "", "", "", ""],
        ["USD / AZN rate", 1.7, "AZN", "", ""],
        ["Macro", "", "", "", ""],
        ["Truck washing frequency", 4, "", "", ""],
      ]),
      SHEET,
      XLSX,
    )
    expect(r.rows).toHaveLength(2)
    // A canonical driver brings its own category and is not overwritten by the band.
    expect(r.rows[0].category).toBe("fx")
    expect(r.rows[1].category).toBe("Macro")
  })

  it("an explicit category column beats both the band and the canonical default", () => {
    const r = parseAssumptions(
      wb([
        ["Category", "Parameter", "Value"],
        ["treasury", "USD / AZN rate", 1.7],
      ]),
      SHEET,
      XLSX,
    )
    expect(r.rows[0].category).toBe("treasury")
  })

  it("warns on a row that has other cells but no readable number", () => {
    const r = parseAssumptions(sheet([["Broken", "n/a", "%", "", "note"]]), SHEET, XLSX)
    expect(r.rows).toHaveLength(0)
    expect(r.warnings.join(" ")).toMatch(/no readable number/)
  })
})

describe("parseAssumptions — company attribution", () => {
  it("resolves a company column into an override row", () => {
    const r = parseAssumptions(
      wb([
        ["Parameter", "Value", "Company"],
        ["Imported input share", 0.7, "CPC MMC"],
      ]),
      SHEET,
      XLSX,
      matcher,
    )
    expect(r.rows[0]).toMatchObject({ key: "import_share", companyCode: "AZSEKER-CPC" })
  })

  it("leaves companyCode null when the column is blank — a plan-level default", () => {
    const r = parseAssumptions(
      wb([
        ["Parameter", "Value", "Company"],
        ["Inflation", 6, ""],
      ]),
      SHEET,
      XLSX,
      matcher,
    )
    expect(r.rows[0].companyCode).toBeNull()
  })

  it("SKIPS an unresolvable company instead of demoting it to a plan default", () => {
    // Demoting would apply one company's driver to every other company in the
    // holding — the precise failure the two-tier model exists to end.
    const r = parseAssumptions(
      wb([
        ["Parameter", "Value", "Company"],
        ["Imported input share", 0.7, "Some Other Firm LLC"],
      ]),
      SHEET,
      XLSX,
      matcher,
    )
    expect(r.rows).toHaveLength(0)
    expect(r.warnings.join(" ")).toMatch(/not in this organization/)
  })

  it("skips a cell that names two different companies", () => {
    // The Company column holds ONE owner per driver. A cell naming two of them
    // is not the signal it was assumed to be, so it is reported rather than
    // attributed to whichever matched first.
    const r = parseAssumptions(
      wb([
        ["Parameter", "Value", "Company"],
        ["Imported input share", 0.7, "CPC MMC and Eden Agro MMC"],
      ]),
      SHEET,
      XLSX,
      matcher,
    )
    expect(r.rows).toHaveLength(0)
    expect(r.warnings.join(" ")).toMatch(/matches more than one company/)
  })

  it("a token shared by two sibling companies resolves to neither", () => {
    // `buildCompanyMatcher` strips tokens common to two companies of the same
    // org — "ALPHA" carries no identity when both are called Alpha. The row is
    // skipped as unresolvable, which is the safe direction.
    const twoWay = buildCompanyMatcher([
      { code: "A-ONE", name: "Alpha Trading" },
      { code: "A-TWO", name: "Alpha Logistics" },
    ])
    const r = parseAssumptions(
      wb([
        ["Parameter", "Value", "Company"],
        ["Inflation", 6, "Alpha"],
      ]),
      SHEET,
      XLSX,
      twoWay,
    )
    expect(r.rows).toHaveLength(0)
    expect(r.warnings.join(" ")).toMatch(/not in this organization/)
  })

  it("ignores the company column entirely when no matcher is supplied", () => {
    const r = parseAssumptions(
      wb([
        ["Parameter", "Value", "Company"],
        ["Inflation", 6, "CPC MMC"],
      ]),
      SHEET,
      XLSX,
    )
    expect(r.rows[0].companyCode).toBeNull()
  })
})

describe("parseAssumptions — refusals and reports", () => {
  it("imports nothing when no header row can be found", () => {
    const r = parseAssumptions(wb([[1, 2, 3], [4, 5, 6]]), SHEET, XLSX)
    expect(r.rows).toHaveLength(0)
    expect(r.warnings.join(" ")).toMatch(/no header row recognised/)
  })

  it("imports nothing when there is no value column", () => {
    const r = parseAssumptions(wb([["Parameter", "Notes"], ["Inflation", "x"]]), SHEET, XLSX)
    expect(r.rows).toHaveLength(0)
    expect(r.warnings.join(" ")).toMatch(/no value/)
  })

  it("reports a missing sheet rather than throwing", () => {
    const r = parseAssumptions(sheet([["Inflation", 6]]), "Nope", XLSX)
    expect(r.rows).toHaveLength(0)
    expect(r.warnings[0]).toMatch(/not found/)
  })

  it("flags an ambiguous percent scale without rescaling the value", () => {
    const r = parseAssumptions(sheet([["Inflation", 6, "%"]]), SHEET, XLSX)
    expect(r.rows[0].value).toBe(6)
    expect(r.warnings.join(" ")).toMatch(/verify the scale/)
  })

  it("does not flag a percent already expressed as a fraction", () => {
    const r = parseAssumptions(sheet([["Inflation", 0.06, "%"]]), SHEET, XLSX)
    expect(r.warnings.join(" ")).not.toMatch(/verify the scale/)
  })

  it("reports duplicate keys on one sheet", () => {
    const r = parseAssumptions(
      sheet([
        ["Inflation", 6],
        ["Inflyasiya", 7],
      ]),
      SHEET,
      XLSX,
    )
    expect(r.rows).toHaveLength(2)
    expect(r.warnings.join(" ")).toMatch(/duplicate key/)
  })

  it("does NOT call the same key on two different companies a duplicate", () => {
    const r = parseAssumptions(
      wb([
        ["Parameter", "Value", "Company"],
        ["Imported input share", 0.7, "CPC MMC"],
        ["Imported input share", 0.1, "Eden Agro MMC"],
      ]),
      SHEET,
      XLSX,
      matcher,
    )
    expect(r.rows).toHaveLength(2)
    expect(r.warnings.join(" ")).not.toMatch(/duplicate key/)
  })

  it("warns when a sheet yields no rows at all", () => {
    const r = parseAssumptions(wb([["Parameter", "Value"]]), SHEET, XLSX)
    expect(r.rows).toHaveLength(0)
    expect(r.warnings.join(" ")).toMatch(/No assumptions parsed/)
  })
})
