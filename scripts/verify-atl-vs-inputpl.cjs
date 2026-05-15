/**
 * Phase 7.H Feature 5 follow-up — verify ATL DB against its actual source sheet.
 *
 * `verify-all-vs-xlsx.ts` reads the SOPL summary sheets (`SOPL P-F DBZ 2026`
 * etc.), but ATL is actually IMPORTED from a different sheet — `Input PL` —
 * via `scripts/import-atl-detailed.cjs` (granular detail; replaces the
 * coarser SOPL aggregates per CARRYOVER L155). Since the two sheets use
 * different classification systems (Input PL = regex-on-label; SOPL P-F
 * = SAP-code prefix), comparing DB to SOPL surfaces sheet-vs-sheet drift
 * that's NOT data corruption.
 *
 * This script uses the SAME parser logic as `import-atl-detailed.cjs`
 * (regex on English label) so DB ↔ Input PL is an apples-to-apples
 * comparison. If totals match here, the residual drift in the SOPL
 * verifier is purely a cross-sheet artifact within the xlsx file.
 *
 * Run: node scripts/verify-atl-vs-inputpl.cjs
 */
const XLSX = require("xlsx")
const { PrismaClient } = require("@prisma/client")

const FILE = "/Users/rashadrahimov/Documents/leaddrive-budgeting/.claude/worktrees/funny-satoshi-39763f/../../../Downloads/azmade budget/rev 9 - 2026 Budget - ATL.xlsx"
const SHEET = "Input PL"
const ENTITY_MAP = { MRKZ: "ATL-MRKZ", DBZ: "ATL-DBZ", PMZ: "ATL-PMZ", TAZ: "ATL-TAZ" }

// Identical to import-atl-detailed.cjs:deriveAccountType so we get the
// same classification as what landed in DB.
function deriveAccountType(label) {
  const s = String(label || "").toLowerCase()
  if (/^revenue\b|^sales\b|sale of|sales of/i.test(s)) return "revenue"
  if (/cost of goods|cost of services|raw materials|salaries|utilities|depreciation|other production|other servic|other service/i.test(s)) return "cogs"
  if (/sg&a|administrative|admin|marketing|interest expense|finance cost|other operat|other expens|tax expense|operating expense/i.test(s)) return "expense"
  if (/asset|inventory|cash|receivable|ppe|property/i.test(s)) return "asset"
  if (/liability|debt|payable/i.test(s)) return "liability"
  if (/equity|capital|retained/i.test(s)) return "equity"
  return "expense"
}

const prisma = new PrismaClient()

async function main() {
  const path = require("path")
  const file = path.resolve("/Users/rashadrahimov/Downloads/azmade budget/rev 9 - 2026 Budget - ATL.xlsx")
  const wb = XLSX.readFile(file, { cellFormula: false, cellHTML: false, cellDates: true })
  const sheet = wb.Sheets[SHEET]
  if (!sheet) throw new Error(`Sheet ${SHEET} not found`)
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false })

  const row1 = aoa[1] || []
  const row2 = aoa[2] || []
  const blocks = new Map()
  for (let c = 0; c < row1.length; c++) {
    const ec = String(row1[c] ?? "").trim()
    if (!(ec in ENTITY_MAP)) continue
    const v = row2[c]
    let monthIdx = null
    if (v instanceof Date) monthIdx = v.getUTCMonth()
    else if (typeof v === "number" && v > 44000 && v < 48000) {
      const d = new Date((v - 25569) * 86400 * 1000)
      monthIdx = d.getUTCMonth()
    } else continue
    if (!blocks.has(ec)) blocks.set(ec, [])
    blocks.get(ec).push({ month: monthIdx, col: c })
  }

  // Per entity aggregate
  const xlsxAggregate = {} // { entityCode: { revenue, cogs, expense } }
  for (const ec of Object.keys(ENTITY_MAP)) xlsxAggregate[ec] = { revenue: 0, cogs: 0, expense: 0 }
  for (let r = 3; r < aoa.length; r++) {
    const labelEn = String(aoa[r]?.[0] ?? "").trim()
    const labelAz = String(aoa[r]?.[1] ?? "").trim()
    if (!labelEn && !labelAz) continue
    // Mirror import-atl-detailed.cjs: classify by labelEn fallback labelAz.
    const at = deriveAccountType(labelEn || labelAz)
    if (!["revenue", "cogs", "expense"].includes(at)) continue
    for (const [ec, cols] of blocks) {
      for (const { col } of cols) {
        const v = aoa[r]?.[col]
        if (typeof v !== "number" || !Number.isFinite(v)) continue
        xlsxAggregate[ec][at] += v
      }
    }
  }

  // Per entity DB aggregate
  const codes = Object.values(ENTITY_MAP)
  const cos = await prisma.company.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } })
  console.log(`\n${"=".repeat(80)}`)
  console.log(`ATL DB ↔ Input PL verification (post-sign-flip)`)
  console.log(`${"=".repeat(80)}\n`)
  let allOk = true
  for (const [ec, dbCode] of Object.entries(ENTITY_MAP)) {
    const co = cos.find((c) => c.code === dbCode)
    if (!co) { console.log(`✗ ${dbCode} not found`); continue }
    const rows = await prisma.budgetLine.findMany({
      where: { companyId: co.id },
      select: { lineType: true, plannedAmount: true },
    })
    const db = { revenue: 0, cogs: 0, expense: 0 }
    for (const r of rows) if (r.lineType in db) db[r.lineType] += r.plannedAmount
    const x = xlsxAggregate[ec]
    const fmt = (n) => Math.round(n).toLocaleString()
    const ok = Math.abs(db.revenue - x.revenue) < 1 && Math.abs(db.cogs - x.cogs) < 1 && Math.abs(db.expense - x.expense) < 1
    if (!ok) allOk = false
    console.log(`${ok ? "✅" : "⚠️ "} ${dbCode}`)
    console.log(`   Input PL : rev=${fmt(x.revenue)} cogs=${fmt(x.cogs)} exp=${fmt(x.expense)}`)
    console.log(`   DB       : rev=${fmt(db.revenue)} cogs=${fmt(db.cogs)} exp=${fmt(db.expense)}`)
    if (!ok) {
      console.log(`   diff     : rev=${fmt(x.revenue - db.revenue)} cogs=${fmt(x.cogs - db.cogs)} exp=${fmt(x.expense - db.expense)}`)
    }
    console.log("")
  }
  console.log(`${"=".repeat(80)}`)
  console.log(allOk ? "✅ All ATL entities match Input PL source exactly" : "⚠️  Some ATL entities still differ from Input PL — real data drift")
  console.log(`${"=".repeat(80)}\n`)
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
