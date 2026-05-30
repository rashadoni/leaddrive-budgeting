/**
 * Restore the true period-2026 IndicatorValue baseline for ALL AZSEKER
 * entities via the canonical recompute (overwrites any stale/contaminated
 * values). Non-destructive (upsert only). Covers the root + all children,
 * including AZSEKER-FARM (which recompute-fo-2026.ts omits).
 *
 * Run: (sandbox off) set -a; source .env; set +a; npx tsx scripts/restore-azseker-2026.ts
 */
import { PrismaClient } from '@prisma/client'
import { runRecomputeForCompanies } from '../src/lib/risk/recompute-trigger'

const prisma = new PrismaClient()
const YEAR = 2026

async function main() {
  const anchor = await prisma.company.findFirst({ where: { code: 'AZSEKER-CPC' }, select: { organizationId: true } })
  if (!anchor) throw new Error('No AZSEKER-CPC anchor company — wrong env?')
  const orgId = anchor.organizationId

  const companies = await prisma.company.findMany({
    where: { organizationId: orgId, code: { startsWith: 'AZSEKER' } },
    select: { id: true, code: true },
  })
  console.log(`Restoring ${companies.length} AZSEKER entities for ${YEAR}: ${companies.map((c) => c.code).join(', ')}`)

  const affected = companies.map((c) => ({ companyId: c.id, year: YEAR }))
  const result = await runRecomputeForCompanies(prisma, orgId, affected, {
    start: (m) => console.log(`  ${m}`),
    pairError: (label, err) => console.error(`  ✗ ${label}: ${err instanceof Error ? err.message : String(err)}`),
    done: (m) => console.log(`  ${m}`),
  })
  console.log(`\nDone: ok=${result.ok} unknown=${result.unknown} failed=${result.failed} targets=${result.targets}`)

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
