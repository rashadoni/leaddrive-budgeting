/**
 * Phase C4 v1 — seed Scenario rows for demo + dev orgs.
 *
 * Architect Round-1 sub-21 closure: DEMO_SCRIPT references
 * `IRAN_HIGH SCN GO` but no `Scenario` rows existed in DB. The schema
 * comment at `prisma/schema.prisma:1156` listed example codes; this
 * script makes them real.
 *
 * Idempotent: upsert by `(organizationId, code)` unique constraint.
 *
 * Run:
 *   npx tsx scripts/seed-scenarios.ts
 *
 * 3 scenarios per org (sized for the live-demo SCN tour):
 *   - IRAN_HIGH       — sanctions tightening; petrochem feedstock cost ↑20%, FX-import lines repriced
 *   - AZN_DEVAL_20    — manat devalues 20% vs USD; foreign-currency liabilities + imports hit
 *   - OIL_DROP_30     — global crude −30%; revenue side compressed for petrochem-tied lines
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface ScenarioSeed {
  code: string;
  nameEn: string;
  nameRu?: string;
  nameAz?: string;
  description: string;
  overrides: Record<string, unknown>;
}

const SCENARIOS: ScenarioSeed[] = [
  {
    code: "IRAN_HIGH",
    nameEn: "Iran sanctions tighten (high-impact)",
    nameRu: "Иран — ужесточение санкций (high)",
    nameAz: "İran sanksiyaları sərtləşir (yüksək təsir)",
    description:
      "Sanctions regime tightens — petrochem feedstock cost +20%, AZN/USD spread widens, foreign-currency import lines repriced at the higher rate. Stress-tests cogs/opex against AGRO_FX_RISK + IND_NET_MARGIN.",
    overrides: {
      fx_rates: { USD: 1.85, EUR: 1.95 },
      booking_drop_pct: { IR: 80 },
      cogs_inflation_pct: { petrochem: 20, feedstock: 18 },
      regulatory_risk: "high",
    },
  },
  {
    code: "AZN_DEVAL_20",
    nameEn: "AZN devalues 20% vs USD",
    nameRu: "Девальвация маната −20% к USD",
    nameAz: "Manat USD-ə qarşı 20% ucuzlaşır",
    description:
      "Manat-USD peg breaks — 20% devaluation. Foreign-currency liabilities + imports hit; export-revenue lines benefit. Stress-tests every indicator that touches `imported_input_cost` or FX-denominated BudgetLine rows.",
    overrides: {
      fx_rates: { USD: 2.04, EUR: 2.22 },
      // Note: base AZN rate is 1.70/USD pre-shock; +20% = 2.04.
      currency_shock: "manat_devaluation_20",
    },
  },
  {
    code: "OIL_DROP_30",
    nameEn: "Brent crude drops 30%",
    nameRu: "Нефть Brent −30%",
    nameAz: "Brent neft 30% ucuzlaşır",
    description:
      "Global crude price falls 30% — revenue compression for petrochem-tied lines, secondary impact on regional FX (manat soft-peg loosens). Stress-tests revenue side + IND_GROSS_MARGIN under price-pressure regime.",
    overrides: {
      commodity_idx: { brent: -30 },
      revenue_pressure_pct: { petrochem: -25, downstream: -15 },
      fx_rates: { USD: 1.78 }, // mild secondary tightening
    },
  },
];

async function main(): Promise<void> {
  const orgs = await prisma.organization.findMany({
    select: { id: true, slug: true, name: true },
  });
  if (orgs.length === 0) {
    console.log("[seed-scenarios] No organizations — nothing to seed.");
    return;
  }

  let totalCreated = 0;
  let totalSkipped = 0;
  for (const org of orgs) {
    for (const s of SCENARIOS) {
      const existing = await prisma.scenario.findFirst({
        where: { organizationId: org.id, code: s.code },
        select: { id: true },
      });
      if (existing) {
        totalSkipped++;
        continue;
      }
      await prisma.scenario.create({
        data: {
          organizationId: org.id,
          code: s.code,
          nameEn: s.nameEn,
          nameRu: s.nameRu,
          nameAz: s.nameAz,
          description: s.description,
          overrides: s.overrides as never,
          isActive: true,
        },
      });
      totalCreated++;
    }
    console.log(`[seed-scenarios] ${org.slug}: scenarios ensured`);
  }

  console.log(
    `[seed-scenarios] Done. Created ${totalCreated}, skipped ${totalSkipped} (already-present).`,
  );
}

main()
  .catch((err) => {
    console.error("[seed-scenarios] FAILED:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
