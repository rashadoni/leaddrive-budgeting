/** TEMP (2026-07-15) — generic recompute for every company of the local org.
 *  Unlike recompute-fo-2026.ts, no hardcoded codes. */
import { PrismaClient } from "@prisma/client"
import { runRecomputeForCompanies } from "@/lib/risk/recompute-trigger"

async function main() {
  const prisma = new PrismaClient()
  const org = await prisma.organization.findFirst({ where: { slug: "azmade" }, select: { id: true } })
  if (!org) throw new Error("org not found")
  const companies = await prisma.company.findMany({
    where: { organizationId: org.id, status: { not: "archived" } },
    select: { id: true, code: true, level: true, role: true },
  })
  console.log("companies:", companies.map(c => `${c.code}(L${c.level},${c.role})`).join(" "))
  for (const year of [2025, 2026]) {
    const affected = companies.map(c => ({ companyId: c.id, year }))
    const res = await runRecomputeForCompanies(prisma, org.id, affected, {
      noop: (m: string) => console.log("noop:", m),
    })
    console.log(`year=${year}: targets=${res.targets} ok=${res.ok} unknown=${res.unknown} failed=${res.failed}`)
  }
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
