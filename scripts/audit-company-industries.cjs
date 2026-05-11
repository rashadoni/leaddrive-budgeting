const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })

  const cos = await prisma.company.findMany({
    where: { organizationId: org.id, isActive: true },
    select: {
      id: true, code: true, level: true, industry: true,
      _count: { select: { companyIndicators: true, budgetLines: true, indicatorValues: true } }
    },
    orderBy: [{ level: "asc" }, { code: "asc" }],
  })

  console.log("\n=== Companies × industry × indicator-count ===")
  console.log("CO".padEnd(22) + "level".padStart(7) + "  industry".padEnd(28) + "co_inds".padStart(8) + "lines".padStart(8) + "iv".padStart(6))
  for (const c of cos) {
    console.log(c.code.padEnd(22) + String(c.level).padStart(7) + "  " + (c.industry || "(null)").padEnd(26) + String(c._count.companyIndicators).padStart(8) + String(c._count.budgetLines).padStart(8) + String(c._count.indicatorValues).padStart(6))
  }

  await prisma.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
