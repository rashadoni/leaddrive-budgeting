// @vitest-environment node
/**
 * Dry-run: parse the REAL client workbook with the real adapter and check the
 * four numbers against the workbook's OWN subtotal rows.
 *
 * Why this exists rather than another fixture test: the 13,453,098 defect was
 * invisible to every fixture in the repo, and the audit note that finally
 * caught the second half of it ("the whole of PLF.07 sits above EBITDA") is a
 * claim about arithmetic in a specific file. `PLF.03` GROSS MARGIN, `PLF.08`
 * EBITDA and `PLF.10` NET PROFIT are computed by the client, are never
 * imported, and therefore make a free independent statement of what the leaves
 * must add up to. This asserts against those rows, not against numbers a
 * developer typed in.
 *
 * The workbook is client data and is not in the repository, so the suite skips
 * when it is absent. Point `PLF_DRYRUN_WORKBOOK` at a copy to run it:
 *
 *   PLF_DRYRUN_WORKBOOK=/path/actual-budget-v1.xlsx npx vitest run plf-workbook-dryrun
 */
import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as XLSX from "xlsx"
import { parsePlfPlSheet } from "./azseker-plf"
import { REPORTING_PACK_SKIP_BU } from "./reporting-pack-detail"
import {
  otherOperatingContribution,
  pnlSectionFromCode,
  revenueContribution,
} from "../../budgeting/coa-role"
import { computeEbitda } from "../../budgeting/ebitda"

const WORKBOOK = process.env.PLF_DRYRUN_WORKBOOK ?? ""
const AVAILABLE = WORKBOOK !== "" && fs.existsSync(WORKBOOK)

const SHEET = "PLF Budget 2026"
/** `PLF Budget 2026` splits entities on `BU_3`; `BU_1` merges CPC into EDEN. */
const BU_HEADER = "BU_3"
/** Half a qəpik — the tolerance the reconciliation layer already uses. */
const TOL = 0.005

interface Totals {
  revenue: number
  cogs: number
  otherOperating: number
  opex: number
  belowEbitda: number
}

function locate(aoa: unknown[][], header: string): { row: number; col: number } {
  for (let r = 0; r < Math.min(aoa.length, 30); r++) {
    const row = aoa[r] ?? []
    for (let c = 0; c < row.length; c++) {
      if (String(row[c] ?? "").trim() === header) return { row: r, col: c }
    }
  }
  throw new Error(`no "${header}" column`)
}

/** Parse every importable entity block and bucket its leaves by P&L section. */
function parseWorkbook(path: string): {
  totals: Totals
  entities: string[]
  sheetSubtotals: Record<string, number>
  warnings: string[]
} {
  const wb = XLSX.readFile(path)
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[SHEET], {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]
  const bu = locate(aoa, BU_HEADER)
  const headerRow = aoa[bu.row]

  // The sheet's own arithmetic, summed over the same entities. Read straight
  // off the grid — these rows are never imported.
  const monthCols: number[] = []
  for (let c = 0; c < headerRow.length; c++) {
    const v = headerRow[c]
    if (typeof v === "number" && v >= 46023 && v <= 46357) monthCols.push(c)
  }

  const byBu = new Map<string, unknown[][]>()
  for (let r = bu.row + 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const key = String(row[bu.col] ?? "").trim()
    if (!key) continue
    let rows = byBu.get(key)
    if (!rows) {
      rows = [headerRow]
      byBu.set(key, rows)
    }
    rows.push(row)
  }

  const totals: Totals = {
    revenue: 0,
    cogs: 0,
    otherOperating: 0,
    opex: 0,
    belowEbitda: 0,
  }
  const sheetSubtotals: Record<string, number> = {}
  const entities: string[] = []
  const warnings: string[] = []

  for (const [buCode, rows] of byBu) {
    if (REPORTING_PACK_SKIP_BU.has(buCode.toUpperCase())) continue
    entities.push(buCode)

    for (const row of rows.slice(1)) {
      const code = String(row[0] ?? "").trim()
      if (!/^PLF\.(03|08|10)$/.test(code)) continue
      let sum = 0
      for (const c of monthCols) {
        const v = row[c]
        if (typeof v === "number" && Number.isFinite(v)) sum += v
      }
      sheetSubtotals[code] = (sheetSubtotals[code] ?? 0) + sum
    }

    const synthetic = {
      SheetNames: [SHEET],
      Sheets: { [SHEET]: XLSX.utils.aoa_to_sheet(rows) },
    } as XLSX.WorkBook
    const parsed = parsePlfPlSheet(synthetic, SHEET, XLSX, { preferYear: 2026 })
    for (const w of parsed.warnings) warnings.push(`[${buCode}] ${w.reason}`)

    for (const line of parsed.lines) {
      const section = pnlSectionFromCode(line.code, line.accountType)
      const amount = line.totalAnnual
      if (section === "revenue") {
        totals.revenue += revenueContribution(line.code, amount)
      } else if (section === "cogs") {
        totals.cogs += amount
      } else if (section === "otherOperating") {
        totals.otherOperating += otherOperatingContribution(line.code, amount)
      } else if (section === "opex") {
        totals.opex += amount
      } else if (section === "belowEbitda") {
        totals.belowEbitda += amount
      }
    }
  }
  return { totals, entities, sheetSubtotals, warnings }
}

