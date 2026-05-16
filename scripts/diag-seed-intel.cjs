#!/usr/bin/env node
/**
 * V3 — synthetic IntelDataPoint seeder.
 *
 * The drift dashboard's `referenceFreshness` panel shows `missing` for
 * every source until at least one IntelDataPoint row exists per
 * (organizationId, sourceCode). This script seeds a single row per
 * source so the freshness card transitions to `fresh` and proves the
 * end-to-end wiring works without waiting for the real scheduler to run.
 *
 * Usage:
 *   node scripts/diag-seed-intel.cjs --insert
 *   node scripts/diag-seed-intel.cjs --insert --source weather-openmeteo
 *   node scripts/diag-seed-intel.cjs --delete
 *
 * Idempotent on `--insert`: every row carries `raw.synthetic = true` so
 * `--delete` can sweep without touching real data. By default seeds ALL
 * 5 sources from DEFAULT_SOURCES; `--source <code>` narrows to one.
 */
const { PrismaClient } = require('@prisma/client');
const { parseArgs } = require('../src/lib/audit/audit-helpers.cjs');

// One representative metric per source so the row is realistic enough
// for the freshness path (`groupBy { by: metric }` returns a non-zero
// count). Pick the dominant metric each adapter emits.
const SEED_METRICS = {
  'tcmb-fx-rates': { metric: 'USD_AZN', value: 1.7, unit: 'ratio' },
  'worldbank-cpi': { metric: 'AZ_CPI_YOY', value: 8.2, unit: '%' },
  'commodities-rss-brent': { metric: 'BRENT_USD_BBL', value: 82.5, unit: 'USD/bbl' },
  'weather-openmeteo': { metric: 'RAINFALL_MM_30D', value: 24.7, unit: 'mm' },
  'worldbank-sugar': { metric: 'SUGAR_RAW_USD_TONNE', value: 540.0, unit: 'USD/tonne' },
};

const prisma = new PrismaClient();

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.insert && !args.delete) {
    console.error('Usage: node scripts/diag-seed-intel.cjs --insert | --delete [--source CODE]');
    process.exit(2);
  }

  // Operate on the first organization we find — diagnostic scripts are
  // single-org tools. Multi-org deployments can `--org <id>` if needed.
  const org = args.org
    ? await prisma.organization.findUnique({ where: { id: args.org }, select: { id: true, name: true } })
    : await prisma.organization.findFirst({ select: { id: true, name: true } });
  if (!org) {
    console.error('No organization found.');
    process.exit(1);
  }

  const sourceFilter = args.source ? [args.source] : Object.keys(SEED_METRICS);
  const unknown = sourceFilter.filter((s) => !SEED_METRICS[s]);
  if (unknown.length > 0) {
    console.error('Unknown sourceCode(s):', unknown.join(', '));
    console.error('Valid:', Object.keys(SEED_METRICS).join(', '));
    process.exit(2);
  }

  if (args.delete) {
    // Sweep synthetic rows only — match on raw.synthetic = true.
    const rows = await prisma.intelDataPoint.findMany({
      where: {
        organizationId: org.id,
        sourceCode: { in: sourceFilter },
      },
      select: { id: true, raw: true, sourceCode: true },
    });
    const synthetic = rows.filter((r) => {
      const raw = r.raw;
      return raw && typeof raw === 'object' && 'synthetic' in raw && raw.synthetic === true;
    });
    if (synthetic.length === 0) {
      console.log('No synthetic IntelDataPoint rows to delete.');
      return;
    }
    await prisma.intelDataPoint.deleteMany({
      where: { id: { in: synthetic.map((r) => r.id) } },
    });
    console.log(`Deleted ${synthetic.length} synthetic IntelDataPoint row(s):`);
    for (const r of synthetic) console.log('  -', r.sourceCode);
    return;
  }

  // --insert path
  const now = new Date();
  for (const sourceCode of sourceFilter) {
    const { metric, value, unit } = SEED_METRICS[sourceCode];
    // datetime represents the period the row applies to; for daily we
    // use "now"; for monthly we use "today" rounded to month-start.
    const datetime = now;
    try {
      await prisma.intelDataPoint.upsert({
        where: {
          organizationId_sourceCode_metric_datetime: {
            organizationId: org.id,
            sourceCode,
            metric,
            datetime,
          },
        },
        update: { value, unit, raw: { synthetic: true, seededBy: 'diag-seed-intel' } },
        create: {
          organizationId: org.id,
          sourceCode,
          metric,
          datetime,
          value,
          unit,
          raw: { synthetic: true, seededBy: 'diag-seed-intel' },
        },
      });
      console.log(`  ✓ ${sourceCode} / ${metric} = ${value} ${unit ?? ''}`);
    } catch (e) {
      console.error(`  ✗ ${sourceCode} / ${metric}: ${e.message}`);
    }
  }
  console.log('');
  console.log(`Seeded ${sourceFilter.length} source(s) into org ${org.name} (${org.id}).`);
  console.log('Open /budgeting/admin/drift — freshness cards should show "fresh" now.');
  console.log('Cleanup: node scripts/diag-seed-intel.cjs --delete');
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
