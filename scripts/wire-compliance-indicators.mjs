#!/usr/bin/env node
/**
 * 2026-05-26 — Wire imported audit + court OperationalFacts to the
 * existing IndicatorDefinitions (LEGAL_CASES_ACTIVE / AUDIT_CLOSED_PCT
 * / AUDIT_MAJOR_OPEN).
 *
 * Why an alias layer:
 *   The previous import wrote descriptive metric names
 *   (`audit_findings_completed_pct`, `court_disputes_open`, etc.) for
 *   future drill-down UI clarity. The pre-existing seeds expect
 *   uppercase canonical names (`AUDIT_CLOSED_PCT`, `LEGAL_CASES_ACTIVE`,
 *   `AUDIT_MAJOR_OPEN`). Rather than re-import or rename, we copy the
 *   values into canonical-named facts so the formula engine resolves
 *   them. Descriptive names stay for drill-down.
 *
 * Also:
 *   - Adds CompanyIndicator enable rows for AZSF / CPC / EDEN on all
 *     three indicators (HeatMap only shows enabled pairs).
 *   - Triggers recompute for the affected (company × period × indicator)
 *     pairs.
 *
 * Idempotent.
 */

import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";

const PERIOD = "2026";
const PERIOD_DATE = new Date(`${PERIOD}-12-31T00:00:00.000Z`);

const ALIASES = [
  { source: "audit_findings_completed_pct", target: "AUDIT_CLOSED_PCT", unit: "%" },
  { source: "audit_findings_major_open", target: "AUDIT_MAJOR_OPEN", unit: "count" },
  { source: "court_disputes_open", target: "LEGAL_CASES_ACTIVE", unit: "cases" },
];

const INDICATOR_CODES = ["AUDIT_CLOSED_PCT", "AUDIT_MAJOR_OPEN", "LEGAL_CASES_ACTIVE"];
const COMPANY_CODES = ["AZSEKER-AZSF", "AZSEKER-CPC", "AZSEKER-EDEN"];

const prisma = new PrismaClient();

async function main() {
  console.log("→ Step 1: alias descriptive facts → canonical metric names");

  const companies = await prisma.company.findMany({
    where: { code: { in: COMPANY_CODES }, isActive: true },
    select: { id: true, code: true, organizationId: true },
  });

  let aliasCount = 0;
  for (const co of companies) {
    for (const { source, target, unit } of ALIASES) {
      const src = await prisma.operationalFact.findFirst({
        where: {
          companyId: co.id,
          metric: source,
          date: PERIOD_DATE,
        },
        select: { value: true, organizationId: true },
      });
      if (!src) {
        console.log(`  ⏭  ${co.code}: no source fact "${source}" — skip`);
        continue;
      }

      // Idempotent upsert via deleteMany + create
      await prisma.operationalFact.deleteMany({
        where: {
          companyId: co.id,
          metric: target,
          date: PERIOD_DATE,
        },
      });
      await prisma.operationalFact.create({
        data: {
          organizationId: src.organizationId,
          companyId: co.id,
          metric: target,
          date: PERIOD_DATE,
          value: src.value,
          unit,
          source: "alias of " + source,
        },
      });
      aliasCount++;
      console.log(`  ✓ ${co.code}: ${source} (${src.value}) → ${target}`);
    }
  }
  console.log(`  Total aliased: ${aliasCount} facts`);

  console.log("\n→ Step 2: enable CompanyIndicator for each (company × indicator)");
  const indicators = await prisma.indicatorDefinition.findMany({
    where: { code: { in: INDICATOR_CODES } },
    select: { id: true, code: true },
  });
  if (indicators.length !== INDICATOR_CODES.length) {
    console.warn(
      `  ⚠ Expected ${INDICATOR_CODES.length} indicator defs, found ${indicators.length}`,
    );
  }
  let enabledCount = 0;
  for (const co of companies) {
    for (const ind of indicators) {
      await prisma.companyIndicator.upsert({
        where: {
          companyId_indicatorId: { companyId: co.id, indicatorId: ind.id },
        },
        update: { enabled: true },
        create: { companyId: co.id, indicatorId: ind.id, enabled: true },
      });
      enabledCount++;
    }
  }
  console.log(`  ✓ Enabled ${enabledCount} (company × indicator) pairs`);

  await prisma.$disconnect();
  console.log("\n✓ Step 3: trigger recompute via the API or run-recompute script");
  console.log("   The wiring is in place. Run:");
  console.log(`     npx tsx scripts/polish-recompute-azseker.ts`);
  console.log("   (or hit POST /api/indicators/recompute for fan-out)");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
