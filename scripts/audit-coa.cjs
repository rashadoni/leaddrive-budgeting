const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()
async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  const total = await prisma.chartOfAccount.count({ where: { organizationId: org.id } })
  console.log(`Total CoA entries for org: ${total}`)

  const byType = await prisma.chartOfAccount.groupBy({
    by: ["accountType"],
    where: { organizationId: org.id },
    _count: { _all: true },
  })
  console.log("\nBy accountType:")
  for (const r of byType) console.log(`  ${r.accountType.padEnd(15)} ${r._count._all}`)

  // Sample bogus rows (code looks like a number)
  const bogusSample = await prisma.$queryRaw`
    SELECT code, name, "accountType"
    FROM chart_of_accounts
    WHERE "organizationId" = ${org.id}
      AND code ~ '^-?[0-9]+\.[0-9]+$'
    LIMIT 5
  `
  console.log("\nBogus sample (code looks like a decimal number):")
  for (const r of bogusSample) console.log(`  code="${r.code}"  name="${r.name}"  type=${r.accountType}`)

  const bogusCount = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS n
    FROM chart_of_accounts
    WHERE "organizationId" = ${org.id}
      AND code ~ '^-?[0-9]+\.[0-9]+$'
  `
  console.log(`\nBogus row count (code is decimal): ${bogusCount[0].n}`)

  // Real-looking SAP codes
  const realSample = await prisma.$queryRaw`
    SELECT code, name, "accountType"
    FROM chart_of_accounts
    WHERE "organizationId" = ${org.id}
      AND code ~ '^[0-9]{3}'
    ORDER BY code
    LIMIT 10
  `
  console.log("\nReal SAP-code samples (start with 3 digits):")
  for (const r of realSample) console.log(`  ${r.code.padEnd(15)} ${(r.name || "").slice(0, 40).padEnd(42)} ${r.accountType}`)

  const realCount = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS n
    FROM chart_of_accounts
    WHERE "organizationId" = ${org.id}
      AND code ~ '^[0-9]{3}'
  `
  console.log(`\nReal-code count: ${realCount[0].n}`)

  // Are bogus accounts referenced by any BudgetLine?
  const refdBogus = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT bl."accountId")::int AS n
    FROM budget_lines bl
    JOIN chart_of_accounts coa ON coa.id = bl."accountId"
    WHERE coa."organizationId" = ${org.id}
      AND coa.code ~ '^-?[0-9]+\.[0-9]+$'
  `
  console.log(`\nBogus accounts referenced by BudgetLine: ${refdBogus[0].n}`)

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
