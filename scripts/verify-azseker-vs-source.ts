/**
 * Thorough DB ↔ source reconciliation for AzerSheker P&L.
 *
 * Re-parses the CURRENT source workbook (`Guvven Fin.xlsx`) with the SAME
 * adapter the import used (parsePlfPlSheet) and reconciles, per company,
 * per account-type, per MONTH + annual, against the budget_lines in the DB.
 *
 * Run: npx tsx scripts/verify-azseker-vs-source.ts
 * Read-only (no DB writes).
 */
import { PrismaClient } from "@prisma/client"
import * as XLSX from "xlsx"
import { parsePlfPlSheet, type PlfAccountType } from "../src/lib/onboarding/adapters/azseker-plf"
import { parseWorkbookBsSheet, type BsLineType } from "../src/lib/onboarding/adapters/azseker-workbook-bs"

const prisma = new PrismaClient()
const SOURCE = "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx"
const YEAR = 2026
const EPS = 1 // 1 ₼ tolerance

const JOBS: { code: string; sheet: string }[] = [
  { code: "AZSEKER-CPC", sheet: "PLF CPC" },
  { code: "AZSEKER-AZSF", sheet: "PLF AZSF" },
  { code: "AZSEKER-EDEN", sheet: "PLF EDEN" },
  { code: "AZSEKER-MALT", sheet: "PL Malt" },
]
const TYPES: PlfAccountType[] = ["revenue", "cogs", "expense"]

const BS_JOBS: { code: string; sheet: string }[] = [
  { code: "AZSEKER-CPC", sheet: "BS CPC" },
  { code: "AZSEKER-AZSF", sheet: "BS AZSF" },
  { code: "AZSEKER-EDEN", sheet: "BS EDEN" },
  { code: "AZSEKER-MALT", sheet: "BS Malt" },
]
const BS_TYPES: BsLineType[] = ["asset", "liability", "equity"]

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 })
}
function monthsWithData(arr: number[]): number {
  return arr.filter((v) => Math.abs(v) > EPS).length
}

