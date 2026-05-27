#!/usr/bin/env node
/**
 * 2026-05-27 — Cleanup fabricated AI-generated data per user direction
 * «ничего выдуманного не нужно».
 *
 * What this script removes:
 *
 * 1. **Risk Registry templates** (Company.settings.riskRegistry +
 *    riskRegistrySource) for AZSF/CPC/MALT/HORIZON. These were
 *    AI-authored industry templates stamped `type: "template_seed"`,
 *    not real client data. EDEN retains its 15 KRIs (from real client
 *    file `Top risk - EDEN AGRO MMC.xlsx`).
 *
 * 2. **fxRevenueSplit educated defaults** (fxRevenueAzn/Usd/Eur/Rub +
 *    fxRevenueSplitSource) for AZSF/MALT/EDEN/HORIZON/PROMALT. These
 *    were AI guesses based on customer list inference. CPC retains
 *    its split (84/14/2/0, computed from real `Farming strategy /
 *    Sales plan` volume data).
 *
 * 3. **LEGAL_MONEY_AT_RISK** OperationalFact rows + CompanyIndicator
 *    enables + IndicatorValue rows. The regex extraction captured only
 *    4 of 54 court cases (7% coverage) — misleading floor estimate.
 *    The indicator definition itself is removed from indicator-seeds.ts
 *    in a separate step.
 *
 * What this script ADDS:
 *
 * 4. **PROMALT data-pending banner** — `Company.settings.dataPendingBanner`
 *    string for AZSEKER-PROMALT so the HeatMap can render an explicit
 *    "No data yet — JV с Azersun, awaiting file" row banner instead of
 *    silently presenting an empty row.
 *
 * Idempotent — safe to re-run. Verifies state after each deletion.
 */

import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Entities whose riskRegistry was AI-templated (delete).
// EDEN is excluded — its registry came from a real client file.
const FABRICATED_REGISTRY_ENTITIES = [
  "AZSEKER-AZSF",
  "AZSEKER-CPC",
  "AZSEKER-MALT",
  "AZSEKER-HORIZON",
];

// Entities whose fxRevenueSplit was an educated guess (delete).
// CPC is excluded — its split was computed from real Sales plan data.
const FABRICATED_FX_ENTITIES = [
  "AZSEKER-AZSF",
  "AZSEKER-MALT",
  "AZSEKER-EDEN",
  "AZSEKER-HORIZON",
  "AZSEKER-PROMALT",
];

const PROMALT_BANNER =
  "No data yet — JV с Azersun, awaiting file from CFO. Indicators show as ⚪ unknown until real data arrives.";

const LEGAL_MONEY_METRIC = "LEGAL_MONEY_AT_RISK";

function stripKeys(settings, keys) {
  const next = { ...(settings ?? {}) };
  let removed = 0;
  for (const k of keys) {
    if (k in next) {
      delete next[k];
      removed++;
    }
  }
  return { next, removed };
}

