// @vitest-environment node
/**
 * Dry-run: what the importer will WRITE for 2025, account by account.
 *
 * The question this answers is not "do the totals add up" — they did before,
 * which is why the defect survived every check. It is "under what NAME does
 * each 2025 amount land". So the run parses `PLF Actual 2025` with the real
 * adapter, lists every leaf carrying money as the (code, name) pair it would
 * be stored under, and compares each one against the name the 2026 chart
 * already holds for that code. A disagreement is a mislabel — money filed
 * under someone else's account, invisible in every total.
 *
 * It runs TWICE, with the legacy-chart translation on and off, so the test
 * states the size of the defect rather than merely the absence of it.
 *
 * The 2026 chart is read straight off `PLF Budget 2026` / `PLF Actual 2026`,
 * which is what production's `chart_of_accounts` was built from, and neither
 * side of the comparison is a number a developer typed in.
 *
 * The workbook is client data and is not in the repository, so the suite skips
 * when it is absent. Point `PLF_DRYRUN_WORKBOOK` at a copy to run it:
 *
 *   PLF_DRYRUN_WORKBOOK=/path/actual-budget-v1.xlsx npx vitest run plf-2025-workbook-dryrun
 */
import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as XLSX from "xlsx"
import { parsePlfPlSheet } from "./azseker-plf"
import { REPORTING_PACK_SKIP_BU } from "./reporting-pack-detail"
import { normaliseChartLabel } from "./plf-legacy-chart"
import {
  otherOperatingContribution,
  pnlSectionFromCode,
  revenueContribution,
} from "../../budgeting/coa-role"
import { computeEbitda } from "../../budgeting/ebitda"

const WORKBOOK = process.env.PLF_DRYRUN_WORKBOOK ?? ""
const AVAILABLE = WORKBOOK !== "" && fs.existsSync(WORKBOOK)

const SHEET = "PLF Actual 2025"
/** `PLF Actual 2025` splits entities on plain `BU`. */
const BU_HEADER = "BU"
const CURRENT_SHEETS = ["PLF Budget 2026", "PLF Actual 2026"] as const
/** Half a qəpik — the tolerance the reconciliation layer already uses. */
const TOL = 0.005

interface Account {
  code: string
  name: string
  amount: number
  sourceCodes: string[]
}

interface Run {
  entities: string[]
  accounts: Account[]
  mislabelled: Array<{ account: Account; currentNames: string[] }>
  rewrittenCodes: number
  warnings: string[]
  sheetSubtotals: Record<string, number>
  grossProfit: number
  ebitda: number
  netProfit: number
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

/** code → the names the CURRENT chart of accounts holds for it. */
function readCurrentChart(wb: XLSX.WorkBook): Map<string, string[]> {
  const byCode = new Map<string, string[]>()
  for (const sheetName of CURRENT_SHEETS) {
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1,
      raw: true,
      defval: null,
    }) as unknown[][]
    for (const row of aoa) {
      const code = String(row?.[0] ?? "").trim()
      const label = String(row?.[1] ?? "").trim()
      if (!code || !label) continue
      const names = byCode.get(code)
      if (!names) byCode.set(code, [label])
      else if (!names.includes(label)) names.push(label)
    }
  }
  return byCode
}

function run(wb: XLSX.WorkBook, legacyChartYear: number | null | undefined): Run {
  const current = readCurrentChart(wb)
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[SHEET], {
    header: 1,
    raw: true,
    blankrows: false,
  }) as unknown[][]
  const bu = locate(aoa, BU_HEADER)
  const headerRow = aoa[bu.row]

  const monthCols: number[] = []
  for (let c = 0; c < headerRow.length; c++) {
    const v = headerRow[c]
    // 2025-01-01 .. 2025-12-01 as Excel serials.
    if (typeof v === "number" && v >= 45658 && v <= 45992) monthCols.push(c)
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

  const totals = { revenue: 0, cogs: 0, opex: 0, otherOperating: 0, belowEbitda: 0 }
  const accounts = new Map<string, Account>()
  const sheetSubtotals: Record<string, number> = {}
  const entities: string[] = []
  const warnings = new Set<string>()
  const rewritten = new Set<string>()

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
    const parsed = parsePlfPlSheet(synthetic, SHEET, XLSX, {
      preferYear: 2025,
      ...(legacyChartYear === undefined ? {} : { legacyChartYear }),
    })
    for (const w of parsed.warnings) warnings.add(w.reason)
    for (const w of parsed.legacyChart?.rewrites ?? []) rewritten.add(w.sourceCode)

    for (const line of parsed.lines) {
      const section = pnlSectionFromCode(line.code, line.accountType)
      const amount = line.totalAnnual
      if (section === "revenue") totals.revenue += revenueContribution(line.code, amount)
      else if (section === "cogs") totals.cogs += amount
      else if (section === "otherOperating")
        totals.otherOperating += otherOperatingContribution(line.code, amount)
      else if (section === "opex") totals.opex += amount
      else if (section === "belowEbitda") totals.belowEbitda += amount

      const existing = accounts.get(line.code)
      const source = line.legacyChart?.sourceCode ?? line.code
      if (existing) {
        existing.amount += amount
        if (!existing.sourceCodes.includes(source)) existing.sourceCodes.push(source)
      } else {
        accounts.set(line.code, {
          code: line.code,
          name: line.label,
          amount,
          sourceCodes: [source],
        })
      }
    }
  }

  const breakdown = computeEbitda({
    totalRevenue: totals.revenue,
    totalCogs: totals.cogs,
    totalOpex: totals.opex,
    totalOtherOperating: totals.otherOperating,
    totalBelowEbitda: totals.belowEbitda,
    daInCogs: 0,
    daInOpex: 0,
  })

  const mislabelled: Run["mislabelled"] = []
  for (const account of accounts.values()) {
    const currentNames = current.get(account.code)
    if (!currentNames) continue
    if (currentNames.some((n) => normaliseChartLabel(n) === normaliseChartLabel(account.name)))
      continue
    mislabelled.push({ account, currentNames })
  }

  return {
    entities,
    accounts: [...accounts.values()],
    mislabelled,
    rewrittenCodes: rewritten.size,
    warnings: [...warnings],
    sheetSubtotals,
    grossProfit: breakdown.grossProfit,
    ebitda: breakdown.ebitda,
    netProfit: breakdown.netProfit,
  }
}

