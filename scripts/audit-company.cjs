#!/usr/bin/env node
/**
 * Universal company audit — xlsx ↔ DB reconciliation.
 *
 * Loads a budget xlsx file, extracts the canonical P&L block (PLF.01..10)
 * from a specified sheet, then compares against:
 *   - DB IndicatorValue (period=YYYY): IND_REVENUE_TOTAL, IND_GROSS_MARGIN,
 *     IND_NET_MARGIN, IND_OPEX_RATIO, IND_COGS_INTENSITY, IND_OPEX_TO_COGS,
 *     IND_OPERATING_LEVERAGE, plus industry-specific (AGRO_*, FP_*, SVC_*).
 *   - DB BudgetLine aggregates per company / lineType for period=YYYY.
 *
 * Reports drift per line + sanity-band check per indicator. Exit code:
 *   0 — all green (drift_minor at most)
 *   1 — drift_major OR suspicious sanity band detected
 *   2 — invalid args / xlsx unreachable / DB unreachable
 *
 * Usage:
 *   node scripts/audit-company.cjs --company AZSEKER-EDEN --xlsx /path/to/budget.xlsx --sheet PL_EDEN --period 2026
 *   node scripts/audit-company.cjs --company AZSEKER --xlsx /path/to/budget.xlsx --auto --period 2026
 *   node scripts/audit-company.cjs --company AZSEKER --xlsx /path/to/budget.xlsx --auto --period 2026 --json
 *
 * --auto mode discovers child entities + maps each to sheet name via the
 * SHEET_MAP table (extend as new clusters onboard).
 */
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const { PrismaClient } = require('@prisma/client');

// Pure helpers + constants live in src/lib/audit/audit-helpers.cjs so they
// can be unit-tested from vitest (F1 closure 2026-05-16).
const {
  SHEET_MAP,
  INDICATORS_BY_INDUSTRY,
  SANITY_BANDS,
  PLF_LINES,
  classifyDrift,
  classifySanityBand,
  extractAnnualFromSheet,
  parseArgs,
  computeVerdict,
} = require('../src/lib/audit/audit-helpers.cjs');

