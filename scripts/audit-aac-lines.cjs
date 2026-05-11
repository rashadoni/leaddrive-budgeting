const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()
async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })

  // Find plans for AAC ops companies
  const aacOps = await prisma.company.findMany({
    where: { organizationId: org.id, code: { in: ["AAC-MAIN", "ATL-DBZ", "ATL-MRKZ", "ATL-PMZ", "ATL-TAZ", "SPARK-MAIN", "ZTP-MAIN", "LLS-MAIN"] } },
    select: { id: true, code: true },
  })
  const idMap = new Map(aacOps.map((c) => [c.id, c.code]))
  const ids = aacOps.map((c) => c.id)

  // Per-company breakdown of lines: with accountId vs without × accountType
  const counts = await prisma.$queryRaw`
    SELECT
      bl."companyId",
      COUNT(*) FILTER (WHERE bl."accountId" IS NOT NULL) AS with_acc,
      COUNT(*) FILTER (WHERE bl."accountId" IS NULL) AS no_acc,
      COUNT(*) AS total
    FROM budget_lines bl
    JOIN budget_plans bp ON bp.id = bl."planId"
    WHERE bl."organizationId" = ${org.id}
      AND bp.year = 2026
      AND bp."deletedAt" IS NULL
      AND bl."companyId" = ANY(${ids}::text[])
    GROUP BY bl."companyId"
  `
  console.log("\n=== AAC ops cos: lines with vs without accountId (2026 plans) ===")
  console.log("CO".padEnd(20) + "with_acc".padStart(10) + "no_acc".padStart(10) + "total".padStart(10))
  for (const r of counts) {
    console.log((idMap.get(r.companyId) || "?").padEnd(20) + String(r.with_acc).padStart(10) + String(r.no_acc).padStart(10) + String(r.total).padStart(10))
  }

  // accountType breakdown for those that DO have accountId
  console.log("\n=== AAC ops accountType breakdown (lines that have accountId) ===")
  const types = await prisma.$queryRaw`
    SELECT c.code AS co_code, coa."accountType", COUNT(*) AS n, SUM(bl."plannedAmount")::int AS sum
    FROM budget_lines bl
    JOIN companies c ON c.id = bl."companyId"
    JOIN budget_plans bp ON bp.id = bl."planId"
    JOIN chart_of_accounts coa ON coa.id = bl."accountId"
    WHERE bl."organizationId" = ${org.id}
      AND bp.year = 2026
      AND bp."deletedAt" IS NULL
      AND bl."companyId" = ANY(${ids}::text[])
    GROUP BY c.code, coa."accountType"
    ORDER BY c.code, coa."accountType"
  `
  let lastCo = null
  for (const r of types) {
    if (r.co_code !== lastCo) { console.log("--- " + r.co_code); lastCo = r.co_code }
    console.log(`  ${String(r.accountType).padEnd(15)} ${String(r.n).padStart(6)}  ${(r.sum/1000).toFixed(0)}K`)
  }
  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
