const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()
async function main() {
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  // Pull all IVs for 2026 + nested indicator code + company code
  const ivs = await prisma.indicatorValue.findMany({
    where: { organizationId: org.id, period: "2026" },
    select: { value: true, status: true, inputs: true, indicator: { select: { code: true } }, company: { select: { code: true } } },
    orderBy: [{ company: { code: "asc" } }, { indicator: { code: "asc" } }],
  })
  let lastCo = null
  for (const iv of ivs) {
    if (iv.company?.code !== lastCo) { console.log("\n--- " + (iv.company?.code || "?")); lastCo = iv.company?.code }
    const v = iv.value === null ? "null" : Number(iv.value).toFixed(2)
    const inputs = iv.inputs ? `  ${JSON.stringify(iv.inputs).slice(0, 90)}` : ""
    console.log(`  ${iv.indicator?.code?.padEnd(28)} ${iv.status.padEnd(9)} ${v.padStart(12)}${inputs}`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