// ── Audit a single (company, sheet) pair ────────────────────────────────────
async function auditOne(prisma, wb, company, sheetName, period, indByCode, indById) {
  const result = {
    company: company.code,
    industry: company.industry,
    sheet: sheetName,
    period,
    xlsx: {},
    db_iv: {},
    db_budget: {},
    drift: {},
    sanity: {},
    verdict: 'pending',
  };

  // Pull DB IVs.
  const ivs = await prisma.indicatorValue.findMany({
    where: { companyId: company.id, period },
    select: { indicatorId: true, value: true, status: true },
  });
  const ivMap = new Map();
  for (const iv of ivs) {
    const code = indById.get(iv.indicatorId)?.code;
    if (code) ivMap.set(code, { value: Number(iv.value), status: iv.status });
  }
  result.db_iv = Object.fromEntries(ivMap);

  // Pull BudgetLines grouped by lineType.
  const lines = await prisma.budgetLine.findMany({
    where: { plan: { is: { year: Number(period.split('-')[0]) } }, companyId: company.id },
    select: { plannedAmount: true, forecastAmount: true, lineType: true },
  });
  const byLineType = new Map();
  for (const l of lines) {
    const lt = l.lineType ?? '(none)';
    const amt = Number(l.forecastAmount ?? l.plannedAmount ?? 0);
    byLineType.set(lt, (byLineType.get(lt) ?? 0) + amt);
  }
  result.db_budget = Object.fromEntries(byLineType);
  result.db_budget._total_lines = lines.length;

  // Extract xlsx P&L lines (if sheet exists).
  const sheet = sheetName ? wb.Sheets[sheetName] : null;
  if (sheet) {
    for (const { plfCode, label, sign } of PLF_LINES) {
      const raw = extractAnnualFromSheet(sheet, plfCode);
      result.xlsx[label] = raw === null ? null : Math.abs(raw) * sign;
    }
  } else {
    for (const { label } of PLF_LINES) result.xlsx[label] = null;
  }

  // Drift checks.
  const checks = [];
  // 1. Revenue (xlsx REVENUE vs DB IND_REVENUE_TOTAL).
  const xRev = result.xlsx['REVENUE'];
  const dbRev = ivMap.get('IND_REVENUE_TOTAL')?.value ?? null;
  if (xRev !== null && dbRev !== null) {
    const driftPct = xRev === 0 ? 0 : ((dbRev - xRev) / xRev) * 100;
    const cls = classifyDrift(driftPct);
    checks.push({ name: 'Revenue (IND_REVENUE_TOTAL vs xlsx)', xlsx: xRev, db: dbRev, drift_pct: driftPct, class: cls });
    result.drift['Revenue'] = { xlsx: xRev, db: dbRev, drift_pct: driftPct, class: cls };
  }
  // 2. BudgetLine[revenue] vs xlsx REVENUE.
  const budRev = byLineType.get('revenue') ?? 0;
  if (xRev !== null && budRev !== 0) {
    const driftPct = xRev === 0 ? 0 : ((budRev - xRev) / xRev) * 100;
    const cls = classifyDrift(driftPct);
    checks.push({ name: 'Revenue (BudgetLine vs xlsx)', xlsx: xRev, db: budRev, drift_pct: driftPct, class: cls });
    result.drift['Revenue_BudgetLine'] = { xlsx: xRev, db: budRev, drift_pct: driftPct, class: cls };
  }
  // 3. COGS.
  const xCogs = result.xlsx['COST OF GOODS SOLD'];
  const budCogs = byLineType.get('cogs') ?? 0;
  if (xCogs !== null && (xCogs !== 0 || budCogs !== 0)) {
    const driftPct = xCogs === 0 ? (budCogs === 0 ? 0 : 100) : ((-budCogs - xCogs) / Math.abs(xCogs)) * 100;
    const cls = classifyDrift(driftPct);
    checks.push({ name: 'COGS (BudgetLine vs xlsx)', xlsx: xCogs, db: -budCogs, drift_pct: driftPct, class: cls });
    result.drift['COGS'] = { xlsx: xCogs, db: -budCogs, drift_pct: driftPct, class: cls };
  }
  // 4. Gross Margin (computed from xlsx vs DB IND_GROSS_MARGIN).
  const xGP = result.xlsx['GROSS PROFIT'];
  if (xRev !== null && xGP !== null && xRev > 0) {
    const xGM = (xGP / xRev) * 100;
    const dbGM = ivMap.get('IND_GROSS_MARGIN')?.value ?? null;
    if (dbGM !== null) {
      const driftPP = dbGM - xGM;
      const cls = Math.abs(driftPP) < 0.5 ? 'match' : Math.abs(driftPP) < 5 ? 'drift_minor' : 'drift_major';
      checks.push({ name: 'Gross Margin (DB vs xlsx-implied)', xlsx_pct: xGM, db_pct: dbGM, drift_pp: driftPP, class: cls });
      result.drift['Gross_Margin'] = { xlsx_pct: xGM, db_pct: dbGM, drift_pp: driftPP, class: cls };
    } else {
      checks.push({ name: 'Gross Margin (DB vs xlsx-implied)', xlsx_pct: xGM, db_pct: null, class: 'db_missing' });
      result.drift['Gross_Margin'] = { xlsx_pct: xGM, db_pct: null, class: 'db_missing' };
    }
  }

  // Sanity band classification per indicator.
  const wanted = INDICATORS_BY_INDUSTRY[company.industry] ?? ['IND_REVENUE_TOTAL'];
  for (const code of wanted) {
    const iv = ivMap.get(code);
    if (!iv) {
      result.sanity[code] = 'missing_iv';
      continue;
    }
    const band = classifySanityBand(company.industry, code, iv.value);
    result.sanity[code] = { value: iv.value, band };
  }

  // Final verdict: worst signal wins. Logic lives in audit-helpers.cjs so
  // the band-precedence ordering can be regression-tested independently.
  result.verdict = computeVerdict(checks, result.sanity);

  return result;
}

