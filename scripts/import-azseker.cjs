/**
 * Phase 7.G CXLV — restructure org + import Azərşəkər from Consolidated
 * file. CommonJS so node runs it directly.
 *
 * Steps:
 * 1. Rename org "AZMADE Group MMC" → "FO Holding"
 * 2. Create level=1 sub-group AZSEKER (name="Azərşəkər")
 * 3. Create 5 level=2 children: EDEN, AZSF, HORIZON, Farm, CPC
 *    (mapped to industries: agro_crops / food_processing / services)
 * 4. Parse + import P&L (PL_X / PLF_X) → BudgetLine
 *    Parse + import CF (CF_X) → CashFlowEntry (source=xlsx_import)
 * 5. accountCode prefix per company per CXXXVIII fix prevents cross-job
 *    overwrite (e.g. PLF-EDEN-PLF.01.01.01).
 *
 * Run: `node scripts/import-azseker.cjs`
 *
 * Idempotent: safe to re-run. Existing companies + plans upserted; per-
 * company BS/CF rows re-created (delete-then-insert per-company prefix).
 */
const { PrismaClient } = require("@prisma/client")
const XLSX = require("xlsx")
const prisma = new PrismaClient()

const FILE = "/Users/rashadrahimov/Downloads/azmade budget/Consolidated budget 2026_AHMAD_NEW.xlsx"
const ORG_SLUG = "azmade" // keep slug for backward compat; rename only display name

// 5 entities with mapping
const ENTITIES = [
  { code: "AZSEKER-EDEN",    name: "Eden Agro",     industry: "agro_crops",     plSheet: "PL_EDEN",  cfSheet: "CF_EDEN" },
  { code: "AZSEKER-AZSF",    name: "Azərşəkər Sugar", industry: "food_processing", plSheet: "PLF_AZSF", cfSheet: "CF_AZSF" },
  { code: "AZSEKER-HORIZON", name: "Horizon",       industry: "services",       plSheet: null,       cfSheet: "CF_HORIZON" },
  { code: "AZSEKER-FARM",    name: "Farm",          industry: "agro_crops",     plSheet: "PLF_Farm", cfSheet: "CF_Farm" },
  { code: "AZSEKER-CPC",     name: "CPC",           industry: "food_processing", plSheet: "PLF_CPC",  cfSheet: "CF_CPC" },
]

const LEAF_RE = /^(PLF|CF)\.\d{2}\.\d{2}\.\d{1,2}$/

function findHeaderRow(aoa) {
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const row = aoa[i] || []
    let cols = []
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      let date
      if (v instanceof Date) date = v
      else if (typeof v === "number" && v > 44000 && v < 48000) date = new Date((v - 25569) * 86400 * 1000)
      else continue
      if (isNaN(date.getTime())) continue
      const y = date.getUTCFullYear()
      if (y < 2020 || y > 2031) continue
      cols.push(c)
    }
    if (cols.length >= 12) return { row: i, monthCols: cols.slice(0, 12) }
  }
  return null
}

function plfAccountType(code) {
  const m = code.match(/^PLF\.(\d{2})/)
  if (!m) return null
  const s = m[1]
  if (s === "01") return "revenue"
  if (s === "02") return "cogs"
  if (s === "10") return null
  if (/^0[3-9]$/.test(s)) return "expense"
  return null
}

function cfActivity(code) {
  const m = code.match(/^CF\.(\d{2})/)
  if (!m) return null
  const s = m[1]
  return s === "01" ? "operating" : s === "02" ? "investing" : s === "03" ? "financing" : null
}

function cfEntryType(code, perMonth) {
  const m = code.match(/^CF\.\d{2}\.(\d{2})\./)
  if (m) {
    if (m[1] === "01") return "inflow"
    if (m[1] === "02") return "outflow"
  }
  const sum = perMonth.reduce((a, b) => a + b, 0)
  return sum >= 0 ? "inflow" : "outflow"
}

