/**
 * Phase 7.J — seed AzerSheker counterparties + strategic / compliance
 * narrative settings to demo state.
 *
 * Closes (every item from the pre-meeting list):
 *   Counterparty model:
 *     - Top-10 customers per AzerSheker entity (name, % revenue,
 *       contract expiry, payment terms, escalator clauses)
 *     - Top-10 suppliers (name, % COGS, single-source vs alternate,
 *       payment terms)
 *
 *   Company.settings JSON extensions (plain text fields, no admin UI
 *   needed for v1 — admin can edit JSON in /companies/<code>/settings):
 *     - strategicPlan       (3-year strategic plan summary)
 *     - risksRegister       (top-3 risks)
 *     - competitivePositioning (3 main competitors + cost/quality/
 *                               distribution/brand assessment)
 *     - initiatives2026     (CAPEX, M&A, new product launches)
 *     - nps                 (latest net promoter score)
 *     - bankCovenants       (DSCR target, debt/equity max, min liquidity)
 *     - insurance           (crop, property, workers comp)
 *     - landTitles          (owned vs leased hectares + lease expiry)
 *     - subsidyPipeline     (gov subsidy program, expected amount, date)
 *     - litigation          (open court cases, regulatory items, audit
 *                            findings)
 *
 * Idempotent — upsert via composite key (companyId × role × name ×
 * period) on counterparties; Company.settings JSON gets merged.
 *
 * Run: `DATABASE_URL=... node scripts/close-azseker-counterparties.cjs`
 */
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const ORG_SLUG = "azmade"
const PERIOD = "2026"

// Plausible AzerSheker top counterparties (placeholder until client
// provides real list). Numbers reflect typical Azeri sugar/agro market.
const CUSTOMERS_BY_ENTITY = {
  "AZSEKER-AZSF": [
    { name: "Bakı Şirniyyat MMC", sharePct: 32, paymentTermsDays: 45, contractExpiry: "2026-12-31", notes: "Largest domestic confectionery; price-escalator: +6% if ICE #11 closes above $0.22/lb for 5 consecutive trading days." },
    { name: "Konfet ASC", sharePct: 18, paymentTermsDays: 30, contractExpiry: "2027-06-30", notes: "Long-term sugar offtake; rolling 12-mo renewal" },
    { name: "Coca-Cola Azerbaijan", sharePct: 15, paymentTermsDays: 60, contractExpiry: "2026-09-30", notes: "Bottling-grade sugar; quarterly QC audit clauses." },
    { name: "Wholesale distributors (top-5 aggregated)", sharePct: 14, paymentTermsDays: 30, contractExpiry: null, notes: "Open-account; concentrated in Bakı + Gəncə wholesale markets" },
    { name: "Export — Georgia / DCFTA", sharePct: 10, paymentTermsDays: 90, contractExpiry: "2026-12-31", notes: "EU-aligned tariff regime; FX exposure to USD invoicing" },
    { name: "Retail chains (Bravo, Bizim, Bolmart)", sharePct: 6, paymentTermsDays: 45, contractExpiry: null, notes: "Mixed SLAs" },
    { name: "Other industrial users", sharePct: 5, paymentTermsDays: 45, contractExpiry: null, notes: "Tail" },
  ],
  "AZSEKER-CPC": [
    { name: "Hacı Şəkər Bakı", sharePct: 28, paymentTermsDays: 45, contractExpiry: "2027-03-31", notes: "Primary glucose syrup offtaker; auto-renewal" },
    { name: "Azərkənd Bakery Group", sharePct: 22, paymentTermsDays: 30, contractExpiry: "2026-12-31", notes: "Cornstarch volume; escalator linked to corn spot" },
    { name: "Pepsi Azerbaijan", sharePct: 14, paymentTermsDays: 60, contractExpiry: "2026-09-30", notes: "F42 fructose syrup; quarterly volume commitments" },
    { name: "Şərbət Industries", sharePct: 12, paymentTermsDays: 45, contractExpiry: "2026-12-31", notes: "Maltose syrup; spot pricing" },
    { name: "Export — Türkiyə", sharePct: 11, paymentTermsDays: 90, contractExpiry: "2026-12-31", notes: "TRY-invoiced; partial USD hedge" },
    { name: "Export — Iran", sharePct: 6, paymentTermsDays: 60, contractExpiry: "2026-08-31", notes: "Cross-border logistics risk" },
    { name: "Tail wholesale", sharePct: 7, paymentTermsDays: 30, contractExpiry: null, notes: "" },
  ],
  "AZSEKER-MALT": [
    { name: "Xırdalan Brewery (Carlsberg Group)", sharePct: 42, paymentTermsDays: 30, contractExpiry: "2027-12-31", notes: "Flagship offtaker; 5-yr offtake agreement signed 2023; price-escalator on barley spot ±10%" },
    { name: "Baltika Bakı", sharePct: 22, paymentTermsDays: 45, contractExpiry: "2026-12-31", notes: "Annual renewal" },
    { name: "Azərbaycan Pivəsi", sharePct: 16, paymentTermsDays: 30, contractExpiry: "2026-09-30", notes: "Mid-tier; price renegotiated yearly" },
    { name: "Export — Georgia / Armenia", sharePct: 12, paymentTermsDays: 60, contractExpiry: "2026-12-31", notes: "USD-invoiced; FX risk" },
    { name: "Craft brewery aggregate", sharePct: 5, paymentTermsDays: 30, contractExpiry: null, notes: "5-10 small accounts" },
    { name: "Spot market", sharePct: 3, paymentTermsDays: 0, contractExpiry: null, notes: "Cash-on-delivery" },
  ],
  "AZSEKER-EDEN": [
    { name: "AZSEKER-AZSF (intra-group)", sharePct: 65, paymentTermsDays: 60, contractExpiry: null, notes: "Internal cane delivery to AZSF sugar mill; transfer-priced" },
    { name: "AZSEKER-CPC (intra-group)", sharePct: 20, paymentTermsDays: 60, contractExpiry: null, notes: "Wheat/barley intra-group" },
    { name: "Cotton trader (TBN — local)", sharePct: 8, paymentTermsDays: 30, contractExpiry: "2026-09-30", notes: "Cotton bale offtake" },
    { name: "Spot wholesale grain", sharePct: 7, paymentTermsDays: 0, contractExpiry: null, notes: "Cash spot" },
  ],
  "AZSEKER-FARM": [
    { name: "AZSEKER-CPC (intra-group)", sharePct: 55, paymentTermsDays: 60, contractExpiry: null, notes: "Mixed cereal intra-group" },
    { name: "AZSEKER-MALT (intra-group)", sharePct: 25, paymentTermsDays: 60, contractExpiry: null, notes: "Barley to malt house" },
    { name: "State grain procurement", sharePct: 12, paymentTermsDays: 90, contractExpiry: "2026-12-31", notes: "Government wheat purchase program" },
    { name: "Open market", sharePct: 8, paymentTermsDays: 14, contractExpiry: null, notes: "Spot" },
  ],
  "AZSEKER-HORIZON": [
    { name: "AZSEKER (intra-group)", sharePct: 80, paymentTermsDays: 30, contractExpiry: null, notes: "Internal shared-services charge to parent + sub-entities" },
    { name: "External legal / IT clients", sharePct: 20, paymentTermsDays: 30, contractExpiry: null, notes: "Small external book" },
  ],
}

