/**
 * recon-bs-cf — companion to recon-actual-plf, for the Balance Sheet and Cash
 * Flow actual sheets.
 *
 *   BS Actual → balance_sheet_lines.  Balance (point-in-time): compare the
 *     YEAR-END value (the latest month present per year), NOT a sum.
 *   CF Actual → cash_flow_entries.    Flow: sum the months. The table has no
 *     companyId — company+code come from `sourceId` = "<COMPANY-CODE>::<CFcode>".
 *
 *   npx tsx scripts/recon-bs-cf.ts ["/path/Reporting 2026.xlsx"]
 *
 * Compares |value| per leaf (the cost-sign flip is intended convention). Exit 0
 * if both sheets reconcile, 1 otherwise.
 */
import * as XLSX from "xlsx"
import fs from "fs"
import { execFileSync } from "child_process"

const HOME = process.env.HOME ?? ""
const FILE = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) ?? `${HOME}/Documents/budget azersheker/Reporting 2026.xlsx`
const TOL = 1
const BU_TO_CO: Record<string, string> = {
  AZSF: "AZSEKER-AZSF",
  EDEN: "AZSEKER-EDEN",
  CPC: "AZSEKER-CPC",
  ProMalt: "AZSEKER-PROMALT",
}
const COMPANIES = Object.values(BU_TO_CO)
const EPOCH = Date.UTC(1899, 11, 30)

function dbUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const env = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : ""
  const m = env.match(/^DATABASE_URL\s*=\s*["']?([^"'\n]+)["']?/m)
  if (!m) throw new Error("DATABASE_URL not found")
  return m[1]
}
function psql(sql: string): string[][] {
  return execFileSync("psql", [dbUrl(), "-tAF", "\t", "-c", sql], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t"))
}

const wb = XLSX.read(fs.readFileSync(FILE), { type: "buffer" })

/** Read a sheet → company|code → year → value. `mode`: "sum" or "yearend". */
function fileSide(sheet: string, mode: "sum" | "yearend"): { vals: Record<string, Record<number, number>>; years: number[] } {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, blankrows: false, defval: null }) as unknown[][]
  const header = aoa[0] ?? []
  let buCol = -1
  const cols: Array<{ c: number; year: number; month: number }> = []
  for (let c = 0; c < header.length; c++) {
    const v = header[c]
    if (String(v ?? "").trim() === "BU") buCol = c
    if (typeof v === "number" && v >= 40000 && v <= 60000) {
      const d = new Date(EPOCH + v * 86400000)
      cols.push({ c, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 })
    }
  }
  if (buCol < 0) throw new Error(`No BU column in ${sheet}`)
  const years = [...new Set(cols.map((x) => x.year))].sort((a, b) => a - b)
  // for "yearend": the latest-month column of each year
  const yearEndCol: Record<number, number> = {}
  for (const y of years) {
    const ys = cols.filter((x) => x.year === y).sort((a, b) => b.month - a.month)
    yearEndCol[y] = ys[0].c
  }
  const out: Record<string, Record<number, number>> = {}
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const code = String(row[0] ?? "").trim()
    const co = BU_TO_CO[String(row[buCol] ?? "").trim()]
    if (!co || !code || code.includes(" ")) continue
    const key = `${co}|${code}`
    out[key] ??= {}
    for (const y of years) {
      if (mode === "yearend") {
        const v = row[yearEndCol[y]]
        if (typeof v === "number" && isFinite(v)) out[key][y] = v
      } else {
        let s = 0
        for (const x of cols) if (x.year === y) { const v = row[x.c]; if (typeof v === "number" && isFinite(v)) s += v }
        out[key][y] = s
      }
    }
  }
  return { vals: out, years }
}

