/**
 * One-off cleanup after Turn-23 Phase-2 live verification.
 *
 * The /apply path created an "AI-Imported 2026 Budget" plan parallel to
 * the CLI's "AZMADE 2026 Budget" plan, doubling SPARK-MAIN BudgetLines
 * (89 + 89 = 178) and thus skewing recompute totals. This script:
 *   1. Soft-deletes BudgetLines under the AI-Imported plan
 *   2. Soft-deletes the AI-Imported BudgetPlan
 *   3. Re-runs recompute on SPARK-MAIN to restore correct IndicatorValue
 *      rows
 *   4. Marks the verifying ImportStaging row as 'discarded' so it doesn't
 *      hang around as 'applied' against a deleted plan
 *
 * Idempotent — re-running is safe.
 *
 * After running, baseline matrix counts (12g/15a/9r) should be restored.
 *
 * DELETE WHEN PHASE 2 VERIFICATION CLEANUP IS DONE — single-purpose script.
 */
import { PrismaClient } from '@prisma/client';
import { runRecomputeForCompanies } from '../src/lib/risk/recompute-trigger';

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: 'azmade' }, select: { id: true } });
  if (!org) throw new Error('azmade org not found');

  const aiPlan = await prisma.budgetPlan.findFirst({
    where: { organizationId: org.id, year: 2026, name: 'AI-Imported 2026 Budget', deletedAt: null },
    select: { id: true },
  });
  if (!aiPlan) {
    console.log('No AI-Imported 2026 Budget plan to clean — already removed.');
  } else {
    const del = await prisma.budgetLine.deleteMany({
      where: { organizationId: org.id, planId: aiPlan.id },
    });
    console.log(`Deleted ${del.count} BudgetLines from AI-Imported plan`);
    await prisma.budgetPlan.update({
      where: { id: aiPlan.id },
      data: { deletedAt: new Date() },
    });
    console.log('Soft-deleted AI-Imported plan');
  }

  // Discard any 'applied' staging rows pointing at deleted plans.
  const sparkCo = await prisma.company.findFirst({
    where: { organizationId: org.id, code: 'SPARK-MAIN' },
    select: { id: true },
  });
  if (sparkCo) {
    const stagingDiscard = await prisma.importStaging.updateMany({
      where: { organizationId: org.id, companyId: sparkCo.id, status: 'applied' },
      data: { status: 'discarded' },
    });
    console.log(`Discarded ${stagingDiscard.count} stale applied staging rows`);

    await runRecomputeForCompanies(prisma, org.id, [{ companyId: sparkCo.id, year: 2026 }], {
      pairError: (label, err) => console.error(`  ✗ ${label}:`, err instanceof Error ? err.message : err),
      done: (msg) => console.log(`  ✓ ${msg}`),
    });
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
