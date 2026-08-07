/**
 * Put the guide stand back into the state the assumptions take starts from.
 *
 * The take is a before/after: it reads a company's crisis score, saves a
 * `cost_rigidity` row for that company, and reads the score again. The second
 * language therefore cannot start where the first one finished — the row is
 * already there, the "before" is no longer a before, and the narration would be
 * describing a change that does not happen on screen. That failure is silent:
 * the video renders perfectly and simply lies.
 *
 * So this runs between languages, as the recorder's DEMO_CMD.
 *
 * It deletes exactly one thing: `cost_rigidity` scoped to the demo company the
 * scenario writes to. Everything else in the stand — the import shares, the
 * plan default, the EDEN rigidity that the narration points at — is left alone,
 * because those are the state the guide is showing, not its residue.
 *
 * Refuses to run without GUIDE_STAND=1. The stand is a restored copy of the
 * production database, so "which database am I pointed at" is a question with a
 * genuinely dangerous wrong answer, and the answer must be given deliberately
 * rather than inherited from whatever .env happened to be sourced.
 */
import { PrismaClient } from "@prisma/client";

const COMPANY_CODE = process.env.GUIDE_STAND_COMPANY || "AZSEKER-CPC";
const KEY = "cost_rigidity";

if (process.env.GUIDE_STAND !== "1") {
  console.error(
    "reset-assumptions-stand: refusing to run without GUIDE_STAND=1 — "
    + "this deletes rows, and the stand is a copy of production data.",
  );
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const company = await prisma.company.findFirst({
    where: { code: COMPANY_CODE },
    select: { id: true, code: true },
  });
  if (!company) {
    // Not fatal: a stand seeded differently simply has nothing to clean, and
    // aborting here would take the whole recording down with it.
    console.warn(`reset-assumptions-stand: no company ${COMPANY_CODE} — nothing to reset.`);
  } else {
    const { count } = await prisma.budgetAssumption.deleteMany({
      where: { key: KEY, companyId: company.id },
    });
    console.log(`reset-assumptions-stand: removed ${count} ${KEY} row(s) for ${company.code}.`);
  }
} finally {
  await prisma.$disconnect();
}
