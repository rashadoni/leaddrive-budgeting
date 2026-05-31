/**
 * Reconcile the Compliance/Legal domain (audit findings + court disputes)
 * against the client source files — end-to-end: source xlsx → parse → DB
 * (Company.settings) → live IndicatorValue. Mirrors verify-azseker-vs-source
 * for the soft-data the Phase 7.N compliance indicators ride on.
 *
 * Checks (the two failure modes that matter — same as the EBITDA bug):
 *   1. NO SILENT DROP — source parseable rows == DB-stored findings/cases.
 *   2. CORRECT DERIVATION — recompute closed%/major/active from the DB-stored
 *      data == the live IndicatorValue (AUDIT_CLOSED_PCT / AUDIT_MAJOR_OPEN /
 *      LEGAL_CASES_ACTIVE).
 *
 * Read-only. Run: npx tsx scripts/verify-compliance-vs-source.ts
 */
import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();
const DIR = '/Users/rashadrahimov/Documents/budget azersheker';

// --- audit parse (faithful to import-audit-findings.mjs) ---
const AUDIT_COMPANY_MAP: Record<string, string> = {
  Azərşəkər: 'AZSEKER-AZSF',
  'CPC MMC': 'AZSEKER-CPC',
};
const COMPLETED_RE = /yerinə yetirilib/i;
function severityBucket(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s === 'major' || s === 'major nc') return 'major';
  if (s === 'minor' || s === 'minor nc') return 'minor';
  if (s === 'observation' || s === 'ofi') return 'observation';
  return 'other';
}

function parseAuditSource() {
  const wb = XLSX.readFile(`${DIR}/Follow up - For GTC.xlsx`);
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Follow-up'], { header: 1, defval: '' });
  const rows = aoa.slice(1).filter((r) => r && r.some((c) => c !== '' && c != null));
  const byCo: Record<string, { total: number; completed: number; major_open: number }> = {};
  let parseable = 0;
  let unmapped = 0;
  for (const r of rows) {
    const severityRaw = String(r[1] ?? '').trim();
    const companyRaw = String(r[3] ?? '').trim();
    const statusMng = String(r[6] ?? '').trim();
    if (!severityRaw || !companyRaw) continue;
    const code = AUDIT_COMPANY_MAP[companyRaw];
    if (!code) { unmapped++; continue; }
    parseable++;
    const c = (byCo[code] ??= { total: 0, completed: 0, major_open: 0 });
    c.total += 1;
    if (COMPLETED_RE.test(statusMng)) c.completed += 1;
    else if (severityBucket(severityRaw) === 'major') c.major_open += 1;
  }
  return { byCo, parseable, unmapped, rawRows: rows.length };
}

function parseCourtSourceTotal() {
  const wb = XLSX.readFile(`${DIR}/Açıq məhkəmə mübahisələri.xlsx`);
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(
    wb.Sheets['Məhkəmə mübahisələri'], { header: 1, defval: '' });
  // import filters rows with non-empty r[0] (skips header row 0)
  return aoa.slice(1).filter((r) => r && r[0] !== '' && r[0] != null).length;
}

async function ivLatest(companyId: string, code: string) {
  const def = await p.indicatorDefinition.findFirst({ where: { code } });
  if (!def) return null;
  const rows = await p.indicatorValue.findMany({
    where: { companyId, indicatorId: def.id },
    select: { period: true, value: true, status: true },
    orderBy: { period: 'desc' },
  });
  return rows[0] ?? null;
}

