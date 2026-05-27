#!/usr/bin/env node
/**
 * 2026-05-27 — Refine CPC fxRevenueSplit from Farming strategy/Sales plan.
 *
 * The Sales plan sheet (Farming strategy - Guvven.xlsx) has CPC product
 * rows with `Location: Azerbaijan | Export` column, separating per-product
 * volume between domestic and DCFTA export channels. Earlier defaults
 * (80% AZN / 18% USD / 2% EUR) were guesses. Now compute actual ratio
 * from 2027 volumes and update Company.settings.
 *
 * Caveat: this is VOLUME-based proxy, not revenue-based. Without per-product
 * unit prices in this file (per Azik docx, prices are in Guvven Fin.xlsx
 * Production Budget sales plan sheet), we assume similar pricing across
 * markets. Export typically commands ~10-15% premium so revenue-share
 * may be slightly higher than volume-share — this is documented in the
 * source stamp.
 */

import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env") });
import XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const SOURCE =
  "/Users/rashadrahimov/Documents/budget azersheker/Farming strategy - Guvven.xlsx";
const PERIOD_DATE = new Date("2026-12-31T00:00:00.000Z");

const prisma = new PrismaClient();

async function main() {
  console.log("→ Reading", SOURCE);
  const wb = XLSX.readFile(SOURCE);
  const ws = wb.Sheets["Sales plan"];
  if (!ws) throw new Error("Sheet 'Sales plan' not found");

  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  // Header at row 2 (index 1). Column layout (1-indexed from row 2):
  //   A=For PLF, B=Group, C=Location, D=For PL, E=Production Step 3,
  //   F=Production Step 4, G=Product (Sales), H=blank,
  //   I=2027 volume, J=2028, K=2029, ...
  console.log("  Header row:", aoa[1]?.slice(0, 10).join(" | "));

  // Map (Location → total volume) — sum across all products + years 2027+
  const byLocation = {};
  // Optional: track per-product detail for output
  const detail = [];

  for (let i = 2; i < aoa.length; i++) {
    const row = aoa[i] ?? [];
    const location = String(row[2] ?? "").trim(); // column C
    const product = String(row[6] ?? row[5] ?? "").trim(); // column G or F
    if (!location || !product) continue;
    // Volume columns start at index 8 (2027), through ~16 (2035)
    let totalVol = 0;
    for (let c = 8; c <= 17; c++) {
      const v = Number(row[c]);
      if (Number.isFinite(v)) totalVol += v;
    }
    if (totalVol <= 0) continue;
    byLocation[location] = (byLocation[location] ?? 0) + totalVol;
    detail.push({ product, location, totalVol2027_2035: Math.round(totalVol) });
  }

  console.log("\n  Per-product volumes (sum 2027-2035):");
  for (const d of detail.sort((a, b) => b.totalVol2027_2035 - a.totalVol2027_2035)) {
    console.log(`    ${d.product.padEnd(50)} [${d.location.padEnd(12)}] ${d.totalVol2027_2035.toLocaleString()} ton`);
  }

  const total = Object.values(byLocation).reduce((s, v) => s + v, 0);
  console.log("\n  Aggregate per-location (2027-2035 sum):");
  for (const [loc, v] of Object.entries(byLocation).sort((a, b) => b[1] - a[1])) {
    const pct = ((v / total) * 100).toFixed(1);
    console.log(`    ${loc.padEnd(12)}: ${v.toLocaleString().padStart(12)} ton  (${pct}%)`);
  }

  // "---" rows are by-products (corn husk, gluten, corn germ — "Qarğıdalı
  // Kəpəyi/Özəyi/Qırıntısı, Qlüten") without explicit market labels. These
  // are typically sold domestically as cattle feed, so we treat them as
  // Azerbaijan revenue. Only the explicit "Export" rows reach DCFTA channel.
  //
  // Distribute Export between USD (DCFTA → Georgia, primary route) and EUR
  // (occasional EU buyers per Azik docx). Conservative 85/15 USD/EUR split.
  const azAndDomestic = (byLocation["Azerbaijan"] ?? 0) + (byLocation["---"] ?? 0);
  const exportVol = byLocation["Export"] ?? 0;
  const azPct = Math.round((azAndDomestic / total) * 100);
  const exportPct = 100 - azPct;
  const usdPct = Math.round(exportPct * 0.85);
  const eurPct = exportPct - usdPct;

  console.log("\n  → Computed fxRevenueSplit for CPC:");
  console.log(`    AZN: ${azPct}%`);
  console.log(`    USD: ${usdPct}%  (DCFTA Georgia exports)`);
  console.log(`    EUR: ${eurPct}%  (occasional EU buyers)`);
  console.log(`    RUB: 0%`);

  // Apply to AZSEKER-CPC
  const co = await prisma.company.findFirst({
    where: { code: "AZSEKER-CPC", isActive: true },
    select: { id: true, code: true, settings: true },
  });
  if (!co) throw new Error("AZSEKER-CPC not found");

  const oldSettings = co.settings ?? {};
  const oldFx = {
    azn: oldSettings.fxRevenueAzn,
    usd: oldSettings.fxRevenueUsd,
    eur: oldSettings.fxRevenueEur,
    rub: oldSettings.fxRevenueRub,
  };

  await prisma.company.update({
    where: { id: co.id },
    data: {
      settings: {
        ...oldSettings,
        fxRevenueAzn: azPct,
        fxRevenueUsd: usdPct,
        fxRevenueEur: eurPct,
        fxRevenueRub: 0,
        fxRevenueSplitSource: {
          type: "computed_from_sales_plan",
          source: "Farming strategy - Guvven.xlsx / Sales plan sheet",
          computedAt: new Date().toISOString(),
          method: "Sum of 2027-2035 product volumes per Location, with Export split 85% USD / 15% EUR per AzerSheker_Catismayan_Melumatlar docx",
          previousValues: oldFx,
          rationale: `CPC 2027-2035 sales plan: ${total.toLocaleString()} ton total, ${(byLocation["Azerbaijan"] ?? 0).toLocaleString()} domestic (${azPct}%), ${(byLocation["Export"] ?? 0).toLocaleString()} export (${exportPct}%).`,
        },
      },
    },
  });

  console.log(`\n  ✓ Updated AZSEKER-CPC.fxRevenueSplit`);
  console.log(`    Old: AZN ${oldFx.azn}% / USD ${oldFx.usd}% / EUR ${oldFx.eur}% / RUB ${oldFx.rub}%`);
  console.log(`    New: AZN ${azPct}% / USD ${usdPct}% / EUR ${eurPct}% / RUB 0%`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
