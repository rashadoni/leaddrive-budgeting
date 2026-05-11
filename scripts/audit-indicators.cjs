const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  if (!org) throw new Error("Org not found")

  // Group counts by status
  const byStatus = await prisma.indicatorValue.groupBy({
    by: ["status"],
    where: { organizationId: org.id, period: "2026" },
    _count: { _all: true },
  })
  console.log("\n=== indicator_values 2026 by status ===")
  for (const r of byStatus) console.log(`  ${r.status.padEnd(10)} ${r._count._all}`)

  // What indicators are computed at all?
  const indicators = await prisma.indicatorDefinition.findMany({
    where: { OR: [{ organizationId: org.id }, { organizationId: null }], isActive: true },
    select: { id: true, code: true, nameEn: true, formula: true, requiredInputs: true },
    orderBy: { code: "asc" },
  })
  console.log(`\n=== Active indicators: ${indicators.length} ===`)

  // Sample a value for each
  const counts = await prisma.indicatorValue.groupBy({
    by: ["indicatorId", "status"],
    where: { organizationId: org.id, period: "2026" },
    _count: { _all: true },
  })
  const byInd = new Map()
  for (const r of counts) {
    if (!byInd.has(r.indicatorId)) byInd.set(r.indicatorId, {})
    byInd.get(r.indicatorId)[r.status] = r._count._all
  }

  console.log(`\n=== Per-indicator status breakdown (2026) ===`)
  console.log("CODE".padEnd(28) + "G ".padStart(4) + "A ".padStart(4) + "R ".padStart(4) + "? ".padStart(4) + "  Formula")
  for (const ind of indicators) {
    const s = byInd.get(ind.id) || {}
    const g = s.green || 0, a = s.amber || 0, r = s.red || 0, u = s.unknown || 0
    const total = g + a + r + u
    if (total === 0) {
      console.log(`  ${ind.code.padEnd(26)} —  no IndicatorValues          ${(ind.formula || "(no formula)").slice(0, 60)}`)
    } else {
      console.log(`  ${ind.code.padEnd(26)} ${String(g).padStart(3)} ${String(a).padStart(3)} ${String(r).padStart(3)} ${String(u).padStart(3)}  ${(ind.formula || "").slice(0, 60)}`)
    }
  }

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
