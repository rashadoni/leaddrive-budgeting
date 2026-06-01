/**
 * Purge placeholder / fake business data so the app shows ONLY real numbers.
 *
 * Removes (per the 2026-06-01 audit):
 *   1. ALL Counterparty rows (49 — fake demo names "Coca-Cola Azerbaijan" etc.)
 *   2. AZSEKER holding Company.settings placeholder keys (insurance, nps,
 *      bankCovenants, risksRegister, strategicPlan, initiatives2026,
 *      subsidyPipeline, litigation, competitivePositioning, landTitles)
 *   3. IntelDataPoint FX_FORWARD_* (IRP model on hardcoded spot+rates)
 *   4. AZSEKER-HORIZON BudgetLine (entirely placeholder — client gave no HORIZON data)
 *   5. ALL BudgetActual (1496 — "100%-execution placeholder"; no real GL actuals exist)
 *   6. ALL SalesBudgetLine (149 — fabricated product splits)
 *   7. ALL BudgetAssumption (4 — illustrative cli-seed FX/CPI/tax)
 *   8. CashFlowEntry rows tagged description LIKE 'placeholder%' (HORIZON placeholder CF)
 *   + set HORIZON settings.dataPendingBanner so the UI shows an honest empty state.
 *
 * PRESERVES (real client data): EDEN/AZSF/CPC/MALT BudgetLine (P&L), ALL
 * BalanceSheetLine, real CashFlowEntry, auditFindings/courtDisputes,
 * EDEN landParcels/riskRegistry, CPC fxRevenue*, strategicDescription/
 * competitiveAdvantage, capexInitiatives, Organization.forwardForecast.
 * AZSEKER-FARM is archived (isActive=false, not shown) → left untouched.
 *
 * Usage:
 *   npx tsx scripts/purge-placeholder-data.ts            # DRY RUN (counts only)
 *   npx tsx scripts/purge-placeholder-data.ts --apply    # actually delete
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const ORG_SLUG = "azmade";
const HOLDING_PLACEHOLDER_KEYS = [
  "insurance", "nps", "bankCovenants", "risksRegister", "strategicPlan",
  "initiatives2026", "subsidyPipeline", "litigation", "competitivePositioning", "landTitles",
];

async function main() {
  const apply = process.argv.includes("--apply");
  const mode = apply ? "APPLY (deleting)" : "DRY RUN (counts only)";
  console.log(`\n=== purge-placeholder-data — ${mode} ===\n`);

  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG }, select: { id: true } });
  if (!org) throw new Error(`org '${ORG_SLUG}' not found`);
  const ORG = org.id;

  const horizon = await prisma.company.findFirst({ where: { organizationId: ORG, code: "AZSEKER-HORIZON" }, select: { id: true, settings: true } });
  if (!horizon) throw new Error("AZSEKER-HORIZON not found");

  // ── Counts (always) ────────────────────────────────────────────────
  const counts = {
    counterparty: await prisma.counterparty.count({ where: { organizationId: ORG } }),
    fxForward: await prisma.intelDataPoint.count({ where: { organizationId: ORG, metric: { startsWith: "FX_FORWARD_" } } }),
    horizonBudgetLine: await prisma.budgetLine.count({ where: { companyId: horizon.id } }),
    budgetActual: await prisma.budgetActual.count({ where: { organizationId: ORG } }),
    salesBudgetLine: await prisma.salesBudgetLine.count({ where: { organizationId: ORG } }),
    budgetAssumption: await prisma.budgetAssumption.count({ where: { organizationId: ORG } }),
    cashFlowPlaceholder: await prisma.cashFlowEntry.count({ where: { organizationId: ORG, description: { startsWith: "placeholder" } } }),
  };
  const azseker = await prisma.company.findFirst({ where: { organizationId: ORG, code: "AZSEKER" }, select: { id: true, settings: true } });
  const azSettings = (azseker?.settings ?? {}) as Record<string, unknown>;
  const azKeysToStrip = HOLDING_PLACEHOLDER_KEYS.filter((k) => k in azSettings);

  console.log("Will DELETE:");
  console.log(`  Counterparty (all, org):            ${counts.counterparty}`);
  console.log(`  IntelDataPoint FX_FORWARD_*:        ${counts.fxForward}`);
  console.log(`  HORIZON BudgetLine (placeholder):   ${counts.horizonBudgetLine}`);
  console.log(`  BudgetActual (all — no real GL):    ${counts.budgetActual}`);
  console.log(`  SalesBudgetLine (fabricated splits):${counts.salesBudgetLine}`);
  console.log(`  BudgetAssumption (illustrative):    ${counts.budgetAssumption}`);
  console.log(`  CashFlowEntry desc~placeholder:     ${counts.cashFlowPlaceholder}`);
  console.log(`  AZSEKER settings keys to strip:     [${azKeysToStrip.join(", ")}]`);

  // ── Preserve-sanity (must stay > 0) ────────────────────────────────
  const keep = {
    balanceSheetLine: await prisma.balanceSheetLine.count({ where: { organizationId: ORG } }),
    realBudgetLine_EDEN_AZSF_CPC_MALT: await prisma.budgetLine.count({ where: { organizationId: ORG, company: { code: { in: ["AZSEKER-EDEN", "AZSEKER-AZSF", "AZSEKER-CPC", "AZSEKER-MALT"] } } } }),
  };
  console.log("\nPRESERVED (sanity — must stay intact):");
  console.log(`  BalanceSheetLine (real workbook):   ${keep.balanceSheetLine}`);
  console.log(`  Real P&L BudgetLine (4 entities):   ${keep.realBudgetLine_EDEN_AZSF_CPC_MALT}`);

  if (!apply) {
    console.log("\nDRY RUN — nothing deleted. Re-run with --apply to execute.\n");
    await prisma.$disconnect();
    return;
  }

  // ── Apply (transactional) ──────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    await tx.counterparty.deleteMany({ where: { organizationId: ORG } });
    await tx.intelDataPoint.deleteMany({ where: { organizationId: ORG, metric: { startsWith: "FX_FORWARD_" } } });
    await tx.budgetLine.deleteMany({ where: { companyId: horizon.id } });
    await tx.budgetActual.deleteMany({ where: { organizationId: ORG } });
    await tx.salesBudgetLine.deleteMany({ where: { organizationId: ORG } });
    await tx.budgetAssumption.deleteMany({ where: { organizationId: ORG } });
    await tx.cashFlowEntry.deleteMany({ where: { organizationId: ORG, description: { startsWith: "placeholder" } } });

    // Strip placeholder keys from AZSEKER holding settings.
    if (azseker && azKeysToStrip.length) {
      const cleaned = { ...azSettings };
      for (const k of azKeysToStrip) delete cleaned[k];
      await tx.company.update({ where: { id: azseker.id }, data: { settings: cleaned as Prisma.InputJsonValue } });
    }

    // Honest empty-state banner for HORIZON (mirrors PROMALT's dataPendingBanner).
    const hSettings = (horizon.settings ?? {}) as Record<string, unknown>;
    await tx.company.update({
      where: { id: horizon.id },
      data: { settings: { ...hSettings, dataPendingBanner: "Реальные финансы HORIZON ещё не предоставлены клиентом — данные появятся после загрузки." } as Prisma.InputJsonValue },
    });
  });

  console.log("\n✓ APPLIED. Re-run recompute to refresh derived indicators (concentration → unknown).\n");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
