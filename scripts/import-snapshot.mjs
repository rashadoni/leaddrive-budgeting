/**
 * Import-cycle snapshot + diff (verification tool).
 *   node scripts/import-snapshot.mjs before   → writes _snap-before.json
 *   node scripts/import-snapshot.mjs after    → writes _snap-after.json + prints a before→after diff
 *
 * Local-only: needs localhost:5432 + the sandbox disabled. The before→after
 * diff is the guard against import collateral-wipes (corruption #1).
 *
 * Captures per-company row counts (P&L / BS / ops-facts / counterparties),
 * indicator status breakdown (green/amber/red/unknown), soft-data settings
 * array lengths, org-wide CF count, and per-(company,year,kind) P&L sums.
 * The diff flags DROPS on companies that weren't the import target = the
 * "tails / collateral wipe" signal (memory: import data-corruption is #1).
 */
import { PrismaClient } from "@prisma/client"
import fs from "fs"

const prisma = new PrismaClient()
const mode = (process.argv[2] || "before").toLowerCase()
const OUT = mode === "after" ? "_snap-after.json" : "_snap-before.json"

const toMap = (rows, key = "companyId") => {
  const m = new Map()
  for (const r of rows) m.set(r[key], (r._count ?? r._count?._all ?? 0))
  return m
}

const companies = await prisma.company.findMany({
  where: { isActive: true },
  select: { id: true, code: true, name: true, settings: true },
  orderBy: { code: "asc" },
})

const [bl, bs, of, cp, ivRows, cf, plLines] = await Promise.all([
  prisma.budgetLine.groupBy({ by: ["companyId"], where: { deletedAt: null }, _count: true }),
  prisma.balanceSheetLine.groupBy({ by: ["companyId"], where: { deletedAt: null }, _count: true }),
  prisma.operationalFact.groupBy({ by: ["companyId"], _count: true }),
  prisma.counterparty.groupBy({ by: ["companyId"], _count: true }),
  prisma.indicatorValue.groupBy({ by: ["companyId", "status"], _count: true }),
  prisma.cashFlowEntry.count({ where: { deletedAt: null } }),
  prisma.budgetLine.findMany({
    where: { deletedAt: null, companyId: { not: null } },
    select: { companyId: true, lineType: true, plannedAmount: true, plan: { select: { year: true, kind: true } } },
  }),
])

const blM = toMap(bl), bsM = toMap(bs), ofM = toMap(of), cpM = toMap(cp)
const ivM = new Map() // companyId -> {green,amber,red,unknown,total}
for (const r of ivRows) {
  const e = ivM.get(r.companyId) ?? { green: 0, amber: 0, red: 0, unknown: 0, total: 0 }
  e[r.status] = (e[r.status] ?? 0) + r._count
  e.total += r._count
  ivM.set(r.companyId, e)
}
// P&L sums per (companyId, year, kind, lineType)
const pl = new Map() // `${companyId}|${year}|${kind}` -> {lines, revenue, cogs, expense}
for (const l of plLines) {
  const k = `${l.companyId}|${l.plan?.year}|${l.plan?.kind}`
  const e = pl.get(k) ?? { lines: 0, revenue: 0, cogs: 0, expense: 0 }
  e.lines++
  if (l.lineType === "revenue") e.revenue += l.plannedAmount
  else if (l.lineType === "cogs") e.cogs += l.plannedAmount
  else e.expense += l.plannedAmount
  pl.set(k, e)
}