describe.skipIf(!AVAILABLE)(
  "dry-run: PLF Budget 2026 parsed with the real adapter",
  () => {
    const { totals, entities, sheetSubtotals, warnings } = AVAILABLE
      ? parseWorkbook(WORKBOOK)
      : {
          totals: {} as Totals,
          entities: [],
          sheetSubtotals: {},
          warnings: [] as string[],
        }
    const breakdown = AVAILABLE
      ? computeEbitda({
          totalRevenue: totals.revenue,
          totalCogs: totals.cogs,
          totalOpex: totals.opex,
          totalOtherOperating: totals.otherOperating,
          totalBelowEbitda: totals.belowEbitda,
          daInCogs: 0,
          daInOpex: 0,
        })
      : null

    it("imports exactly the four operating entities (AJE excluded)", () => {
      expect([...entities].sort()).toEqual(["AZSF", "CPC", "EDEN", "ProMalt"])
    })

    it("parses without a blocking warning", () => {
      expect(warnings.filter((w) => w.includes("BLOCKED:"))).toEqual([])
    })

    it("revenue is 58,880,102 — the sales rows only", () => {
      // Was 72,333,200: PLF.07 income counted as revenue.
      expect(totals.revenue).toBeCloseTo(58_880_102.23, 2)
    })

    it("gross profit is 20,180,179 — equal to the sheet's own PLF.03", () => {
      // Was 33,633,277.
      expect(breakdown!.grossProfit).toBeCloseTo(20_180_179.07, 2)
      expect(
        Math.abs(breakdown!.grossProfit - sheetSubtotals["PLF.03"]),
      ).toBeLessThan(TOL)
    })

    it("other operating income/(expense) is its own line above EBITDA", () => {
      expect(totals.otherOperating).toBeCloseTo(13_076_279.14, 2)
    })

    it("EBITDA is 15,890,432 — equal to the sheet's own PLF.08", () => {
      expect(breakdown!.ebitda).toBeCloseTo(15_890_431.51, 2)
      expect(
        Math.abs(breakdown!.ebitda - sheetSubtotals["PLF.08"]),
      ).toBeLessThan(TOL)
    })

    it("net profit is unchanged at 3,829,842 — equal to the sheet's own PLF.10", () => {
      // The one number the old double-compensation already got right. If a fix
      // to revenue moves this, the fix traded one error for another.
      expect(breakdown!.netProfit).toBeCloseTo(3_829_841.7, 2)
      expect(
        Math.abs(breakdown!.netProfit - sheetSubtotals["PLF.10"]),
      ).toBeLessThan(TOL)
    })
  },
)
