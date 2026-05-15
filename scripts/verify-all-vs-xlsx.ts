/**
 * Phase 7.H Feature 5 follow-up — full-coverage xlsx ↔ DB verifier.
 *
 * Why this exists: today (2026-05-12) the client reconciled AzerSheker
 * EBITDA against their own books and our number was off. User flagged
 * «дело не только в ебитда надо проверить всё. чтоб точно было отображение
 * из файла», so this script extends `verify-azmade-vs-xlsx.ts` to cover
 * ALL 13 imported entities (AZMADE 8 + AZSEKER 5) and reports per-company
 * annual + per-month diffs in one place.
 *
 * Per-company outcomes:
 *   ✅ rev/cogs/exp match within 1 ₼ and 12 monthly buckets within 1 ₼
 *   ⚠️  any line-type or month-bucket diverges (likely sign-flip,
 *       missing rows, double-import, or stale fixture)
 *
 * Run: `npx tsx scripts/verify-all-vs-xlsx.ts`
 * Exits 0 always (informational). To gate on diffs in CI: read the
 * "Summary:" line and assert.
 */

import { PrismaClient } from "@prisma/client"
import * as XLSX from "xlsx"
import {
  parseSoplSheet,
  parseSummaryRollupSheet,
} from "../src/lib/onboarding/adapters/azmade-sopl"
import { parsePlfPlSheet } from "../src/lib/onboarding/adapters/azseker-plf"

const prisma = new PrismaClient()

const BUDGETS_DIR = "/Users/rashadrahimov/Documents/budgets azmade"
const AAC_PATH = "/Users/rashadrahimov/Downloads/2026 Budget - AAC.xlsx"
const AZSEKER_PATH =
  "/Users/rashadrahimov/Downloads/azmade budget/Consolidated budget 2026_AHMAD_NEW.xlsx"

type ParserKind = "sopl" | "rollup" | "azseker-plf"

interface JobSpec {
  file: string
  sheet: string
  companyCode: string
  parser: ParserKind
  rollupColumnHeader?: string
}

const JOBS: JobSpec[] = [
  // AZMADE — SOPL parser (single-column-per-company sheets).
  { file: `${BUDGETS_DIR}/rev6 - 2026 Budget - LLS.xlsx`, sheet: "SOPL", companyCode: "LLS-MAIN", parser: "sopl" },
  { file: `${BUDGETS_DIR}/rev7 - 2026 Budget - -SPARK.xlsx`, sheet: "SOPL", companyCode: "SPARK-MAIN", parser: "sopl" },
  { file: `${BUDGETS_DIR}/rev8 - 2026 Budget - ZTP.xlsx`, sheet: "SOPL", companyCode: "ZTP-MAIN", parser: "sopl" },
  { file: `${BUDGETS_DIR}/rev 9 - 2026 Budget - ATL.xlsx`, sheet: "SOPL P-F DBZ 2026", companyCode: "ATL-DBZ", parser: "sopl" },
  { file: `${BUDGETS_DIR}/rev 9 - 2026 Budget - ATL.xlsx`, sheet: "SOPL P-F PMZ 2026", companyCode: "ATL-PMZ", parser: "sopl" },
  { file: `${BUDGETS_DIR}/rev 9 - 2026 Budget - ATL.xlsx`, sheet: "SOPL P-F TAZ 2026", companyCode: "ATL-TAZ", parser: "sopl" },
  { file: `${BUDGETS_DIR}/rev 9 - 2026 Budget - ATL.xlsx`, sheet: "5-2 2026 büdcə mrkz daxil", companyCode: "ATL-MRKZ", parser: "rollup", rollupColumnHeader: "Mərkəz" },
  { file: AAC_PATH, sheet: "P&L", companyCode: "AAC-MAIN", parser: "sopl" },
  // AZSEKER — PLF-format parser (Consolidated workbook). Per-company
  // isolation in DB is by `companyId`, not a code prefix — categories
  // are stored as e.g. `AZSEKER-EDEN-PLF.01.01.01` but the same
  // companyId scope already isolates them, so no extra filter needed.
  { file: AZSEKER_PATH, sheet: "PL_EDEN", companyCode: "AZSEKER-EDEN", parser: "azseker-plf" },
  { file: AZSEKER_PATH, sheet: "PLF_AZSF", companyCode: "AZSEKER-AZSF", parser: "azseker-plf" },
  { file: AZSEKER_PATH, sheet: "PLF_Farm", companyCode: "AZSEKER-FARM", parser: "azseker-plf" },
  { file: AZSEKER_PATH, sheet: "PLF_CPC", companyCode: "AZSEKER-CPC", parser: "azseker-plf" },
  // AZSEKER-HORIZON: per import-azseker.cjs `plSheet: null` — no P&L in
  // source workbook, only Cash Flow. Skip P&L verification; CF
  // verification is a separate workstream.
]

