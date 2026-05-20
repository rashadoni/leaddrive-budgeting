/**
 * AzerSheker 2026 budget import from `Copy of Guvven Fin.xlsx`.
 *
 * The Workbook file differs from the original Consolidated file:
 *   - Sheet names are space-separated (`PLF CPC`, `PL Malt`) instead
 *     of underscore (`PLF_CPC`, `PL_MALT`).
 *   - Date headers cover multiple years (R1 has 24-60 monthly date
 *     serials, spanning e.g. 2022-2026 for CPC). The simple "first
 *     12 dates" header detector picks the EARLIEST year, not the
 *     budget year of interest.
 *   - R1 *is* the header row (not R2) for PLF sheets, but for CF/BS
 *     sheets it's R2.
 *   - Includes a new entity MALT not in the original file. AZSEKER-MALT
 *     was seeded with status='pending' last session; this import
 *     transitions it to active by populating data.
 *
 * What this script does:
 *   1. Open the Workbook xlsx
 *   2. For each AZSEKER child (CPC, AZSF, EDEN, MALT):
 *      - Parse PLF sheet → BudgetLine for year 2026 (12 months)
 *      - Parse CF sheet → CashFlowEntry for year 2026
 *   3. Use `Azərşəkər 2026 Budget` plan (created by prior session,
 *      reuse via findFirst).
 *   4. Delete-then-insert per-companyId so the script is idempotent.
 *   5. ChartOfAccount upsert with `${entityCode}-${plfCode}` prefix
 *      to avoid cross-entity overwrites.
 *   6. Transition AZSEKER-MALT status from 'pending' → 'active' to
 *      unblock the C.3 terminal gate.
 *   7. Print summary; user runs recompute separately.
 *
 * Run: `node scripts/import-azseker-workbook.cjs`
 * Idempotent: safe to re-run.
 */
const { PrismaClient } = require("@prisma/client")
const XLSX = require("xlsx")
const prisma = new PrismaClient()

// Phase 7.M Tier 3 (2026-05-19): switched to newer "Guvven Fin.xlsx" (May 19)
const FILE = "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx"
const ORG_SLUG = "azmade"
const TARGET_YEAR = 2026
const PLAN_NAME = "Azərşəkər 2026 Budget"

// 4 entities present in the Workbook file. HORIZON/FARM are not in this
// workbook — they retain whatever data the prior Consolidated import wrote.
const ENTITIES = [
  { code: "AZSEKER-CPC",  plSheet: "PLF CPC",  cfSheet: "CF CPC"  },
  { code: "AZSEKER-AZSF", plSheet: "PLF AZSF", cfSheet: "CF AZSF" },
  { code: "AZSEKER-EDEN", plSheet: "PLF EDEN", cfSheet: "CF EDEN" },
  { code: "AZSEKER-MALT", plSheet: "PL Malt",  cfSheet: "CF Malt" },
]

const LEAF_PLF = /^PLF\.\d{2}\.\d{2}\.\d{1,2}$/
const LEAF_CF  = /^CF\.\d{2}\.\d{2}\.\d{1,2}$/

// PLF prefix → account_type
function plfAccountType(code) {
  const m = code.match(/^PLF\.(\d{2})/)
  if (!m) return null
  const s = m[1]
  if (s === "01") return "revenue"
  if (s === "02") return "cogs"
  if (s === "10") return null // computed Net Profit, skip
  if (/^0[3-9]$/.test(s)) return "expense"
  return null
}

// CF prefix → activity_type
function cfActivity(code) {
  const m = code.match(/^CF\.(\d{2})/)
  if (!m) return null
  const s = m[1]
  return s === "01" ? "operating" : s === "02" ? "investing" : s === "03" ? "financing" : null
}

// CF prefix → inflow/outflow heuristic
function cfEntryType(code, perMonth) {
  const m = code.match(/^CF\.\d{2}\.(\d{2})\./)
  if (m) {
    if (m[1] === "01") return "inflow"
    if (m[1] === "02") return "outflow"
  }
  const sum = perMonth.reduce((a, b) => a + b, 0)
  return sum >= 0 ? "inflow" : "outflow"
}

/**
 * Year-aware header detection. Returns { row, monthCols: number[12] }
 * where monthCols[0]=Jan column index, monthCols[11]=Dec, all for the
 * target year. Returns null if 12 distinct months for that year aren't
 * found in any of the first 5 rows.
 */
function findYearHeaderRow(aoa, year) {
  for (let i = 0; i < Math.min(aoa.length, 5); i++) {
    const row = aoa[i] || []
    const monthCols = Array(12).fill(-1)
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (typeof v !== "number") continue
      if (v < 44000 || v > 48000) continue
      const d = new Date((v - 25569) * 86400 * 1000)
      if (d.getUTCFullYear() !== year) continue
      const month = d.getUTCMonth() // 0..11
      if (monthCols[month] === -1) monthCols[month] = c
    }
    if (monthCols.every((v) => v !== -1)) {
      // Sanity: monotonic ascending columns
      let mono = true
      for (let k = 1; k < 12; k++) if (monthCols[k] <= monthCols[k - 1]) { mono = false; break }
      if (mono) return { row: i, monthCols }
    }
  }
  return null
}

