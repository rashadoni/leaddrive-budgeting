const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })

  const plans = await prisma.budgetPlan.findMany({
    where: { organizationId: org.id, deletedAt: null, status: { in: ["approved", "draft"] } },
    select: { id: true, name: true, year: true, status: true, _count: { select: { lines: true } } },
    orderBy: { year: "desc" },
  })
  console.log("\n=== BudgetPlans ===")
  for (const p of plans) console.log(`  ${p.year} ${p.status.padEnd(8)} ${p.name.padEnd(40)} ${p._count.lines} lines`)

  // For 2026 plans only — break down by company × accountType
  const plan2026 = plans.find((p) => p.year === 2026 && p.status === "approved")
  if (!plan2026) {
    console.log("\n⚠ No approved 2026 plan found")
    await prisma.$disconnect()
    return
  }
  console.log(`\n=== 2026 plan "${plan2026.name}" — lines by company × accountType ===`)

  const grouped = await prisma.budgetLine.groupBy({
    by: ["companyId", "accountType"],
    where: { organizationId: org.id, planId: plan2026.id },
    _count: { _all: true },
    _sum: { plannedAmount: true },
  })

  // Resolve company codes
  const cos = await prisma.company.findMany({
    where: { organizationId: org.id },
    select: { id: true, code: true, level: true },
    orderBy: { code: "asc" },
  })
  const codeById = new Map(cos.map((c) => [c.id, c.code]))

  // Build map: company → accountType → { count, sum }
  const m = new Map()
  for (const r of grouped) {
    const code = codeById.get(r.companyId) || `(unknown ${r.companyId})`
    if (!m.has(code)) m.set(code, {})
    m.get(code)[r.accountType || "(null)"] = { count: r._count._all, sum: r._sum.plannedAmount || 0 }
  }

  // Header
  const types = ["revenue", "cogs", "expense", "asset", "liability", "equity", "(null)"]
  console.log("CO".padEnd(20) + types.map((t) => t.padStart(15)).join(""))
  for (const code of [...m.keys()].sort()) {
    const row = m.get(code)
    const cells = types.map((t) => {
      const v = row[t]
      if (!v) return "—".padStart(15)
      return `${v.count}/${(v.sum / 1000).toFixed(0)}K`.padStart(15)
    })
    console.log(code.padEnd(20) + cells.join(""))
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
