#!/usr/bin/env node
/**
 * 2026-05-27 — Enable TOP_CUSTOMER_SHARE + TOP3_CUSTOMER_SHARE for all
 * 6 operational AZSEKER entities. The seed runner created the
 * IndicatorDefinitions; this opens them up per company.
 */

import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const indicators = await prisma.indicatorDefinition.findMany({
    where: { code: { in: ["TOP_CUSTOMER_SHARE", "TOP3_CUSTOMER_SHARE"] } },
    select: { id: true, code: true },
  });
  const companies = await prisma.company.findMany({
    where: {
      code: { startsWith: "AZSEKER-" },
      isActive: true,
      level: 2,
    },
    select: { id: true, code: true },
  });

  console.log(`→ Enabling ${indicators.length} indicators × ${companies.length} entities = ${indicators.length * companies.length} pairs`);

  for (const co of companies) {
    for (const ind of indicators) {
      await prisma.companyIndicator.upsert({
        where: {
          companyId_indicatorId: { companyId: co.id, indicatorId: ind.id },
        },
        update: { enabled: true },
        create: { companyId: co.id, indicatorId: ind.id, enabled: true },
      });
    }
    console.log(`  ✓ ${co.code}`);
  }

  await prisma.$disconnect();
  console.log("\n✓ Done. Run recompute next.");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