// ── Persist audit verdict back to IndicatorValue rows ───────────────────────
// When invoked with --write, this updates each IV referenced in the audit
// with sourceDocument / lastReconciledAt / reconciledBy / sanityBand so
// Panel 3 + the CompanyTree trust badge see real provenance, not nulls.
async function writeAuditToDb(prisma, result, xlsxPath, sheetName, reconciledBy) {
  if (!result || result.verdict === 'pending') return;
  const company = await prisma.company.findFirst({ where: { code: result.company }, select: { id: true } });
  if (!company) return;
  const indByCode = await prisma.indicatorDefinition.findMany({ select: { id: true, code: true } });
  const indMap = new Map(indByCode.map(i => [i.code, i.id]));
  const xlsxBaseName = xlsxPath.split('/').pop();
  const reconciledAt = new Date();
  for (const [code, snap] of Object.entries(result.sanity)) {
    if (snap === 'missing_iv' || !indMap.has(code)) continue;
    const sanityBand = typeof snap === 'object' ? snap.band : 'no_band';
    const sourceDocument = sheetName ? `${xlsxBaseName}#${sheetName}` : `${xlsxBaseName}`;
    try {
      await prisma.indicatorValue.updateMany({
        where: { companyId: company.id, indicatorId: indMap.get(code), period: result.period },
        data: {
          sourceDocument,
          lastReconciledAt: reconciledAt,
          reconciledBy,
          sanityBand,
        },
      });
    } catch (e) {
      console.error(`  ✗ write failed for ${code}:`, e.message);
    }
  }
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.company) {
    console.error('Usage: --company CODE --xlsx PATH [--sheet NAME | --auto] --period YYYY-MM|YYYY [--json]');
    process.exit(2);
  }
  if (!args.xlsx || !fs.existsSync(args.xlsx)) {
    console.error('xlsx not found:', args.xlsx);
    process.exit(2);
  }
  const period = args.period ?? '2026';
  const json = !!args.json;

  const wb = xlsx.readFile(args.xlsx);
  const prisma = new PrismaClient();
  let exitCode = 0;
  try {
    const root = await prisma.company.findFirst({
      where: { code: args.company },
      select: { id: true, code: true, name: true, industry: true },
    });
    if (!root) {
      console.error('Company not found in DB:', args.company);
      process.exit(2);
    }

    // Indicator catalog.
    const allInd = await prisma.indicatorDefinition.findMany({
      select: { id: true, code: true, unit: true },
    });
    const indByCode = new Map(allInd.map(i => [i.code, i]));
    const indById = new Map(allInd.map(i => [i.id, i]));

    // --auto: walk children, map each to SHEET_MAP entry.
    let targets;
    if (args.auto) {
      const children = await prisma.company.findMany({
        where: { parentCompanyId: root.id },
        select: { id: true, code: true, name: true, industry: true },
        orderBy: { code: 'asc' },
      });
      targets = children.map(c => ({ company: c, sheet: SHEET_MAP[c.code] ?? null }));
      if (targets.length === 0) {
        // Maybe `root` is a leaf — audit it directly.
        targets = [{ company: root, sheet: SHEET_MAP[root.code] ?? args.sheet ?? null }];
      }
    } else {
      targets = [{ company: root, sheet: args.sheet ?? SHEET_MAP[root.code] ?? null }];
    }

    const results = [];
    const reconciledBy = args['user'] ?? 'cli';
    for (const { company, sheet } of targets) {
      const r = await auditOne(prisma, wb, company, sheet, period, indByCode, indById);
      results.push(r);
      if (r.verdict === 'drift_major' || r.verdict === 'suspicious') exitCode = 1;
      // --write — persist this audit's verdict back to the affected IVs
      // so Panel 3 / trust badges immediately reflect "audited X days ago,
      // sanity=normal/high_extreme/etc.". Without this flag the audit is
      // read-only (dry-run); with it the run becomes the "official"
      // reconciliation timestamp.
      if (args.write) {
        await writeAuditToDb(prisma, r, args.xlsx, sheet, reconciledBy);
      }
    }

    // Output.
    if (json) {
      console.log(JSON.stringify({ args, results }, null, 2));
    } else {
      printHumanReport(args, results);
    }
  } finally {
    await prisma.$disconnect();
  }
  process.exit(exitCode);
})().catch(e => { console.error(e); process.exit(2); });

function printHumanReport(args, results) {
  console.log('═'.repeat(80));
  console.log('audit-company:', args.company, '· period:', args.period ?? '2026');
  console.log('xlsx:', args.xlsx);
  console.log('═'.repeat(80));
  for (const r of results) {
    const badge = { verified: '✅', partial: '🟡', suspicious: '🔴', drift_major: '🔴' }[r.verdict] ?? '⚪';
    console.log('');
    console.log(`${badge} ${r.company} (${r.industry}) · sheet=${r.sheet ?? '(none)'} · verdict=${r.verdict}`);
    console.log('─'.repeat(80));
    // Drift table.
    if (Object.keys(r.drift).length > 0) {
      console.log('  Drift checks:');
      for (const [name, d] of Object.entries(r.drift)) {
        const tag = { match: '✓', drift_minor: '~', drift_major: '✗', db_missing: '?' }[d.class] ?? '·';
        if ('drift_pct' in d) {
          console.log(`    ${tag} ${name.padEnd(28)}: xlsx=${d.xlsx?.toLocaleString() ?? '—'}  db=${d.db?.toLocaleString() ?? '—'}  drift=${d.drift_pct.toFixed(3)}%  [${d.class}]`);
        } else if ('drift_pp' in d) {
          console.log(`    ${tag} ${name.padEnd(28)}: xlsx=${d.xlsx_pct?.toFixed(2)}%  db=${d.db_pct?.toFixed(2)}%  drift=${d.drift_pp?.toFixed(2)} pp  [${d.class}]`);
        } else {
          console.log(`    ${tag} ${name.padEnd(28)}: ${JSON.stringify(d)}`);
        }
      }
    }
    // Sanity bands.
    console.log('  Sanity bands:');
    for (const [code, s] of Object.entries(r.sanity)) {
      if (s === 'missing_iv') {
        console.log(`    ? ${code.padEnd(28)}: missing_iv`);
      } else {
        const tag = { normal: '✓', low_extreme: '⚠', high_extreme: '⚠', missing_input: '?', no_band: '·' }[s.band] ?? '·';
        console.log(`    ${tag} ${code.padEnd(28)}: ${s.value?.toFixed?.(2) ?? s.value}  [${s.band}]`);
      }
    }
  }
  console.log('');
  console.log('═'.repeat(80));
  const counts = { verified: 0, partial: 0, suspicious: 0, drift_major: 0 };
  for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  console.log('Summary:', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' · '));
  console.log('═'.repeat(80));
}