interface CompareRow {
  company: string
  sheet: string
  parser: ParserKind
  xlsxLines: number
  xlsxRevenue: number
  xlsxCogs: number
  xlsxExpense: number
  dbLines: number
  dbRevenue: number
  dbCogs: number
  dbExpense: number
  revDiff: number
  cogsDiff: number
  expDiff: number
  monthlyXlsx: number[]
  monthlyDb: number[]
  monthlyMaxDiff: number
  parserWarningsCount: number
}

function aggregateParsedSopl(parsed: { lines: { plannedAnnual: number; perMonth: number[]; accountType: string }[] }) {
  let revenue = 0, cogs = 0, expense = 0
  const monthly = Array.from({ length: 12 }, () => 0)
  for (const line of parsed.lines) {
    const annual = line.plannedAnnual
    if (line.accountType === "revenue") revenue += annual
    else if (line.accountType === "cogs") cogs += annual
    else expense += annual
    for (let m = 0; m < 12; m += 1) monthly[m] += line.perMonth[m] ?? 0
  }
  return { revenue, cogs, expense, monthly, lineCount: parsed.lines.length }
}

function aggregateParsedPlf(parsed: { lines: { totalAnnual: number; perMonth: number[]; accountType: string }[] }) {
  let revenue = 0, cogs = 0, expense = 0
  const monthly = Array.from({ length: 12 }, () => 0)
  for (const line of parsed.lines) {
    const annual = line.totalAnnual
    if (line.accountType === "revenue") revenue += annual
    else if (line.accountType === "cogs") cogs += annual
    else expense += annual
    for (let m = 0; m < 12; m += 1) monthly[m] += line.perMonth[m] ?? 0
  }
  return { revenue, cogs, expense, monthly, lineCount: parsed.lines.length }
}

async function compareJob(job: JobSpec): Promise<CompareRow> {
  const wb = XLSX.readFile(job.file)
  let xlsxAggregate: { revenue: number; cogs: number; expense: number; monthly: number[]; lineCount: number }
  let parserWarningsCount = 0

  if (job.parser === "sopl") {
    const parsed = parseSoplSheet(wb, job.sheet, XLSX)
    xlsxAggregate = aggregateParsedSopl(parsed)
    parserWarningsCount = parsed.parentRollupsDropped.length + parsed.parentRollupsUnallocated.length
  } else if (job.parser === "rollup") {
    const parsed = parseSummaryRollupSheet(wb, job.sheet, job.rollupColumnHeader!, XLSX)
    xlsxAggregate = aggregateParsedSopl(parsed)
    parserWarningsCount = parsed.parentRollupsDropped.length + parsed.parentRollupsUnallocated.length
  } else {
    const parsed = parsePlfPlSheet(wb, job.sheet, XLSX)
    xlsxAggregate = aggregateParsedPlf(parsed)
    parserWarningsCount = parsed.warnings.length
  }

  const company = await prisma.company.findFirst({ where: { code: job.companyCode } })
  if (!company) throw new Error(`Company ${job.companyCode} not found in DB`)

  const dbLines = await prisma.budgetLine.findMany({
    where: { companyId: company.id },
    select: { lineType: true, plannedAmount: true, sortOrder: true },
  })

  let dbRevenue = 0, dbCogs = 0, dbExpense = 0
  const monthlyDb = Array.from({ length: 12 }, () => 0)
  for (const line of dbLines) {
    if (line.lineType === "revenue") dbRevenue += line.plannedAmount
    else if (line.lineType === "cogs") dbCogs += line.plannedAmount
    else dbExpense += line.plannedAmount
    const m = (line.sortOrder ?? 0) % 100
    if (m >= 0 && m < 12) monthlyDb[m] += line.plannedAmount
  }
  let monthlyMaxDiff = 0
  for (let m = 0; m < 12; m += 1) {
    const d = Math.abs(xlsxAggregate.monthly[m] - monthlyDb[m])
    if (d > monthlyMaxDiff) monthlyMaxDiff = d
  }

  return {
    company: job.companyCode,
    sheet: job.sheet,
    parser: job.parser,
    xlsxLines: xlsxAggregate.lineCount,
    xlsxRevenue: xlsxAggregate.revenue,
    xlsxCogs: xlsxAggregate.cogs,
    xlsxExpense: xlsxAggregate.expense,
    dbLines: dbLines.length,
    dbRevenue,
    dbCogs,
    dbExpense,
    revDiff: xlsxAggregate.revenue - dbRevenue,
    cogsDiff: xlsxAggregate.cogs - dbCogs,
    expDiff: xlsxAggregate.expense - dbExpense,
    monthlyXlsx: xlsxAggregate.monthly,
    monthlyDb,
    monthlyMaxDiff,
    parserWarningsCount,
  }
}

