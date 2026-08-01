// @vitest-environment node
/**
 * Defect 5 at the importer — what `budget_lines` and `chart_of_accounts` get.
 *
 * Every code, label and amount below is verbatim from `PLF Actual 2025` and
 * `PLF Budget 2026` in `actual-budget-v1.xlsx`, so a fixture that drifts from
 * the file is a failing test rather than a quiet disagreement. The
 * whole-workbook proof is `plf-2025-workbook-dryrun.test.ts`; this file is the
 * always-on guard, because that one skips when the client file is absent.
 *
 * What makes each case fail without the fix is stated in the case.
 */
import { describe, it, expect } from "vitest"
import * as XLSX from "xlsx"
import { parsePlfPlSheet } from "./azseker-plf"

/** 2025 month serials, Jan..Dec, exactly as `PLF Actual 2025` row 1 has them. */
const M2025 = [
  45658, 45689, 45717, 45748, 45778, 45809, 45839, 45870, 45901, 45931, 45962,
  45992,
]
/** 2026 month serials — the sheet whose chart is already current. */
const M2026 = [
  46023, 46054, 46082, 46113, 46143, 46174, 46204, 46235, 46266, 46296, 46327,
  46357,
]

const spread = (annual: number) => Array(12).fill(annual / 12)

const SHEET = "PLF Actual 2025"

function sheet2025(rows: unknown[][]): XLSX.WorkBook {
  const aoa: unknown[][] = [["", "", "", ...M2025], ...rows]
  return {
    SheetNames: [SHEET],
    Sheets: { [SHEET]: XLSX.utils.aoa_to_sheet(aoa) },
  } as XLSX.WorkBook
}

const parse2025 = (rows: unknown[][], legacyChartYear?: number | null) =>
  parsePlfPlSheet(sheet2025(rows), SHEET, XLSX, {
    preferYear: 2025,
    ...(legacyChartYear === undefined ? {} : { legacyChartYear }),
  })

const find = <T extends { code: string }>(lines: T[], code: string) =>
  lines.find((l) => l.code === code)

