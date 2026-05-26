#!/usr/bin/env node
/**
 * 2026-05-27 — Seed Risk Registry for AZSF/CPC/MALT/FARM/HORIZON,
 * mirroring the EDEN template structure (15 KRIs across 7 Level-1
 * categories) but adapted per-industry.
 *
 * EDEN already has its native registry from "Top risk - EDEN AGRO MMC.xlsx".
 * The other 5 entities had only canonical `riskTags` chips (no KRI list)
 * because their files haven't been received from Nəcəf M yet. This
 * seeds reasonable industry-template registries that the user can
 * refine via the admin UI once real data arrives.
 *
 * Each KRI: { level1, level2, level3, kri, criticality (1=critical,
 *           2=elevated, 3=monitor), description, note? }
 *
 * Idempotent — overwrites existing settings.riskRegistry. Stores
 * `riskRegistrySource` metadata as "template seed" to distinguish from
 * client-supplied entries.
 */

import { config } from "dotenv";
import path from "node:path";
config({ path: path.resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ───────────────────────────────────────────────────────────────────────
// AZSF — Azərşəkər Sugar (food processing, sugar refining)
// Industry: sugar beet → refined sugar; customers = food/beverage/retail
// ───────────────────────────────────────────────────────────────────────
const AZSF_REGISTRY = [
  {
    level1: "Environmental risk",
    level2: "Climate change",
    level3: "Beet supply shortage",
    kri: "% deviation from contracted beet volume (Eden Agro + 3rd-party farms)",
    criticality: 1,
    description: "Climate-driven yield drop in supplier farms reduces refinery throughput.",
  },
  {
    level1: "Financial risk",
    level2: "Credit & liquidity",
    level3: "Cash flow",
    kri: "Current ratio",
    criticality: 1,
    description: "Refinery seasonality (beet harvest Sep-Dec) creates lumpy cash flow.",
  },
  {
    level1: "Financial risk",
    level2: "Macroeconomic",
    level3: "Sugar price volatility",
    kri: "12-month CV of refined sugar price",
    criticality: 1,
    description: "World sugar price swings cascade to domestic refining margin.",
  },
  {
    level1: "Financial risk",
    level2: "Macroeconomic",
    level3: "FX exposure",
    kri: "% of refined sugar revenue collected in non-AZN currency",
    criticality: 2,
    description: "Domestic AZN revenue vs imported USD-denominated machinery + spares mismatch.",
  },
  {
    level1: "Market & commercial risk",
    level2: "Customer concentration",
    level3: "Single-buyer dominance",
    kri: "Top customer share of revenue (Bakı Şirniyyat ~32%)",
    criticality: 1,
    description: "Single confectionery buyer holds enough share to threaten cash flow on a delayed payment.",
  },
  {
    level1: "Operational risk",
    level2: "Process efficiency",
    level3: "Sugar extraction rate",
    kri: "Refined sugar yield from beet input (target ≥14% by weight)",
    criticality: 1,
    description: "Extraction below 14% signals equipment degradation or low-Brix beet supply.",
  },
  {
    level1: "Operational risk",
    level2: "Capacity utilisation",
    level3: "Refinery downtime",
    kri: "Unplanned downtime hours per month",
    criticality: 2,
    description: "Aging Soviet-era equipment + spare-parts lead time create capacity risk during peak season.",
  },
  {
    level1: "Operational risk",
    level2: "Quality control",
    level3: "Off-spec batches",
    kri: "% of batches outside ISO 22000 / AQTA spec",
    criticality: 2,
    description: "Off-spec batches lose sale to confectionery buyers + trigger returns.",
  },
  {
    level1: "Regulatory & compliance risk",
    level2: "Subsidy regime",
    level3: "Government subsidy continuity",
    kri: "Year-over-year change in beet-subsidy AZN per hectare",
    criticality: 1,
    description: "Subsidy cut would compress contracted-beet farm-gate price, destroying farm-side margin and disrupting supply.",
  },
  {
    level1: "Regulatory & compliance risk",
    level2: "Food safety",
    level3: "AQTA non-conformities",
    kri: "Non-conformity count per inspection",
    criticality: 1,
    description: "Repeat findings escalate to facility suspension under Azerbaijan food safety law.",
  },
  {
    level1: "Regulatory & compliance risk",
    level2: "Audit findings",
    level3: "Major audit-finding remediation",
    kri: "Open Major audit findings count",
    criticality: 1,
    description: "Internal audit Major findings open >90 days indicate systemic control failures.",
  },
  {
    level1: "Strategic & reputational risk",
    level2: "Strategic",
    level3: "Financial profitability",
    kri: "EBITDA margin",
    criticality: 1,
    description: "Inability to meet expected refining-margin targets vs imported-sugar competition.",
  },
  {
    level1: "Strategic & reputational risk",
    level2: "Governance",
    level3: "Related-party transparency",
    kri: "Related-party transaction disclosure completeness (%)",
    criticality: 1,
    description: "Intercompany beet purchases from Eden Agro + intercompany malt sales need arms-length pricing audit.",
  },
  {
    level1: "Human capital risk",
    level2: "Talent retention",
    level3: "Skilled operator turnover",
    kri: "Annual voluntary turnover rate (refining operators)",
    criticality: 2,
    description: "Loss of experienced refinery operators during peak season.",
  },
  {
    level1: "Technology & data risk",
    level2: "ERP/MES",
    level3: "Production tracking gap",
    kri: "% of batches missing MES log entries",
    criticality: 3,
    description: "Manual production logging makes yield analysis + traceability post-incident slow.",
  },
];

// ───────────────────────────────────────────────────────────────────────
// CPC — Corn Processing Company (deep maize processing: glucose, fructose,
// starch, corn oil, maltose; the ONLY such facility in South Caucasus)
// ───────────────────────────────────────────────────────────────────────
const CPC_REGISTRY = [
  {
    level1: "Environmental risk",
    level2: "Climate change",
    level3: "Maize supply",
    kri: "% deviation from contracted maize volume (Eden Agro Oğuz)",
    criticality: 1,
    description: "Maize is grown in-house at Eden Agro Oğuz; drought there crushes CPC throughput.",
  },
  {
    level1: "Financial risk",
    level2: "Credit & liquidity",
    level3: "Cash flow",
    kri: "Current ratio",
    criticality: 1,
    description: "High-CAPEX deep-processing facility carries lumpy debt service.",
  },
  {
    level1: "Financial risk",
    level2: "Macroeconomic",
    level3: "Commodity price (glucose/fructose)",
    kri: "12-month CV of wholesale glucose syrup price",
    criticality: 1,
    description: "Glucose/fructose are commodity inputs to beverage industry — price volatility cascades to margin.",
  },
  {
    level1: "Financial risk",
    level2: "Macroeconomic",
    level3: "DCFTA export exposure",
    kri: "% of revenue from EU/Georgia export under DCFTA tariff regime",
    criticality: 2,
    description: "DCFTA tariff renegotiation or origin-rule tightening would compress export margin.",
  },
  {
    level1: "Market & commercial risk",
    level2: "Customer concentration",
    level3: "Domestic vs export mix",
    kri: "Top-3 customer share of revenue (Hacı Şəkər Bakı 28% + 2 others)",
    criticality: 1,
    description: "Concentrated domestic beverage buyers + DCFTA export channels create single-pipeline risk.",
  },
  {
    level1: "Operational risk",
    level2: "Process efficiency",
    level3: "Corn-to-syrup conversion yield",
    kri: "Glucose output per ton of maize input (target ≥65%)",
    criticality: 1,
    description: "Yield below 65% signals enzymatic process drift or maize quality drop.",
  },
  {
    level1: "Operational risk",
    level2: "Single-source equipment",
    level3: "EU/Turkish spare parts",
    kri: "Days of inventory cover for critical enzyme membranes",
    criticality: 2,
    description: "Deep-processing equipment is single-source from EU/Turkey; sanctions or supply shock = months downtime.",
  },
  {
    level1: "Operational risk",
    level2: "By-product utilisation",
    level3: "Corn oil + maltose secondary streams",
    kri: "% of by-product (corn oil/maltose) sold vs disposed",
    criticality: 3,
    description: "Unsold corn oil and maltose by-products erode unit economics.",
  },
  {
    level1: "Regulatory & compliance risk",
    level2: "Subsidy regime",
    level3: "Maize subsidy / DCFTA preferences",
    kri: "Combined state subsidy + DCFTA tariff benefit AZN/ton",
    criticality: 1,
    description: "Loss of subsidy or DCFTA benefit cuts effective revenue per ton significantly.",
  },
  {
    level1: "Regulatory & compliance risk",
    level2: "Food safety",
    level3: "Export-grade certification",
    kri: "Days remaining on EU food-grade certifications",
    criticality: 1,
    description: "Export certifications require ongoing audits; lapse blocks DCFTA channel.",
  },
  {
    level1: "Regulatory & compliance risk",
    level2: "Audit findings",
    level3: "Open Major audit findings",
    kri: "Open Major audit findings count",
    criticality: 1,
    description: "Internal audit Major findings open indicate process or control gaps.",
  },
  {
    level1: "Strategic & reputational risk",
    level2: "Strategic",
    level3: "Financial profitability",
    kri: "EBITDA margin",
    criticality: 1,
    description: "South Caucasus monopoly position should yield premium margins; underperformance signals operational issues.",
  },
  {
    level1: "Strategic & reputational risk",
    level2: "Governance",
    level3: "Related-party transparency",
    kri: "Intercompany subsidy flows audit transparency",
    criticality: 1,
    description: "Subsidy passes from state → Eden Agro → CPC need arms-length pricing audit.",
  },
  {
    level1: "Technology & data risk",
    level2: "Process control",
    level3: "Enzyme reactor automation",
    kri: "% of reactor cycles with full SCADA log capture",
    criticality: 3,
    description: "Process tracing for FDA/EU audits requires complete SCADA logs.",
  },
];

// ───────────────────────────────────────────────────────────────────────
// MALT — barley malting (Carlsberg-grade), JV-style relationship
// ───────────────────────────────────────────────────────────────────────
const MALT_REGISTRY = [
  {
    level1: "Market & commercial risk",
    level2: "Customer concentration",
    level3: "Carlsberg single-buyer dominance",
    kri: "% of malt revenue from Carlsberg Azerbaijan",
    criticality: 1,
    description: "Single off-take partner — loss or price renegotiation = existential threat.",
  },
  {
    level1: "Environmental risk",
    level2: "Climate change",
    level3: "Barley supply",
    kri: "% deviation from contracted barley volume (Eden Agro)",
    criticality: 1,
    description: "Drought reduces barley extraction quality; off-spec batches rejected by Carlsberg QA.",
  },
  {
    level1: "Operational risk",
    level2: "Process efficiency",
    level3: "Extraction rate",
    kri: "Malt extract yield from barley (target ≥80%)",
    criticality: 1,
    description: "Extraction below 80% rejected by Carlsberg brewing spec.",
  },
  {
    level1: "Operational risk",
    level2: "Quality control",
    level3: "Off-spec malt batches",
    kri: "% of batches outside Carlsberg brewing spec",
    criticality: 1,
    description: "Off-spec batches cannot be resold (Carlsberg-grade only) — full inventory write-off.",
  },
  {
    level1: "Financial risk",
    level2: "Credit & liquidity",
    level3: "Cash flow",
    kri: "Current ratio",
    criticality: 2,
    description: "Annual malting cycle creates seasonal working capital strain.",
  },
  {
    level1: "Financial risk",
    level2: "Macroeconomic",
    level3: "Barley commodity price",
    kri: "12-month CV of barley input price",
    criticality: 2,
    description: "Price-volatile input vs fixed Carlsberg offtake contract pinches margin.",
  },
  {
    level1: "Regulatory & compliance risk",
    level2: "Food safety",
    level3: "Brewing-grade certification",
    kri: "Days remaining on Carlsberg quality certification",
    criticality: 1,
    description: "Carlsberg supplier audit lapse = loss of single buyer.",
  },
  {
    level1: "Strategic & reputational risk",
    level2: "Strategic",
    level3: "Financial profitability",
    kri: "EBITDA margin",
    criticality: 1,
    description: "Margin compressed by single-buyer pricing power.",
  },
  {
    level1: "Strategic & reputational risk",
    level2: "Concentration risk",
    level3: "JV partner exit",
    kri: "Carlsberg contract renewal probability assessment",
    criticality: 1,
    description: "Carlsberg portfolio rationalization risk — they have other Caucasus options.",
  },
  {
    level1: "Human capital risk",
    level2: "Talent retention",
    level3: "Maltster turnover",
    kri: "Annual voluntary turnover rate (skilled maltsters)",
    criticality: 2,
    description: "Limited domestic talent pool for malting expertise.",
  },
];

// ───────────────────────────────────────────────────────────────────────
// FARM — generic farming entity (mirrors EDEN structure but slimmer)
// ───────────────────────────────────────────────────────────────────────
const FARM_REGISTRY = [
  {
    level1: "Environmental risk",
    level2: "Climate change",
    level3: "Drought",
    kri: "Days per month with soil-moisture index below threshold",
    criticality: 1,
    description: "Extended low rainfall causing water stress, wilting, reduced productivity.",
  },
  {
    level1: "Environmental risk",
    level2: "Climate change",
    level3: "Flood",
    kri: "Relative share of planted area flooded for >48h",
    criticality: 1,
    description: "Field inundation damaging plants, eroding topsoil, delaying operations.",
  },
  {
    level1: "Operational risk",
    level2: "Field-level capability",
    level3: "Unproductive land",
    kri: "% of total farmland left unused or yielding below target",
    criticality: 1,
    description: "Underperforming land due to soil issues, lack of investment, or unsuitable crop planning.",
  },
  {
    level1: "Operational risk",
    level2: "Crop health & management",
    level3: "Over/under watering",
    kri: "Irrigation events outside optimal range (%)",
    criticality: 2,
    description: "Improper irrigation levels resulting in water stress or root diseases.",
  },
  {
    level1: "Operational risk",
    level2: "Quality control",
    level3: "End-to-end crop loss",
    kri: "% Harvest loss across value chain",
    criticality: 1,
    description: "Cumulative loss from harvest, transport, storage, processing.",
  },
  {
    level1: "Financial risk",
    level2: "Credit & liquidity",
    level3: "Cash flow",
    kri: "Current ratio",
    criticality: 1,
    description: "Annual single-revenue cycle creates lumpy cash flow.",
  },
  {
    level1: "Financial risk",
    level2: "Macroeconomic",
    level3: "Commodity price",
    kri: "12-month CV of primary crop price",
    criticality: 1,
    description: "Crop price instability impacts cost structure and margins.",
  },
  {
    level1: "Market & commercial risk",
    level2: "Customer concentration",
    level3: "Single-buyer dependence",
    kri: "Top customer share of revenue",
    criticality: 1,
    description: "Over-reliance on a few major buyers (intercompany or third-party).",
  },
  {
    level1: "Regulatory & compliance risk",
    level2: "Food safety",
    level3: "AQTA standards",
    kri: "AQTA non-conformities per inspection",
    criticality: 1,
    description: "Violation of national food safety standards.",
  },
  {
    level1: "Strategic & reputational risk",
    level2: "Strategic",
    level3: "Financial profitability",
    kri: "EBITDA margin",
    criticality: 1,
    description: "Inability to meet expected financial returns vs benchmark farms.",
  },
];

// ───────────────────────────────────────────────────────────────────────
// HORIZON — services holding entity (passive corporate shell or services)
// Per AzerSheker_Catismayan_Melumatlar[91].docx: "hələki tam olaraq mövcud deyil"
// — placeholder until business description arrives
// ───────────────────────────────────────────────────────────────────────
const HORIZON_REGISTRY = [
  {
    level1: "Strategic & reputational risk",
    level2: "Strategic",
    level3: "Business model clarity",
    kri: "Defined business model document completeness (%)",
    criticality: 1,
    description: "Per AzerSheker docx, business purpose pending confirmation — possible passive shell entity.",
  },
  {
    level1: "Financial risk",
    level2: "Credit & liquidity",
    level3: "Cash flow",
    kri: "Current ratio",
    criticality: 2,
    description: "Service entities carry low fixed-asset base; cash flow tied to billing cycles.",
  },
  {
    level1: "Market & commercial risk",
    level2: "Customer concentration",
    level3: "Client concentration (HHI)",
    kri: "Customer HHI",
    criticality: 2,
    description: "Service-sector concentration vulnerability — known live value 0.48 (high).",
  },
  {
    level1: "Regulatory & compliance risk",
    level2: "Corporate governance",
    level3: "Legal entity disclosures",
    kri: "Statutory filing compliance (annual reports, tax)",
    criticality: 2,
    description: "Shell entities still require statutory filings; lapses trigger fines.",
  },
  {
    level1: "Strategic & reputational risk",
    level2: "Governance",
    level3: "Related-party transparency",
    kri: "Intercompany service-fee transfer pricing audit",
    criticality: 1,
    description: "Service entities common vehicle for intercompany cost allocation requiring transfer-pricing documentation.",
  },
];

const REGISTRIES = {
  "AZSEKER-AZSF": { name: "Azərşəkər Sugar", registry: AZSF_REGISTRY },
  "AZSEKER-CPC": { name: "CPC", registry: CPC_REGISTRY },
  "AZSEKER-MALT": { name: "Malt", registry: MALT_REGISTRY },
  "AZSEKER-FARM": { name: "Farm", registry: FARM_REGISTRY },
  "AZSEKER-HORIZON": { name: "Horizon", registry: HORIZON_REGISTRY },
};

async function main() {
  const codes = Object.keys(REGISTRIES);
  console.log(`→ Seeding Risk Registry templates for ${codes.length} entities\n`);

  const companies = await prisma.company.findMany({
    where: { code: { in: codes }, isActive: true },
    select: { id: true, code: true, name: true, settings: true },
  });

  for (const co of companies) {
    const meta = REGISTRIES[co.code];
    if (!meta) continue;

    const oldCount = (co.settings?.riskRegistry ?? []).length;
    const newSettings = {
      ...(co.settings ?? {}),
      riskRegistry: meta.registry,
      riskRegistrySource: {
        type: "template_seed",
        seeded: new Date().toISOString(),
        kriCount: meta.registry.length,
        note: "Industry-adapted template until client-supplied risk file arrives. Refine via /budgeting/admin/companies → Risk Registry panel.",
      },
    };

    await prisma.company.update({
      where: { id: co.id },
      data: { settings: newSettings },
    });

    const byL1 = {};
    for (const r of meta.registry) byL1[r.level1] = (byL1[r.level1] ?? 0) + 1;
    console.log(`✓ ${co.code} (${meta.name}): ${oldCount} → ${meta.registry.length} KRIs`);
    for (const [l1, n] of Object.entries(byL1).sort()) {
      console.log(`    ${l1}: ${n}`);
    }
  }

  await prisma.$disconnect();
  console.log(`\n✓ Done. Total KRIs seeded: ${Object.values(REGISTRIES).reduce((sum, m) => sum + m.registry.length, 0)}`);
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