function parsePl(aoa, header) {
  const lines = []
  for (let r = header.row + 1; r < aoa.length; r++) {
    const row = aoa[r] || []
    const code = typeof row[0] === "string" ? row[0].trim() : ""
    if (!LEAF_RE.test(code)) continue
    const acc = plfAccountType(code)
    if (!acc) continue
    const label = typeof row[1] === "string" ? row[1].trim() : code
    const perMonth = []
    let total = 0, allZero = true
    for (let m = 0; m < 12; m++) {
      const v = row[header.monthCols[m]]
      const n = typeof v === "number" ? v : 0
      perMonth.push(n)
      total += n
      if (n !== 0) allZero = false
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
    if (!LEAF_RE.test(code)) continue
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
  console.log("\n=== Azərşəkər import — Phase 7.G CXLV ===\n")

  // Step 1: Rename org
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG }, select: { id: true, name: true } })
  if (!org) throw new Error(`Org "${ORG_SLUG}" not found`)
  if (org.name !== "FO Holding") {
    await prisma.organization.update({ where: { id: org.id }, data: { name: "FO Holding" } })
    console.log(`✓ Org renamed: "${org.name}" → "FO Holding"`)
  } else {
    console.log(`↪ Org already named "FO Holding"`)
  }

  // Step 2: Create AZSEKER level=1 sub-group
  const azsekerCompany = await prisma.company.upsert({
    where: { organizationId_code: { organizationId: org.id, code: "AZSEKER" } },
    create: {
      organizationId: org.id, code: "AZSEKER", name: "Azərşəkər",
      level: 1, role: "operational", country: "AZ", baseCurrencyCode: "AZN",
      sortOrder: 700, // after AAC/ATL/SPARK/ZTP/LLS (100-600)
    },
    update: { name: "Azərşəkər" },
  })
  console.log(`✓ Sub-group: ${azsekerCompany.code} (id=${azsekerCompany.id})`)

  // Step 3: Create 5 level=2 children + load workbook
  const wb = XLSX.readFile(FILE, { cellFormula: false, cellHTML: false, cellDates: true })

  const children = []
  for (let i = 0; i < ENTITIES.length; i++) {
    const ent = ENTITIES[i]
    const child = await prisma.company.upsert({
      where: { organizationId_code: { organizationId: org.id, code: ent.code } },
      create: {
        organizationId: org.id, code: ent.code, name: ent.name,
        level: 2, role: "operational", country: "AZ", baseCurrencyCode: "AZN",
        industry: ent.industry, parentCompanyId: azsekerCompany.id,
        sortOrder: 700 + (i + 1) * 10,
      },
      update: { name: ent.name, industry: ent.industry, parentCompanyId: azsekerCompany.id },
    })
    children.push({ ...ent, id: child.id })
    console.log(`  ✓ Child: ${ent.code} (${ent.industry})`)
  }

  // Step 4: Find or create plan "Azərşəkər 2026 Budget" — separate from AZMADE plan
  // Reuse the AZMADE 2026 plan if both holdings share fiscal year, else separate
  let plan = await prisma.budgetPlan.findFirst({
    where: { organizationId: org.id, year: 2026, name: "Azərşəkər 2026 Budget", deletedAt: null },
    select: { id: true },
  })
  if (!plan) {
    plan = await prisma.budgetPlan.create({
      data: {
        organizationId: org.id, year: 2026, name: "Azərşəkər 2026 Budget",
        periodType: "annual", status: "draft",
      },
      select: { id: true },
    })
    console.log(`\n✓ Plan created: "Azərşəkər 2026 Budget" (id=${plan.id})`)
  } else {
    console.log(`\n↪ Plan exists: "Azərşəkər 2026 Budget"`)
  }

  // Step 5: Import P&L + CF for each entity
  let totalPlLines = 0, totalCfEntries = 0
  for (const ent of children) {
    console.log(`\n→ ${ent.code} (${ent.name})`)

    // P&L
    if (ent.plSheet && wb.Sheets[ent.plSheet]) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[ent.plSheet], { header: 1, raw: true, blankrows: false })
      const header = findHeaderRow(aoa)
      if (!header) {
        console.log(`  ⚠ ${ent.plSheet}: no header — skipping P&L`)
      } else {
        const lines = parsePl(aoa, header)
        // Ensure CoA + insert BudgetLine per (line × month) per CompanyId
        const coaCache = new Map()
        await prisma.$transaction(async (tx) => {
          await tx.budgetLine.deleteMany({ where: { planId: plan.id, companyId: ent.id } })
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
                organizationId: org.id, planId: plan.id, companyId: ent.id,
                accountId: coaId,
                category: codeKey, // keeps PLF code as legacy text column
                department: null,
                lineType: line.accountType,
                plannedAmount: line.perMonth[m],
                sortOrder: m, monthIndex: m,
                isAutoPlanned: false, isAutoActual: false,
                currencyCode: "AZN",
              })
            }
          }
          if (rows.length > 0) await tx.budgetLine.createMany({ data: rows })
          return rows.length
        })
        const insertedRows = lines.length * 12
        totalPlLines += insertedRows
        console.log(`  ✓ P&L: ${lines.length} leaves × 12 = ${insertedRows} BudgetLine rows`)
      }
    }

    // Cash Flow
    if (ent.cfSheet && wb.Sheets[ent.cfSheet]) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[ent.cfSheet], { header: 1, raw: true, blankrows: false })
      const header = findHeaderRow(aoa)
      if (!header) {
        console.log(`  ⚠ ${ent.cfSheet}: no header — skipping CF`)
      } else {
        const entries = parseCf(aoa, header)
        const sourceIdPrefix = `${ent.id}:`
        await prisma.$transaction(async (tx) => {
          await tx.cashFlowEntry.deleteMany({
            where: { organizationId: org.id, year: 2026, source: "xlsx_import", sourceId: { startsWith: sourceIdPrefix } },
          })
          const rows = []
          for (const e of entries) {
            for (let m = 0; m < 12; m++) {
              const amount = e.perMonth[m]
              if (amount === 0) continue
              rows.push({
                organizationId: org.id, year: 2026, month: m + 1,
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
        totalCfEntries += nonZeroCount
        console.log(`  ✓ CF:  ${entries.length} leaves → ${nonZeroCount} non-zero monthly entries`)
      }
    }
  }

  console.log(`\n=== DONE ===`)
  console.log(`Total: ${totalPlLines} BudgetLine rows + ${totalCfEntries} CashFlowEntry rows for Azərşəkər`)
  console.log(`Org: "FO Holding" (slug=azmade)`)
  console.log(`Companies: AAC + ATL+4 + SPARK + ZTP + LLS + AZSEKER+5 = 13 + 6 = 19`)
  console.log(`Next: trigger recompute → POST /api/indicators with body {"period":"2026"}`)

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
