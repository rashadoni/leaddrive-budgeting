/**
 * recon-bs-cf — reconcile Balance Sheet + Cash Flow actuals file ↔ DB.
 *
 * Uses the SAME bespoke parsers the importer uses (parseReportingPackBs /
 * parseReportingPackCf) to compute the EXPECTED leaf values — so "file" means
 * exactly what the import would insert (leaf selection + BU split applied
 * identically). A raw column re-sum diverges from the parser on BS depth and CF
 * structure; parsing removes that whole class of false positives.
 *
 * Compares per (company, leaf code, year, MONTH) by |magnitude|:
 *   - CF perMonth carries direction in the sign (an inflow line can hold a
 *     negative correction month); the DB stores the magnitude and carries
 *     direction in `entryType`. So abs() on both sides is the right grain — the
 *     same cost-sign convention recon-actual-plf uses. A MAGNITUDE difference is
 *     the real bug.
 *   - BS lines carry a sparse monthlyAmounts map; only the months the DB stores
 *     (2025 = Dec year-end; 2026 = the actuals loaded so far) are compared.
 *
 *   npx tsx scripts/recon-bs-cf.ts ["/path/Reporting 2026.xlsx"]
 *
 * Exit 0 if both reconcile, 1 otherwise.
 */
import * as XLSX from "xlsx"
import fs from "fs"
import { execFileSync } from "child_process"
import { parseReportingPackBs, parseReportingPackCf } from "../src/lib/onboarding/adapters/reporting-pack-detail"

const HOME = process.env.HOME ?? ""
const FILE = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) ?? `${HOME}/Documents/budget azersheker/Reporting 2026.xlsx`
const YEARS = [2025, 2026]
const TOL = 1
const COMPANIES = ["AZSEKER-AZSF", "AZSEKER-EDEN", "AZSEKER-CPC", "AZSEKER-PROMALT"]

function dbUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const env = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : ""
  const m = env.match(/^DATABASE_URL\s*=\s*["']?([^"'\n]+)["']?/m)
  if (!m) throw new Error("DATABASE_URL not found")
  return m[1]
}
function psql(sql: string): string[][] {
  return execFileSync("psql", [dbUrl(), "-tAF", "\t", "-c", sql], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean).map((l) => l.split("\t"))
}

const wb = XLSX.read(fs.readFileSync(FILE), { type: "buffer" })

// Normalize either parser line shape → a 12-slot perMonth for `year`:
//   CF / PLF line → `perMonth: number[]`
//   BS line       → `monthlyAmounts: { "YYYY-MM": n }` (sparse)
type AnyLine = { code: string; perMonth?: number[]; monthlyAmounts?: Record<string, number> }
function lineToPerMonth(line: AnyLine, year: number): number[] {
  const pm = new Array(12).fill(0)
  if (Array.isArray(line.perMonth)) {
    for (let m = 0; m < 12; m++) pm[m] = line.perMonth[m] ?? 0
  } else if (line.monthlyAmounts) {
    for (const [k, v] of Object.entries(line.monthlyAmounts)) {
      const [y, mo] = k.split("-").map(Number)
      if (y === year && mo >= 1 && mo <= 12) pm[mo - 1] += v
    }
  }
  return pm
}

// expected[`${company}|${code}|${year}`] = perMonth[12], summed across appearances.
function expectedFromParser(parse: typeof parseReportingPackBs | typeof parseReportingPackCf, sheet: string) {
  const exp: Record<string, number[]> = {}
  for (const year of YEARS) {
    const res = parse(wb, sheet, XLSX, { preferYear: year }) as {
      entities: Array<{ entityCode: string | null; skipped?: boolean; lines: AnyLine[] }>
    }
    for (const e of res.entities) {
      if (e.skipped || !e.entityCode) continue
      for (const l of e.lines) {
        const k = `${e.entityCode}|${l.code}|${year}`
        if (!exp[k]) exp[k] = new Array(12).fill(0)
        const pm = lineToPerMonth(l, year)
        for (let m = 0; m < 12; m++) exp[k][m] += pm[m]
      }
    }
  }
  return exp
}

// db[`${company}|${code}|${year}|${month}`] = amount, from a per-month query that
// yields columns (company, code, year, month, amount).
function dbCells(rows: string[][]): Record<string, number> {
  const db: Record<string, number> = {}
  for (const [co, acct, y, mo, v] of rows) db[`${co}|${acct}|${y}|${mo}`] = Number(v)
  return db
}

// Per (company, code, year, month) |magnitude| compare. Returns mismatch lines.
function compare(exp: Record<string, number[]>, db: Record<string, number>) {
  const mism: string[] = []
  let ok = 0
  const seen = new Set<string>()
  for (const [k, pm] of Object.entries(exp)) {
    for (let m = 0; m < 12; m++) {
      const cell = `${k}|${m + 1}`
      seen.add(cell)
      const e = Math.abs(pm[m] ?? 0)
      const d = Math.abs(db[cell] ?? 0)
      if (Math.abs(e - d) > TOL) mism.push(`${cell}  |parser|=${Math.round(e)} |db|=${Math.round(d)}`)
      else if (e > TOL || d > TOL) ok++
    }
  }
  for (const cell of Object.keys(db)) {
    if (!seen.has(cell) && Math.abs(db[cell]) > TOL) mism.push(`${cell}  |parser|=0 |db|=${Math.round(Math.abs(db[cell]))} (DB has, parser doesn't)`)
  }
  return { ok, mism }
}

function report(label: string, ok: number, mism: string[]): boolean {
  console.log(`\n=== ${label} — parser ↔ DB (per month, |value|) ===`)
  console.log(`matched cells: ${ok}  |  mismatches: ${mism.length}`)
  mism.slice(0, 30).forEach((m) => console.log("  ✗ " + m))
  if (mism.length > 30) console.log(`  … +${mism.length - 30} more`)
  return mism.length === 0
}

// ── BS ──────────────────────────────────────────────────────────────────
const bsExp = expectedFromParser(parseReportingPackBs, "BS Actual")
const bsDb = dbCells(psql(`
  SELECT c.code, coa.code, b.year, b.month, ROUND(b.amount::numeric)
  FROM balance_sheet_lines b
  JOIN chart_of_accounts coa ON coa.id=b."accountId"
  JOIN companies c ON c.id=b."companyId"
  WHERE b."deletedAt" IS NULL AND c.code = ANY('{${COMPANIES.join(",")}}') AND b.year = ANY('{${YEARS.join(",")}}')`))
const bs = compare(bsExp, bsDb)
const bsOk = report("BS Actual (balance)", bs.ok, bs.mism)

// ── CF ──────────────────────────────────────────────────────────────────
const cfExp = expectedFromParser(parseReportingPackCf, "CF Actual")
const cfDb = dbCells(psql(`
  SELECT split_part("sourceId",'::',1), split_part("sourceId",'::',2), year, month, ROUND(amount::numeric)
  FROM cash_flow_entries
  WHERE "deletedAt" IS NULL AND "sourceId" LIKE '%::CF%'
    AND split_part("sourceId",'::',1) = ANY('{${COMPANIES.join(",")}}') AND year = ANY('{${YEARS.join(",")}}')`))
const cf = compare(cfExp, cfDb)
const cfOk = report("CF Actual (flow)", cf.ok, cf.mism)

console.log(`\nVERDICT: BS ${bsOk ? "✅" : "⚠️"}  ·  CF ${cfOk ? "✅" : "⚠️"}`)
process.exit(bsOk && cfOk ? 0 : 1)