function compare(label: string, F: { vals: Record<string, Record<number, number>>; years: number[] }, DB: Record<string, Record<number, number>>): boolean {
  let ok = 0
  const mismatch: string[] = []
  const dbKeys = new Set(Object.keys(DB))
  for (const k of dbKeys) {
    const f = F.vals[k]
    if (!f) {
      mismatch.push(`${k} — in DB, NOT in file`)
      continue
    }
    const bad = F.years.filter((y) => Math.abs(Math.abs(f[y] ?? 0) - Math.abs(DB[k][y] ?? 0)) > TOL)
    if (bad.length === 0) ok++
    else mismatch.push(`${k}  ` + F.years.map((y) => `${y}: file=${Math.round(f[y] ?? 0)} db=${Math.round(DB[k][y] ?? 0)}`).join("  |  "))
  }
  const missingDb = Object.keys(F.vals).filter(
    (k) => !dbKeys.has(k) && F.years.some((y) => Math.abs(F.vals[k][y] ?? 0) > TOL),
  )
  console.log(`\n=== ${label}: file ↔ DB (per leaf) — years ${F.years.join(", ")} ===`)
  console.log(`matched: ${ok}  |  mismatches: ${mismatch.length}  |  in-file-not-DB: ${missingDb.length}`)
  mismatch.slice(0, 20).forEach((m) => console.log("  ✗ " + m))
  if (mismatch.length > 20) console.log(`  … +${mismatch.length - 20} more`)
  missingDb.slice(0, 20).forEach((k) => console.log("  ? " + k + " — in file, never loaded"))
  return mismatch.length === 0 && missingDb.length === 0
}

// ── BS: year-end balance ────────────────────────────────────────────────
function bsDb(): Record<string, Record<number, number>> {
  const rows = psql(`
    SELECT c.code, coa.code, b.year, b.month, ROUND(b.amount::numeric)
    FROM balance_sheet_lines b
    JOIN chart_of_accounts coa ON coa.id=b."accountId"
    JOIN companies c ON c.id=b."companyId"
    WHERE b."deletedAt" IS NULL AND c.code = ANY('{${COMPANIES.join(",")}}')`)
  // keep the latest-month value per (company, code, year)
  const latest: Record<string, Record<number, { m: number; v: number }>> = {}
  for (const [co, acct, yStr, mStr, vStr] of rows) {
    const k = `${co}|${acct}`, y = Number(yStr), m = Number(mStr), v = Number(vStr)
    latest[k] ??= {}
    if (!latest[k][y] || m > latest[k][y].m) latest[k][y] = { m, v }
  }
  const out: Record<string, Record<number, number>> = {}
  for (const [k, byYear] of Object.entries(latest)) {
    out[k] = {}
    for (const [y, { v }] of Object.entries(byYear)) out[k][Number(y)] = v
  }
  return out
}

// ── CF: flow sum, company+code from sourceId "<co>::<code>" ─────────────
function cfDb(): Record<string, Record<number, number>> {
  const rows = psql(`
    SELECT split_part("sourceId",'::',1) AS co, split_part("sourceId",'::',2) AS acct,
      year, ROUND(SUM(amount)::numeric)
    FROM cash_flow_entries
    WHERE "deletedAt" IS NULL AND "sourceId" LIKE '%::CF%'
      AND split_part("sourceId",'::',1) = ANY('{${COMPANIES.join(",")}}')
    GROUP BY 1,2,3`)
  const out: Record<string, Record<number, number>> = {}
  for (const [co, acct, yStr, vStr] of rows) {
    const k = `${co}|${acct}`
    out[k] ??= {}
    out[k][Number(yStr)] = Number(vStr)
  }
  return out
}

const bsOk = compare("BS Actual (year-end balance)", fileSide("BS Actual", "yearend"), bsDb())
const cfOk = compare("CF Actual (flow)", fileSide("CF Actual", "sum"), cfDb())
console.log(`\nVERDICT: BS ${bsOk ? "✅" : "⚠️"}  ·  CF ${cfOk ? "✅" : "⚠️"}`)
process.exit(bsOk && cfOk ? 0 : 1)
