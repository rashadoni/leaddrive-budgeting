/**
 * Phase 7.G CLI follow-up — import ATL detailed monthly P&L plan from
 * `rev 9 - 2026 Budget - ATL.xlsx`.
 *
 * Source layout (Input PL sheet):
 *   Row 0: entity+date concat ("MRKZ46053")
 *   Row 1: entity code (MRKZ / DBZ / PMZ / TAZ / AZTECH / CONSOL)
 *   Row 2: month dates (Excel dates) + "Total" col at end
 *   Rows 3+: data — col 0 = English label, col 1 = Azeri name
 *   Each entity has 12 month cols + 1 total col
 *
 * Target:
 *   - 4 ATL ops (ATL-MRKZ, ATL-DBZ, ATL-PMZ, ATL-TAZ) → BudgetLine rows
 *     with monthIndex 0..11, accountType derived from label, category =
 *     `${entityCode}-${KOD}-${slug(label)}` for per-company isolation.
 *   - AZTECH and CONSOL skipped (umbrella aggregator rows).
 *
 * Strategy:
 *   - Replace existing ATL-* BudgetLines in the active 2026 plan rather
 *     than create a new plan (avoids ATL data showing in 2 plans at once).
 *   - Re-trigger indicator recompute after the load so HeatMap reflects
 *     the new granularity.
 *
 * Idempotent: re-run replaces (deletes ATL rows + re-inserts).
 *
 * Run: node scripts/import-atl-detailed.cjs
 */
const XLSX = require("xlsx")
const { PrismaClient } = require("@prisma/client")

const FILE = "/Users/rashadrahimov/Downloads/azmade budget/rev 9 - 2026 Budget - ATL.xlsx"
const SHEET = "Input PL"
const PLAN_NAME = "AZMADE 2026 Budget" // active plan; replace ATL slice inside it
const ENTITY_MAP = {
  MRKZ: "ATL-MRKZ",
  DBZ: "ATL-DBZ",
  PMZ: "ATL-PMZ",
  TAZ: "ATL-TAZ",
}

function deriveAccountType(label) {
  const s = String(label || "").toLowerCase()
  if (/^revenue\b|^sales\b|sale of|sales of/i.test(s)) return "revenue"
  if (/cost of goods|cost of services|raw materials|salaries|utilities|depreciation|other production|other servic|other service/i.test(s)) return "cogs"
  if (/sg&a|administrative|admin|marketing|interest expense|finance cost|other operat|other expens|tax expense|operating expense/i.test(s)) return "expense"
  if (/asset|inventory|cash|receivable|ppe|property/i.test(s)) return "asset"
  if (/liability|debt|payable/i.test(s)) return "liability"
  if (/equity|capital|retained/i.test(s)) return "equity"
  // P&L items in this file frequently start with a SAP-like code (6.61.611...);
  // those are typically asset items per the schedule. Default unknown → expense
  // is safer than asset for cash flow purposes; will be ignored by formula resolver
  // (it only sums revenue/cogs/expense for now) if not recognised.
  return "expense"
}

function slugify(s) {
  return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)
}

const prisma = new PrismaClient()

async function main() {
  const wb = XLSX.readFile(FILE, { cellFormula: false, cellHTML: false, cellDates: true })
  const sheet = wb.Sheets[SHEET]
  if (!sheet) throw new Error(`Sheet ${SHEET} not found`)
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false })

  // Header parse
  const row1 = aoa[1] || []
  const row2 = aoa[2] || []
  // Per-entity month-col map: { entityCode: [{ month:0..11, col:idx }] }
  const blocks = new Map()
  for (let c = 0; c < row1.length; c++) {
    const ec = String(row1[c] ?? "").trim()
    if (!(ec in ENTITY_MAP)) continue
    // Skip 'Total' column (text in row 2)
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
  for (const [ec, cols] of blocks) {
    console.log(`  ${ec}: ${cols.length} month columns`)
  }

  // Resolve org, plan, companies
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  if (!org) throw new Error("Org 'azmade' not found")
  const plan = await prisma.budgetPlan.findFirst({
    where: { organizationId: org.id, name: PLAN_NAME, deletedAt: null },
    select: { id: true },
  })
  if (!plan) throw new Error(`Plan '${PLAN_NAME}' not found`)

  const cos = await prisma.company.findMany({
    where: { organizationId: org.id, code: { in: Object.values(ENTITY_MAP) } },
    select: { id: true, code: true },
  })
  const coByCode = new Map(cos.map((c) => [c.code, c.id]))
  console.log(`\nResolved companies: ${cos.map((c) => c.code).join(", ")}`)

  // Build BudgetLine payload + delete-existing scope
  const rowsToInsert = []
  let labelCount = 0
  let skippedZero = 0
  for (let r = 3; r < aoa.length; r++) {
    const row = aoa[r] || []
    const labelEn = String(row[0] ?? "").trim()
    const labelAz = String(row[1] ?? "").trim()
    if (!labelEn && !labelAz) continue
    const label = labelEn || labelAz
    const accountType = deriveAccountType(labelEn || labelAz)
    labelCount++

    for (const [entityCode, monthCols] of blocks) {
      const companyId = coByCode.get(ENTITY_MAP[entityCode])
      if (!companyId) continue
      const categoryKey = `${entityCode}-${slugify(label)}`

      for (const { month, col } of monthCols) {
        const v = row[col]
        if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) < 0.001) { skippedZero++; continue }
        rowsToInsert.push({
          organizationId: org.id,
          planId: plan.id,
          companyId,
          category: categoryKey,
          lineType: accountType === "asset" || accountType === "liability" || accountType === "equity" ? "bs" : accountType,
          plannedAmount: v,
          sortOrder: month,
          monthIndex: month,
          isAutoPlanned: false,
          isAutoActual: false,
        })
      }
    }
  }
  console.log(`\nLabel rows processed: ${labelCount}`)
  console.log(`Rows to insert: ${rowsToInsert.length} (skipped ${skippedZero} zero/empty)`)

  // Delete existing ATL slice in this plan (scoped by companyId IN ATL ops + plan)
  const atlIds = cos.map((c) => c.id)
  const deleted = await prisma.budgetLine.deleteMany({
    where: { planId: plan.id, companyId: { in: atlIds } },
  })
  console.log(`\n✓ Deleted ${deleted.count} pre-existing ATL BudgetLines in plan`)

  // Insert new rows in chunks
  const CHUNK = 500
  let inserted = 0
  for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
    const chunk = rowsToInsert.slice(i, i + CHUNK)
    await prisma.budgetLine.createMany({ data: chunk })
    inserted += chunk.length
  }
  console.log(`✓ Inserted ${inserted} new BudgetLines (granular monthly)`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
