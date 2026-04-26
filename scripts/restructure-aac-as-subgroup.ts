/**
 * One-shot script: restore AAC as sub-group level=1 wrapper + AAC-MAIN level=2
 * operational child. Counterpart to Turn-14 restructure (which had collapsed
 * the AAC level-1 wrapper). Per Turn-29 user clarification: AAC должен входить
 * в список sub-groups symmetrically with ATL/SPARK/ZTP/LLS.
 *
 * Idempotent: if AAC already at level=1 + AAC-MAIN exists at level=2, no-op.
 *
 * Operations (atomic transaction):
 * 1. Find current AAC (level=2, role=operational, parent=NULL, ~90 BudgetLines)
 * 2. Rename it → AAC-MAIN (level=2, role=operational); FK by id preserved so
 *    BudgetLines, IndicatorValues, etc. all stay attached
 * 3. Create new AAC company (level=1, role=operational, parent=NULL) as wrapper
 * 4. Set AAC-MAIN.parentCompanyId → new AAC wrapper id
 * 5. Verify BudgetLines count unchanged + IndicatorValues unchanged
 *
 * Safe to delete after use (or keep as documentation of the structure choice).
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ORG_SLUG = "azmade";

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!org) {
    throw new Error(`Org "${ORG_SLUG}" not found`);
  }

  const result = await prisma.$transaction(async (tx) => {
    // ---- IDEMPOTENCY GUARD ----
    const aacWrapperExisting = await tx.company.findFirst({
      where: { organizationId: org.id, code: "AAC", level: 1 },
    });
    const aacMainExisting = await tx.company.findFirst({
      where: { organizationId: org.id, code: "AAC-MAIN", level: 2 },
    });
    if (aacWrapperExisting && aacMainExisting) {
      return {
        status: "noop",
        reason: "AAC sub-group structure already in place",
        wrapperId: aacWrapperExisting.id,
        mainId: aacMainExisting.id,
      };
    }

    // ---- CURRENT STATE ----
    const aacCurrent = await tx.company.findFirst({
      where: { organizationId: org.id, code: "AAC" },
    });
    if (!aacCurrent) {
      throw new Error("Current AAC company not found — nothing to restructure");
    }
    const blCountBefore = await tx.budgetLine.count({
      where: { companyId: aacCurrent.id },
    });
    const ivCountBefore = await tx.indicatorValue.count({
      where: { companyId: aacCurrent.id },
    });

    // Step A: rename current AAC → AAC-MAIN (still level=2, parent stays for now)
    const aacMain = await tx.company.update({
      where: { id: aacCurrent.id },
      data: {
        code: "AAC-MAIN",
        name: "AAC Main",
        level: 2,
        // parentCompanyId left null temporarily — set after wrapper creation
      },
    });

    // Step B: create new AAC wrapper at level=1
    const aacWrapper = await tx.company.create({
      data: {
        organizationId: org.id,
        code: "AAC",
        name: "AAC",
        level: 1,
        role: "operational",
        // industry left null — wrappers don't carry industry
        parentCompanyId: null,
      },
    });

    // Step C: re-parent AAC-MAIN to the new wrapper
    await tx.company.update({
      where: { id: aacMain.id },
      data: { parentCompanyId: aacWrapper.id },
    });

    // ---- VERIFY ----
    const blCountAfter = await tx.budgetLine.count({
      where: { companyId: aacMain.id },
    });
    const ivCountAfter = await tx.indicatorValue.count({
      where: { companyId: aacMain.id },
    });

    if (blCountBefore !== blCountAfter) {
      throw new Error(
        `BudgetLine count drift: before=${blCountBefore} after=${blCountAfter} — rolling back`,
      );
    }
    if (ivCountBefore !== ivCountAfter) {
      throw new Error(
        `IndicatorValue count drift: before=${ivCountBefore} after=${ivCountAfter} — rolling back`,
      );
    }

    return {
      status: "restructured",
      wrapperId: aacWrapper.id,
      mainId: aacMain.id,
      budgetLinesTransferred: blCountAfter,
      indicatorValuesTransferred: ivCountAfter,
    };
  });

  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    return prisma.$disconnect().then(() => process.exit(1));
  });
