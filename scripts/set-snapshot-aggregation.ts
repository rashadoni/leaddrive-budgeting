/**
 * One-shot: set IndicatorDefinition.aggregation='snapshot' on the 12 stock/
 * intensive indicators (the seed files already declare this; this applies it to
 * the existing global rows the migration defaulted to 'flow'). Idempotent.
 */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const SNAPSHOT = [
  'LEGAL_CASES_ACTIVE','LEGAL_CASES_TOTAL','AUDIT_CLOSED_PCT','AUDIT_MAJOR_OPEN',
  'AGRO_DROUGHT_RISK','AGRO_YIELD_PER_HA','AGRO_SUGAR_CONTENT','AGRO_WATER_INTENSITY',
  'AGRO_FERTILIZER_INTENSITY','AGRO_BUYER_CONCENTRATION','AGRO_HARVEST_PROGRESS',
  'FP_EXTRACTION_RATE',
];
(async () => {
  const before = await p.indicatorDefinition.count({ where: { code: { in: SNAPSHOT }, aggregation: 'snapshot' } });
  const r = await p.indicatorDefinition.updateMany({
    where: { code: { in: SNAPSHOT } },
    data: { aggregation: 'snapshot' },
  });
  const present = await p.indicatorDefinition.findMany({ where: { code: { in: SNAPSHOT } }, select: { code: true } });
  const found = new Set(present.map((x) => x.code));
  const missing = SNAPSHOT.filter((c) => !found.has(c));
  console.log(`snapshot codes targeted: ${SNAPSHOT.length} · matched rows updated: ${r.count} · already-snapshot before: ${before}`);
  console.log(`missing from DB (not seeded?): ${missing.length ? missing.join(', ') : 'none ✓'}`);
  // sanity: no OTHER indicator accidentally snapshot
  const totalSnap = await p.indicatorDefinition.count({ where: { aggregation: 'snapshot' } });
  console.log(`total indicators now aggregation='snapshot': ${totalSnap} (expect ${SNAPSHOT.length - missing.length})`);
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