const arrLen = (v) => (Array.isArray(v) ? v.length : 0)
const perCompany = companies.map((c) => {
  const s = c.settings && typeof c.settings === "object" ? c.settings : {}
  const iv = ivM.get(c.id) ?? { green: 0, amber: 0, red: 0, unknown: 0, total: 0 }
  const plByYear = {}
  for (const [k, v] of pl) {
    if (k.startsWith(c.id + "|")) plByYear[k.split("|").slice(1).join("|")] = v
  }
  return {
    code: c.code,
    name: c.name,
    pnl_lines: blM.get(c.id) ?? 0,
    bs_lines: bsM.get(c.id) ?? 0,
    ops_facts: ofM.get(c.id) ?? 0,
    counterparties: cpM.get(c.id) ?? 0,
    iv_total: iv.total,
    iv_ok: iv.green + iv.amber + iv.red,
    iv_dark: iv.unknown,
    iv_status: { green: iv.green, amber: iv.amber, red: iv.red, unknown: iv.unknown },
    settings: {
      auditFindings: arrLen(s.auditFindings),
      courtDisputes: arrLen(s.courtDisputes),
      riskRegister: arrLen(s.riskRegister),
      landParcels: arrLen(s.landParcels),
      capexInitiatives: arrLen(s.capexInitiatives),
      strategic: !!(s.strategicFullText || s.strategicDescription),
    },
    pnl_by_year: plByYear,
  }
})

const snap = {
  mode,
  capturedAt: new Date().toISOString(),
  totals: {
    companies_active: companies.length,
    budget_lines_live: [...blM.values()].reduce((a, b) => a + b, 0),
    bs_lines_live: [...bsM.values()].reduce((a, b) => a + b, 0),
    cf_entries_live: cf,
    ops_facts: [...ofM.values()].reduce((a, b) => a + b, 0),
    counterparties: [...cpM.values()].reduce((a, b) => a + b, 0),
    iv_total: [...ivM.values()].reduce((a, b) => a + b.total, 0),
    iv_ok: [...ivM.values()].reduce((a, b) => a + b.green + b.amber + b.red, 0),
  },
  perCompany,
}
fs.writeFileSync(OUT, JSON.stringify(snap, null, 2))
console.log(`✓ wrote ${OUT} @ ${snap.capturedAt}`)
console.log(`  totals:`, JSON.stringify(snap.totals))
console.log(`  companies:`)
for (const c of perCompany) {
  console.log(
    `    ${c.code.padEnd(16)} P&L:${String(c.pnl_lines).padStart(5)} BS:${String(c.bs_lines).padStart(4)} ` +
      `facts:${String(c.ops_facts).padStart(4)} cp:${String(c.counterparties).padStart(3)} ` +
      `IV ok/dark:${c.iv_ok}/${c.iv_dark} ` +
      `[audit:${c.settings.auditFindings} court:${c.settings.courtDisputes} risk:${c.settings.riskRegister} land:${c.settings.landParcels} capex:${c.settings.capexInitiatives}${c.settings.strategic ? " +strat" : ""}]`,
  )
}

if (mode === "after" && fs.existsSync("_snap-before.json")) {
  const before = JSON.parse(fs.readFileSync("_snap-before.json", "utf8"))
  const bMap = new Map(before.perCompany.map((c) => [c.code, c]))
  console.log(`\n=== DIFF before → after (⚠ = DROP on a company = possible tail/collateral wipe) ===`)
  const fields = ["pnl_lines", "bs_lines", "ops_facts", "counterparties", "iv_ok"]
  for (const a of perCompany) {
    const b = bMap.get(a.code)
    if (!b) { console.log(`  + NEW company ${a.code}`); continue }
    const parts = []
    for (const f of fields) {
      const d = a[f] - b[f]
      if (d !== 0) parts.push(`${f} ${b[f]}→${a[f]} (${d > 0 ? "+" : ""}${d}${d < 0 ? " ⚠" : ""})`)
    }
    if (parts.length) console.log(`  ${a.code}: ${parts.join(" · ")}`)
  }
  // companies in before but gone after
  for (const b of before.perCompany) {
    if (!perCompany.find((c) => c.code === b.code)) console.log(`  ⚠ company ${b.code} DISAPPEARED`)
  }
}

await prisma.$disconnect()