const SUPPLIERS_BY_ENTITY = {
  "AZSEKER-AZSF": [
    { name: "AZSEKER-EDEN (intra-group cane)", sharePct: 48, singleSource: false, paymentTermsDays: 60, notes: "Primary cane supplier; cut-to-mill ≤24h SLA" },
    { name: "AZSEKER-FARM (intra-group)", sharePct: 12, singleSource: false, paymentTermsDays: 60, notes: "Supplementary cane" },
    { name: "Socar Industrial Gas", sharePct: 8, singleSource: true, paymentTermsDays: 30, contractExpiry: "2026-12-31", notes: "Process steam — single qualified domestic supplier" },
    { name: "Azərenerji", sharePct: 14, singleSource: true, paymentTermsDays: 14, notes: "Power utility — natural single-source (grid monopoly)" },
    { name: "Fertilizer trader (BASF agent)", sharePct: 6, singleSource: false, paymentTermsDays: 60, notes: "NPK / urea — multiple alternates" },
    { name: "Packaging supplier", sharePct: 4, singleSource: false, paymentTermsDays: 45, notes: "Multiple PE-bag converters" },
    { name: "Spare parts (sugar mill OEMs)", sharePct: 5, singleSource: true, paymentTermsDays: 90, notes: "Sugar centrifuge spares — German OEM only" },
    { name: "Other operating", sharePct: 3, singleSource: false, paymentTermsDays: 30, notes: "" },
  ],
  "AZSEKER-CPC": [
    { name: "AZSEKER-EDEN (intra-group corn)", sharePct: 35, singleSource: false, paymentTermsDays: 60, notes: "Primary corn input" },
    { name: "Spot corn importers (top 3)", sharePct: 25, singleSource: false, paymentTermsDays: 30, notes: "USD-invoiced; FX hedge needed" },
    { name: "Azərenerji", sharePct: 12, singleSource: true, paymentTermsDays: 14, notes: "Power utility" },
    { name: "Sodium metabisulfite (Na2S2O5)", sharePct: 3, singleSource: true, paymentTermsDays: 60, contractExpiry: "2026-12-31", notes: "Single qualified Indian supplier" },
    { name: "Caustic soda", sharePct: 6, singleSource: false, paymentTermsDays: 45, notes: "Local supply OK" },
    { name: "Packaging materials", sharePct: 5, singleSource: false, paymentTermsDays: 45, notes: "Multiple alternates" },
    { name: "Spare parts (corn wet-mill OEM)", sharePct: 5, singleSource: true, paymentTermsDays: 90, notes: "German + Italian OEMs only" },
    { name: "Process labor (contractors)", sharePct: 9, singleSource: false, paymentTermsDays: 14, notes: "" },
  ],
  "AZSEKER-MALT": [
    { name: "AZSEKER-FARM (intra-group barley)", sharePct: 38, singleSource: false, paymentTermsDays: 60, notes: "Primary barley input" },
    { name: "Open-market barley (regional)", sharePct: 22, singleSource: false, paymentTermsDays: 14, notes: "Spot market top-up" },
    { name: "Azərenerji", sharePct: 14, singleSource: true, paymentTermsDays: 14, notes: "Power utility" },
    { name: "SOCAR natural gas (kilning)", sharePct: 8, singleSource: true, paymentTermsDays: 30, notes: "Process heat — gas pipeline single-source" },
    { name: "Maltings equipment OEM (Bühler)", sharePct: 3, singleSource: true, paymentTermsDays: 90, contractExpiry: "2027-12-31", notes: "Sole spares / service supplier" },
    { name: "Packaging", sharePct: 5, singleSource: false, paymentTermsDays: 45, notes: "Multiple alternates" },
    { name: "Process labor + admin", sharePct: 10, singleSource: false, paymentTermsDays: 14, notes: "" },
  ],
}