function parsePl(aoa, header) {
  const lines = []
  for (let r = header.row + 1; r < aoa.length; r++) {
    const row = aoa[r] || []
    const code = typeof row[0] === "string" ? row[0].trim() : ""
    if (!LEAF_PLF.test(code)) continue
    const acc = plfAccountType(code)
    if (!acc) continue
    const label = typeof row[1] === "string" ? row[1].trim() : code
    const perMonth = []
    let total = 0, allZero = true
    // CXLIX sign normalization (same as azseker-plf.ts adapter): cogs/expense
    // in source xlsx are NEGATIVE; risk resolvers expect positive magnitudes.
    const normalizeSign = acc === "cogs" || acc === "expense"
    for (let m = 0; m < 12; m++) {
      const v = row[header.monthCols[m]]
      const raw = typeof v === "number" ? v : 0
      const num = normalizeSign ? Math.abs(raw) : raw
      perMonth.push(num)
      total += num
      if (num !== 0) allZero = false
    }
    if (allZero) continue
    lines.push({ code, label, accountType: acc, perMonth, totalAnnual: total })
  }
  return lines
}

function parseCf(aoa, header) {
  const entries = []
  for (let r = header.row + 1; r < aoa.length; r++) {
    const row = aoa[r] || []
    const code = typeof row[0] === "string" ? row[0].trim() : ""
    if (!LEAF_CF.test(code)) continue
    const act = cfActivity(code)
    if (!act) continue
    const label = typeof row[1] === "string" ? row[1].trim() : code
    const perMonthRaw = []
    let allZero = true
    for (let m = 0; m < 12; m++) {
      const v = row[header.monthCols[m]]
      const n = typeof v === "number" ? v : 0
      perMonthRaw.push(n)
      if (n !== 0) allZero = false
    }
    if (allZero) continue
    const entry = cfEntryType(code, perMonthRaw)
    entries.push({ code, label, activityType: act, entryType: entry, perMonth: perMonthRaw.map((n) => Math.abs(n)) })
  }
  return entries
}

