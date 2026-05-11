const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()
async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  const rows = await prisma.$queryRaw`
    SELECT c.code AS co,
           COUNT(*) FILTER (WHERE bl."currencyCode" IS NULL) AS base_only,
           COUNT(*) FILTER (WHERE bl."currencyCode" IS NOT NULL AND bl."exchangeRate" IS NULL) AS foreign_no_rate,
           COUNT(*) FILTER (WHERE bl."currencyCode" IS NOT NULL AND bl."exchangeRate" IS NOT NULL) AS foreign_with_rate,
           COUNT(*) AS total
    FROM budget_lines bl
    JOIN companies c ON c.id = bl."companyId"
    JOIN budget_plans bp ON bp.id = bl."planId"
    WHERE c."organizationId" = ${org.id}
      AND bp.year = 2026
      AND bp."deletedAt" IS NULL
    GROUP BY c.code
    ORDER BY c.code
  `
  console.log("\n=== Currency tagging for 2026 BudgetLines ===")
  console.log("CO".padEnd(22) + "base_only".padStart(12) + "frgn_norate".padStart(13) + "frgn+rate".padStart(12) + "total".padStart(10))
  for (const r of rows) console.log(r.co.padEnd(22) + String(r.base_only).padStart(12) + String(r.foreign_no_rate).padStart(13) + String(r.foreign_with_rate).padStart(12) + String(r.total).padStart(10))
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