const EPSILON_ANNUAL = 1 // AZN
const EPSILON_MONTHLY = 1

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 })
}

function annualOk(r: CompareRow): boolean {
  return (
    Math.abs(r.revDiff) < EPSILON_ANNUAL &&
    Math.abs(r.cogsDiff) < EPSILON_ANNUAL &&
    Math.abs(r.expDiff) < EPSILON_ANNUAL
  )
}

async function main() {
  console.log(`\n${"=".repeat(80)}`)
  console.log(`Full xlsx ↔ DB verification (AZMADE 8 + AZSEKER 4 = 12 entities)`)
  console.log(`${"=".repeat(80)}\n`)

  const results: CompareRow[] = []
  for (const job of JOBS) {
    try {
      const result = await compareJob(job)
      results.push(result)
    } catch (err) {
      console.error(`✗ ${job.companyCode}: ${(err as Error).message}`)
    }
  }

  for (const r of results) {
    const ok = annualOk(r) && r.monthlyMaxDiff < EPSILON_MONTHLY
    const annualMark = annualOk(r) ? "✅" : "⚠️ "
    const monthlyMark = r.monthlyMaxDiff < EPSILON_MONTHLY ? "✅" : "⚠️ "
    console.log(`${ok ? "✅" : "⚠️ "} ${r.company} (sheet="${r.sheet}", parser=${r.parser})`)
    console.log(`   xlsx: ${r.xlsxLines} lines | rev=${fmt(r.xlsxRevenue)} cogs=${fmt(r.xlsxCogs)} exp=${fmt(r.xlsxExpense)}`)
    console.log(`   db:   ${r.dbLines} rows  | rev=${fmt(r.dbRevenue)} cogs=${fmt(r.dbCogs)} exp=${fmt(r.dbExpense)}`)
    if (!annualOk(r)) {
      console.log(`   ${annualMark} annual diff: rev=${fmt(r.revDiff)} cogs=${fmt(r.cogsDiff)} exp=${fmt(r.expDiff)}`)
    }
    if (r.monthlyMaxDiff >= EPSILON_MONTHLY) {
      console.log(`   ${monthlyMark} monthly max-diff: ${fmt(r.monthlyMaxDiff)} ₼`)
    }
    if (r.parserWarningsCount > 0) console.log(`   parser warnings: ${r.parserWarningsCount}`)
    console.log("")
  }

  const okCount = results.filter((r) => annualOk(r) && r.monthlyMaxDiff < EPSILON_MONTHLY).length
  const annualOkCount = results.filter(annualOk).length
  console.log(`${"=".repeat(80)}`)
  console.log(`Summary:`)
  console.log(`  Full match (annual + monthly): ${okCount}/${results.length}`)
  console.log(`  Annual sums match:             ${annualOkCount}/${results.length}`)
  console.log(`${"=".repeat(80)}\n`)
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err)
    return prisma.$disconnect().then(() => process.exit(1))
  })
