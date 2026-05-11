const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()
async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  // Include deleted
  const plans = await prisma.budgetPlan.findMany({
    where: { organizationId: org.id, year: 2026 },
    select: { id: true, name: true, year: true, status: true, deletedAt: true, _count: { select: { lines: true } } },
    orderBy: { createdAt: "desc" },
  })
  console.log("\n=== ALL 2026 plans (incl. deleted) ===")
  for (const p of plans) {
    console.log(`  ${(p.deletedAt ? "DELETED" : "active ").padEnd(8)} ${p.status.padEnd(8)} ${p.name.padEnd(40)} ${p._count.lines} lines  [${p.id}]`)
  }

  // For AAC-MAIN, list line counts per plan
  const aacMain = await prisma.company.findFirst({ where: { organizationId: org.id, code: "AAC-MAIN" }, select: { id: true } })
  console.log(`\n=== AAC-MAIN lines per plan ===`)
  const grouped = await prisma.$queryRaw`
    SELECT bp.id, bp.name, bp.year, bp.status, bp."deletedAt" AS deleted_at, COUNT(*)::int AS lines
    FROM budget_lines bl
    JOIN budget_plans bp ON bp.id = bl."planId"
    WHERE bl."companyId" = ${aacMain.id}
    GROUP BY bp.id, bp.name, bp.year, bp.status, bp."deletedAt"
    ORDER BY bp.year DESC, bp.name
  `
  for (const r of grouped) {
    console.log(`  ${(r.deleted_at ? "DELETED" : "active ").padEnd(8)} ${String(r.year)} ${r.status.padEnd(8)} ${r.name.padEnd(40)} ${r.lines}`)
  }

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
