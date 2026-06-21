/**
 * recon-actual-plf — reconcile the source `Actual PLF` sheet against what is
 * ACTUALLY stored in the DB, leaf code by leaf code, per company and year.
 *
 * Why: the DB can drift from the source file (a row reclassified in the file
 * after the last import, a company/year never loaded). A section-total check
 * misses this — a mis-allocation between two sub-accounts nets to zero at the
 * section level. This compares EVERY leaf (e.g. PLF.01.02.01) file↔DB, so even
 * a hidden swap surfaces.
 *
 * Run it BEFORE an import to capture the baseline, and AGAIN after to confirm
 * the discrepancies resolved (or to see exactly what changed).
 *
 *   npx tsx scripts/recon-actual-plf.ts
 *   npx tsx scripts/recon-actual-plf.ts "/path/to/Reporting 2026.xlsx" --sheet "Actual PLF"
 *
 * Reads DATABASE_URL from .env. Compares |value| (the cost-sign flip — Excel
 * stores costs negative, the DB stores the positive charge — is a known,
 * intended convention, not a discrepancy; a MAGNITUDE difference is the bug).
 * Exit 0 = every leaf matches; 1 = discrepancies found.
 */
import * as XLSX from "xlsx"
import fs from "fs"
import { execFileSync } from "child_process"

// ── config ──────────────────────────────────────────────────────────────
const HOME = process.env.HOME ?? ""
const fileArg = process.argv.find((a, i) => i >= 2 && !a.startsWith("--"))
const FILE = fileArg ?? `${HOME}/Documents/budget azersheker/Reporting 2026.xlsx`
const sheetIdx = process.argv.indexOf("--sheet")
const SHEET = sheetIdx >= 0 ? process.argv[sheetIdx + 1] : "Actual PLF"
const buIdx = process.argv.indexOf("--bu")
const BU_HEADER = buIdx >= 0 ? process.argv[buIdx + 1] : "BU"
const TOL = 1 // manat — ignore rounding

// BU value (file) → company code (DB). Extend here for new entities.
const BU_TO_CO: Record<string, string> = {
  AZSF: "AZSEKER-AZSF",
  EDEN: "AZSEKER-EDEN",
  CPC: "AZSEKER-CPC",
  ProMalt: "AZSEKER-PROMALT",
}
const COMPANIES = Object.values(BU_TO_CO)

// ── DATABASE_URL from .env ──────────────────────────────────────────────
function dbUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  const env = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : ""
  const m = env.match(/^DATABASE_URL\s*=\s*["']?([^"'\n]+)["']?/m)
  if (!m) throw new Error("DATABASE_URL not found (env or .env)")
  return m[1]
}

// ── file side: per (company, leaf code) → annual sum per year ───────────
// Leaf = a real data row the import stores (PLF.xx.xx.xx / .R), NOT a section
// parent or a computed subtotal (PLF.01, PLF.01.01, Gross Margin, EBITDA…).
const LEAF_RE = /^(PLF|CF)\.\d{2}\.\d{2}\.([0-9]{1,2}|[A-Za-z]{1,2})$/
const EPOCH = Date.UTC(1899, 11, 30)
function fileLeaves(): { leaves: Record<string, Record<number, number>>; years: number[] } {
  const wb = XLSX.read(fs.readFileSync(FILE), { type: "buffer" })
  if (!wb.Sheets[SHEET]) throw new Error(`Sheet "${SHEET}" not in ${FILE}`)
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[SHEET], {
    header: 1,
    blankrows: false,
    defval: null,
  }) as unknown[][]
  const header = aoa[0] ?? []
  // Dynamic column→year map from date-serial headers (robust to column shifts).
  const colYear: Record<number, number> = {}
  let buCol = -1
  for (let c = 0; c < header.length; c++) {
    const v = header[c]
    if (String(v ?? "").trim() === BU_HEADER) buCol = c
    if (typeof v === "number" && v >= 40000 && v <= 60000) {
      colYear[c] = new Date(EPOCH + v * 86400000).getUTCFullYear()
    }
  }
  if (buCol < 0) throw new Error(`No "${BU_HEADER}" column in header`)
  const out: Record<string, Record<number, number>> = {}
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] ?? []
    const code = String(row[0] ?? "").trim()
    const co = BU_TO_CO[String(row[buCol] ?? "").trim()]
    if (!co || !/^PLF\./.test(code)) continue
    const key = `${co}|${code}`
    out[key] ??= {}
    for (const [cStr, year] of Object.entries(colYear)) {
      const v = row[Number(cStr)]
      if (typeof v === "number" && isFinite(v)) out[key][year] = (out[key][year] ?? 0) + v
    }
  }
  return { leaves: out, years: [...new Set(Object.values(colYear))].sort((a, b) => a - b) }
}

