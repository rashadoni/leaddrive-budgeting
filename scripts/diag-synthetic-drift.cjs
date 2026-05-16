#!/usr/bin/env node
/**
 * V2 — synthetic drift event injector.
 *
 * Inserts a fake `reconciliation_drift_detected` AuditEvent so the
 * /budgeting/admin/drift dashboard has visible red-row content during
 * a no-real-drift demo / smoke test.
 *
 * Run once: `node scripts/diag-synthetic-drift.cjs --insert`
 * Cleanup:  `node scripts/diag-synthetic-drift.cjs --delete`
 *
 * Idempotent on `--insert`: writes a single row tagged with
 * `metadata.synthetic: true`. `--delete` removes all such rows.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) args[a.slice(2)] = true;
  }
  return args;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.insert && !args.delete) {
    console.error('Usage: node scripts/diag-synthetic-drift.cjs --insert | --delete');
    process.exit(2);
  }

  if (args.delete) {
    // Find by metadata.synthetic = true (JSON path predicate).
    const rows = await prisma.auditEvent.findMany({
      where: {
        action: 'reconciliation_drift_detected',
      },
      select: { id: true, metadata: true },
    });
    const synthetic = rows.filter((r) => {
      const m = r.metadata;
      return m && typeof m === 'object' && 'synthetic' in m && m.synthetic === true;
    });
    if (synthetic.length === 0) {
      console.log('No synthetic drift events to delete.');
      return;
    }
    await prisma.auditEvent.deleteMany({
      where: { id: { in: synthetic.map((r) => r.id) } },
    });
    console.log(`Deleted ${synthetic.length} synthetic drift event(s).`);
    return;
  }

  // --insert path
  const company = await prisma.company.findFirst({
    where: { code: 'AZSEKER-AZSF' },
    select: { id: true, code: true, organizationId: true },
  });
  if (!company) {
    console.error('Company AZSEKER-AZSF not found. Aborting.');
    process.exit(1);
  }

  const event = await prisma.auditEvent.create({
    data: {
      organizationId: company.organizationId,
      actorUserId: null,
      action: 'reconciliation_drift_detected',
      entityType: 'Company',
      entityId: company.id,
      metadata: {
        synthetic: true,
        runBy: 'diag-synthetic-drift',
        drifts: [
          {
            indicatorCode: 'FP_GROSS_MARGIN',
            beforeBand: 'normal',
            afterBand: 'high_extreme',
            beforeValue: 19.12,
            afterValue: 100.0,
            valueDriftPct: 422.78,
            bandChanged: true,
          },
          {
            indicatorCode: 'FP_OPEX_RATIO',
            beforeBand: 'no_band',
            afterBand: 'high_extreme',
            beforeValue: 28.82,
            afterValue: 164.74,
            valueDriftPct: 471.62,
            bandChanged: true,
          },
        ],
      },
    },
  });
  console.log('Created synthetic drift event:');
  console.log('  id:', event.id);
  console.log('  company:', company.code);
  console.log('  action:', event.action);
  console.log('');
  console.log('Open /budgeting/admin/drift to see it in the Recent drift events section.');
  console.log('Cleanup: node scripts/diag-synthetic-drift.cjs --delete');
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