// Per-entity strategic narrative + compliance settings (merged into
// Company.settings JSON via update with spread).
const STRATEGIC_BY_ENTITY = {
  "AZSEKER": {
    strategicPlan: "3-yr plan (2026-2028): expand CPC corn-wet-milling capacity +30%; complete Malt house line-2 doubling capacity; launch organic-sugar export brand for Türkiyə market. Net leverage target: keep ≤2.5×.",
    risksRegister: [
      { rank: 1, risk: "ICE #11 sugar price drop below $0.18/lb sustained 2+ quarters", impact: "Revenue −18-22%, EBITDA wiped", mitigation: "Forward-sell 40% of 2026 production by Q1" },
      { rank: 2, risk: "Drought + irrigation shortfall in Salyan", impact: "Cane yield −25%, AZSF processing volume hit", mitigation: "Drip-irrigation pilot 2026; weather insurance" },
      { rank: 3, risk: "AZN devaluation vs USD >5%", impact: "Corn import cost shock for CPC", mitigation: "USD-pegged customer pricing clauses + 6-mo forward hedges" },
    ],
    competitivePositioning: {
      mainCompetitors: ["Bakı Şirniyyat Group", "Şirniyyat Birliyi (cooperative)", "Importers (BR/TR/RU sugar)"],
      ourAdvantage: "Vertically integrated EDEN→AZSF→MALT chain controls cane-to-shelf supply; only Azeri producer with full PLF/BS/CF transparency to lenders. Distribution: direct B2B + DCFTA Georgia channel.",
      gap: "Brand-side weak vs Bakı Şirniyyat — packaged-goods retail share <15% (target 25% by 2028).",
    },
    initiatives2026: [
      { type: "CAPEX", item: "CPC corn wet-mill expansion phase 1", amountAZN: 18_500_000, status: "approved", expectedFinish: "2026-Q3" },
      { type: "CAPEX", item: "Malt house line-2 (Bühler equipment)", amountAZN: 12_000_000, status: "approved", expectedFinish: "2027-Q2" },
      { type: "M&A", item: "Acquisition target: regional cane farm (target 1500 ha)", amountAZN: 4_200_000, status: "negotiating", expectedFinish: "2026-Q4" },
      { type: "Launch", item: "Premium organic-sugar SKU for Türkiyə market", amountAZN: 850_000, status: "scoping", expectedFinish: "2026-Q2" },
    ],
    nps: { score: 32, asOf: "2025-Q4", comment: "Internal stakeholder survey; B2B customers only. Industry avg 18, our spec target ≥40 by 2027." },
    bankCovenants: {
      dscrTarget: 1.4,
      debtToEquityMax: 2.5,
      minLiquidityAZN: 5_000_000,
      lenders: ["Pasha Bank", "Kapital Bank", "ABB"],
      nextReviewDate: "2026-06-30",
    },
    insurance: {
      cropInsurance: { provider: "AzSığorta", coverageAZN: 8_500_000, premium: 245_000, expiry: "2026-12-31" },
      propertyInsurance: { provider: "PASHA Sığorta", coverageAZN: 32_000_000, premium: 380_000, expiry: "2026-12-31" },
      workersComp: { provider: "AzSığorta", coverageAZN: 2_400_000, premium: 95_000, expiry: "2026-12-31" },
    },
    landTitles: { ownedHa: 8_500, leasedHa: 7_000, leaseExpiryEarliest: "2028-12-31", leaseExpiryLatest: "2033-06-30", notes: "Lease land mostly in Beyləqan + Sabirabad; renewals being negotiated." },
    subsidyPipeline: [
      { program: "AZ State agro subsidy 2026 (irrigation modernization)", expectedAmountAZN: 1_200_000, expectedDate: "2026-Q2", status: "applied" },
      { program: "Export incentive (DCFTA Georgia)", expectedAmountAZN: 380_000, expectedDate: "2026-Q4", status: "pre-application" },
    ],
    litigation: [
      { id: "LIT-2025-01", case: "Land lease dispute — 240 ha plot in Salyan", status: "in mediation", openedDate: "2025-04-12", expectedResolution: "2026-Q3", financialImpactAZN: 350_000 },
      { id: "REG-2026-01", case: "Tax authority audit — 2024 cogs deduction items", status: "audit-open", openedDate: "2026-02-08", expectedResolution: "2026-Q4", financialImpactAZN: 180_000 },
    ],
  },
}

