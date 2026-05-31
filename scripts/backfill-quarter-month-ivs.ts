/**
 * Phase 7.G CLI follow-up — backfill quarterly + monthly IndicatorValues.
 *
 * The default `runRecomputeForCompanies` trigger writes only annual
 * IVs (period = "YYYY"). Period chips in the HeatMap (Q1..Q4 + M1..M12)
 * fetch the matrix at those granular periods and find empty data — so
 * clicking Q1 shows a blank grid.
 *
 * This script bypasses the year-locked trigger and calls the lower-level
 * `recomputeIndicator(ds, { period: 'YYYY-QN' | 'YYYY-MM', ... })` for
 * each (company × indicator × period) pair across all 16 sub-year periods
 * of the requested year(s). The resolver already supports the period
 * granularity (`sortOrderFilter` in `src/lib/risk/recompute.ts:511`)
 * via the BudgetLine.monthIndex column.
 *
 * Cost: 13 ops cos × ~10 indicators × 16 periods + 7 parents × 1 rollup ×
 * 16 periods ≈ 2200 pairs ≈ 30s on local Postgres.
 *
 * Usage:
 *   npx tsx scripts/backfill-quarter-month-ivs.ts --org=azmade --years=2026
 *   npx tsx scripts/backfill-quarter-month-ivs.ts --org=azmade --years=2026 --dry-run
 */

import { PrismaClient } from '@prisma/client';
import { recomputeIndicator } from '../src/lib/risk/recompute';
import {
  filterOperationalCompanies,
  filterRollupParentCompanies,
  isRollupIndicator,
  matchCompaniesToIndicators,
  preferOrgScopedDefinitions,
} from '../src/lib/risk/targets';
import { createPrismaDataSource } from '../src/lib/risk/recompute';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? 'true'];
    }),
);

const orgSlug = args.org ?? 'azmade';
const years = (args.years ?? '2026').split(',').map((s) => parseInt(s.trim(), 10));
const dryRun = args['dry-run'] === 'true';

function periodsForYear(year: number): string[] {
  const out: string[] = [];
  for (let q = 1; q <= 4; q++) out.push(`${year}-Q${q}`);
  for (let m = 1; m <= 12; m++) out.push(`${year}-${String(m).padStart(2, '0')}`);
  return out;
}

async function main() {
  const prisma = new PrismaClient();
  const org = await prisma.organization.findFirst({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) throw new Error(`Org ${orgSlug} not found`);

  const companies = await prisma.company.findMany({
    where: { organizationId: org.id, isActive: true },
    select: {
      id: true, code: true, industry: true, level: true, isActive: true, role: true, baseCurrencyCode: true,
    },
  });
  const operational = filterOperationalCompanies(companies);
  const operationalIndustries = [...new Set(operational.map((c) => c.industry))];

  const allDefs = await prisma.indicatorDefinition.findMany({
    where: {
      isActive: true,
      OR: [{ organizationId: null }, { organizationId: org.id }],
      AND: [{ OR: [{ industries: { isEmpty: true } }, { industries: { hasSome: operationalIndustries } }] }],
    },
    select: {
      id: true, organizationId: true, code: true, formula: true, sparklineFormula: true,
      thresholds: true, requiredInputs: true, industries: true, isActive: true, unit: true,
      aggregation: true, // 2026-05-31 — snapshot/flow → ctx.aggregation (else this backfill re-averages snapshot metrics)
    },
  });
  const defs = preferOrgScopedDefinitions(allDefs);
  const rollupDefs = defs.filter((d) => isRollupIndicator(d) && d.industries.length === 0);
  const parents = rollupDefs.length > 0
    ? filterRollupParentCompanies(
        await prisma.company.findMany({
          where: { organizationId: org.id, level: 1, isActive: true },
          select: { id: true, code: true, industry: true, level: true, isActive: true, role: true, baseCurrencyCode: true },
        }),
      )
    : [];

  const ds = createPrismaDataSource(prisma);

  let total = 0;
  let ok = 0;
  let unknown = 0;
  let failed = 0;

  for (const year of years) {
    const periods = periodsForYear(year);
    const opTargets = matchCompaniesToIndicators(operational, defs);
    const parentTargets = parents.flatMap((p) => rollupDefs.map((d) => ({ company: p, definition: d })));
    const targets = [...opTargets, ...parentTargets];
    const periodCount = periods.length * targets.length;
    console.log(`Year ${year}: ${periods.length} sub-year periods × ${targets.length} (co × ind) = ${periodCount} target IVs`);
    if (dryRun) { total += periodCount; continue; }

    for (const period of periods) {
      for (const { company, definition } of targets) {
        try {
          const result = await recomputeIndicator(ds, {
            organizationId: org.id,
            companyId: company.id,
            definition: {
              id: definition.id,
              code: definition.code,
              formula: definition.formula,
              sparklineFormula: definition.sparklineFormula,
              thresholds: definition.thresholds as never,
              requiredInputs: definition.requiredInputs,
              unit: definition.unit,
              aggregation: definition.aggregation, // 2026-05-31 — snapshot/flow
            },
            period,
            baseCurrency: company.baseCurrencyCode ?? undefined,
          });
          if (result.status === 'unknown') unknown++;
          else ok++;
          total++;
        } catch (err) {
          failed++;
          total++;
          if (failed <= 5) console.log(`  ⚠ ${company.code}/${definition.code}@${period}: ${(err as Error).message}`);
        }
      }
    }
  }
  console.log(`\n✓ Done: total=${total}, ok=${ok}, unknown=${unknown}, failed=${failed}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