const EMPTY: Run = {
  entities: [],
  accounts: [],
  mislabelled: [],
  rewrittenCodes: 0,
  warnings: [],
  sheetSubtotals: {},
  grossProfit: 0,
  ebitda: 0,
  netProfit: 0,
}

describe.skipIf(!AVAILABLE)("dry-run: what 2025 will be stored as", () => {
  const wb = AVAILABLE ? XLSX.readFile(WORKBOOK) : null
  const withMap = wb ? run(wb, undefined) : EMPTY
  const withoutMap = wb ? run(wb, null) : EMPTY

  const total = (r: Run) =>
    r.accounts.reduce((s, a) => s + Math.abs(a.amount), 0)

  it("lists every account it will write, code and NAME", () => {
    // The listing itself, printed. This file only runs when the operator
    // points `PLF_DRYRUN_WORKBOOK` at the client file, so the output is the
    // point: before the re-import, someone reads these lines and recognises
    // the account names as their own. `PLF_DRYRUN_OUT` writes them to a file.
    const rows = [...withMap.accounts]
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
      .map(
        (a) =>
          `  ${a.code.padEnd(24)}${a.amount.toFixed(2).padStart(16)}  ${a.name}` +
          (a.sourceCodes.some((s) => s !== a.code)
            ? `   [from ${a.sourceCodes.join(", ")}]`
            : ""),
      )
    const listing =
      `2025 → chart_of_accounts, ${withMap.accounts.length} accounts, ` +
      `${total(withMap).toFixed(2)} AZN of activity\n${rows.join("\n")}`
    console.log(`\n${listing}\n`)
    if (process.env.PLF_DRYRUN_OUT) {
      fs.writeFileSync(process.env.PLF_DRYRUN_OUT, `${listing}\n`)
    }
    // Every account has a name, and no name is just its code — an account
    // named after its code is `resolveOrCreateAccountId`'s fallback, i.e. a
    // row whose label never made it out of the sheet.
    for (const a of withMap.accounts) {
      expect(a.name, a.code).toBeTruthy()
      expect(a.name, a.code).not.toBe(a.code)
    }
  })

  it("covers the three entities the 2025 sheet has (EJE excluded)", () => {
    expect([...withMap.entities].sort()).toEqual(["AZSF", "CPC", "EDEN"])
  })

  it("writes 148 accounts carrying 99,984,622 AZN", () => {
    expect(withMap.accounts).toHaveLength(148)
    expect(total(withMap)).toBeCloseTo(99_984_622.34, 2)
    // The translation moves money between ACCOUNTS; it must not create or
    // destroy any. Same total either way.
    expect(total(withoutMap)).toBeCloseTo(total(withMap), 2)
  })

  it("re-points 73 codes", () => {
    expect(withMap.rewrittenCodes).toBe(73)
    expect(withoutMap.rewrittenCodes).toBe(0)
  })

  it("stores NOTHING under a 2026 name", () => {
    // The assertion this whole file exists for. Printed in full so a failure
    // names the account rather than a count.
    expect(
      withMap.mislabelled.map(
        (m) =>
          `${m.account.code} ${m.account.amount.toFixed(2)} stored as "${m.account.name}" but the 2026 chart says "${m.currentNames.join('" / "')}"`,
      ),
    ).toEqual([])
  })

  it("without the map, 37 accounts and 48,735,978 AZN are mislabelled", () => {
    // What the pending re-import would have written. The three biggest:
    //   PLF.01.01.06  16,428,573  processed corn revenue → "Sale of Almond"
    //   PLF.02.01.06 −13,231,466  processed corn cost    → "Almond Costs"
    //   PLF.07.02.04   7,354,842  Subsidies - Farming    → "Subsidies - Product"
    expect(withoutMap.mislabelled).toHaveLength(37)
    expect(
      withoutMap.mislabelled.reduce((s, m) => s + Math.abs(m.account.amount), 0),
    ).toBeCloseTo(48_735_978.02, 2)
  })

  it("gives the three big 2025-only accounts their own row and their own name", () => {
    const owned = [
      ["PLF.01.01.06.FY2025", "Revenue from Sale of Processed Corn Products", 16_428_572.72],
      ["PLF.02.01.06.FY2025", "Processed Corn Products", 13_231_465.97],
      ["PLF.05.01.01.FY2025", "Staff Salaries, Net", 2_994_917.85],
    ] as const
    for (const [code, name, amount] of owned) {
      const account = withMap.accounts.find((a) => a.code === code)
      expect(account, code).toBeDefined()
      expect(account!.name).toBe(name)
      expect(Math.abs(account!.amount)).toBeCloseTo(amount, 2)
    }
  })

  it("splits PLF.07.02.04 back into the three subsidies the 2026 chart names", () => {
    const at = (code: string) => withMap.accounts.find((a) => a.code === code)
    expect(at("PLF.07.02.02")).toMatchObject({ name: "Subsidies - Farming" })
    expect(at("PLF.07.02.03")).toMatchObject({ name: "Subsidies - Investment" })
    expect(at("PLF.07.02.04")).toMatchObject({ name: "Subsidies - Product" })
    for (const code of ["PLF.07.02.02", "PLF.07.02.03", "PLF.07.02.04"]) {
      expect(at(code)!.sourceCodes).toEqual(["PLF.07.02.04"])
    }
    expect(at("PLF.07.02.02")!.amount).toBeCloseTo(2_377_802.70, 2)
    expect(at("PLF.07.02.03")!.amount).toBeCloseTo(935_417.22, 2)
    expect(at("PLF.07.02.04")!.amount).toBeCloseTo(4_041_621.92, 2)
  })

  it("warns about the one account that duplicates a 2026 one", () => {
    // `PLF.05.18.R` "Commission Fees - G&A" — the 2026 twin is `PLF.05.15`,
    // a PARENT row, so no matching rule can see it. Named, not minted quietly.
    expect(withMap.warnings.filter((w) => w.includes("two accounts, one meaning")))
      .toHaveLength(1)
  })

  it("knows every 2025 leaf that carries money", () => {
    // A leaf the map has never seen keeps the code the sheet wrote — which is
    // how a mislabel gets back in. Zero of them on this workbook.
    expect(
      withMap.warnings.filter((w) => w.includes("chart map does not describe")),
    ).toEqual([])
  })

  it("parses without a blocking warning", () => {
    expect(withMap.warnings.filter((w) => w.includes("BLOCKED:"))).toEqual([])
  })

  it("gross profit ties to the sheet's own PLF.03", () => {
    expect(withMap.grossProfit).toBeCloseTo(10_122_449.02, 2)
    expect(
      Math.abs(withMap.grossProfit - withMap.sheetSubtotals["PLF.03"]),
    ).toBeLessThan(TOL)
  })

  it("EBITDA now ties to the sheet's own PLF.08 — it was 8,578,368 short", () => {
    // 2025 files D&A inside `PLF.05`; the map moves it to `PLF.09.03`, which
    // is where the client's own PLF.08 subtotal already puts it. This is the
    // reconciliation `plf-chart.ts` recorded as unreachable until Defect 5.
    expect(withMap.ebitda).toBeCloseTo(3_233_867.51, 2)
    expect(Math.abs(withMap.ebitda - withMap.sheetSubtotals["PLF.08"])).toBeLessThan(TOL)
    expect(withoutMap.ebitda).toBeCloseTo(-5_344_500.84, 2)
    expect(withMap.ebitda - withoutMap.ebitda).toBeCloseTo(8_578_368.35, 2)
  })

  it("leaves net profit exactly where it was, 95,053 short of PLF.10", () => {
    // Net must not move: the translation renames and re-sections accounts, it
    // does not add or drop money.
    expect(withMap.netProfit).toBeCloseTo(withoutMap.netProfit, 2)
    // The residual is the client's own: for AZSF, PLF.10 −3,778,165.68 is
    // 95,053.04 ABOVE PLF.08 + PLF.08.01 + PLF.05.15, which are the only
    // below-the-line rows the 2025 sheet carries. Pinned so that a future
    // change that moves it has to say why.
    expect(withMap.netProfit - withMap.sheetSubtotals["PLF.10"]).toBeCloseTo(
      -95_053.04,
      2,
    )
  })
})
