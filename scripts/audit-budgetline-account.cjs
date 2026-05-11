const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })

  const plan = await prisma.budgetPlan.findFirst({
    where: { organizationId: org.id, deletedAt: null, year: 2026 },
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" },
  })
  console.log(`\n=== Plan ${plan.name} ===`)

  // For each company, count lines with accountId vs without
  const counts = await prisma.$queryRaw`
    SELECT
      c.code AS company_code,
      COUNT(*) FILTER (WHERE bl."accountId" IS NOT NULL) AS with_account,
      COUNT(*) FILTER (WHERE bl."accountId" IS NULL) AS without_account,
      COUNT(*) AS total
    FROM budget_lines bl
    JOIN companies c ON c.id = bl."companyId"
    WHERE bl."organizationId" = ${org.id}
      AND bl."planId" = ${plan.id}
    GROUP BY c.code
    ORDER BY c.code
  `
  console.log("CO".padEnd(20) + "with_account".padStart(15) + "without_account".padStart(18) + "total".padStart(10))
  for (const r of counts) {
    console.log(r.company_code.padEnd(20) + String(r.with_account).padStart(15) + String(r.without_account).padStart(18) + String(r.total).padStart(10))
  }

  // What accountType distribution exists on lines that DO have accountId?
  console.log(`\n=== accountType distribution (lines that have "accountId") ===`)
  const types = await prisma.$queryRaw`
    SELECT coa."accountType", COUNT(*) AS n
    FROM budget_lines bl
    JOIN chart_of_accounts coa ON coa.id = bl."accountId"
    WHERE bl."organizationId" = ${org.id}
      AND bl."planId" = ${plan.id}
    GROUP BY coa."accountType"
    ORDER BY n DESC
  `
  for (const r of types) console.log(`  ${String(r.accountType).padEnd(12)} ${r.n}`)

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
