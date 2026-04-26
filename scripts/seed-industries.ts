/**
 * Phase 7.B — Seed the Industry catalog.
 *
 * 10 industries covering the holding-wide scope documented in ROADMAP §7.C.
 * Codes use snake_case and MUST match the `industries[]` arrays on
 * IndicatorDefinition rows (see scripts/seed-indicators.ts) — otherwise
 * indicators won't match to any company.
 *
 * Run:
 *   npx tsx scripts/seed-industries.ts
 *
 * Idempotent via `upsert` on the String primary key.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type IndustrySeed = {
  code: string;
  nameEn: string;
  nameAz?: string;
  nameRu?: string;
  category?: string;
  sortOrder: number;
};

const INDUSTRIES: IndustrySeed[] = [
  {
    code: 'hospitality',
    nameEn: 'Hospitality',
    nameAz: 'Qonaqpərvərlik',
    nameRu: 'Гостиничный бизнес',
    category: 'services_umbrella',
    sortOrder: 10,
  },
  {
    code: 'food_processing',
    nameEn: 'Food Processing',
    nameAz: 'Qida emalı',
    nameRu: 'Пищевая переработка',
    category: 'agro_umbrella',
    sortOrder: 20,
  },
  {
    code: 'agro_crops',
    nameEn: 'Agro — Crops',
    nameAz: 'Bitkiçilik',
    nameRu: 'Растениеводство',
    category: 'agro_umbrella',
    sortOrder: 30,
  },
  {
    code: 'poultry',
    nameEn: 'Poultry',
    nameAz: 'Quşçuluq',
    nameRu: 'Птицеводство',
    category: 'agro_umbrella',
    sortOrder: 40,
  },
  {
    code: 'pharma',
    nameEn: 'Pharmaceuticals',
    nameAz: 'Əczaçılıq',
    nameRu: 'Фармацевтика',
    category: 'industrial_umbrella',
    sortOrder: 50,
  },
  {
    code: 'industrial',
    nameEn: 'Industrial',
    nameAz: 'Sənaye',
    nameRu: 'Промышленность',
    category: 'industrial_umbrella',
    sortOrder: 60,
  },
  {
    code: 'real_estate',
    nameEn: 'Real Estate',
    nameAz: 'Daşınmaz əmlak',
    nameRu: 'Недвижимость',
    category: 'services_umbrella',
    sortOrder: 70,
  },
  {
    code: 'entertainment',
    nameEn: 'Entertainment',
    nameAz: 'Əyləncə',
    nameRu: 'Развлечения',
    category: 'services_umbrella',
    sortOrder: 80,
  },
  {
    code: 'education',
    nameEn: 'Education',
    nameAz: 'Təhsil',
    nameRu: 'Образование',
    category: 'services_umbrella',
    sortOrder: 90,
  },
  {
    code: 'services',
    nameEn: 'Services',
    nameAz: 'Xidmətlər',
    nameRu: 'Услуги',
    category: 'services_umbrella',
    sortOrder: 100,
  },
  // Phase 7.C-extension — 4 sectors added 2026-04-25 to close ROADMAP
  // 44→52 indicator coverage. Codes match `industries[]` on
  // beverageIndicators / retailIndicators / logisticsIndicators /
  // constructionIndicators in src/lib/risk/indicator-seeds.ts.
  {
    code: 'beverage',
    nameEn: 'Beverage',
    nameAz: 'İçki istehsalı',
    nameRu: 'Производство напитков',
    category: 'agro_umbrella',
    sortOrder: 110,
  },
  {
    code: 'retail',
    nameEn: 'Retail',
    nameAz: 'Pərakəndə satış',
    nameRu: 'Розничная торговля',
    category: 'services_umbrella',
    sortOrder: 120,
  },
  {
    code: 'logistics',
    nameEn: 'Logistics',
    nameAz: 'Logistika',
    nameRu: 'Логистика',
    category: 'services_umbrella',
    sortOrder: 130,
  },
  {
    code: 'construction',
    nameEn: 'Construction',
    nameAz: 'Tikinti',
    nameRu: 'Строительство',
    category: 'industrial_umbrella',
    sortOrder: 140,
  },
];

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
