/**
 * Phase 1 (decouple-terminal-pnl plan) — write P&L period-facts from the live
 * 2026 BudgetLines, using the SHARED `aggregatePnlLines` (so the facts are
 * bit-perfect vs what `budgetLineResolver` computes today).
 *
 * Writes 6 metrics per (company, month) as OperationalFact:
 *   pl_revenue, pl_cogs, pl_opex, pl_imported_cogs, pl_imported_opex, pl_da
 * date = Date.UTC(2026, monthIndex, 1); unit "AZN"; source
 * "migration:budgetline-2026". `pl_ebitda` is NOT touched (left as-is).
 *
 * Idempotent + reversible: re-run deletes this source's rows first; rollback =
 *   DELETE FROM operational_facts WHERE source='migration:budgetline-2026'.
 *
 * Default = DRY RUN (compute + verify vs Phase-0 checksum, NO writes).
 * Pass `--apply` to write.
 *
 * Run: npx tsx scripts/phase1-write-pnl-facts.ts [--apply]
 */
import { readFileSync } from "fs"
import { PrismaClient } from "@prisma/client"
import { aggregatePnlLines, type PnlLineInput } from "../src/lib/risk/pnl-aggregation"

const prisma = new PrismaClient()
const APPLY = process.argv.includes("--apply")
const YEAR = 2026
const SOURCE = "migration:budgetline-2026"
const METRICS = ["pl_revenue", "pl_cogs", "pl_opex", "pl_imported_cogs", "pl_imported_opex", "pl_da"] as const
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