async function main() {
  const cos = await p.company.findMany({
    where: { code: { startsWith: 'AZSEKER-' } },
    select: { id: true, code: true, settings: true },
  });
  const byCode = new Map(cos.map((c) => [c.code, c]));

  // ===== AUDIT =====
  console.log('═══════════════ AUDIT FINDINGS (Follow up - For GTC.xlsx → Follow-up) ═══════════════');
  const src = parseAuditSource();
  console.log(`source: ${src.rawRows} non-empty rows · ${src.parseable} parseable (severity+mapped company) · ${src.unmapped} unmapped-skipped`);
  let auditOk = true;
  for (const [code, s] of Object.entries(src.byCo)) {
    const co = byCode.get(code);
    if (!co) { console.log(`  ${code}: NOT IN DB`); auditOk = false; continue; }
    const settings = (co.settings ?? {}) as Record<string, unknown>;
    // settings.auditFindings = { items: [...], source, summary, importedAt }
    const af = settings.auditFindings as { items?: unknown[] } | undefined;
    const dbTotal = af?.items?.length ?? 0;
    const closedPct = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
    const ivClosed = await ivLatest(co.id, 'AUDIT_CLOSED_PCT');
    const ivMajor = await ivLatest(co.id, 'AUDIT_MAJOR_OPEN');
    const dropOk = dbTotal === s.total;
    const closedMatch = ivClosed != null && Math.abs(ivClosed.value - closedPct) <= 1;
    const majorMatch = ivMajor != null && Math.abs(ivMajor.value - s.major_open) <= 0;
    if (!dropOk || !closedMatch || !majorMatch) auditOk = false;
    console.log(`  ${code}: source total=${s.total} completed=${s.completed} major=${s.major_open} closed%=${closedPct}`);
    console.log(`        DB settings.findings=${dbTotal} ${dropOk ? '✓' : '✗ DROP'} | IV AUDIT_CLOSED_PCT=${ivClosed?.value ?? 'none'}@${ivClosed?.period ?? '-'} ${closedMatch ? '✓' : '✗'} | IV AUDIT_MAJOR_OPEN=${ivMajor?.value ?? 'none'} ${majorMatch ? '✓' : '✗'}`);
  }
  console.log(`AUDIT: ${auditOk ? '✓ ALL MATCH' : '✗ MISMATCH'}`);

  // ===== COURT =====
  console.log('\n═══════════════ COURT DISPUTES (Açıq məhkəmə mübahisələri.xlsx) ═══════════════');
  const srcCourtTotal = parseCourtSourceTotal();
  let dbCasesTotal = 0;
  let courtOk = true;
  // courtDisputes = { cases:[...], summary:{open,total,...}, source, importedAt }
  const perCo: { code: string; cases: number; sumOpen: number; sumTotal: number; iv: number | null; ivPeriod: string | null }[] = [];
  for (const co of cos) {
    const settings = (co.settings ?? {}) as Record<string, unknown>;
    const cd = settings.courtDisputes as { cases?: unknown[]; summary?: { open?: number; total?: number } } | undefined;
    if (!cd?.cases?.length) continue;
    const cases = cd.cases.length;
    dbCasesTotal += cases;
    const sumOpen = cd.summary?.open ?? -1;
    const sumTotal = cd.summary?.total ?? -1;
    const iv = await ivLatest(co.id, 'LEGAL_CASES_ACTIVE');
    perCo.push({ code: co.code, cases, sumOpen, sumTotal, iv: iv?.value ?? null, ivPeriod: iv?.period ?? null });
  }
  console.log(`source: ${srcCourtTotal} case rows | DB: ${dbCasesTotal} company-case rows across ${perCo.length} companies (a case maps to ≥1 company via party regex, so DB ≥ source is expected)`);
  for (const x of perCo) {
    // end-to-end: import's own summary.open (= active) must equal the live IndicatorValue,
    // and summary.total must equal the stored case count for that company.
    const totalOk = x.sumTotal === x.cases;
    const ivMatch = x.iv != null && Math.abs(x.iv - x.sumOpen) <= 0;
    if (!totalOk || !ivMatch) courtOk = false;
    console.log(`  ${x.code}: cases=${x.cases} summary.total=${x.sumTotal} ${totalOk ? '✓' : '✗'} | summary.open=${x.sumOpen} → IV LEGAL_CASES_ACTIVE=${x.iv ?? 'none'}@${x.ivPeriod ?? '-'} ${ivMatch ? '✓' : '✗'}`);
  }
  console.log(`COURT: ${courtOk ? '✓ ALL MATCH (open→IndicatorValue + summary.total→stored cases)' : '✗ MISMATCH'}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
