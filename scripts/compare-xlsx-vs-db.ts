import * as XLSX from "xlsx"
import { PrismaClient } from "@prisma/client"

const FILE = "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx"
const PLAN_ID = "cmp17ayy7000du6ockilfw0c4"

// Excel serial range for 2026-01-01 through 2026-12-31 (~46023-46388)
const SERIAL_2026_MIN = 46000
const SERIAL_2026_MAX = 46400

// Sheet name → entity shortCode (actual sheet names in Guvven Fin.xlsx)
const PLF_SHEETS: Record<string, string> = {
  "PLF CPC":  "CPC",
  "PLF AZSF": "AZSF",
  "PLF EDEN": "EDEN",
  "PL Malt":  "MALT",
}

type Totals = { revenue: number; cogs: number; expense: number }
type RowDetail = { code: string; name: string; type: string; xl: number; db: number }

async function main() {
  const prisma = new PrismaClient()
  const wb = XLSX.readFile(FILE)
  const xlTotals: Record<string, Totals> = {}
  const xlRows: Record<string, RowDetail[]> = {}

  for (const [sheetName, shortCode] of Object.entries(PLF_SHEETS)) {
    const ws = wb.Sheets[sheetName]
    if (!ws) { console.log(`Sheet ${sheetName} not found`); continue }
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: 0 })

    // Auto-detect 2026 column range from header row
    let colStart = -1, colEnd = -1
    for (let r = 0; r < Math.min(5, rows.length); r++) {
      const hdr = rows[r]
      const first = hdr.findIndex((v: unknown, i: number) =>
        i > 2 && typeof v === "number" && v >= SERIAL_2026_MIN && v <= SERIAL_2026_MAX
      )
      if (first < 0) continue
      let last = first
      while (last + 1 < hdr.length && typeof hdr[last + 1] === "number" &&
             hdr[last + 1] >= SERIAL_2026_MIN && hdr[last + 1] <= SERIAL_2026_MAX) last++
      colStart = first; colEnd = last
      break
    }
    if (colStart < 0) { console.log(`Sheet ${sheetName}: 2026 columns not found`); continue }
    console.log(`Sheet ${sheetName}: 2026 cols ${colStart}-${colEnd}`)

    let revenue = 0, cogs = 0, expense = 0
    let currentSection = ""
    xlRows[shortCode] = []

    for (const row of rows) {
      const rawCode = String(row[0] ?? "").trim()
      const name    = String(row[1] ?? "").trim()
      // Only leaf rows: PLF.XX.XX.XX (3 dots = 4 segments)
      const parts = rawCode.split(".")
      if (!rawCode.startsWith("PLF.") || parts.length !== 4) continue

      const sectionNum = parseInt(parts[1])
      if (sectionNum === 1) currentSection = "revenue"
      else if (sectionNum === 2) currentSection = "cogs"
      else if (sectionNum === 10) continue // skip computed Net Profit rows
      else currentSection = "expense"

      // Sum 2026 columns
      let rowTotal = 0
      for (let c = colStart; c <= colEnd; c++) {
        const v = typeof row[c] === "number" ? row[c] : parseFloat(String(row[c])) || 0
        rowTotal += v
      }
      if (rowTotal === 0) continue

      // COGS and expense rows are stored as negative values in the Excel file
      const absTotal = Math.abs(rowTotal)
      if (currentSection === "revenue") revenue += absTotal
      else if (currentSection === "cogs") cogs += absTotal
      else expense += absTotal

      rowTotal = absTotal
      xlRows[shortCode].push({ code: rawCode, name, type: currentSection, xl: rowTotal, db: 0 })
    }
    xlTotals[shortCode] = { revenue, cogs, expense }
  }

  // DB totals + per-row breakdown (live rows only)
  const lines: any[] = await (prisma as any).budgetLine.findMany({
    where: { planId: PLAN_ID, deletedAt: null },
    include: {
      company: { select: { code: true } },
      account: { select: { code: true, accountType: true } },
    },
  })

  const dbTotals: Record<string, Totals> = {}
  const dbByCategory: Record<string, number> = {}  // "shortCode::PLF.XX.XX.XX" -> total

  for (const bl of lines) {
    const compCode = bl.company?.code ?? "unknown"
    const type = bl.account?.accountType ?? bl.lineType
    if (!dbTotals[compCode]) dbTotals[compCode] = { revenue: 0, cogs: 0, expense: 0 }
    if (type === "revenue") dbTotals[compCode].revenue += bl.plannedAmount
    else if (type === "cogs") dbTotals[compCode].cogs += bl.plannedAmount
    else dbTotals[compCode].expense += bl.plannedAmount

    // Strip entity prefix to get PLF code for row-level match
    // category = "AZSEKER-CPC-PLF.01.02.01" → plfCode = "PLF.01.02.01"
    // Also handles letter-suffix codes like "AZSEKER-CPC-PLF.05.01.R"
    const cat = bl.category ?? ""
    const plfMatch = cat.match(/PLF(\.\d+\.\d+\.[A-Za-z0-9]+)$/)
    if (plfMatch) {
      const plfCode = "PLF" + plfMatch[1]
      const key = `${compCode}::${plfCode}`
      dbByCategory[key] = (dbByCategory[key] ?? 0) + bl.plannedAmount
    }
  }

  // DB company codes include the holding prefix, e.g. "AZSEKER-CPC"
  // Map shortCode → the actual DB key
  const dbKeyFor = (shortCode: string): string | undefined =>
    Object.keys(dbTotals).find(
      k => k === shortCode || k === `AZSEKER-${shortCode}` || k.endsWith(`-${shortCode}`)
    )

  // Match DB amounts back to xlRows
  for (const [shortCode, details] of Object.entries(xlRows)) {
    const dbKey = dbKeyFor(shortCode) ?? shortCode
    for (const d of details) {
      const key = `${dbKey}::${d.code}`
      d.db = dbByCategory[key] ?? 0
    }
  }

  // ── Summary table ──
  console.log("\n=== SUMMARY: Excel 2026 vs DB (AZN millions) ===\n")
  console.log("Entity  | Type    |  Excel (M) |    DB (M) |  Diff (M) | Diff%  |")
  console.log("--------|---------|------------|-----------|-----------|--------|")

  let grandXl = { revenue: 0, cogs: 0, expense: 0 }
  let grandDb = { revenue: 0, cogs: 0, expense: 0 }

  for (const [shortCode, xl] of Object.entries(xlTotals)) {
    const dbKey = dbKeyFor(shortCode)
    const db = (dbKey ? dbTotals[dbKey] : undefined) ?? { revenue: 0, cogs: 0, expense: 0 }
    for (const t of ["revenue", "cogs", "expense"] as const) {
      const xlv = xl[t] / 1e6
      const dbv = db[t] / 1e6
      const diff = dbv - xlv
      const pct = xlv > 0.001 ? ((diff / xlv) * 100).toFixed(1) + "%" : "n/a"
      const flag = xlv > 0.001 && Math.abs(diff / xlv) > 0.01 ? " ⚠️" : " ✓"
      console.log(`${shortCode.padEnd(8)}| ${t.padEnd(7)} | ${xlv.toFixed(3).padStart(10)} | ${dbv.toFixed(3).padStart(9)} | ${diff.toFixed(3).padStart(9)} | ${pct.padStart(6)}${flag}`)
      ;(grandXl as any)[t] += xl[t];
      ;(grandDb as any)[t] += db[t]
    }
    console.log("--------|---------|------------|-----------|-----------|--------|")
  }

  console.log("\n=== TOTAL ===")
  for (const t of ["revenue", "cogs", "expense"] as const) {
    const xlv = grandXl[t] / 1e6, dbv = grandDb[t] / 1e6
    const diff = dbv - xlv
    const pct = xlv > 0.001 ? ((diff / xlv) * 100).toFixed(1) + "%" : "n/a"
    const flag = xlv > 0.001 && Math.abs(diff / xlv) > 0.01 ? " ⚠️" : " ✓"
    console.log(`${"TOTAL".padEnd(8)}| ${t.padEnd(7)} | ${xlv.toFixed(3).padStart(10)} | ${dbv.toFixed(3).padStart(9)} | ${diff.toFixed(3).padStart(9)} | ${pct.padStart(6)}${flag}`)
  }

  // ── Worst discrepancies ──
  console.log("\n=== TOP DISCREPANCIES (>5% diff, >10K AZN) ===\n")
  const allRows = Object.entries(xlRows).flatMap(([code, rows]) =>
    rows.map(r => ({ entity: code, ...r }))
  )
  const bad = allRows
    .filter(r => r.xl > 10000 && Math.abs((r.db - r.xl) / r.xl) > 0.05)
    .sort((a, b) => Math.abs(b.db - b.xl) - Math.abs(a.db - a.xl))
    .slice(0, 20)

  if (bad.length === 0) {
    console.log("No significant row-level discrepancies found!")
  } else {
    console.log("Entity | Code           | Name                              | Excel (K) |  DB (K) | Diff% ")
    for (const r of bad) {
      const pct = ((r.db - r.xl) / r.xl * 100).toFixed(1)
      console.log(`${r.entity.padEnd(6)} | ${r.code.padEnd(14)} | ${r.name.slice(0,33).padEnd(33)} | ${(r.xl/1000).toFixed(1).padStart(9)} | ${(r.db/1000).toFixed(1).padStart(7)} | ${pct}%`)
    }
  }

  await prisma.$disconnect()
}

main().catch(console.error)
