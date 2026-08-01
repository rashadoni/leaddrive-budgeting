// @vitest-environment node
/**
 * 11.82 — the join that decides whether "371 customer rows" is a fact or a
 * guess.
 *
 * A briefing that says «371 sətir» and is wrong is worse than the "could not
 * read" it replaces: the reader now has a number to trust. So the arithmetic
 * is checked twice.
 *
 *   1. Against a fixture whose values were measured by running the real
 *      `extractWorkbookMeta` + `buildWorkbookProfile` over
 *      `actual-budget-v1.xlsx`. Always runs.
 *   2. Against the workbook itself, end to end, when it is available. The
 *      client file is not in the repository, so point `PLF_DRYRUN_WORKBOOK`
 *      at a copy:
 *
 *        PLF_DRYRUN_WORKBOOK=/path/actual-budget-v1.xlsx npx vitest run warning-facts
 *
 * The second test is the one that matters. `blankrows: false` means the
 * collapsed row index and the Excel row number differ by a variable amount
 * (on `Müştəri İcmalı`, `!ref` starts at A2 and row 5 is blank, so index 3 is
 * Excel row 6). Nothing short of running the extractor proves the subtraction
 * lands on the real customer count.
 */
import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as XLSX from "xlsx"
import { buildWarningSheetFacts } from "./warning-facts"
import { extractWorkbookMeta } from "@/lib/onboarding/ai-import/sheet-meta-extractor"
import { buildWorkbookProfile } from "@/lib/onboarding/ai-import/workbook-profile"

const WORKBOOK = process.env.PLF_DRYRUN_WORKBOOK ?? ""
const AVAILABLE = WORKBOOK !== "" && fs.existsSync(WORKBOOK)
const FILE = "actual-budget-v1.xlsx"

/** Measured from the real workbook — see the end-to-end test below. */
const PROFILE_SHEETS = [
  { sheetName: "Müştəri İcmalı", totalRows: 375, totalColumns: 20, headerRowIndex: 3 },
  { sheetName: "Satış İcmalı", totalRows: 42, totalColumns: 21, headerRowIndex: 0 },
  { sheetName: "Tech", totalRows: 34, totalColumns: 2, headerRowIndex: 0 },
]

const RESPONSE = {
  perFile: [
    {
      filename: FILE,
      classifications: [
        { sheetName: "Müştəri İcmalı", dataType: "COUNTERPARTY", confidence: 0.82 },
        { sheetName: "Satış İcmalı", dataType: "OPS_FACTS", confidence: 0.61 },
        { sheetName: "Tech", dataType: "INFO_SUMMARY", confidence: 0.74 },
      ],
      workbookProfile: { sheets: PROFILE_SHEETS },
    },
  ],
  sheetImpactsByFilename: {
    [FILE]: [
      {
        sheetName: "Müştəri İcmalı",
        impact: {
          indicators: [
            { code: "CUSTOMER_HHI" },
            { code: "TOP_CUSTOMER_SHARE" },
            { code: "TOP3_CUSTOMER_SHARE" },
            { code: "SUPPLIER_HHI" },
          ],
        },
      },
    ],
  },
}

const factFor = (name: string, res = RESPONSE) =>
  buildWarningSheetFacts(res).find((f) => f.sheetName === name)!

describe("buildWarningSheetFacts", () => {
  it("turns the collapsed row index into the real customer count", () => {
    // 375 rows in the used range, header at collapsed index 3 → 371 below it.
    expect(factFor("Müştəri İcmalı")).toMatchObject({
      dataRows: 371,
      columns: 20,
      preambleRows: 3,
      headerFound: true,
      dataType: "COUNTERPARTY",
    })
  })

  it("reports no preamble when the header IS the first row", () => {
    expect(factFor("Satış İcmalı")).toMatchObject({
      dataRows: 41,
      columns: 21,
      preambleRows: 0,
    })
    expect(factFor("Tech")).toMatchObject({ dataRows: 33, columns: 2, preambleRows: 0 })
  })

  it("carries the Analysis tab's indicator list through unchanged", () => {
    expect(factFor("Müştəri İcmalı").indicatorCodes).toEqual([
      "CUSTOMER_HHI",
      "TOP_CUSTOMER_SHARE",
      "TOP3_CUSTOMER_SHARE",
      "SUPPLIER_HHI",
    ])
    // A sheet with no projection gets an empty list, never a borrowed one.
    expect(factFor("Tech").indicatorCodes).toEqual([])
  })

  it("marks a sheet whose header could not be found", () => {
    const res = {
      ...RESPONSE,
      perFile: [
        {
          ...RESPONSE.perFile[0],
          workbookProfile: {
            sheets: [
              { sheetName: "Müştəri İcmalı", totalRows: 375, totalColumns: 20, headerRowIndex: null },
            ],
          },
        },
      ],
    }
    expect(factFor("Müştəri İcmalı", res as never)).toMatchObject({
      dataRows: 375,
      headerFound: false,
      preambleRows: null,
    })
  })

  it("states nothing when the profile is missing rather than guessing zero", () => {
    const res = {
      ...RESPONSE,
      perFile: [{ ...RESPONSE.perFile[0], workbookProfile: null }],
    }
    expect(factFor("Tech", res as never)).toMatchObject({
      dataRows: null,
      columns: null,
      headerFound: undefined,
    })
  })

  it("returns nothing for an absent or empty payload", () => {
    expect(buildWarningSheetFacts(null)).toEqual([])
    expect(buildWarningSheetFacts({})).toEqual([])
  })
})

describe.skipIf(!AVAILABLE)("against the real workbook", () => {
  it("the fixture above is what the extractor actually produces", () => {
    const wb = XLSX.readFile(WORKBOOK)
    const metas = extractWorkbookMeta(wb, XLSX as never, { sampleRows: 3 })
    const profile = buildWorkbookProfile(wb, XLSX as never, {
      filename: FILE,
      sheetMetas: metas,
    })
    for (const want of PROFILE_SHEETS) {
      const got = profile.sheets.find((s) => s.sheetName === want.sheetName)
      expect(got, `sheet ${want.sheetName} missing from profile`).toBeTruthy()
      expect({
        sheetName: got!.sheetName,
        totalRows: got!.totalRows,
        totalColumns: got!.totalColumns,
        headerRowIndex: got!.headerRowIndex,
      }).toEqual(want)
    }
  })

  it("371 is the customer count, not an artefact of the subtraction", () => {
    // Independent of the extractor: count non-empty client names under the
    // row that literally says "Channel".
    const wb = XLSX.readFile(WORKBOOK)
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Müştəri İcmalı"], {
      header: 1,
      blankrows: true,
    })
    const header = aoa.findIndex((r) => String(r?.[0] ?? "").trim() === "Channel")
    const clients = aoa
      .slice(header + 1)
      .filter((r) => String(r?.[1] ?? "").trim() !== "")
    expect(clients).toHaveLength(371)
    expect(factFor("Müştəri İcmalı").dataRows).toBe(clients.length)
  })
})