async function main() {
  const wb = XLSX.readFile(SOURCE)
  console.log(`Source: ${SOURCE}`)
  console.log(`Reconciling ${JOBS.length} entities, year ${YEAR}, tolerance ±${EPS} ₼\n`)

  let anyDiff = false

  for (const job of JOBS) {
    console.log(`━━━ ${job.code}  (sheet "${job.sheet}") ━━━`)

    // --- SOURCE: parse + aggregate by type × month ---
    const parsed = parsePlfPlSheet(wb, job.sheet, XLSX, { preferYear: YEAR })
    if (parsed.warnings.length) {
      console.log(`  ⚠ parse warnings: ${parsed.warnings.map((w) => w.reason).join("; ")}`)
    }
    const src: Record<PlfAccountType, number[]> = {
      revenue: Array(12).fill(0),
      cogs: Array(12).fill(0),
      expense: Array(12).fill(0),
    }
    for (const line of parsed.lines) {
      for (let m = 0; m < 12; m++) src[line.accountType][m] += line.perMonth[m] ?? 0
    }

    // --- DB: aggregate budget_lines by lineType × monthIndex ---
    const co = await prisma.company.findFirst({ where: { code: job.code }, select: { id: true } })
    if (!co) { console.log(`  ✗ company not found in DB\n`); anyDiff = true; continue }
    const rows = await prisma.budgetLine.findMany({
      // deletedAt: null is CRITICAL — the table retains soft-deleted rows from
      // superseded import attempts (multi-import / "Copy of Guvven Fin.xlsx").
      // recompute filters these out; the verifier must too, else it sums ghosts.
      where: { companyId: co.id, plan: { year: YEAR }, deletedAt: null },
      select: { lineType: true, monthIndex: true, plannedAmount: true },
    })
    const db: Record<string, number[]> = {
      revenue: Array(12).fill(0),
      cogs: Array(12).fill(0),
      expense: Array(12).fill(0),
    }
    for (const r of rows) {
      const t = r.lineType
      const mi = r.monthIndex ?? -1
      if (db[t] && mi >= 0 && mi < 12) db[t][mi] += r.plannedAmount
    }

    // --- compare ---
    for (const t of TYPES) {
      const sAnnual = src[t].reduce((a, b) => a + b, 0)
      const dAnnual = db[t].reduce((a, b) => a + b, 0)
      const sMonths = monthsWithData(src[t])
      const dMonths = monthsWithData(db[t])
      const annualMatch = Math.abs(sAnnual - dAnnual) <= EPS
      const monthsMatch = sMonths === dMonths
      // STRICT per-month: every one of the 12 buckets must match, not just the
      // annual total + month count (a wrong month-split can net to the same annual).
      let maxMonthDiff = 0
      for (let m = 0; m < 12; m++) maxMonthDiff = Math.max(maxMonthDiff, Math.abs((db[t][m] || 0) - (src[t][m] || 0)))
      const monthValsMatch = maxMonthDiff <= EPS
      const ok = annualMatch && monthsMatch && monthValsMatch
      if (!ok) anyDiff = true
      console.log(
        `  ${ok ? "✓" : "✗"} ${t.padEnd(8)} annual src=${fmt(sAnnual).padStart(12)} db=${fmt(dAnnual).padStart(12)}` +
        ` | months src=${sMonths} db=${dMonths} | maxMonthΔ=${fmt(maxMonthDiff)}` +
        `${annualMatch ? "" : "  ←ANNUAL"}${monthsMatch ? "" : "  ←MONTH-COUNT"}${monthValsMatch ? "" : "  ←MONTH-VALUE"}`,
      )
      if (!ok) {
        // per-month breakdown for the diverging type
        const parts: string[] = []
        for (let m = 0; m < 12; m++) {
          const d = (db[t][m] || 0) - (src[t][m] || 0)
          if (Math.abs(d) > EPS) parts.push(`M${m + 1}:Δ${fmt(d)}`)
        }
        if (parts.length) console.log(`      per-month Δ(db-src): ${parts.join("  ")}`)
      }
    }
    console.log("")
  }

  // ===== BALANCE SHEET (point-in-time, per month-end snapshot) =====
  console.log("========== BALANCE SHEET ==========\n")
  for (const job of BS_JOBS) {
    console.log(`━━━ ${job.code}  (sheet "${job.sheet}") ━━━`)
    const parsed = parseWorkbookBsSheet(wb, job.sheet, XLSX, { preferYear: YEAR })
    if (parsed.warnings.length) console.log(`  ⚠ ${parsed.warnings.map((w) => w.reason).join("; ")}`)
    const src: Record<string, Record<number, number>> = { asset: {}, liability: {}, equity: {} }
    for (const line of parsed.lines) {
      for (const [key, val] of Object.entries(line.monthlyAmounts)) {
        const [y, mm] = key.split("-")
        if (Number(y) !== YEAR) continue
        const m = Number(mm)
        src[line.lineType][m] = (src[line.lineType][m] || 0) + (val as number)
      }
    }
    const co = await prisma.company.findFirst({ where: { code: job.code }, select: { id: true } })
    const rows = co
      ? await prisma.balanceSheetLine.findMany({
          where: { companyId: co.id, deletedAt: null, year: YEAR },
          select: { lineType: true, month: true, amount: true },
        })
      : []
    const db: Record<string, Record<number, number>> = { asset: {}, liability: {}, equity: {} }
    for (const r of rows) if (db[r.lineType]) db[r.lineType][r.month] = (db[r.lineType][r.month] || 0) + r.amount

    if (rows.length === 0) {
      const srcMonths = new Set<number>()
      for (const t of BS_TYPES) for (const m of Object.keys(src[t])) srcMonths.add(Number(m))
      console.log(
        `  ✗ NO LIVE BS IN DB — source has ${srcMonths.size} month(s) [${[...srcMonths].sort((a, b) => a - b).map((m) => "M" + m).join(",")}]` +
        ` → balance sheet MISSING for this entity`,
      )
      anyDiff = true
      console.log("")
      continue
    }
    for (const t of BS_TYPES) {
      const months = new Set<number>([...Object.keys(src[t]), ...Object.keys(db[t])].map(Number))
      let maxDiff = 0
      const diffMonths: string[] = []
      for (const m of months) {
        const d = (db[t][m] || 0) - (src[t][m] || 0)
        if (Math.abs(d) > EPS) { maxDiff = Math.max(maxDiff, Math.abs(d)); diffMonths.push(`M${m}:Δ${fmt(d)}`) }
      }
      const ok = maxDiff <= EPS
      if (!ok) anyDiff = true
      console.log(`  ${ok ? "✓" : "✗"} ${t.padEnd(10)} months src=${Object.keys(src[t]).length} db=${Object.keys(db[t]).length} | maxMonthΔ=${fmt(maxDiff)}`)
      if (!ok && diffMonths.length) console.log(`      ${diffMonths.join("  ")}`)
    }
    console.log("")
  }

  console.log(anyDiff ? "RESULT: ✗ discrepancies found (see above)" : "RESULT: ✓ all match")
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
