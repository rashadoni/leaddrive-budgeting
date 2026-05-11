/**
 * Phase 7.G CLI Tier 2 #8 — import AAC umbrella Balance Sheet from
 * `2026 Budget - AAC.xlsx` sheet "BS".
 *
 * Source layout:
 *   Row 0: header banner ("BUDCƏ 2026")
 *   Row 1: month dates 2024-12 baseline + 2026-01..2026-12 + Total
 *   Rows 2+: data — col 0 = account code (10/101/11/111/...), col 1 =
 *            Azerbaijani name, col 2 = Dec 2024 baseline, col 4-15 =
 *            2026 monthly values.
 *
 * Account-code → lineType classifier (Azerbaijani CoA convention):
 *   1xx → asset (long-term: PPE, intangibles)
 *   2xx → asset (current: inventory, receivables, cash)
 *   3xx → equity
 *   4xx → liability (long-term)
 *   5xx → liability (current)
 *
 * Target: BalanceSheetLine rows tied to AAC company under the active
 * 2026 plan. Idempotent: replaces AAC BS rows in that plan on re-run.
 *
 * Run: node scripts/import-aac-bs.cjs
 */
const XLSX = require("xlsx")
const { PrismaClient } = require("@prisma/client")

const FILE = "/Users/rashadrahimov/Downloads/azmade budget/2026 Budget - AAC.xlsx"
const SHEET = "BS"
const PLAN_NAME = "AZMADE 2026 Budget"
const TARGET_COMPANY_CODE = "AAC" // umbrella (level=1)

function classifyByCode(code) {
  const s = String(code || "").trim()
  if (!s || !/^\d/.test(s)) return null
  const firstDigit = s[0]
  if (firstDigit === "1") return { lineType: "asset", subType: "fixed_asset" }
  if (firstDigit === "2") return { lineType: "asset", subType: "current_asset" }
  if (firstDigit === "3") return { lineType: "equity", subType: null }
  if (firstDigit === "4") return { lineType: "liability", subType: "long_term" }
  if (firstDigit === "5") return { lineType: "liability", subType: "current_liability" }
  return null
}

const prisma = new PrismaClient()

async function main() {
  const wb = XLSX.readFile(FILE, { cellFormula: false, cellHTML: false, cellDates: true })
  const sheet = wb.Sheets[SHEET]
  if (!sheet) throw new Error(`Sheet ${SHEET} not found`)
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, blankrows: false })

  // Find header row (row 1 = the date row)
  const headerRow = aoa[1] || []
  const monthCols = []
  for (let c = 0; c < headerRow.length; c++) {
    const v = headerRow[c]
    let d
    if (v instanceof Date) d = v
    else if (typeof v === "number" && v > 44000 && v < 48000) {
      d = new Date((v - 25569) * 86400 * 1000)
    } else continue
    if (!d || isNaN(d.getTime())) continue
    const year = d.getUTCFullYear()
    const month = d.getUTCMonth() + 1
    if (year === 2026 && month >= 1 && month <= 12) {
      monthCols.push({ col: c, year, month })
    }
  }
  console.log(`Detected ${monthCols.length} month columns (2026):`)
  for (const mc of monthCols) console.log(`  col ${mc.col} → ${mc.year}-${String(mc.month).padStart(2, "0")}`)

  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  if (!org) throw new Error("Org 'azmade' not found")
  const plan = await prisma.budgetPlan.findFirst({
    where: { organizationId: org.id, name: PLAN_NAME, deletedAt: null },
    select: { id: true },
  })
  if (!plan) throw new Error(`Plan '${PLAN_NAME}' not found`)

  // BalanceSheetLine table is plan-scoped (no companyId column). Encode AAC
  // identifier in `accountCode` prefix so per-company isolation + future
  // multi-company import doesn't clobber.
  const PREFIX = `BS-${TARGET_COMPANY_CODE}-`

  // Delete existing AAC BS slice in this plan (idempotent re-run)
  const deleted = await prisma.balanceSheetLine.deleteMany({
    where: { organizationId: org.id, planId: plan.id, accountCode: { startsWith: PREFIX } },
  })
  console.log(`\n✓ Deleted ${deleted.count} pre-existing AAC BS lines`)

  // Parse data rows
  const rowsToInsert = []
  let skipped = 0
  for (let r = 2; r < aoa.length; r++) {
    const row = aoa[r] || []
    const code = String(row[0] ?? "").trim()
    const name = String(row[1] ?? "").trim()
    if (!code || !name) { skipped++; continue }
    const classified = classifyByCode(code)
    if (!classified) { skipped++; continue }

    for (const { col, year, month } of monthCols) {
      const v = row[col]
      if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) < 0.001) continue
      rowsToInsert.push({
        organizationId: org.id,
        planId: plan.id,
        accountCode: `${PREFIX}${code}`,
        accountName: name,
        lineType: classified.lineType,
        subType: classified.subType,
        year,
        month,
        amount: v,
      })
    }
  }
  console.log(`\nRows to insert: ${rowsToInsert.length} (skipped ${skipped} non-classifiable)`)

  // Insert in chunks of 500
  const CHUNK = 500
  let inserted = 0
  for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
    const chunk = rowsToInsert.slice(i, i + CHUNK)
    await prisma.balanceSheetLine.createMany({ data: chunk })
    inserted += chunk.length
  }
  console.log(`\n✓ Inserted ${inserted} BalanceSheetLine rows for AAC umbrella`)

  // Per-type summary
  const summary = await prisma.balanceSheetLine.groupBy({
    by: ["lineType"],
    where: { organizationId: org.id, planId: plan.id, accountCode: { startsWith: PREFIX } },
    _count: { _all: true },
    _sum: { amount: true },
  })
  console.log(`\nPer-type summary:`)
  for (const r of summary) {
    console.log(`  ${r.lineType.padEnd(10)} ${r._count._all} rows  sum=${(r._sum.amount / 1e6).toFixed(1)}M ₼`)
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
