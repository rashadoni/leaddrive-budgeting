// @vitest-environment node
/**
 * Dry-run for Defect 3: read the REAL client workbook and measure the gap
 * between "sum of the legal entities" and "the group".
 *
 * The unit tests next door prove the route now declares its basis. They cannot
 * prove the declaration matters, because the size of the lie is a property of
 * one specific file. This one is:
 *
 *   `BS Actual 2026`, month 2026-05 (the latest populated month, which is the
 *   month the balance-sheet tab headlines):
 *
 *     AZSF      134,234,695.76
 *     EDEN      177,351,644.55
 *     CPC        25,184,079.11
 *     ProMalt    36,381,644.76
 *     ---------------------------
 *     Σ         373,152,064.18   ← printed as "Total assets"
 *     EJE       -123,200,854.11
 *     ---------------------------
 *     group     249,951,210.07
 *
 * Each entity's Σ is checked against that entity's OWN `BS.01 ASSETS` row —
 * a cell the client computed and the importer never reads — so the numbers
 * here are the workbook's, not a developer's.
 *
 * The workbook is client data and is not in the repository, so the suite skips
 * when it is absent. Point `BS_DRYRUN_WORKBOOK` (or the `PLF_DRYRUN_WORKBOOK`
 * already used by the P&L dry-run — it is the same file) at a copy:
 *
 *   BS_DRYRUN_WORKBOOK=/path/actual-budget-v1.xlsx npx vitest run balance-sheet-consolidation-dryrun
 */
import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as XLSX from "xlsx"
import {
  getBalanceSheetSectionData,
  normalizeBalanceSheetMonth,
  resolveBalanceSheetScope,
  type BalanceSheetEvidenceLine,
} from "./balance-sheet-evidence"

const WORKBOOK =
  process.env.BS_DRYRUN_WORKBOOK ?? process.env.PLF_DRYRUN_WORKBOOK ?? ""
const AVAILABLE = WORKBOOK !== "" && fs.existsSync(WORKBOOK)

const SHEET = "BS Actual 2026"
/** The latest month the sheet publishes, and therefore the headline month. */
const MONTH = "2026-05"
/** Legal entities. EJE is the client's elimination journal, not a company. */
const ENTITIES = ["AZSF", "EDEN", "CPC", "ProMalt"] as const
/** Leaf rule the BS adapters use — `BS.01.01.05` and friends, three groups. */
const LEAF = /^BS\.\d{2}\.\d{2}\.\d{1,2}$/

interface Sheet {
  aoa: unknown[][]
  monthCol: number
  buCol: number
}

function load(path: string): Sheet {
  const wb = XLSX.readFile(path, { cellDates: false })
  const ws = wb.Sheets[SHEET]
  if (!ws) throw new Error(`no "${SHEET}" sheet`)
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    blankrows: true,
  }) as unknown[][]

  let headerRow = -1
  let best = 0
  for (let r = 0; r < Math.min(aoa.length, 8); r++) {
    const n = (aoa[r] ?? []).filter(
      (v) => typeof v === "number" && v > 40_000 && v < 60_000,
    ).length
    if (n > best) {
      best = n
      headerRow = r
    }
  }
  if (headerRow < 0) throw new Error("no date header row")

  let monthCol = -1
  ;(aoa[headerRow] ?? []).forEach((v, c) => {
    if (typeof v !== "number" || v <= 40_000 || v >= 60_000) return
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86_400_000)
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    if (ym === MONTH) monthCol = c
  })
  if (monthCol < 0) throw new Error(`no ${MONTH} column`)

  const buCol = (aoa[headerRow] ?? []).findIndex(
    (v) => typeof v === "string" && v.trim() === "BU",
  )
  if (buCol < 0) throw new Error("no BU column")

  return { aoa, monthCol, buCol }
}

const codeOf = (row: unknown[]) => (typeof row[0] === "string" ? row[0].trim() : "")
const buOf = (row: unknown[], buCol: number) =>
  typeof row[buCol] === "string" ? (row[buCol] as string).trim() : ""
const valOf = (row: unknown[], col: number) =>
  typeof row[col] === "number" ? (row[col] as number) : null

