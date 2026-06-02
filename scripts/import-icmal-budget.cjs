/**
 * Load the İcmal 2026 PLAN (Farming strategy - Guvven.xlsx) into the
 * "Azərşəkər 2026 Budget" plan (kind=budget) as BudgetLines.
 *
 * Decisions (user 2026-06-02):
 *   • Annual İcmal figure ÷ 12 → equal monthly BudgetLines.
 *   • Revenue + COGS by product → child company; sugar beet → AZSF
 *     (AZSF sells only beet), other crops → EDEN, glucose/fructose/
 *     starch/lab/by-product → CPC, beer raw → MALT.
 *   • Overhead (Logistics/S&M/OPEX) + investment subsidy → split
 *     pro-rata by product-revenue across the revenue children (the
 *     holding-rollup view only matches LEAF children, so holding-level
 *     lines never display).
 *   • Subsidies INCLUDED as other income (lineType revenue): farming +
 *     product subsidy → EDEN; investment subsidy → pro-rata.
 *   • Sign: revenue positive; COGS/expense as POSITIVE magnitude (matches
 *     the actuals-plan convention so execution % compares like-for-like).
 *
 * DEFAULT = dry-run. Pass --apply to write. --with-subsidies includes them.
 */
const XLSX = require("xlsx")
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const APPLY = process.argv.includes("--apply")
const WITH_SUBS = process.argv.includes("--with-subsidies")
const FILE = "/Users/rashadrahimov/Documents/budget azersheker/Farming strategy - Guvven.xlsx"
const YEAR = 2026
const SOURCE_DOC = "icmal:Farming strategy - Guvven.xlsx#İcmal"

// İcmal group (col1) → operating lineType
const GROUP_MAP = {
  Revenue: "revenue",
  COGS: "cogs",
  Logistics: "expense",
  "S&M": "expense",
  OPEX: "expense",
}
// Subsidies → other income (lineType revenue), only when --with-subsidies.
const SUBSIDY_GROUPS = {
  "Subsidy - Farming": "AZSEKER-EDEN",
  "Subsidy - Product": "AZSEKER-EDEN",
  "Subsidies - Investment": "AZSEKER", // → pro-rata
}
// Below-EBITDA (never loaded into the operating budget).
const BELOW_EBITDA = new Set([
  "Other expenses",
  "Shareholders' expense",
  "Interest income",
  "Interest expense",
  "Depreciation",
  "Profit tax",
])
const PRODUCT_COMPANY = {
  Buğda: "AZSEKER-EDEN",
  "Şəkər çuğunduru": "AZSEKER-AZSF", // AZSF sells ONLY beet (user)
  Qarğıdalı: "AZSEKER-EDEN",
  Pambıq: "AZSEKER-EDEN",
  Arpa: "AZSEKER-EDEN",
  "Sair məhsullar": "AZSEKER-EDEN",
  "Torpaq icarəsi": "AZSEKER-EDEN",
  Qlukoza: "AZSEKER-CPC",
  Fruktoza: "AZSEKER-CPC",
  Nişasta: "AZSEKER-CPC",
  "Laboratoriya xidmətləri": "AZSEKER-CPC",
  "Yan məhsul": "AZSEKER-CPC",
  Tekstil: "AZSEKER-CPC",
  "Pivə xammalı": "AZSEKER-MALT",
}
const HOLDING = "AZSEKER" // pro-rata sentinel

const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40)