async function main() {
  console.log("━━━ Cleanup fabricated data ━━━\n");

  // ─── F1: Remove riskRegistry + riskRegistrySource for 4 entities ───
  console.log("→ F1: Removing fabricated Risk Registry templates (4 entities)");
  const registryCompanies = await prisma.company.findMany({
    where: { code: { in: FABRICATED_REGISTRY_ENTITIES }, isActive: true },
    select: { id: true, code: true, settings: true },
  });
  for (const co of registryCompanies) {
    const { next, removed } = stripKeys(co.settings, [
      "riskRegistry",
      "riskRegistrySource",
    ]);
    if (removed > 0) {
      await prisma.company.update({
        where: { id: co.id },
        data: { settings: next },
      });
      console.log(`  ✓ ${co.code}: removed ${removed} settings keys`);
    } else {
      console.log(`  • ${co.code}: nothing to remove (already clean)`);
    }
  }

  // ─── F2: Remove fxRevenueSplit defaults for 5 entities ─────────────
  console.log("\n→ F2: Removing fabricated fxRevenueSplit defaults (5 entities)");
  const fxCompanies = await prisma.company.findMany({
    where: { code: { in: FABRICATED_FX_ENTITIES }, isActive: true },
    select: { id: true, code: true, settings: true },
  });
  for (const co of fxCompanies) {
    const { next, removed } = stripKeys(co.settings, [
      "fxRevenueAzn",
      "fxRevenueUsd",
      "fxRevenueEur",
      "fxRevenueRub",
      "fxRevenueSplitSource",
    ]);
    if (removed > 0) {
      await prisma.company.update({
        where: { id: co.id },
        data: { settings: next },
      });
      console.log(`  ✓ ${co.code}: removed ${removed} settings keys`);
    } else {
      console.log(`  • ${co.code}: nothing to remove (already clean)`);
    }
  }

  // ─── F3a: Delete LEGAL_MONEY_AT_RISK OperationalFact rows ──────────
  console.log("\n→ F3a: Deleting LEGAL_MONEY_AT_RISK OperationalFact rows");
  const factsDeleted = await prisma.operationalFact.deleteMany({
    where: { metric: LEGAL_MONEY_METRIC },
  });
  console.log(`  ✓ Deleted ${factsDeleted.count} fact rows`);

  // ─── F3b: Delete CompanyIndicator + IndicatorValue rows ────────────
  console.log("\n→ F3b: Deleting LEGAL_MONEY_AT_RISK CompanyIndicator + IndicatorValue rows");
  const legalIndicator = await prisma.indicatorDefinition.findFirst({
    where: { code: LEGAL_MONEY_METRIC },
    select: { id: true, code: true },
  });
  if (legalIndicator) {
    const ivDeleted = await prisma.indicatorValue.deleteMany({
      where: { indicatorId: legalIndicator.id },
    });
    const ciDeleted = await prisma.companyIndicator.deleteMany({
      where: { indicatorId: legalIndicator.id },
    });
    const defDeleted = await prisma.indicatorDefinition.deleteMany({
      where: { id: legalIndicator.id },
    });
    console.log(`  ✓ Deleted ${ivDeleted.count} IV rows`);
    console.log(`  ✓ Deleted ${ciDeleted.count} CompanyIndicator rows`);
    console.log(`  ✓ Deleted ${defDeleted.count} IndicatorDefinition row`);
  } else {
    console.log("  • LEGAL_MONEY_AT_RISK IndicatorDefinition not found (already removed)");
  }

  // ─── N1: Add PROMALT dataPendingBanner ─────────────────────────────
  console.log("\n→ N1: Adding PROMALT data-pending banner");
  const promalt = await prisma.company.findFirst({
    where: { code: "AZSEKER-PROMALT", isActive: true },
    select: { id: true, code: true, settings: true },
  });
  if (promalt) {
    const next = {
      ...(promalt.settings ?? {}),
      dataPendingBanner: PROMALT_BANNER,
    };
    await prisma.company.update({
      where: { id: promalt.id },
      data: { settings: next },
    });
    console.log(`  ✓ ${promalt.code}: banner set`);
  } else {
    console.log("  ⚠ AZSEKER-PROMALT not found");
  }

  // ─── Verification ──────────────────────────────────────────────────
  console.log("\n━━━ Verification ━━━");
  const checks = await prisma.company.findMany({
    where: { code: { startsWith: "AZSEKER-" }, isActive: true, level: 2 },
    select: { code: true, settings: true },
    orderBy: { code: "asc" },
  });
  console.log(
    `\n  ${"Entity".padEnd(22)} | registry | fxSplit | banner`,
  );
  console.log("  " + "─".repeat(60));
  for (const co of checks) {
    const s = co.settings ?? {};
    const hasRegistry = !!s.riskRegistry ? "✓" : "·";
    const hasFx = !!s.fxRevenueAzn ? "✓" : "·";
    const banner = s.dataPendingBanner ? "✓" : "·";
    console.log(
      `  ${co.code.padEnd(22)} |    ${hasRegistry}     |    ${hasFx}    |    ${banner}`,
    );
  }
  console.log("\n  Expected:");
  console.log("    EDEN  registry=✓ (real client)");
  console.log("    CPC   fxSplit=✓ (real Sales plan)");
  console.log("    PROMALT banner=✓ (new)");
  console.log("    All others: registry=·, fxSplit=·, banner=·");

  await prisma.$disconnect();
  console.log("\n✓ Cleanup complete. Run seed-indicators + polish-recompute next.");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
