/**
 * Phase C4 v1 + Phase 7.N — seed Scenario rows for demo + dev orgs.
 *
 * Phase 7.N adds 3 AzerSheker-specific simulatable scenarios:
 *   - SUGAR_PRICE_DROP_20  — цена сахара −20%
 *   - DROUGHT_2026         — засуха, урожай −30%
 *   - AZN_DEVAL_15         — девальвация маната 15% + долговой стресс
 *
 * Simulatable format: overrides.adjustments[] with {codes, multiply, note}.
 * The existing IRAN_HIGH / AZN_DEVAL_20 / OIL_DROP_30 are updated to also
 * carry adjustments so the simulate endpoint can run on them.
 *
 * Idempotent via upsert: re-running replaces overrides (update path).
 *
 * Run:
 *   npx tsx scripts/seed-scenarios.ts
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
  // ── AzerSheker-specific (Phase 7.N, simulatable) ─────────────────────────
  {
    code: "SUGAR_PRICE_DROP_20",
    nameEn: "Sugar price drops 20%",
    nameRu: "Цена сахара −20%",
    nameAz: "Şəkər qiyməti 20% ucuzlaşır",
    description:
      "Мировая цена сахара падает на 20% — выручка сжимается по всем предприятиям AzerSheker. " +
      "Проверяет валовую маржу, EBITDA и покрытие долга. " +
      "Ключевой риск для EDEN (крупнейший производитель тростника) и MALT (переработка).",
    overrides: {
      adjustments: [
        {
          codes: ["AGRO_SUGAR_PRICE_TREND"],
          multiply: 0.80,
          note: "Цена сахара −20%",
        },
        {
          codes: ["AGRO_REVENUE_PER_HA"],
          multiply: 0.80,
          note: "Выручка с га пропорционально снижается",
        },
        {
          codes: ["IND_GROSS_MARGIN", "IND_NET_MARGIN"],
          multiply: 0.78,
          note: "Маржа сжимается сильнее выручки (COGS фиксированы)",
        },
        {
          codes: ["FP_GROSS_MARGIN"],
          multiply: 0.75,
          note: "Переработка (MALT): маржа под давлением низкой цены",
        },
        {
          codes: ["IND_REVENUE_TOTAL", "IND_HOLDING_REVENUE"],
          multiply: 0.82,
          note: "Консолидированная выручка холдинга",
        },
      ],
    },
  },
  {
    code: "DROUGHT_2026",
    nameEn: "Drought — harvest −30%",
    nameRu: "Засуха — урожай −30%",
    nameAz: "Quraqlıq — məhsul 30% azalır",
    description:
      "Сильная засуха снижает сбор тростника на 30%. Урожайность на га падает ниже порога amber. " +
      "Выручка следует за урожаем; затраты на тонну растут (фиксированная база / меньше объём). " +
      "Аналитический стресс-тест на климатический риск — ключевой для инвесторов в агро-активы.",
    overrides: {
      adjustments: [
        {
          codes: ["AGRO_YIELD", "AGRO_YIELD_PER_HA", "AGRO_YIELD_EFFICIENCY"],
          multiply: 0.70,
          note: "Засуха: урожайность −30%",
        },
        {
          codes: ["AGRO_HARVEST_PROGRESS"],
          multiply: 0.70,
          note: "Прогресс уборки отстаёт от плана",
        },
        {
          codes: ["AGRO_DROUGHT_RISK"],
          multiply: 1.50,
          note: "Индекс засухи ухудшается",
        },
        {
          codes: ["AGRO_SUGAR_CONTENT"],
          multiply: 0.88,
          note: "Стресс растений снижает содержание сахара в тростнике",
        },
        {
          codes: ["AGRO_REVENUE_PER_HA", "AGRO_WATER_INTENSITY"],
          multiply: 0.72,
          note: "Выручка с га пропорциональна урожаю",
        },
        {
          codes: ["IND_GROSS_MARGIN", "FP_GROSS_MARGIN"],
          multiply: 0.72,
          note: "Фиксированные затраты делятся на меньший объём — маржа падает",
        },
        {
          codes: ["FP_EXTRACTION_RATE"],
          multiply: 0.90,
          note: "Более слабый тростник → ниже выход сахара",
        },
        {
          codes: ["FP_YIELD_LOSS"],
          multiply: 1.40,
          note: "Потери при переработке растут",
        },
        {
          codes: ["AGRO_CUT_TO_MILL"],
          multiply: 1.35,
          note: "Логистика под давлением экстренного сбора",
        },
      ],
    },
  },
  {
    code: "AZN_DEVAL_15",
    nameEn: "AZN devalues 15% + debt stress",
    nameRu: "Девальвация маната 15% + долговой стресс",
    nameAz: "Manat 15% ucuzlaşır + borc stresi",
    description:
      "Манат слабеет на 15% к USD — импортные ресурсы (удобрения, техника, запчасти) дорожают в манатах. " +
      "Долг в иностранной валюте увеличивается в AZN-эквиваленте. " +
      "Проверяет ликвидность, покрытие процентов и FX-экспозицию.",
    overrides: {
      adjustments: [
        {
          codes: ["FX_IMPORTED_INPUT"],
          multiply: 1.15,
          note: "Импортные затраты +15% в AZN",
        },
        {
          codes: ["AGRO_FERTILIZER_INTENSITY"],
          multiply: 1.15,
          note: "Удобрения (импорт) дорожают",
        },
        {
          codes: ["IND_OPEX_RATIO"],
          multiply: 1.08,
          note: "Рост операционных расходов от импортной инфляции",
        },
        {
          codes: ["IND_GROSS_MARGIN", "IND_NET_MARGIN", "FP_GROSS_MARGIN"],
          multiply: 0.92,
          note: "Маржа сжимается из-за дорогих импортных ресурсов",
        },
        {
          codes: ["AGRO_COMMODITY_VOL"],
          multiply: 1.20,
          note: "Волатильность сырья возрастает при девальвации",
        },
        {
          codes: ["HOSP_FX_EXPOSURE"],
          multiply: 1.15,
          note: "FX-экспозиция холдинга в целом",
        },
      ],
    },
  },
  // ── Macroeconomic (Phase C4, updated with adjustments for simulate) ───────
  {
    code: "IRAN_HIGH",
    nameEn: "Iran sanctions tighten (high-impact)",
    nameRu: "Иран — ужесточение санкций (high)",
    nameAz: "İran sanksiyaları sərtləşir (yüksək təsir)",
    description:
      "Sanctions regime tightens — AZN/USD spread widens, import lines repriced. " +
      "Stress-tests FX exposure + operating margins.",
    overrides: {
      adjustments: [
        {
          codes: ["FX_IMPORTED_INPUT"],
          multiply: 1.20,
          note: "FX spread +20% on import lines",
        },
        {
          codes: ["IND_GROSS_MARGIN", "IND_NET_MARGIN"],
          multiply: 0.88,
          note: "COGS inflation from dearer imports",
        },
        {
          codes: ["AGRO_COMMODITY_VOL"],
          multiply: 1.25,
          note: "Commodity volatility rises",
        },
      ],
      // legacy descriptor fields kept for audit trail
      fx_rates: { USD: 1.85, EUR: 1.95 },
      regulatory_risk: "high",
    },
  },
  {
    code: "AZN_DEVAL_20",
    nameEn: "AZN devalues 20% vs USD",
    nameRu: "Девальвация маната −20% к USD",
    nameAz: "Manat USD-ə qarşı 20% ucuzlaşır",
    description:
      "Manat-USD peg breaks — 20% devaluation. Stress-tests FX exposure + operating costs.",
    overrides: {
      adjustments: [
        {
          codes: ["FX_IMPORTED_INPUT"],
          multiply: 1.20,
          note: "AZN/USD +20%",
        },
        {
          codes: ["IND_GROSS_MARGIN", "FP_GROSS_MARGIN"],
          multiply: 0.90,
          note: "Import cost inflation",
        },
        {
          codes: ["AGRO_FERTILIZER_INTENSITY"],
          multiply: 1.20,
          note: "Fertilizer imports more expensive",
        },
      ],
      fx_rates: { USD: 2.04, EUR: 2.22 },
    },
  },
  {
    code: "OIL_DROP_30",
    nameEn: "Brent crude drops 30%",
    nameRu: "Нефть Brent −30%",
    nameAz: "Brent neft 30% ucuzlaşır",
    description:
      "Global crude price falls 30% — secondary impact on manat soft-peg + commodity inputs. " +
      "Mild positive for agro (cheaper diesel/machinery).",
    overrides: {
      adjustments: [
        {
          codes: ["AGRO_COMMODITY_VOL"],
          multiply: 0.85,
          note: "Oil-linked commodity volatility eases",
        },
        {
          codes: ["AGRO_FERTILIZER_INTENSITY"],
          multiply: 0.92,
          note: "Cheaper energy → cheaper fertilizer",
        },
        {
          codes: ["IND_OPEX_RATIO"],
          multiply: 0.96,
          note: "Fuel/logistics cost eases",
        },
      ],
      commodity_idx: { brent: -30 },
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

  let totalUpserted = 0;
  for (const org of orgs) {
    for (const s of SCENARIOS) {
      await prisma.scenario.upsert({
        where: { organizationId_code: { organizationId: org.id, code: s.code } },
        create: {
          organizationId: org.id,
          code: s.code,
          nameEn: s.nameEn,
          nameRu: s.nameRu,
          nameAz: s.nameAz,
          description: s.description,
          overrides: s.overrides as never,
          isActive: true,
        },
        update: {
          nameEn: s.nameEn,
          nameRu: s.nameRu,
          nameAz: s.nameAz,
          description: s.description,
          overrides: s.overrides as never,
          isActive: true,
        },
      });
      totalUpserted++;
    }
    console.log(`[seed-scenarios] ${org.slug}: ${SCENARIOS.length} scenarios upserted`);
  }

  console.log(
    `[seed-scenarios] Done. ${totalUpserted} upserts across ${orgs.length} org(s).`,
  );
}

main()
  .catch((err) => {
    console.error("[seed-scenarios] FAILED:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