async function main() {
  const baseline = JSON.parse(readFileSync("docs/plans/phase0-baseline.json", "utf8"))
  const org = await prisma.organization.findFirst({ select: { id: true } })
  if (!org) throw new Error("no org")

  const rows = await prisma.budgetLine.findMany({
    where: { organizationId: org.id, deletedAt: null, plan: { year: YEAR } },
    select: {
      plannedAmount: true,
      currencyCode: true,
      exchangeRate: true,
      monthIndex: true,
      sortOrder: true,
      lineType: true,
      companyId: true,
      account: { select: { accountType: true, code: true } },
      company: { select: { baseCurrencyCode: true } },
    },
  })

  // Group by (companyId, resolved monthIndex) — same resolution as listBudgetLines.
  type Grp = { companyId: string; base: string; lines: PnlLineInput[] }
  const groups = new Map<string, Grp>()
  let nullMonth = 0
  for (const r of rows) {
    const mi = r.monthIndex ?? (r.sortOrder >= 0 && r.sortOrder <= 11 ? r.sortOrder : null)
    if (mi == null) { nullMonth += 1; continue }
    const key = `${r.companyId}|${mi}`
    if (!groups.has(key)) groups.set(key, { companyId: r.companyId!, base: r.company?.baseCurrencyCode ?? "AZN", lines: [] })
    groups.get(key)!.lines.push({
      plannedAmount: r.plannedAmount,
      currencyCode: r.currencyCode,
      exchangeRate: r.exchangeRate,
      accountType: r.account?.accountType ?? r.lineType ?? null,
      accountCode: r.account?.code ?? null,
    })
  }
  if (nullMonth > 0) throw new Error(`ABORT: ${nullMonth} lines have no resolvable monthIndex — would break monthly facts`)

  // Build the fact rows.
  const facts: { companyId: string; metric: string; date: Date; value: number }[] = []
  const tot: Record<string, number> = { pl_revenue: 0, pl_cogs: 0, pl_opex: 0, pl_imported_cogs: 0, pl_imported_opex: 0, pl_da: 0 }
  for (const [key, g] of groups) {
    const mi = Number(key.split("|")[1])
    const a = aggregatePnlLines(g.lines, g.base)
    const date = new Date(Date.UTC(YEAR, mi, 1))
    const vals: Record<string, number> = {
      pl_revenue: a.revenue, pl_cogs: a.cogs, pl_opex: a.opex,
      pl_imported_cogs: a.imported_cogs, pl_imported_opex: a.imported_opex, pl_da: a.da_total,
    }
    for (const m of METRICS) { facts.push({ companyId: g.companyId, metric: m, date, value: vals[m] }); tot[m] += vals[m] }
  }

  // Verify. The strong no-loss invariant is the GRAND total (rounding-robust:
  // one sum, one round) vs the Phase-0 checksum. Per-type is compared with a
  // 0.05 tolerance because the Phase-0 `budgetLineByKey` rounded each
  // (company|month|lineType) key to 2dp, so summing those pre-rounded keys
  // accumulates ~0.01 of noise vs a raw sum. (lineType==accountType confirmed.)
  const ck = baseline.checksums.budgetLineByKey as Record<string, number>
  const sumByType = (t: string) => Object.entries(ck).filter(([k]) => k.endsWith(`|${t}`)).reduce((s, [, v]) => s + v, 0)
  const grandDerived = r2(tot.pl_revenue + tot.pl_cogs + tot.pl_opex)
  const grandChecksum = baseline.checksums.budgetLine2026Total as number
  console.log(`Groups: ${groups.size} (company×month) · facts to write: ${facts.length}`)
  for (const [m, t] of [["pl_revenue", "revenue"], ["pl_cogs", "cogs"], ["pl_opex", "expense"]] as const) {
    const got = r2(tot[m]); const want = r2(sumByType(t)); const diff = r2(Math.abs(got - want))
    console.log(`  ${m}: derived ${got} vs checksum ${want} (Δ${diff}) → ${diff <= 0.05 ? "OK" : "MISMATCH"}`)
    if (diff > 0.05) throw new Error(`ABORT: ${m} off by ${diff} (> 0.05 rounding tolerance)`)
  }
  console.log(`  pl_imported_cogs: ${r2(tot.pl_imported_cogs)} · pl_imported_opex: ${r2(tot.pl_imported_opex)} · pl_da: ${r2(tot.pl_da)}`)
  console.log(`  GRAND (rev+cogs+opex): derived ${grandDerived} vs checksum ${grandChecksum} → ${grandDerived === grandChecksum ? "EXACT MATCH ✓" : "MISMATCH"}`)
  if (grandDerived !== grandChecksum) throw new Error("ABORT: grand total does not match Phase-0 checksum (real data loss)")

  if (!APPLY) { console.log("\nDRY RUN — no writes. Re-run with --apply to write."); await prisma.$disconnect(); return }

  // Idempotent write.
  const del = await prisma.operationalFact.deleteMany({
    where: { organizationId: org.id, source: SOURCE, metric: { in: [...METRICS] }, date: { gte: new Date(Date.UTC(YEAR, 0, 1)), lt: new Date(Date.UTC(YEAR + 1, 0, 1)) } },
  })
  const created = await prisma.operationalFact.createMany({
    data: facts.map((f) => ({ organizationId: org.id, companyId: f.companyId, metric: f.metric, date: f.date, value: f.value, unit: "AZN", source: SOURCE })),
  })
  // Re-read & verify written sums.
  const back = await prisma.operationalFact.groupBy({ by: ["metric"], where: { organizationId: org.id, source: SOURCE }, _sum: { value: true } })
  console.log(`\nAPPLIED: deleted ${del.count}, inserted ${created.count}.`)
  for (const b of back) console.log(`  ${b.metric}: ${r2(b._sum.value ?? 0)}`)
  const revBack = r2(back.find((b) => b.metric === "pl_revenue")?._sum.value ?? 0)
  if (revBack !== r2(sumByType("revenue"))) throw new Error("POST-WRITE MISMATCH on pl_revenue")
  console.log("Post-write verify: pl_revenue matches checksum ✓")
  await prisma.$disconnect()
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1) })