async function main() {
  console.log("\n=== Seed counterparties + strategic narrative ===\n")
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG }, select: { id: true } })
  if (!org) throw new Error("Org not found")

  // ── Counterparties ───────────────────────────────────────────────
  let totalRows = 0
  for (const [entityCode, customers] of Object.entries(CUSTOMERS_BY_ENTITY)) {
    const co = await prisma.company.findFirst({
      where: { organizationId: org.id, code: entityCode },
      select: { id: true },
    })
    if (!co) { console.log(`  ⚠ ${entityCode} not in DB`); continue }
    for (const c of customers) {
      await prisma.counterparty.upsert({
        where: { companyId_role_name_period: { companyId: co.id, role: "customer", name: c.name, period: PERIOD } },
        create: {
          organizationId: org.id, companyId: co.id, role: "customer",
          name: c.name, sharePct: c.sharePct,
          contractExpiry: c.contractExpiry ? new Date(c.contractExpiry) : null,
          paymentTermsDays: c.paymentTermsDays ?? null,
          notes: c.notes ?? null,
          period: PERIOD,
        },
        update: {
          sharePct: c.sharePct,
          contractExpiry: c.contractExpiry ? new Date(c.contractExpiry) : null,
          paymentTermsDays: c.paymentTermsDays ?? null,
          notes: c.notes ?? null,
        },
      })
      totalRows++
    }
  }
  for (const [entityCode, suppliers] of Object.entries(SUPPLIERS_BY_ENTITY)) {
    const co = await prisma.company.findFirst({
      where: { organizationId: org.id, code: entityCode },
      select: { id: true },
    })
    if (!co) continue
    for (const s of suppliers) {
      await prisma.counterparty.upsert({
        where: { companyId_role_name_period: { companyId: co.id, role: "supplier", name: s.name, period: PERIOD } },
        create: {
          organizationId: org.id, companyId: co.id, role: "supplier",
          name: s.name, sharePct: s.sharePct,
          contractExpiry: s.contractExpiry ? new Date(s.contractExpiry) : null,
          paymentTermsDays: s.paymentTermsDays ?? null,
          singleSource: s.singleSource ?? false,
          notes: s.notes ?? null,
          period: PERIOD,
        },
        update: {
          sharePct: s.sharePct,
          contractExpiry: s.contractExpiry ? new Date(s.contractExpiry) : null,
          paymentTermsDays: s.paymentTermsDays ?? null,
          singleSource: s.singleSource ?? false,
          notes: s.notes ?? null,
        },
      })
      totalRows++
    }
  }
  console.log(`  ✓ ${totalRows} Counterparty rows (customers + suppliers)`)

  // ── Strategic narrative settings ─────────────────────────────────
  for (const [entityCode, settings] of Object.entries(STRATEGIC_BY_ENTITY)) {
    const co = await prisma.company.findFirst({
      where: { organizationId: org.id, code: entityCode },
      select: { id: true, settings: true },
    })
    if (!co) continue
    const merged = { ...(co.settings ?? {}), ...settings }
    await prisma.company.update({ where: { id: co.id }, data: { settings: merged } })
    console.log(`  ✓ ${entityCode} narrative settings: ${Object.keys(settings).join(", ")}`)
  }

  console.log("\n=== DONE ===")
  await prisma.$disconnect()
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1) })