describe("a 2025 sheet is read against the 2025 chart", () => {
  it("does not post processed-corn revenue under the almond account", () => {
    // `PLF Actual 2025` r4, CPC. The 2026 chart calls `PLF.01.01.06`
    // "Revenue from Sale of Almond", and `resolveOrCreateAccountId` never
    // renames an existing row — so without the mint this 16,428,573 posts
    // under almond and nothing anywhere says so.
    const { lines } = parse2025([
      ["PLF.01", "REVENUE", "", ...spread(17_250_510.11)],
      ["PLF.01.01", "Revenue from Products Sold", "", ...spread(16_950_050.01)],
      [
        "PLF.01.01.06",
        "Revenue from Sale of Processed Corn Products",
        "",
        ...spread(16_428_572.72),
      ],
    ])
    expect(find(lines, "PLF.01.01.06")).toBeUndefined()
    expect(find(lines, "PLF.01.01.06.FY2025")).toMatchObject({
      label: "Revenue from Sale of Processed Corn Products",
      accountType: "revenue",
      legacyChart: {
        chartYear: 2025,
        sourceCode: "PLF.01.01.06",
        kind: "own_account",
      },
    })
    expect(find(lines, "PLF.01.01.06.FY2025")!.totalAnnual).toBeCloseTo(
      16_428_572.72,
      2,
    )
  })

  it("follows the client's own wording when a code was renumbered", () => {
    // 2025 `PLF.08.01` → 2026 `PLF.09.01`, both "Shareholders' expense".
    const { lines, legacyChart } = parse2025([
      ["PLF.08", "EBITDA", "", ...spread(1_706_901.52)],
      ["PLF.08.01", "Shareholders' expense", "", ...spread(-174_491)],
    ])
    expect(find(lines, "PLF.09.01")).toMatchObject({
      label: "Shareholders' expense",
      legacyChart: { sourceCode: "PLF.08.01", kind: "renumbered" },
    })
    expect(legacyChart?.rewrites).toEqual([
      {
        sourceCode: "PLF.08.01",
        storedCode: "PLF.09.01",
        name: "Shareholders' expense",
        kind: "renumbered",
      },
    ])
  })

  it("re-types the row from where it LANDS, not from where it was written", () => {
    // 2025 files D&A inside `PLF.05` (opex); the 2026 chart puts it at
    // `PLF.09.03` (below EBITDA), and so does the 2025 sheet's own PLF.08
    // subtotal. Classify from the source code and 8,578,368 AZN stays above
    // the EBITDA line and 2025 cannot reconcile to itself.
    const { lines } = parse2025([
      ["PLF.05", "SUPPORTING FUNCTIONS COST", "", ...spread(-538_974.72)],
      ["PLF.05.15", "Depreciation & Amortization", "", ...spread(-538_974.72)],
      ["PLF.05.15.01", "Depreciation - Buildings", "", ...spread(-538_974.72)],
    ])
    const line = find(lines, "PLF.09.03.01")
    expect(line).toMatchObject({ label: "Depreciation - Buildings" })
    // Cost reaches the database positive, same as every other cost row.
    expect(line!.totalAnnual).toBeCloseTo(538_974.72, 2)
  })

  it("splits one code carrying three subsidies into the three 2026 accounts", () => {
    // `PLF Actual 2025` r863-865, AZSF. One code, three labels, three
    // different accounts in the 2026 chart. A code-keyed map takes the first
    // label and mislabels the other 935,417 + 4,041,622.
    const { lines } = parse2025([
      ["PLF.07", "OTHER OPERATING INCOME/EXPENSES", "", ...spread(6_314_806)],
      ["PLF.07.02", "Non-Operating Income", "", ...spread(6_078_153)],
      ["PLF.07.02.04", "Subsidies - Farming", "", ...spread(1_761_728.24)],
      ["PLF.07.02.04", "Subsidies - Investment", "", ...spread(804_415.03)],
      ["PLF.07.02.04", "Subsidies - Product", "", ...spread(2_918_999.42)],
    ])
    expect(
      lines.map((l) => [l.code, l.label, Number(l.totalAnnual.toFixed(2))]),
    ).toEqual([
      ["PLF.07.02.02", "Subsidies - Farming", 1_761_728.24],
      ["PLF.07.02.03", "Subsidies - Investment", 804_415.03],
      ["PLF.07.02.04", "Subsidies - Product", 2_918_999.42],
    ])
    // All three are other-operating INCOME, so all three stay positive.
    for (const l of lines) expect(l.accountType).toBe("revenue")
  })

  it("keeps two simultaneously-renumbered codes apart", () => {
    // 2025 `PLF.04.02.99` moves ONTO `PLF.04.01.99` while 2025's own
    // `PLF.04.01.99` ("Other Advertisements") is an own-account row.
    // Translation is simultaneous, not chained; only the mint keeps them from
    // sharing one code under two names.
    const { lines } = parse2025([
      ["PLF.04", "SELLING EXPENSES", "", ...spread(-61_043)],
      ["PLF.04.01", "Advertisement Expenses", "", ...spread(-56_501)],
      ["PLF.04.01.99", "Other Advertisements", "", ...spread(-56_501.29)],
      ["PLF.04.02", "Promotional & Research Expenses", "", ...spread(-4_542)],
      [
        "PLF.04.02.99",
        "Other Promotional & Research Expenses",
        "",
        ...spread(-4_542.03),
      ],
    ])
    expect(lines.map((l) => [l.code, l.label])).toEqual([
      ["PLF.04.01.99.FY2025", "Other Advertisements"],
      ["PLF.04.01.99", "Other Promotional & Research Expenses"],
    ])
  })

  it("warns when a 2025 account duplicates a 2026 one under another code", () => {
    // `PLF.05.18.R` "Commission Fees - G&A" keeps its own code — no 2026 LEAF
    // carries that label. But 2026's `PLF.05.15` does, as a parent row, which
    // the matching rule cannot see. Two accounts, one meaning: said out loud.
    // The four rows the workbook actually has under `PLF.05.18` — `.R` is a
    // parallel "Regions" namespace whose child is `PLF.05.18.01.R`, so the
    // leaf set only comes out right with all four present.
    const { warnings } = parse2025([
      ["PLF.05", "SUPPORTING FUNCTIONS COST", "", ...spread(-216_144)],
      ["PLF.05.18", "Commission Fees - G&A", "", ...spread(-216_144)],
      ["PLF.05.18.01", "Bank Commission Fees", "", ...spread(-216_144)],
      ["PLF.05.18.R", "Commission Fees - G&A", "", ...spread(-9_993.17)],
      ["PLF.05.18.01.R", "Bank Commission Fees", "", ...spread(-9_993.17)],
    ])
    const dupe = warnings.filter((w) =>
      w.reason.includes("two accounts, one meaning"),
    )
    expect(dupe).toHaveLength(1)
    expect(dupe[0].reason).toContain("PLF.05.18.R")
    expect(dupe[0].reason).toContain("PLF.05.15")
  })

  it("warns rather than guessing when the chart map does not know the row", () => {
    // The one door the map does not cover: a 2025 leaf it has never seen
    // keeps the code the sheet wrote, and if 2026 reuses that code the row
    // posts under the 2026 name — Defect 5 arriving through the back.
    const { lines, warnings } = parse2025([
      ["PLF.01", "REVENUE", "", ...spread(1_000)],
      ["PLF.01.01", "Revenue from Products Sold", "", ...spread(1_000)],
      ["PLF.01.01.06", "Revenue from Sale of Something New", "", ...spread(1_000)],
    ])
    expect(find(lines, "PLF.01.01.06")).toBeDefined()
    expect(warnings).toHaveLength(1)
    expect(warnings[0].reason).toContain("the 2025 chart map does not describe")
  })

  it("summarises rather than floods when the whole sheet is foreign", () => {
    // Another client's 2025 workbook that happens to use `PLF.*` codes
    // matches nothing here. One warning per leaf would bury the blocking
    // ones, so ten are listed and the rest become a count that says plainly
    // that nothing was translated.
    const rows: unknown[][] = [
      ["PLF.05", "OPERATING EXPENSES", "", ...spread(-15_000)],
      ["PLF.05.90", "Foreign Chart Block", "", ...spread(-15_000)],
    ]
    for (let i = 1; i <= 15; i++) {
      rows.push([
        `PLF.05.90.${String(i).padStart(2, "0")}`,
        `Some Other Client Account ${i}`,
        "",
        ...spread(-1_000),
      ])
    }
    const { warnings } = parse2025(rows)
    const unknown = warnings.filter((w) =>
      w.reason.includes("chart map does not describe"),
    )
    expect(unknown).toHaveLength(10)
    const summary = warnings.filter((w) => w.reason.includes("NOTHING was translated"))
    expect(summary).toHaveLength(1)
    expect(summary[0].reason).toContain("15 leaves")
  })

  it("says nothing about a row it did not move", () => {
    const { warnings, legacyChart } = parse2025([
      ["PLF.05", "SUPPORTING FUNCTIONS COST", "", ...spread(-173_970)],
      ["PLF.05.03", "Professional Services", "", ...spread(-173_970)],
      ["PLF.05.03.01", "Audit Fees", "", ...spread(-173_970)],
    ])
    expect(warnings).toEqual([])
    expect(legacyChart).toEqual({ chartYear: 2025, rewrites: [] })
  })
})

