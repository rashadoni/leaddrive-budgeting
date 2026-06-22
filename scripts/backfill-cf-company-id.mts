/**
 * Backfill CashFlowEntry.companyId from sourceId "<entity>::<cfCode>" (2026-06-23).
 *
 * The cashflow_company_id migration added the column nullable; existing rows stay
 * null until this runs. New imports populate companyId directly (cf-import-batch).
 * Resolves each entity-code prefix → Company per org. The "::" delimiter is exact,
 * so "AZSEKER-CPC::" maps to the CPC company and never to the holding "AZSEKER::".
 *
 *   DRY-RUN: npx tsx scripts/backfill-cf-company-id.mts
 *   APPLY:   npx tsx scripts/backfill-cf-company-id.mts --apply
 *
 * Prod note (memory project_prod_is_docker_vm): the runtime image has no tsx —
 * run from a machine that can reach the prod DB, or port the updateMany into an
 * admin route.
 */
import { PrismaClient } from "@prisma/client"

const apply = process.argv.includes("--apply")
const prisma = new PrismaClient()

async function main() {
  const orgs = await prisma.organization.findMany({ select: { id: true, slug: true } })
  for (const org of orgs) {
    const companies = await prisma.company.findMany({
      where: { organizationId: org.id },
      select: { id: true, code: true },
    })
    let total = 0
    for (const c of companies) {
      const where = {
        organizationId: org.id,
        companyId: null,
        sourceId: { startsWith: `${c.code}::` },
      }
      if (apply) {
        total += (await prisma.cashFlowEntry.updateMany({ where, data: { companyId: c.id } })).count
      } else {
        total += await prisma.cashFlowEntry.count({ where })
      }
    }
    if (total > 0) {
      console.log(`org "${org.slug}": ${apply ? "set" : "would set"} companyId on ${total} CF rows`)
    }
  }
  console.log(apply ? "APPLIED." : "DRY-RUN — pass --apply to backfill.")
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