// ── DB side: per (company, leaf code) → annual sum per year (actual plans) ─
function dbLeaves(): Array<{ company: string; acct: string; type: string; vals: Record<number, number> }> {
  const sql = `
    SELECT c.code AS company, coa.code AS acct, coa."accountType" AS type, p.year AS year,
      ROUND(SUM(bl."plannedAmount")::numeric) AS total
    FROM budget_lines bl
    JOIN budget_plans p ON p.id=bl."planId" AND p.kind='actual' AND p."deletedAt" IS NULL
    JOIN chart_of_accounts coa ON coa.id=bl."accountId"
    JOIN companies c ON c.id=bl."companyId"
    WHERE bl."deletedAt" IS NULL AND c.code = ANY('{${COMPANIES.join(",")}}')
    GROUP BY c.code, coa.code, coa."accountType", p.year`
  const raw = execFileSync("psql", [dbUrl(), "-tAF", "\t", "-c", sql], { encoding: "utf8" })
  const map: Record<string, { company: string; acct: string; type: string; vals: Record<number, number> }> = {}
  for (const line of raw.trim().split("\n")) {
    if (!line) continue
    const [company, acct, type, year, total] = line.split("\t")
    const k = `${company}|${acct}`
    map[k] ??= { company, acct, type, vals: {} }
    map[k].vals[Number(year)] = Number(total)
  }
  return Object.values(map)
}

// ── compare ─────────────────────────────────────────────────────────────
function main() {
  const { leaves: F, years } = fileLeaves() // compare ONLY the years this sheet covers
  const DB = dbLeaves()
  let ok = 0
  const mismatch: string[] = []
  const missingFile: string[] = []
  for (const d of DB) {
    const f = F[`${d.company}|${d.acct}`]
    if (!f) {
      missingFile.push(`${d.company}|${d.acct} — in DB, NOT in file`)
      continue
    }
    const diffs = years
      .map((y) => ({ y, d: Math.abs(Math.abs(f[y] ?? 0) - Math.abs(d.vals[y] ?? 0)) }))
      .filter((x) => x.d > TOL)
    if (diffs.length === 0) ok++
    else
      mismatch.push(
        `${d.company}|${d.acct} [${d.type}]  ` +
          years.map((y) => `${y}: file=${f[y] ?? 0} db=${d.vals[y] ?? 0}`).join("  |  "),
      )
  }
  // file LEAF codes with real data in a covered year but no DB row at all
  // (present in source, never loaded). Parents/subtotals are excluded.
  const dbKeys = new Set(DB.map((d) => `${d.company}|${d.acct}`))
  const missingDb = Object.keys(F).filter(
    (k) =>
      !dbKeys.has(k) &&
      LEAF_RE.test(k.split("|")[1]) &&
      years.some((y) => Math.abs(F[k][y] ?? 0) > TOL),
  )

  console.log(`\n=== recon Actual PLF: file ↔ DB (per leaf, |value|) ===`)
  console.log(`file: ${FILE}`)
  console.log(`sheet: ${SHEET} · companies: ${COMPANIES.length} · years: ${years.join(", ")}`)
  console.log(
    `\nmatched: ${ok}  |  value mismatches: ${mismatch.length}  |  in-DB-not-file: ${missingFile.length}  |  in-file-not-DB: ${missingDb.length}`,
  )
  if (mismatch.length) {
    console.log(`\n--- VALUE MISMATCHES ---`)
    mismatch.forEach((m) => console.log("  ✗ " + m))
  }
  if (missingDb.length) {
    console.log(`\n--- IN FILE, NOT IN DB (never loaded) ---`)
    missingDb.slice(0, 60).forEach((k) => console.log("  ? " + k))
    if (missingDb.length > 60) console.log(`  … +${missingDb.length - 60} more`)
  }
  if (missingFile.length) {
    console.log(`\n--- IN DB, NOT IN FILE ---`)
    missingFile.forEach((m) => console.log("  ! " + m))
  }
  const clean = mismatch.length === 0 && missingFile.length === 0 && missingDb.length === 0
  console.log(`\nVERDICT: ${clean ? "✅ CLEAN — every leaf reconciles" : "⚠️ DISCREPANCIES — see above"}`)
  process.exit(clean ? 0 : 1)
}

main()