function parseIcmal() {
  const wb = XLSX.readFile(FILE)
  const ws = wb.Sheets["İcmal"]
  const R = XLSX.utils.decode_range(ws["!ref"])
  const cell = (r, c) => {
    const x = ws[XLSX.utils.encode_cell({ r, c })]
    return x ? x.v : null
  }
  const raw = []
  const excluded = []
  for (let r = R.s.r; r <= R.e.r; r++) {
    const g = cell(r, 1) == null ? "" : String(cell(r, 1)).trim()
    const l = cell(r, 2) == null ? "" : String(cell(r, 2)).trim()
    const v = cell(r, 3)
    if (!g || g === "Group") continue // blank group = subtotal; "Group" = total row
    if (typeof v !== "number" || v === 0) continue
    if (GROUP_MAP[g]) {
      raw.push({
        group: g,
        label: l,
        lineType: GROUP_MAP[g],
        annual: Math.abs(v),
        companyCode: PRODUCT_COMPANY[l] ?? HOLDING,
        coaCode: `ICMAL.${g.toUpperCase().replace(/[^A-Z0-9]+/g, "")}.${slug(l)}`,
      })
    } else if (SUBSIDY_GROUPS[g] && WITH_SUBS) {
      raw.push({
        group: g,
        label: l,
        lineType: "revenue", // other income
        annual: Math.abs(v),
        companyCode: SUBSIDY_GROUPS[g],
        coaCode: `ICMAL.SUBSIDY.${slug(l)}`,
        isSubsidy: true,
      })
    } else {
      excluded.push({ group: g, label: l, amount: v })
    }
  }
  return { raw, excluded }
}

function allocate(raw) {
  // pro-rata base = PRODUCT revenue (real child revenue lines, not holding)
  const revByChild = new Map()
  let totalRev = 0
  for (const l of raw) {
    if (l.lineType === "revenue" && l.companyCode !== HOLDING && !l.isSubsidy) {
      revByChild.set(l.companyCode, (revByChild.get(l.companyCode) ?? 0) + l.annual)
      totalRev += l.annual
    }
  }
  const children = [...revByChild.keys()]
  const out = []
  for (const l of raw) {
    if (l.companyCode !== HOLDING) {
      out.push(l)
      continue
    }
    let acc = 0
    children.forEach((child, i) => {
      const amt =
        i === children.length - 1
          ? Math.round((l.annual - acc) * 100) / 100
          : Math.round(l.annual * (revByChild.get(child) / totalRev) * 100) / 100
      acc += amt
      out.push({ ...l, companyCode: child, annual: amt, allocated: true })
    })
  }
  return out
}

