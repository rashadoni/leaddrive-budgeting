/**
 * Purge orphaned predictive-breach forecasts — rows in `predictive_breaches`
 * whose `companyId` does NOT reference an existing Company. These are stale /
 * mock (`cmockji…`) forecasts that the 2026-06-01 API filter already HIDES from
 * the UI; this physically removes them so the table holds only real-company data.
 *
 * SAFE BY CONSTRUCTION: deletes ONLY rows whose company doesn't exist (unusable
 * by definition). Real-company forecasts are preserved + verified > 0 after.
 *
 *   npx tsx scripts/purge-orphan-breaches.ts          # DRY RUN (counts only)
 *   npx tsx scripts/purge-orphan-breaches.ts --apply  # delete the orphans
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`\n=== purge-orphan-breaches — ${apply ? "APPLY (deleting)" : "DRY RUN (counts only)"} ===\n`);

  const realIds = (await prisma.company.findMany({ select: { id: true } })).map((c) => c.id);
  const total = await prisma.predictiveBreach.count();
  const orphan = await prisma.predictiveBreach.count({ where: { companyId: { notIn: realIds } } });
  const keep = total - orphan;

  // Show the distinct orphan companyIds (proof they're mock/non-existent).
  const orphanRows = await prisma.predictiveBreach.groupBy({
    by: ["companyId"],
    where: { companyId: { notIn: realIds } },
    _count: { _all: true },
  });
  console.log(`predictive_breaches total: ${total}`);
  console.log(`  ORPHAN (company does not exist) → DELETE: ${orphan} across ${orphanRows.length} dead companyIds`);
  for (const r of orphanRows.slice(0, 12)) console.log(`    ${r.companyId}  (${r._count._all})`);
  console.log(`  REAL (preserved): ${keep}`);

  if (!apply) {
    console.log("\nDRY RUN — nothing deleted. Re-run with --apply.\n");
    await prisma.$disconnect();
    return;
  }

  const res = await prisma.predictiveBreach.deleteMany({ where: { companyId: { notIn: realIds } } });
  const after = await prisma.predictiveBreach.count();
  const afterReal = await prisma.predictiveBreach.count({ where: { companyId: { in: realIds } } });
  console.log(`\n✓ Deleted ${res.count}. Table now ${after} rows (real preserved: ${afterReal}).\n`);
  if (afterReal !== keep) console.error(`⚠ PRESERVE MISMATCH: expected ${keep} real, got ${afterReal}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
