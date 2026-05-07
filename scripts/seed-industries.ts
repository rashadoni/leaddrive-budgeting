/**
 * Phase 7.B — Seed the Industry catalog.
 *
 * 14 industries covering the holding-wide scope documented in ROADMAP §7.C.
 * Codes use snake_case and MUST match the `industries[]` arrays on
 * IndicatorDefinition rows (see scripts/seed-indicators.ts) — otherwise
 * indicators won't match to any company.
 *
 * Phase 7.G Turn LVIII — INDUSTRIES const moved to
 * `src/lib/industries/data.ts` as the canonical single source of truth.
 * Both this seeder AND `scripts/build-industries-i18n.ts` (which emits
 * `messages/{en,ru,az}.json:industries.*` slices) consume the same array,
 * eliminating the JSON-vs-DB drift class (closes 80-turn-stale architect
 * Turn-G Round-1 💡).
 *
 * Run:
 *   npx tsx scripts/seed-industries.ts
 *
 * Idempotent via `upsert` on the String primary key.
 */

import { PrismaClient } from '@prisma/client';
import { INDUSTRIES } from '../src/lib/industries/data';

const prisma = new PrismaClient();

async function main() {
  let created = 0;
  let updated = 0;
  for (const seed of INDUSTRIES) {
    const existing = await prisma.industry.findUnique({
      where: { code: seed.code },
      select: { code: true },
    });
    await prisma.industry.upsert({
      where: { code: seed.code },
      create: {
        code: seed.code,
        nameEn: seed.nameEn,
        nameAz: seed.nameAz ?? null,
        nameRu: seed.nameRu ?? null,
        category: seed.category ?? null,
        sortOrder: seed.sortOrder,
        isActive: true,
      },
      update: {
        nameEn: seed.nameEn,
        nameAz: seed.nameAz ?? null,
        nameRu: seed.nameRu ?? null,
        category: seed.category ?? null,
        sortOrder: seed.sortOrder,
        isActive: true,
      },
    });
    if (existing) updated += 1;
    else created += 1;
    console.log(`  ${existing ? '~' : '+'} ${seed.code.padEnd(18)} ${seed.nameEn}`);
  }
  console.log('');
  console.log(
    `Seeded ${INDUSTRIES.length} industries (${created} created, ${updated} updated).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
