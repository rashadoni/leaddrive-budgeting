/**
 * Re-key the 2026 İcmal budget Revenue+COGS lines onto the PLF chart of accounts
 * so budget↔actual share codes → per-category budget-vs-actual works.
 *
 * DRY-RUN by default. Pass --apply to write. Amounts + companies are PRESERVED
 * (pure re-code); only accountId changes. Unmapped labels (sugar-beet COGS,
 * "other products" ambiguity, subsidies, OPEX) stay ICMAL.* → render "—".
 */
import { PrismaClient } from "@prisma/client"
const prisma = new PrismaClient()
const APPLY = process.argv.includes("--apply")

// İcmal product label → PLF account code. Verified each PLF code exists in the
// 2026 actuals (see investigate-icmal-plf-mappability output).
const REV = {
  "Buğda": "PLF.01.01.01",                 // Wheat
  "Şəkər çuğunduru": "PLF.01.01.02",       // Sugar Beet
  "Arpa": "PLF.01.01.04",                  // Barley
  "Pambıq": "PLF.01.01.05",                // Cotton
  "Qlukoza": "PLF.01.02.01",               // Glucose
  "Nişasta": "PLF.01.02.02",               // Corn Starch
  "Fruktoza": "PLF.01.02.03",              // Fructose
  "Pivə xammalı": "PLF.01.02.05",          // Malt
  "Yan məhsul": "PLF.01.02.06",            // Corn Processing Byproducts
  "Torpaq icarəsi": "PLF.01.03.01",        // Land Rent
  "Laboratoriya xidmətləri": "PLF.01.03.02", // Lab Services
}
const COGS = {
  "Buğda": "PLF.02.01.01",                 // Wheat Costs
  "Arpa": "PLF.02.01.04",                  // Barley Costs
  "Pambıq": "PLF.02.01.05",                // Cotton Costs
  "Qlukoza": "PLF.02.02.01",               // Glucose Costs
  "Nişasta": "PLF.02.02.02",               // Corn Starch Costs
  "Fruktoza": "PLF.02.02.03",              // Fructose Costs
  "Pivə xammalı": "PLF.02.02.05",          // Malt Costs
  "Yan məhsul": "PLF.02.02.06",            // Corn Processing Byproducts Costs
  "Laboratoriya xidmətləri": "PLF.02.03.02", // Cost of Lab Services
  // NOTE: "Şəkər çuğunduru" (sugar beet) COGS has NO PLF.02.01.02 in actuals → left unmapped (—)
  // NOTE: "Sair məhsullar" (other) is ambiguous (PLF.*.99 x2) → left unmapped (—)
}

async function main() {
  const budget = await prisma.budgetPlan.findFirst({ where: { year: 2026, kind: "budget", deletedAt: null }, select: { id: true } })
  const actuals = await prisma.budgetPlan.findFirst({ where: { year: 2026, kind: "actual", deletedAt: null }, select: { id: true } })

  // PLF ChartOfAccount lookup (code → id) — confirm every target exists
  const targets = [...new Set([...Object.values(REV), ...Object.values(COGS)])]
  const coa = await prisma.chartOfAccount.findMany({ where: { code: { in: targets } }, select: { id: true, code: true } })
  const codeToId = Object.fromEntries(coa.map((c) => [c.code, c.id]))
  const missing = targets.filter((c) => !codeToId[c])
  console.log(`PLF target codes: ${targets.length}, found in ChartOfAccount: ${coa.length}, MISSING: ${missing.length}`, missing.length ? missing : "")
  if (missing.length) { console.log("ABORT: target PLF codes missing from ChartOfAccount"); return }

  // actual sum per PLF code (consolidated)
  const aLines = await prisma.budgetLine.findMany({ where: { planId: actuals.id, deletedAt: null }, select: { plannedAmount: true, account: { select: { code: true } } } })
  const actualByCode = new Map()
  for (const l of aLines) actualByCode.set(l.account?.code, (actualByCode.get(l.account?.code) ?? 0) + l.plannedAmount)

  // budget lines to remap
  const bLines = await prisma.budgetLine.findMany({
    where: { planId: budget.id, deletedAt: null, lineType: { in: ["revenue", "cogs"] } },
    select: { id: true, lineType: true, plannedAmount: true, account: { select: { code: true, name: true } } },
  })

  const plan = [] // {id, fromCode, toCode, name, lineType, amount}
  const unmapped = new Map()
  for (const l of bLines) {
    const name = l.account?.name ?? ""
    const map = l.lineType === "revenue" ? REV : COGS
    const toCode = map[name]
    if (toCode) plan.push({ id: l.id, fromCode: l.account?.code, toCode, name, lineType: l.lineType, amount: l.plannedAmount })
    else { const k = `${l.lineType}:${name}`; unmapped.set(k, (unmapped.get(k) ?? 0) + l.plannedAmount) }
  }

  console.log(`\nbudget rev+cogs lines: ${bLines.length}  → mappable: ${plan.length}  unmapped: ${bLines.length - plan.length}`)
  console.log(`\n=== UNMAPPED (will stay "—") ===`)
  for (const [k, v] of [...unmapped.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(Math.round(v)).padStart(10)}  ${k}`)

  // per-category budget-vs-actual PREVIEW (consolidated), grouped by target PLF code
  const budgetByCode = new Map()
  for (const p of plan) budgetByCode.set(p.toCode, (budgetByCode.get(p.toCode) ?? 0) + p.amount)
  console.log(`\n=== PREVIEW: consolidated budget-vs-actual per mapped code ===`)
  console.log(`  ${"PLF code".padEnd(16)} ${"budget".padStart(11)} ${"actual".padStart(11)} ${"variance".padStart(11)}`)
  for (const [code, b] of [...budgetByCode.entries()].sort((a, b2) => b2[1] - a[1])) {
    const a = actualByCode.get(code) ?? 0
    console.log(`  ${code.padEnd(16)} ${String(Math.round(b)).padStart(11)} ${String(Math.round(a)).padStart(11)} ${String(Math.round(a - b)).padStart(11)}`)
  }

  // totals-preserved sanity
  const sumBefore = bLines.reduce((s, l) => s + l.plannedAmount, 0)
  console.log(`\ntotal rev+cogs budget (unchanged by re-key): ${Math.round(sumBefore)}`)

  if (!APPLY) { console.log("\n*** DRY-RUN — no writes. Re-run with --apply to commit. ***"); return }

  // Reversibility: snapshot each line's CURRENT accountId before mutating.
  const { writeFileSync } = await import("node:fs")
  const before = await prisma.budgetLine.findMany({ where: { id: { in: plan.map((p) => p.id) } }, select: { id: true, accountId: true } })
  const backup = before.map((b) => ({ id: b.id, oldAccountId: b.accountId }))
  const backupPath = `/tmp/claude/remap-icmal-plf-backup-${plan.length}.json`
  writeFileSync(backupPath, JSON.stringify(backup, null, 2))
  console.log(`\nbackup of original accountIds → ${backupPath}`)

  // APPLY: update accountId per line (amounts + company preserved)
  let n = 0
  for (const p of plan) { await prisma.budgetLine.update({ where: { id: p.id }, data: { accountId: codeToId[p.toCode] } }); n++ }
  console.log(`*** APPLIED: re-keyed ${n} budget lines to PLF codes. ***`)
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