async function main() {
  console.log("\n=== AzerSheker (Workbook Fin) import — year " + TARGET_YEAR + " ===\n")

  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG }, select: { id: true, name: true } })
  if (!org) throw new Error(`Org "${ORG_SLUG}" not found`)
  console.log(`Org: ${org.name} (id=${org.id})`)

  const wb = XLSX.readFile(FILE, { cellFormula: false, cellHTML: false, cellDates: false })

  // Fetch all AZSEKER entity rows in one query
  const companies = await prisma.company.findMany({
    where: { organizationId: org.id, code: { in: ENTITIES.map((e) => e.code) } },
    select: { id: true, code: true, name: true, status: true },
  })
  const byCode = new Map(companies.map((c) => [c.code, c]))
  for (const ent of ENTITIES) {
    if (!byCode.has(ent.code)) throw new Error(`Company ${ent.code} not in DB — seed first`)
  }
  console.log("Companies resolved: " + companies.map((c) => `${c.code}(status=${c.status})`).join(", "))

  // Find or create plan
  let plan = await prisma.budgetPlan.findFirst({
    where: { organizationId: org.id, year: TARGET_YEAR, name: PLAN_NAME, deletedAt: null },
    select: { id: true },
  })
  if (!plan) {
    plan = await prisma.budgetPlan.create({
      data: {
        organizationId: org.id, year: TARGET_YEAR, name: PLAN_NAME,
        periodType: "annual", status: "draft",
      },
      select: { id: true },
    })
    console.log(`✓ Plan created: "${PLAN_NAME}" (id=${plan.id})`)
  } else {
    console.log(`↪ Plan exists: "${PLAN_NAME}" (id=${plan.id})`)
  }

  let totalPlLines = 0, totalCfEntries = 0
  const perEntitySummary = []

  for (const ent of ENTITIES) {
    const company = byCode.get(ent.code)
    console.log(`\n→ ${ent.code} (${company.name})`)
    const sum = { code: ent.code, plLeaves: 0, plRows: 0, cfEntries: 0, cfNonZero: 0 }

    // ── P&L ────────────────────────────────────────────────────────
    if (wb.Sheets[ent.plSheet]) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[ent.plSheet], { header: 1, raw: true, blankrows: false })
      const header = findYearHeaderRow(aoa, TARGET_YEAR)
      if (!header) {
        console.log(`  ⚠ ${ent.plSheet}: no ${TARGET_YEAR} header row — skipping P&L`)
      } else {
        const lines = parsePl(aoa, header)
        const coaCache = new Map()
        await prisma.$transaction(async (tx) => {
          await tx.budgetLine.deleteMany({ where: { planId: plan.id, companyId: company.id } })
          const rows = []
          for (const line of lines) {
            const codeKey = `${ent.code}-${line.code}`
            let coaId = coaCache.get(codeKey)
            if (!coaId) {
              const existing = await tx.chartOfAccount.findUnique({
                where: { organizationId_code: { organizationId: org.id, code: codeKey } },
                select: { id: true },
              })
              if (existing) coaId = existing.id
              else {
                const created = await tx.chartOfAccount.create({
                  data: {
                    organizationId: org.id, code: codeKey, name: line.label, nameEn: line.label,
                    accountType: line.accountType, sortOrder: 0, isActive: true,
                  },
                  select: { id: true },
                })
                coaId = created.id
              }
              coaCache.set(codeKey, coaId)
            }
            for (let m = 0; m < 12; m++) {
              rows.push({
                organizationId: org.id, planId: plan.id, companyId: company.id,
                accountId: coaId, category: codeKey, department: null,
                lineType: line.accountType,
                plannedAmount: line.perMonth[m],
                sortOrder: m, monthIndex: m,
                isAutoPlanned: false, isAutoActual: false,
              })
            }
          }
          if (rows.length > 0) await tx.budgetLine.createMany({ data: rows })
        })
        sum.plLeaves = lines.length
        sum.plRows = lines.length * 12
        totalPlLines += sum.plRows
        console.log(`  ✓ P&L: ${lines.length} leaves × 12 mo = ${sum.plRows} BudgetLine rows  ` +
          `[header R${header.row + 1}, cols ${header.monthCols.join(",")}]`)
      }
    } else {
      console.log(`  ⚠ P&L sheet "${ent.plSheet}" not in workbook`)
    }

    // ── Cash Flow ──────────────────────────────────────────────────
    if (wb.Sheets[ent.cfSheet]) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[ent.cfSheet], { header: 1, raw: true, blankrows: false })
      const header = findYearHeaderRow(aoa, TARGET_YEAR)
      if (!header) {
        console.log(`  ⚠ ${ent.cfSheet}: no ${TARGET_YEAR} header row — skipping CF`)
      } else {
        const entries = parseCf(aoa, header)
        const sourceIdPrefix = `${company.id}:`
        await prisma.$transaction(async (tx) => {
          await tx.cashFlowEntry.deleteMany({
            where: { organizationId: org.id, year: TARGET_YEAR, source: "xlsx_import",
                     sourceId: { startsWith: sourceIdPrefix } },
          })
          const rows = []
          for (const e of entries) {
            for (let m = 0; m < 12; m++) {
              const amount = e.perMonth[m]
              if (amount === 0) continue
              rows.push({
                organizationId: org.id, year: TARGET_YEAR, month: m + 1,
                entryType: e.entryType, source: "xlsx_import",
                sourceId: `${sourceIdPrefix}${e.code}:${m + 1}`,
                amount, currencyCode: "AZN",
                description: `${ent.code}: ${e.label}`,
                activityType: e.activityType, category: `${ent.code}: ${e.label}`,
                isProjected: true,
              })
            }
          }
          if (rows.length > 0) await tx.cashFlowEntry.createMany({ data: rows })
        })
        let nonZeroCount = 0
        for (const e of entries) for (const v of e.perMonth) if (v !== 0) nonZeroCount++
        sum.cfEntries = entries.length
        sum.cfNonZero = nonZeroCount
        totalCfEntries += nonZeroCount
        console.log(`  ✓ CF:  ${entries.length} leaves → ${nonZeroCount} non-zero monthly entries`)
      }
    } else {
      console.log(`  ⚠ CF sheet "${ent.cfSheet}" not in workbook`)
    }

    perEntitySummary.push(sum)
  }

  // ── Transition AZSEKER-MALT pending → active ──────────────────────
  const malt = byCode.get("AZSEKER-MALT")
  if (malt && malt.status === "pending") {
    const maltLines = perEntitySummary.find((s) => s.code === "AZSEKER-MALT")
    if (maltLines && maltLines.plRows > 0) {
      await prisma.company.update({ where: { id: malt.id }, data: { status: "active" } })
      console.log(`\n✓ AZSEKER-MALT status: pending → active (now has ${maltLines.plRows} P&L rows)`)
    } else {
      console.log(`\n↪ AZSEKER-MALT kept status=pending (no P&L data imported)`)
    }
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log(`\n=== SUMMARY ===`)
  console.log(`${'Entity'.padEnd(16)} ${'PL leaves'.padStart(10)} ${'PL rows'.padStart(8)} ${'CF leaves'.padStart(10)} ${'CF nz'.padStart(8)}`)
  for (const s of perEntitySummary) {
    console.log(`${s.code.padEnd(16)} ${String(s.plLeaves).padStart(10)} ${String(s.plRows).padStart(8)} ${String(s.cfEntries).padStart(10)} ${String(s.cfNonZero).padStart(8)}`)
  }
  console.log(`\nTotal: ${totalPlLines} BudgetLine rows + ${totalCfEntries} CashFlowEntry rows`)
  console.log(`\nNext step: trigger recompute for AZSEKER companies + parent rollup.`)
  console.log(`   curl -X POST http://localhost:3000/api/indicators -H "Content-Type: application/json" \\`)
  console.log(`     -d '{"period":"2026"}'  # requires auth cookie`)
  console.log(`Or run inside Node via internal helper.`)

  await prisma.$disconnect()
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1) })
