const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()
async function main() {
  const c = await prisma.company.findFirst({
    where: { code: "ATL-MRKZ" },
    select: { id: true, role: true, _count: { select: { budgetLines: true } } },
  })
  if (!c) { console.log("ATL-MRKZ not found"); return }
  console.log(`ATL-MRKZ before: role=${c.role}, ${c._count.budgetLines} budget lines`)

  if (c.role === "operational") {
    console.log("✓ Already operational — skip")
    return
  }

  await prisma.company.update({
    where: { id: c.id },
    data: { role: "operational" },
  })
  console.log("✓ Updated ATL-MRKZ role: admin → operational")
  console.log("  Rationale: entity has 10.8M revenue + full P&L, matrix filter")
  console.log("  was hiding its 2 real RED indicators behind 'admin' classification.")
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
