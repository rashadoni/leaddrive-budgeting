#!/usr/bin/env node
/**
 * Financial-truth-infra Phase D.1 — drift watchdog.
 *
 * Reads a source-of-record registry mapping each company → its
 * authoritative xlsx + sheet + period, re-runs audit-company.cjs for
 * every entry, then compares the new verdict to the most-recent
 * sanityBand stored on each IndicatorValue. Drifts (band changed,
 * value drifted by > THRESHOLD%) emit audit-log entries + are summarized
 * to stdout / a JSON report file.
 *
 * Run via cron / launchd / GitHub Actions nightly. Failed runs leave
 * existing audit metadata in place (no destructive writes on error).
 *
 * Usage:
 *   node scripts/drift-watchdog.cjs --registry data/onboarding-source-registry.json
 *   node scripts/drift-watchdog.cjs --registry path/to/registry.json --report /tmp/drift-2026-05-16.json
 *
 * Exit codes:
 *   0 — no drift detected
 *   1 — drift detected (one or more entries showed status change or > threshold delta)
 *   2 — bad args / registry not parsable / DB unreachable
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const DRIFT_THRESHOLD_PCT = 0.5; // 0.5% considered material drift

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) args[k] = true;
      else { args[k] = v; i++; }
    }
  }
  return args;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const registryPath = args.registry ?? 'data/onboarding-source-registry.json';
  if (!fs.existsSync(registryPath)) {
    console.error(`Registry not found at ${registryPath}.`);
    console.error('Copy data/onboarding-source-registry.example.json and fill in paths.');
    process.exit(2);
  }
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  // Drop the metadata sentinel key if present.
  for (const k of Object.keys(registry)) if (k.startsWith('_')) delete registry[k];

  const prisma = new PrismaClient();
  const reportPath = args.report ?? null;
  const report = {
    runAt: new Date().toISOString(),
    registry: registryPath,
    threshold_pct: DRIFT_THRESHOLD_PCT,
    entries: [],
    summary: { ok: 0, drift: 0, error: 0 },
  };

  console.log('═'.repeat(80));
  console.log('drift-watchdog · run at', report.runAt);
  console.log('registry:', registryPath, '·', Object.keys(registry).length, 'entries');
  console.log('drift threshold:', DRIFT_THRESHOLD_PCT, '%');
  console.log('═'.repeat(80));

  let anyDrift = false;
  try {
    for (const [companyCode, cfg] of Object.entries(registry)) {
      console.log('\n→', companyCode, '·', cfg.xlsx, cfg.sheet ? `#${cfg.sheet}` : '');
      if (!fs.existsSync(cfg.xlsx)) {
        console.log('  ✗ xlsx not found, skipping');
        report.entries.push({ companyCode, status: 'error', reason: 'xlsx not found' });
        report.summary.error++;
        continue;
      }

      // Snapshot current sanityBand BEFORE running audit so we can diff.
      const company = await prisma.company.findFirst({
        where: { code: companyCode },
        select: { id: true },
      });
      if (!company) {
        console.log('  ✗ company not found in DB');
        report.entries.push({ companyCode, status: 'error', reason: 'company not in DB' });
        report.summary.error++;
        continue;
      }
      const ivsBefore = await prisma.indicatorValue.findMany({
        where: { companyId: company.id, period: cfg.period ?? '2026', lastReconciledAt: { not: null } },
        select: { indicatorId: true, sanityBand: true, value: true, indicator: { select: { code: true } } },
      });
      const beforeMap = new Map(ivsBefore.map((iv) => [iv.indicator.code, iv]));

      // Run audit-company.cjs with --write so DB sanityBand updates.
      const auditArgs = [
        path.join(__dirname, 'audit-company.cjs'),
        '--company', companyCode,
        '--xlsx', cfg.xlsx,
        '--period', cfg.period ?? '2026',
        '--write',
        '--user', 'drift-watchdog',
        '--json',
      ];
      if (cfg.sheet) auditArgs.push('--sheet', cfg.sheet);
      const child = spawnSync('node', auditArgs, { encoding: 'utf8' });
      if (child.status === 2) {
        console.log('  ✗ audit-company error:', child.stderr.split('\n')[0]);
        report.entries.push({ companyCode, status: 'error', reason: child.stderr.split('\n')[0] });
        report.summary.error++;
        continue;
      }

      // Compare new sanityBand to before-snapshot.
      const ivsAfter = await prisma.indicatorValue.findMany({
        where: { companyId: company.id, period: cfg.period ?? '2026', lastReconciledAt: { not: null } },
        select: { indicatorId: true, sanityBand: true, value: true, indicator: { select: { code: true } } },
      });
      const drifts = [];
      for (const iv of ivsAfter) {
        const before = beforeMap.get(iv.indicator.code);
        if (!before) continue;
        const bandChanged = before.sanityBand !== iv.sanityBand;
        const valueDrift =
          Math.abs((Number(iv.value) - Number(before.value)) /
            Math.max(Math.abs(Number(before.value)), 1)) * 100;
        if (bandChanged || valueDrift > DRIFT_THRESHOLD_PCT) {
          drifts.push({
            indicatorCode: iv.indicator.code,
            beforeBand: before.sanityBand,
            afterBand: iv.sanityBand,
            beforeValue: Number(before.value),
            afterValue: Number(iv.value),
            valueDriftPct: valueDrift,
            bandChanged,
          });
        }
      }
      if (drifts.length > 0) {
        anyDrift = true;
        report.summary.drift++;
        console.log(`  🔴 drift: ${drifts.length} indicator(s) changed`);
        for (const d of drifts) {
          console.log(
            `     · ${d.indicatorCode}: band ${d.beforeBand} → ${d.afterBand}, ` +
              `value ${d.beforeValue.toLocaleString()} → ${d.afterValue.toLocaleString()} ` +
              `(${d.valueDriftPct.toFixed(2)}%)`,
          );
        }
        // Audit-log entry — use `actorUserId=null` since this runs from
        // a CLI script (no logged-in user); stamp the runner identity
        // in metadata.runBy so the dashboard can show it.
        try {
          const orgId = (
            await prisma.company.findUnique({
              where: { id: company.id },
              select: { organizationId: true },
            })
          ).organizationId;
          await prisma.auditEvent.create({
            data: {
              organizationId: orgId,
              actorUserId: null,
              action: 'reconciliation_drift_detected',
              entityType: 'Company',
              entityId: company.id,
              metadata: { drifts, runBy: 'drift-watchdog' },
            },
          });
        } catch (e) {
          console.log('  (audit_log write failed:', e.message, ')');
        }
      } else {
        report.summary.ok++;
        console.log('  ✓ no drift');
      }
      report.entries.push({ companyCode, status: drifts.length > 0 ? 'drift' : 'ok', drifts });
    }

    console.log('\n' + '═'.repeat(80));
    console.log(
      'Summary:',
      `ok=${report.summary.ok} · drift=${report.summary.drift} · error=${report.summary.error}`,
    );
    console.log('═'.repeat(80));

    if (reportPath) {
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log('\nReport written to', reportPath);
    }
  } finally {
    await prisma.$disconnect();
  }
  process.exit(anyDrift ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
