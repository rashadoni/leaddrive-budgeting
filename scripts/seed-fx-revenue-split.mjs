#!/usr/bin/env node
/**
 * 2026-05-27 — Seed FX revenue split per entity (% of revenue collected
 * in each currency). Defaults from existing customer + market knowledge;
 * admin can refine via UI when N. Nəcəfzadə file arrives with verified
 * customer-level FX breakdown.
 *
 * Each value is % (0-100); the 4 currency columns should sum to ~100
 * (other = rounding error).
 *
 * Schema: stored as flat numeric keys on Company.settings so
 * companySettingsResolver can expose them as formula variables:
 *   fxRevenueAzn → fx_revenue_azn
 *   fxRevenueUsd → fx_revenue_usd
 *   fxRevenueEur → fx_revenue_eur
 *   fxRevenueRub → fx_revenue_rub
 */

import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Reasoning per entity (educated defaults; user can override via UI):
// - AZSF: domestic confectionery + retail; nearly all AZN.
// - CPC: deep maize processing; some DCFTA export to EU/Georgia → USD.
// - MALT: Carlsberg Azerbaijan single buyer; AZN-denominated contract.
// - EDEN: agri-output mostly intercompany (AZN) + small sugar-cane export.
// - HORIZON: services; AZN domestic.
// - PROMALT: JV with Azersun, malt sales — AZN domestic.
const DEFAULTS = {
  "AZSEKER-AZSF": {
    azn: 95, usd: 5, eur: 0, rub: 0,
    rationale: "Domestic confectionery + retail dominant; Crocs Group MMC + Coca-Cola Azerbaijan ~5% USD.",
  },
  "AZSEKER-CPC": {
    azn: 80, usd: 18, eur: 2, rub: 0,
    rationale: "Hacı Şəkər Bakı 28% AZN + Georgia DCFTA exports ~18% USD + occasional EU buyers ~2% EUR.",
  },
  "AZSEKER-MALT": {
    azn: 100, usd: 0, eur: 0, rub: 0,
    rationale: "Carlsberg Azerbaijan single offtake contract — AZN-denominated.",
  },
  "AZSEKER-EDEN": {
    azn: 90, usd: 10, eur: 0, rub: 0,
    rationale: "Mostly intercompany sales (AZN) + Salyan sugarcane export to Georgia ~10% USD.",
  },
  "AZSEKER-HORIZON": {
    azn: 100, usd: 0, eur: 0, rub: 0,
    rationale: "Service entity, domestic clients only.",
  },
  "AZSEKER-PROMALT": {
    azn: 100, usd: 0, eur: 0, rub: 0,
    rationale: "JV with Azersun, domestic AZN.",
  },
};

async function main() {
  const codes = Object.keys(DEFAULTS);
  console.log(`→ Seeding fxRevenueSplit defaults for ${codes.length} entities\n`);

  const companies = await prisma.company.findMany({
    where: { code: { in: codes }, isActive: true },
    select: { id: true, code: true, settings: true },
  });

  for (const co of companies) {
    const def = DEFAULTS[co.code];
    if (!def) continue;
    // Sanity: should sum to 100
    const sum = def.azn + def.usd + def.eur + def.rub;
    if (Math.abs(sum - 100) > 0.5) {
      console.warn(`  ⚠ ${co.code}: split sums to ${sum}, not 100`);
    }
    const newSettings = {
      ...(co.settings ?? {}),
      fxRevenueAzn: def.azn,
      fxRevenueUsd: def.usd,
      fxRevenueEur: def.eur,
      fxRevenueRub: def.rub,
      fxRevenueSplitSource: {
        type: "educated_default",
        seeded: new Date().toISOString(),
        rationale: def.rationale,
        note: "Admin can refine via UI when N. Nəcəfzadə file arrives.",
      },
    };
    await prisma.company.update({
      where: { id: co.id },
      data: { settings: newSettings },
    });
    console.log(`✓ ${co.code}: AZN ${def.azn}% / USD ${def.usd}% / EUR ${def.eur}% / RUB ${def.rub}%`);
    console.log(`    ${def.rationale}`);
  }

  await prisma.$disconnect();
  console.log("\n✓ Done. Run seed-indicators next, then enable + recompute.");
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
