const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()
async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  const rows = await prisma.$queryRaw`
    SELECT c.code AS co, bl."currencyCode" AS cc, COUNT(*)::int AS n
    FROM budget_lines bl
    JOIN companies c ON c.id = bl."companyId"
    JOIN budget_plans bp ON bp.id = bl."planId"
    WHERE c."organizationId" = ${org.id}
      AND bp.year = 2026
      AND bp."deletedAt" IS NULL
    GROUP BY c.code, bl."currencyCode"
    ORDER BY c.code, bl."currencyCode"
  `
  let last = null
  for (const r of rows) {
    if (r.co !== last) { console.log("--- " + r.co); last = r.co }
    console.log(`  cc="${r.cc}" n=${r.n}`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