describe("the translation is scoped to the 2025 chart", () => {
  it("leaves a 2026 sheet alone", () => {
    const aoa: unknown[][] = [
      ["", "", "", ...M2026],
      ["PLF.01", "REVENUE", "", ...spread(31_986_950)],
      ["PLF.01.01", "Revenue from Farming Activities", "", ...spread(31_736_950)],
      ["PLF.01.01.06", "Revenue from Sale of Almond", "", ...spread(1_000_000)],
    ]
    const wb = {
      SheetNames: ["PLF Budget 2026"],
      Sheets: { "PLF Budget 2026": XLSX.utils.aoa_to_sheet(aoa) },
    } as XLSX.WorkBook
    const res = parsePlfPlSheet(wb, "PLF Budget 2026", XLSX, { preferYear: 2026 })
    expect(res.legacyChart).toBeUndefined()
    expect(res.lines.map((l) => l.code)).toEqual(["PLF.01.01.06"])
    expect(res.lines[0].legacyChart).toBeUndefined()
  })

  it("can be switched off for a caller that has already translated", () => {
    const { lines, legacyChart } = parse2025(
      [
        ["PLF.01", "REVENUE", "", ...spread(16_428_572.72)],
        ["PLF.01.01", "Revenue from Products Sold", "", ...spread(16_428_572.72)],
        [
          "PLF.01.01.06",
          "Revenue from Sale of Processed Corn Products",
          "",
          ...spread(16_428_572.72),
        ],
      ],
      null,
    )
    expect(lines.map((l) => l.code)).toEqual(["PLF.01.01.06"])
    expect(legacyChart).toBeUndefined()
  })
})
