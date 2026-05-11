const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()
async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  const cos = await prisma.company.findMany({
    where: { organizationId: org.id, code: { in: ["AZSEKER-EDEN", "AZSEKER-AZSF", "AZSEKER-HORIZON", "AZSEKER-FARM", "AZSEKER-CPC"] } },
    select: { id: true, code: true },
  })
  const ids = cos.map((c) => c.id)
  const map = new Map(cos.map((c) => [c.id, c.code]))
  const rows = await prisma.$queryRaw`
    SELECT c.code, coa."accountType", COUNT(*)::int AS n, ROUND(SUM(bl."plannedAmount")::numeric)::int AS sum
    FROM budget_lines bl
    JOIN companies c ON c.id = bl."companyId"
    JOIN budget_plans bp ON bp.id = bl."planId"
    LEFT JOIN chart_of_accounts coa ON coa.id = bl."accountId"
    WHERE bl."companyId" = ANY(${ids}::text[])
      AND bp.year = 2026
      AND bp."deletedAt" IS NULL
    GROUP BY c.code, coa."accountType"
    ORDER BY c.code, coa."accountType"
  `
  let lastCo = null
  for (const r of rows) {
    if (r.code !== lastCo) { console.log("\n--- " + r.code); lastCo = r.code }
    console.log(`  ${String(r.accountType ?? "(null)").padEnd(15)} ${String(r.n).padStart(6)}  ${(Number(r.sum)/1000).toFixed(0)}K`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