describe.skipIf(!AVAILABLE)("Defect 3 dry-run — summing entities is not consolidating", () => {
  const sheet = AVAILABLE ? load(WORKBOOK) : (null as unknown as Sheet)

  /** Σ of an entity's asset leaves at MONTH, and that entity's own subtotal. */
  function entityAssets(bu: string): { leaves: number; ownSubtotal: number } {
    let leaves = 0
    let ownSubtotal = Number.NaN
    for (const row of sheet.aoa) {
      if (!row || buOf(row, sheet.buCol) !== bu) continue
      const v = valOf(row, sheet.monthCol)
      if (v === null) continue
      const code = codeOf(row)
      if (code === "BS.01") ownSubtotal = v
      else if (LEAF.test(code) && code.startsWith("BS.01")) leaves += v
    }
    return { leaves, ownSubtotal }
  }

  it("each entity's leaves cross-foot to that entity's own ASSETS row", () => {
    for (const bu of ENTITIES) {
      const { leaves, ownSubtotal } = entityAssets(bu)
      expect(Number.isNaN(ownSubtotal), `${bu} has no BS.01 row`).toBe(false)
      expect(leaves, bu).toBeCloseTo(ownSubtotal, 2)
    }
  })

  it("the four entities add to 373,152,064.18 — the number the page printed as Total assets", () => {
    const sum = ENTITIES.reduce((acc, bu) => acc + entityAssets(bu).leaves, 0)
    expect(sum).toBeCloseTo(373152064.18, 2)
  })

  it("the client's own elimination journal removes 123,200,854.11 of it, leaving 249,951,210.07", () => {
    // EJE detail rows only: `BS.01` inside the EJE block is a running subtotal
    // of the entries above it and would double-count.
    let coded = 0
    let uncoded = 0
    for (const row of sheet.aoa) {
      if (!row || buOf(row, sheet.buCol) !== "EJE") continue
      const v = valOf(row, sheet.monthCol)
      if (v === null) continue
      const code = codeOf(row)
      if (code.startsWith("BS.01") && code !== "BS.01") coded += v
      // `BS Actual 2026!A968` — no account code at all (col A is literally
      // "---"). See the dedicated test below for why it is counted here.
      else if (code === "---" && /Deferred Asset/i.test(String(row[1] ?? ""))) uncoded += v
    }

    expect(coded).toBeCloseTo(-136590400.48, 2)
    expect(uncoded).toBeCloseTo(13389546.37, 2)
    expect(coded + uncoded).toBeCloseTo(-123200854.11, 2)

    const summed = ENTITIES.reduce((acc, bu) => acc + entityAssets(bu).leaves, 0)
    expect(summed + coded + uncoded).toBeCloseTo(249951210.07, 2)
  })

  it("`A968` Deferred Asset on Business Combination carries no code and is the other half of an elimination", () => {
    // Reported, deliberately not imported. Col A is "---", so no code-keyed
    // parser can pick it up — and it must not: the row immediately above it
    // reverses "Investments in Joint Ventures (QTA Investment)" by the same
    // amount, which makes this the balancing debit of a CONSOLIDATION entry,
    // not a balance of any legal entity. Attaching it to one would invent
    // 13.4M of assets on that entity's standalone sheet.
    //
    // It is still load-bearing: drop it from the elimination and consolidated
    // assets come out 13,389,546.37 low (236,561,663.70 instead of
    // 249,951,210.07). It belongs to whatever writes the holding's
    // consolidated balance sheet, and nowhere else.
    const idx = sheet.aoa.findIndex(
      (row) =>
        !!row &&
        codeOf(row) === "---" &&
        String(row[1] ?? "").trim() === "Deferred Asset on Business Combination",
    )
    expect(idx, "row not found — the workbook shape changed").toBeGreaterThan(0)

    const row = sheet.aoa[idx]
    const prev = sheet.aoa[idx - 1]
    expect(buOf(row, sheet.buCol)).toBe("EJE")
    expect(String(prev[1] ?? "")).toContain("Investments in Joint Ventures")
    // Same magnitude, opposite sign: one journal entry, two halves.
    expect(valOf(row, sheet.monthCol)! + valOf(prev, sheet.monthCol)!).toBeCloseTo(0, 2)
  })

  it("the balance check stays silent on the un-eliminated sum — only the declared basis catches it", () => {
    const rows: BalanceSheetEvidenceLine[] = []
    let id = 0
    for (const row of sheet.aoa) {
      if (!row) continue
      const bu = buOf(row, sheet.buCol)
      if (!(ENTITIES as readonly string[]).includes(bu)) continue
      const v = valOf(row, sheet.monthCol)
      if (v === null) continue
      const code = codeOf(row)
      if (!LEAF.test(code)) continue
      const lineType = code.startsWith("BS.01")
        ? "asset"
        : code.startsWith("BS.02")
          ? "equity"
          : code.startsWith("BS.03")
            ? "liability"
            : null
      if (!lineType) continue
      rows.push({
        id: `r${id++}`,
        companyId: bu,
        lineType,
        month: 5,
        amount: v,
        account: { code, name: String(row[1] ?? code) },
      })
    }

    const scope = resolveBalanceSheetScope(rows, { holdingConsolidated: false })
    expect(scope.basis).toBe("sum_of_entities")
    expect(scope.entityCount).toBe(4)
    expect(scope.eliminationsApplied).toBe(false)

    const totals = normalizeBalanceSheetMonth(
      getBalanceSheetSectionData(rows.filter((r) => r.lineType === "asset")),
      getBalanceSheetSectionData(rows.filter((r) => r.lineType === "liability")),
      getBalanceSheetSectionData(rows.filter((r) => r.lineType === "equity")),
      5,
      scope,
    )

    // Four balanced balance sheets summed are still balanced: the residual
    // gate resolves a clean convention and publishes liabilities and equity.
    expect(totals.convention).toBe("trial_balance")
    expect(totals.assets).toBeCloseTo(373152064.18, 2)
    expect(totals.liabilities).not.toBeNull()
    // ₼1.32 of residual on ₼373,152,064 — the client's own rounding, and four
    // orders of magnitude inside the gate's tolerance. Set against the
    // ₼123,200,854 the total is actually wrong by, it is the whole point: the
    // statement that balances best is the one nobody eliminated.
    const residual = Math.abs(totals.assets! - totals.liabilities! - totals.equity!)
    expect(residual).toBeLessThan(2)
    expect(residual).toBeLessThan(Math.abs(totals.assets!) * 0.001)

    // ...and the total is 123,200,854.11 too high. Nothing arithmetic can say
    // so; only the declared basis can.
    expect(totals.eliminationsApplied).toBe(false)
  })
})
