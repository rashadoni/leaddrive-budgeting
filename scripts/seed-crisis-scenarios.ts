/**
 * Phase 1 "Crisis Brief" — seed the scenario catalog (B2 shocks) into the DB.
 * Catalog data + types live in `src/lib/risk/crisis-catalog.ts` (unit-tested);
 * this is the thin DB runner. Upserts Scenario.overrides.shock (JSON),
 * preserving any legacy adjustments already on the row.
 *
 * Run: (sandbox off) set -a; source .env; set +a; npx tsx scripts/seed-crisis-scenarios.ts
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { CRISIS_CATALOG } from '@/lib/risk/crisis-catalog'

async function main() {
  const org = await prisma.organization.findFirstOrThrow()
  for (const s of CRISIS_CATALOG) {
    const existing = await prisma.scenario.findFirst({ where: { organizationId: org.id, code: s.code } })
    const legacy = (existing?.overrides as { adjustments?: unknown } | null)?.adjustments
    // JSON round-trip strips nominal types → a plain Prisma-assignable JSON object.
    const overrides = JSON.parse(
      JSON.stringify({ shock: s.shock, ...(legacy ? { adjustments: legacy } : {}) }),
    ) as Prisma.InputJsonObject
    if (existing) {
      await prisma.scenario.update({
        where: { id: existing.id },
        data: { overrides, nameEn: s.nameEn, nameRu: s.nameRu, nameAz: s.nameAz, description: s.description, isActive: true },
      })
    } else {
      await prisma.scenario.create({
        data: { organizationId: org.id, code: s.code, nameEn: s.nameEn, nameRu: s.nameRu, nameAz: s.nameAz, description: s.description, overrides, isActive: true },
      })
    }
    console.log(`upserted ${s.code}`)
  }
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
