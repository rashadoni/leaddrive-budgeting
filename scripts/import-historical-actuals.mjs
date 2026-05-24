/**
 * import-historical.mjs
 * Imports PLF (P&L), BS, and CF historical data for 2020-2025
 * from Guvven Fin.xlsx into the budgetpro DB.
 *
 * Run:
 *   DATABASE_URL="postgresql://rashadrahimov:@localhost:5432/budgetpro" \
 *   node /tmp/claude/import-historical.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('/Users/rashadrahimov/Documents/leaddrive-budgeting/node_modules/xlsx/xlsx.js');
const { PrismaClient } = require('/Users/rashadrahimov/Documents/leaddrive-budgeting/node_modules/@prisma/client/default.js');

const prisma = new PrismaClient();
const WORKBOOK = "/Users/rashadrahimov/Documents/budget azersheker/Guvven Fin.xlsx";
const SOURCE_DOC = "Guvven Fin.xlsx (historical import 2020-2025)";
const ACTOR = "historical-import-2025-05-24";

// ── Entity config ────────────────────────────────────────────────────────────
const PLF_SHEETS = {
  'AZSEKER-CPC':  { sheet: 'PLF CPC',  years: [2022, 2023, 2024, 2025] },
  'AZSEKER-AZSF': { sheet: 'PLF AZSF', years: [2023, 2024, 2025] },
  'AZSEKER-EDEN': { sheet: 'PLF EDEN', years: [2023, 2024, 2025] },
  'AZSEKER-MALT': { sheet: 'PL Malt',  years: [2025] },
};

const BS_SHEETS = {
  'AZSEKER-CPC':  { sheet: 'BS CPC',  years: [2020, 2021, 2022, 2023, 2024, 2025] },
  'AZSEKER-AZSF': { sheet: 'BS AZSF', years: [2022, 2023, 2024, 2025] },
  'AZSEKER-EDEN': { sheet: 'BS EDEN', years: [2024, 2025] },
  'AZSEKER-MALT': { sheet: 'BS Malt', years: [2025] },
};

const CF_SHEETS = {
  'AZSEKER-CPC':  { sheet: 'CF CPC',  years: [2022, 2023, 2024, 2025] },
  'AZSEKER-AZSF': { sheet: 'CF AZSF', years: [2023, 2024, 2025] },
  'AZSEKER-EDEN': { sheet: 'CF EDEN', years: [2023, 2024, 2025] },
  'AZSEKER-MALT': { sheet: 'CF Malt', years: [2025] },
};

// ── Excel serial → {year, month 0-based} ────────────────────────────────────
function excelToYM(cell) {
  if (typeof cell !== 'number' || !Number.isFinite(cell)) return null;
  if (cell < 43000 || cell > 50000) return null; // ~2017-2036
  const d = new Date((cell - 25569) * 86400 * 1000);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 2019 || y > 2031) return null;
  return { year: y, month: d.getUTCMonth() }; // month 0-based
}

// Find header row + column positions for a target year
function findHeaderRow(aoa, preferYear) {
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const row = aoa[i] ?? [];
    const byYear = new Map();
    for (let c = 0; c < row.length; c++) {
      const ym = excelToYM(row[c]);
      if (!ym) continue;
      if (!byYear.has(ym.year)) byYear.set(ym.year, Array(12).fill(-1));
      const cols = byYear.get(ym.year);
      if (cols[ym.month] === -1) cols[ym.month] = c;
    }
    if (!byYear.has(preferYear)) continue;
    const cols = byYear.get(preferYear);
    const filled = cols.filter(v => v !== -1).length;
    if (filled < 12) continue;
    // Must be monotonic
    let mono = true;
    for (let k = 1; k < 12; k++) if (cols[k] <= cols[k-1]) { mono = false; break; }
    if (mono) return { row: i, monthCols: cols, year: preferYear };
  }
  return null;
}

// ── PLF helpers ──────────────────────────────────────────────────────────────
const PLF_LEAF_RE = /^PLF\.\d{2}\.\d{2}\.([0-9]{1,2}|[A-Za-z]{1,2})$/;

function plfAccountType(code) {
  const m = code.trim().match(/^PLF\.(\d{2})/);
  if (!m) return null;
  const s = m[1];
  if (s === '01') return 'revenue';
  if (s === '02') return 'cogs';
  if (s === '10') return null; // computed Net Profit — skip
  if (/^0[3-9]$/.test(s) || s === '12') return 'expense';
  return null;
}

// ── BS helpers ───────────────────────────────────────────────────────────────
const BS_LEAF_RE = /^BS\.\d{2}\.\d{2}\.([0-9]{1,2}|[A-Za-z]{1,2})$/;

function classifyBs(code) {
  const m = code.trim().match(/^BS\.(\d{2})\.(\d{2})?/);
  if (!m) return { lineType: null, subType: null };
  const top = m[1], sub = m[2];
  if (top === '01') {
    if (sub === '01') return { lineType: 'asset', subType: 'non_current' };
    if (sub === '02') return { lineType: 'asset', subType: 'current' };
    return { lineType: 'asset', subType: null };
  }
  if (top === '02') return { lineType: 'equity', subType: null };
  if (top === '03') {
    if (sub === '01') return { lineType: 'liability', subType: 'long_term' };
    if (sub === '02') return { lineType: 'liability', subType: 'short_term' };
    return { lineType: 'liability', subType: null };
  }
  return { lineType: null, subType: null };
}

// ── CF helpers ───────────────────────────────────────────────────────────────
const CF_LEAF_RE = /^CF\.\d{2}\.\d{2}\.([0-9]{1,2}|[A-Za-z]{1,2})$/;

function cfActivityType(code) {
  const m = code.trim().match(/^CF\.(\d{2})/);
  if (!m) return null;
  const s = m[1];
  if (s === '01') return 'operating';
  if (s === '02') return 'investing';
  if (s === '03') return 'financing';
  return null;
}

// Infer entryType from the label or default to 'outflow'
function cfEntryType(label) {
  const l = (label || '').toLowerCase();
  if (l.includes('inflow') || l.includes('daxilolma') || l.includes('receipt')) return 'inflow';
  return 'outflow';
}

// ── BudgetPlan get-or-create ─────────────────────────────────────────────────
const planCache = new Map();

async function getOrCreatePlan(orgId, year) {
  const key = `${orgId}::${year}`;
  if (planCache.has(key)) return planCache.get(key);

  let plan = await prisma.budgetPlan.findFirst({
    where: { organizationId: orgId, year, name: { contains: 'Actuals' } },
    select: { id: true, name: true },
  });

  if (!plan) {
    plan = await prisma.budgetPlan.create({
      data: {
        name: `Azərşəkər ${year} Actuals`,
        year,
        organizationId: orgId,
        status: 'active',
        periodType: 'monthly',
      },
      select: { id: true, name: true },
    });
    console.log(`  📋 Created plan: ${plan.name} (${plan.id})`);
  }

  planCache.set(key, plan);
  return plan;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Loading workbook…');
  const wb = XLSX.readFile(WORKBOOK, { cellFormula: false, cellHTML: false });

  // Org
  const org = await prisma.organization.findFirst({
    select: { id: true, name: true },
  });
  if (!org) throw new Error('No organization found in DB');
  console.log(`Org: ${org.name} (${org.id})`);

  // Companies
  const companies = await prisma.company.findMany({
    where: { code: { in: ['AZSEKER-CPC', 'AZSEKER-AZSF', 'AZSEKER-EDEN', 'AZSEKER-MALT'] } },
    select: { id: true, code: true },
  });
  const codeToId = new Map(companies.map(c => [c.code, c.id]));
  console.log('Companies loaded:', [...codeToId.keys()].join(', '), '\n');

  let totalPLF = 0, totalBS = 0, totalCF = 0;

  // ── 1. PLF ─────────────────────────────────────────────────────────────────
  console.log('=== PLF (P&L) ===');
  for (const [entityCode, cfg] of Object.entries(PLF_SHEETS)) {
    const companyId = codeToId.get(entityCode);
    if (!companyId) { console.warn(`  ${entityCode}: not in DB, skipping`); continue; }

    const ws = wb.Sheets[cfg.sheet];
    if (!ws) { console.warn(`  ${cfg.sheet}: sheet not found`); continue; }
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });

    for (const year of cfg.years) {
      const hdr = findHeaderRow(aoa, year);
      if (!hdr) { console.log(`  ${entityCode} ${year}: no 12-month header for year ${year}`); continue; }

      const plan = await getOrCreatePlan(org.id, year);
      const rows = [];

      for (let ri = hdr.row + 1; ri < aoa.length; ri++) {
        const row = aoa[ri] ?? [];
        const raw_code = row[0];
        if (!raw_code || typeof raw_code !== 'string') continue;
        const code = raw_code.trim();
        if (!PLF_LEAF_RE.test(code)) continue;

        const accountType = plfAccountType(code);
        if (!accountType) continue;

        const normalizeSign = accountType === 'cogs' || accountType === 'expense';

        for (let m = 0; m < 12; m++) {
          const colIdx = hdr.monthCols[m];
          if (colIdx === -1) continue;
          const val = row[colIdx];
          if (val === null || val === undefined) continue;
          const num = typeof val === 'number' ? val : parseFloat(val);
          if (!Number.isFinite(num) || num === 0) continue;

          rows.push({
            organizationId: org.id,
            planId: plan.id,
            companyId,
            category: code,
            lineType: accountType,
            plannedAmount: normalizeSign ? -num : num,
            currencyCode: 'AZN',
            exchangeRate: null,
            monthIndex: m,
            accountId: null,
            sourceDocument: `${SOURCE_DOC}#${cfg.sheet}`,
          });
        }
      }

      if (rows.length === 0) { console.log(`  ${entityCode} ${year}: 0 rows`); continue; }

      // Soft-delete existing for this plan+company
      await prisma.budgetLine.updateMany({
        where: { organizationId: org.id, planId: plan.id, companyId, deletedAt: null },
        data: { deletedAt: new Date(), deletedBy: ACTOR },
      });
      const res = await prisma.budgetLine.createMany({ data: rows });
      console.log(`  ✓ ${entityCode} ${year}: ${res.count} PLF rows`);
      totalPLF += res.count;
    }
  }

  // ── 2. BS ──────────────────────────────────────────────────────────────────
  console.log('\n=== BS (Balance Sheet) ===');
  for (const [entityCode, cfg] of Object.entries(BS_SHEETS)) {
    const companyId = codeToId.get(entityCode);
    if (!companyId) { console.warn(`  ${entityCode}: not in DB, skipping`); continue; }

    const ws = wb.Sheets[cfg.sheet];
    if (!ws) { console.warn(`  ${cfg.sheet}: sheet not found`); continue; }
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });

    for (const year of cfg.years) {
      const hdr = findHeaderRow(aoa, year);
      if (!hdr) { console.log(`  ${entityCode} ${year}: no 12-month BS header for year ${year}`); continue; }

      const plan = await getOrCreatePlan(org.id, year);
      const rows = [];

      for (let ri = hdr.row + 1; ri < aoa.length; ri++) {
        const row = aoa[ri] ?? [];
        const raw_code = row[0];
        if (!raw_code || typeof raw_code !== 'string') continue;
        const code = raw_code.trim();
        // Accept leaf codes (BS.01.01.01) OR mid-level like BS.01.01 that have data
        if (!/^BS\.\d{2}/.test(code)) continue;

        const { lineType, subType } = classifyBs(code);
        if (!lineType) continue;

        const label = typeof row[1] === 'string' ? row[1].trim() : code;

        for (let m = 0; m < 12; m++) {
          const colIdx = hdr.monthCols[m];
          if (colIdx === -1) continue;
          const val = row[colIdx];
          if (val === null || val === undefined) continue;
          const num = typeof val === 'number' ? val : parseFloat(val);
          if (!Number.isFinite(num) || num === 0) continue;

          rows.push({
            organizationId: org.id,
            planId: plan.id,
            accountCode: code,
            accountName: label,
            lineType,
            subType,
            year,
            month: m + 1, // 1-based
            amount: num,
            notes: `${entityCode} | ${SOURCE_DOC}#${cfg.sheet}`,
          });
        }
      }

      if (rows.length === 0) { console.log(`  ${entityCode} ${year}: 0 BS rows`); continue; }

      // Soft-delete existing BS rows for this plan+year
      await prisma.balanceSheetLine.updateMany({
        where: { organizationId: org.id, planId: plan.id, year, deletedAt: null },
        data: { deletedAt: new Date(), deletedBy: ACTOR },
      });
      const res = await prisma.balanceSheetLine.createMany({ data: rows });
      console.log(`  ✓ ${entityCode} ${year}: ${res.count} BS rows`);
      totalBS += res.count;
    }
  }

  // ── 3. CF ──────────────────────────────────────────────────────────────────
  console.log('\n=== CF (Cash Flow) ===');
  for (const [entityCode, cfg] of Object.entries(CF_SHEETS)) {
    const ws = wb.Sheets[cfg.sheet];
    if (!ws) { console.warn(`  ${cfg.sheet}: sheet not found`); continue; }
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false });

    for (const year of cfg.years) {
      const hdr = findHeaderRow(aoa, year);
      if (!hdr) { console.log(`  ${entityCode} ${year}: no 12-month CF header for year ${year}`); continue; }

      const rows = [];

      for (let ri = hdr.row + 1; ri < aoa.length; ri++) {
        const row = aoa[ri] ?? [];
        const raw_code = row[0];
        if (!raw_code || typeof raw_code !== 'string') continue;
        const code = raw_code.trim();
        if (!CF_LEAF_RE.test(code)) continue;

        const activityType = cfActivityType(code);
        if (!activityType) continue;

        const label = typeof row[1] === 'string' ? row[1].trim() : code;
        const entryType = cfEntryType(label);

        for (let m = 0; m < 12; m++) {
          const colIdx = hdr.monthCols[m];
          if (colIdx === -1) continue;
          const val = row[colIdx];
          if (val === null || val === undefined) continue;
          const num = typeof val === 'number' ? val : parseFloat(val);
          if (!Number.isFinite(num) || num === 0) continue;

          rows.push({
            organizationId: org.id,
            year,
            month: m + 1, // 1-based
            entryType,
            source: 'workbook-cf-historical',
            sourceId: `${entityCode}::${code}`,
            amount: Math.abs(num), // CF stored as absolute; sign = entryType
            currencyCode: 'AZN',
            description: label,
            activityType,
            category: `${entityCode}-${code}`,
            isProjected: false, // historical actuals
          });
        }
      }

      if (rows.length === 0) { console.log(`  ${entityCode} ${year}: 0 CF rows`); continue; }

      // Remove existing CF rows for this entity+year (source-tagged)
      await prisma.cashFlowEntry.deleteMany({
        where: {
          organizationId: org.id,
          year,
          source: 'workbook-cf-historical',
          sourceId: { startsWith: `${entityCode}::` },
        },
      });
      const res = await prisma.cashFlowEntry.createMany({ data: rows });
      console.log(`  ✓ ${entityCode} ${year}: ${res.count} CF rows`);
      totalCF += res.count;
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`PLF rows inserted: ${totalPLF}`);
  console.log(`BS  rows inserted: ${totalBS}`);
  console.log(`CF  rows inserted: ${totalCF}`);
  console.log(`Total: ${totalPLF + totalBS + totalCF}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