async function main() {
  const org = await prisma.organization.findFirst({ select: { id: true } })
  const companies = await prisma.company.findMany({
    where: { organizationId: org.id },
    select: { id: true, code: true, name: true },
  })
  const codeToId = new Map(companies.map((c) => [c.code, c.id]))
  const plan = await prisma.budgetPlan.findFirst({
    where: { organizationId: org.id, year: YEAR, kind: "budget", deletedAt: null },
    select: { id: true, name: true },
  })
  if (!plan) throw new Error("No kind=budget plan for 2026")

  const { raw, excluded } = parseIcmal()
  const lines = allocate(raw)
  const missing = [...new Set(lines.map((l) => l.companyCode))].filter((c) => !codeToId.has(c))
  if (missing.length) throw new Error(`Unmapped companies: ${missing.join(", ")}`)

  const agg = new Map()
  const totals = { revenue: 0, cogs: 0, expense: 0 }
  for (const l of lines) {
    const a = agg.get(l.companyCode) ?? { revenue: 0, cogs: 0, expense: 0 }
    a[l.lineType] += l.annual
    agg.set(l.companyCode, a)
    totals[l.lineType] += l.annual
  }

  console.log(`\n=== İcmal 2026 → "${plan.name}" (${APPLY ? "APPLY" : "DRY-RUN"}${WITH_SUBS ? " +subsidies" : ""}) ===`)
  console.log(`${lines.length} line items → ${lines.length * 12} monthly BudgetLines\n`)
  console.log(`  ${"company".padEnd(16)} ${"revenue".padStart(13)} ${"cogs".padStart(13)} ${"expense".padStart(13)}`)
  for (const [code, a] of [...agg].sort()) {
    console.log(`  ${code.padEnd(16)} ${Math.round(a.revenue).toLocaleString().padStart(13)} ${Math.round(a.cogs).toLocaleString().padStart(13)} ${Math.round(a.expense).toLocaleString().padStart(13)}`)
  }
  console.log(`  ${"TOTAL".padEnd(16)} ${Math.round(totals.revenue).toLocaleString().padStart(13)} ${Math.round(totals.cogs).toLocaleString().padStart(13)} ${Math.round(totals.expense).toLocaleString().padStart(13)}`)
  console.log(`  net (rev−cogs−exp): ${Math.round(totals.revenue - totals.cogs - totals.expense).toLocaleString()} ₼`)
  if (excluded.length) console.log(`\nExcluded (below-EBITDA): ${excluded.map((e) => `${e.label}=${Math.round(e.amount).toLocaleString()}`).join("; ")}`)

  if (!APPLY) {
    console.log(`\n(DRY-RUN — nothing written.)`)
    return
  }

  // ---------- APPLY ----------
  const result = await prisma.$transaction(async (tx) => {
    // 1) resolve-or-create one CoA per unique coaCode
    const coaByCode = new Map()
    const specs = new Map() // coaCode → {name, accountType}
    for (const l of lines) {
      if (!specs.has(l.coaCode)) specs.set(l.coaCode, { name: l.label, accountType: l.lineType })
    }
    for (const [code, spec] of specs) {
      const row = await tx.chartOfAccount.upsert({
        where: { organizationId_code: { organizationId: org.id, code } },
        create: { organizationId: org.id, code, name: spec.name, accountType: spec.accountType, category: "budget" },
        update: { name: spec.name, accountType: spec.accountType },
        select: { id: true },
      })
      coaByCode.set(code, row.id)
    }
    // 2) idempotent: clear any prior İcmal budget lines in this plan
    const del = await tx.budgetLine.deleteMany({ where: { planId: plan.id } })
    // 3) build 12 monthly rows per line item
    const rows = []
    for (const l of lines) {
      const monthly = Math.round((l.annual / 12) * 100) / 100
      for (let m = 0; m < 12; m++) {
        const amt = m === 11 ? Math.round((l.annual - monthly * 11) * 100) / 100 : monthly
        rows.push({
          organizationId: org.id,
          planId: plan.id,
          companyId: codeToId.get(l.companyCode),
          accountId: coaByCode.get(l.coaCode),
          lineType: l.lineType,
          plannedAmount: amt,
          monthIndex: m,
          currencyCode: "AZN",
          isAutoPlanned: false,
          isAutoActual: false,
          sourceDocument: SOURCE_DOC,
        })
      }
    }
    await tx.budgetLine.createMany({ data: rows })
    return { deleted: del.count, inserted: rows.length, accounts: specs.size }
  })

  // 4) post-write verification
  const written = {}
  for (const lt of ["revenue", "cogs", "expense"]) {
    const a = await prisma.budgetLine.aggregate({ where: { planId: plan.id, lineType: lt }, _sum: { plannedAmount: true } })
    written[lt] = Math.round(a._sum.plannedAmount || 0)
  }
  console.log(`\n✅ APPLIED: ${result.inserted} BudgetLines (deleted ${result.deleted}, ${result.accounts} CoA accounts)`)
  console.log(`   written sums: revenue=${written.revenue.toLocaleString()} cogs=${written.cogs.toLocaleString()} expense=${written.expense.toLocaleString()}`)
  const ok = written.revenue === Math.round(totals.revenue) && written.cogs === Math.round(totals.cogs) && written.expense === Math.round(totals.expense)
  console.log(ok ? `   ✓ checksum matches the preview` : `   ⚠ checksum drift vs preview (rev ${Math.round(totals.revenue)}, cogs ${Math.round(totals.cogs)}, exp ${Math.round(totals.expense)})`)
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
