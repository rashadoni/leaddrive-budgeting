/**
 * Phase 7.E demo-data expansion — saturate HeatMap matrix to ~24 companies
 * across 11 industries with realistic green/amber/red severity spread.
 *
 * Why this exists: AZMADE seed has 13 companies all in `industrial` /
 * `services` industries → only ~5 indicators light up per company → matrix
 * is sparse and the Bloomberg-grade "wall of cells" demo punch is missing.
 * This script extends the EXISTING `demo` org (alongside DEMO-CO) with a
 * holding tree covering hospitality / agro / poultry / industrial / pharma /
 * food_processing / beverage / real_estate / logistics / retail / construction /
 * entertainment / education — enough industries to exercise ~30 of 52
 * IndicatorDefinitions.
 *
 * Idempotent. Re-running converges to the same DB state (deterministic
 * values, upsert + transactional replace patterns). Safe to run repeatedly.
 *
 * Run:
 *   npx tsx scripts/seed-demo-companies.ts
 *
 * Then trigger recompute (DB connection required for the indicator pipeline):
 *   npx tsx scripts/seed-demo-companies.ts --recompute
 *   # OR via API once dev server is up:
 *   #   curl -X POST http://localhost:3000/api/indicators \
 *   #     -H "Content-Type: application/json" -d '{}'
 *
 * After recompute, populate sparklines:
 *   npx tsx scripts/compute-sparklines.ts --orgSlug=demo
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { runRecomputeForCompanies } from '../src/lib/risk/recompute-trigger';

const prisma = new PrismaClient();

const ORG_SLUG = 'demo';
const ORG_NAME = 'Demo Holdings';
const YEARS = [2025, 2026] as const;
const PRIMARY_YEAR = 2026;

// ─────────────────────────────────────────────────────────────────────────
// Company tree: 6 L1 sub-groups + 24 L2 operational entities
// ─────────────────────────────────────────────────────────────────────────

type Severity = 'green' | 'amber' | 'red';

interface CompanySeed {
  code: string;
  name: string;
  nameEn?: string;
  industry?: string; // null for L1
  level: 1 | 2;
  parentCode?: string;
  country: string;
  baseCurrencyCode: string;
  sortOrder: number;
  severity?: Severity; // only on L2; drives value recipe
  /** Optional Company.settings JSON — sector-specific config keys. */
  settings?: Record<string, number>;
}

const SUB_GROUPS: CompanySeed[] = [
  { code: 'DEMO-HOTELS', name: 'Demo Hospitality Group', level: 1, country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 100 },
  { code: 'DEMO-AGRO', name: 'Demo Agro Group', level: 1, country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 200 },
  { code: 'DEMO-IND', name: 'Demo Industrial Group', level: 1, country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 300 },
  { code: 'DEMO-FOOD', name: 'Demo Food & Beverage Group', level: 1, country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 400 },
  { code: 'DEMO-RE', name: 'Demo Real Estate Group', level: 1, country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 500 },
  { code: 'DEMO-SVC', name: 'Demo Services Group', level: 1, country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 600 },
];

const OP_COMPANIES: CompanySeed[] = [
  // Hospitality (3 hotels — 1 green / 1 amber / 1 red)
  { code: 'DEMO-HOTEL-CG', name: 'Caspian Grand Hotel', industry: 'hospitality', level: 2, parentCode: 'DEMO-HOTELS', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 110, severity: 'green', settings: { totalRooms: 180 } },
  { code: 'DEMO-HOTEL-KB', name: 'Khazar Beach Resort', industry: 'hospitality', level: 2, parentCode: 'DEMO-HOTELS', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 120, severity: 'amber', settings: { totalRooms: 120 } },
  { code: 'DEMO-HOTEL-SB', name: 'Sheki Boutique Inn', industry: 'hospitality', level: 2, parentCode: 'DEMO-HOTELS', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 130, severity: 'red', settings: { totalRooms: 60 } },
  // Agro crops (3 farms)
  { code: 'DEMO-AGRO-AW', name: 'Aran Wheat Fields', industry: 'agro_crops', level: 2, parentCode: 'DEMO-AGRO', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 210, severity: 'green' },
  { code: 'DEMO-AGRO-MP', name: 'Mil Plain Cotton', industry: 'agro_crops', level: 2, parentCode: 'DEMO-AGRO', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 220, severity: 'amber' },
  { code: 'DEMO-AGRO-KV', name: 'Kur Valley Vegetables', industry: 'agro_crops', level: 2, parentCode: 'DEMO-AGRO', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 230, severity: 'red' },
  // Poultry (2)
  { code: 'DEMO-POULT-GJ', name: 'Ganja Poultry', industry: 'poultry', level: 2, parentCode: 'DEMO-AGRO', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 240, severity: 'green' },
  { code: 'DEMO-POULT-AB', name: 'Absheron Broilers', industry: 'poultry', level: 2, parentCode: 'DEMO-AGRO', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 250, severity: 'red' },
  // Industrial (3 plants)
  { code: 'DEMO-IND-SS', name: 'Sumgait Steel Works', industry: 'industrial', level: 2, parentCode: 'DEMO-IND', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 310, severity: 'green' },
  { code: 'DEMO-IND-BC', name: 'Baku Cement Plant', industry: 'industrial', level: 2, parentCode: 'DEMO-IND', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 320, severity: 'amber' },
  { code: 'DEMO-IND-CP', name: 'Caspian Plastics', industry: 'industrial', level: 2, parentCode: 'DEMO-IND', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 330, severity: 'red' },
  // Pharma (2)
  { code: 'DEMO-PHARM-AP', name: 'Azeri Pharma Labs', industry: 'pharma', level: 2, parentCode: 'DEMO-IND', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 340, severity: 'green' },
  { code: 'DEMO-PHARM-GX', name: 'Genix Generics', industry: 'pharma', level: 2, parentCode: 'DEMO-IND', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 350, severity: 'amber' },
  // Food & Beverage (4)
  { code: 'DEMO-FOOD-CD', name: 'Caspian Dairy', industry: 'food_processing', level: 2, parentCode: 'DEMO-FOOD', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 410, severity: 'green' },
  { code: 'DEMO-FOOD-AC', name: 'Aran Cannery', industry: 'food_processing', level: 2, parentCode: 'DEMO-FOOD', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 420, severity: 'amber' },
  { code: 'DEMO-BEV-KB', name: 'Khazar Beverages', industry: 'beverage', level: 2, parentCode: 'DEMO-FOOD', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 430, severity: 'red' },
  { code: 'DEMO-BEV-CS', name: 'Caucasus Spirits', industry: 'beverage', level: 2, parentCode: 'DEMO-FOOD', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 440, severity: 'green' },
  // Real Estate (2)
  { code: 'DEMO-RE-BT', name: 'Baku Business Towers', industry: 'real_estate', level: 2, parentCode: 'DEMO-RE', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 510, severity: 'green', settings: { totalArea: 25000, leasedArea: 23000 } },
  { code: 'DEMO-RE-KR', name: 'Khazar Residences', industry: 'real_estate', level: 2, parentCode: 'DEMO-RE', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 520, severity: 'amber', settings: { totalArea: 18000, leasedArea: 14400 } },
  // Services umbrella (logistics / retail / construction / entertainment / education)
  { code: 'DEMO-LOG-AL', name: 'Atlas Logistics', industry: 'logistics', level: 2, parentCode: 'DEMO-SVC', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 610, severity: 'amber' },
  { code: 'DEMO-RTL-CR', name: 'Caspian Express Retail', industry: 'retail', level: 2, parentCode: 'DEMO-SVC', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 620, severity: 'green' },
  { code: 'DEMO-CON-ZC', name: 'Zaman Construction', industry: 'construction', level: 2, parentCode: 'DEMO-SVC', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 630, severity: 'red' },
  { code: 'DEMO-ENT-CC', name: 'Crescent Cinemas', industry: 'entertainment', level: 2, parentCode: 'DEMO-SVC', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 640, severity: 'amber', settings: { capacity: 2400 } },
  { code: 'DEMO-EDU-BH', name: 'Baku Higher School', industry: 'education', level: 2, parentCode: 'DEMO-SVC', country: 'AZ', baseCurrencyCode: 'AZN', sortOrder: 650, severity: 'green', settings: { targetEnrollment: 1200, teachers: 80 } },
];

const ALL_COMPANIES = [...SUB_GROUPS, ...OP_COMPANIES];

// ─────────────────────────────────────────────────────────────────────────
// Chart of Accounts — minimal 8-row pack the budgetLineResolver needs.
// `accountType` MUST be one of revenue|cogs|expense|asset|liability|equity;
// the resolver only sums revenue/cogs/expense (lines 748-758 of recompute.ts).
// ─────────────────────────────────────────────────────────────────────────

interface CoaSeed {
  code: string;
  name: string;
  accountType: string;
  category?: string;
  sortOrder: number;
}

const COA_SEEDS: CoaSeed[] = [
  { code: '601-REV', name: 'Sales Revenue', accountType: 'revenue', category: 'sales', sortOrder: 10 },
  { code: '602-REV-FX', name: 'Export Revenue (FX)', accountType: 'revenue', category: 'sales', sortOrder: 11 },
  { code: '701-COGS', name: 'Cost of Goods Sold (Domestic)', accountType: 'cogs', category: 'cogs', sortOrder: 20 },
  { code: '702-COGS-IMPORTED', name: 'Imported Materials', accountType: 'cogs', category: 'cogs', sortOrder: 21 },
  { code: '703-COGS-FEED', name: 'Feed Cost', accountType: 'cogs', category: 'feed', sortOrder: 22 },
  { code: '711-OPEX-SALES', name: 'Sales & Marketing', accountType: 'expense', category: 'sales', sortOrder: 30 },
  { code: '721-OPEX-ADMIN', name: 'Admin & General', accountType: 'expense', category: 'staff', sortOrder: 31 },
  { code: '731-DEPR', name: 'Depreciation', accountType: 'expense', category: 'depreciation', sortOrder: 32 },
  { code: '741-DEBT-SERVICE', name: 'Debt Service', accountType: 'expense', category: 'debt_service', sortOrder: 33 },
  { code: '771-TAX', name: 'Income Tax', accountType: 'expense', category: 'tax', sortOrder: 40 },
];

// ─────────────────────────────────────────────────────────────────────────
// Value recipes — per-severity raw numbers calibrated against indicator
// thresholds. The evaluator turns these into IndicatorValue.status.
// ─────────────────────────────────────────────────────────────────────────

interface BudgetRecipe {
  /** Annual revenue in AZN. Distributed across 12 months by SHAPE vector. */
  annualRevenue: number;
  /** COGS share of revenue (drives gross margin). */
  cogsShare: number;
  /** Imported share of COGS (drives FX exposure). */
  importedCogsShare: number;
  /** OpEx share of revenue (drives opex ratio + net margin). */
  opexShare: number;
  /** Depreciation share. */
  deprShare: number;
  /** Debt-service share (RE / heavily-levered industrial only). */
  debtServiceShare: number;
  /** Tax share. */
  taxShare: number;
  /** Year-over-year multiplier; 2025 = base × 0.92, 2026 = base × 1.0. */
  yearMultiplier: Record<number, number>;
}

function recipeFor(industry: string, severity: Severity): BudgetRecipe {
  // Pharmacy uses different threshold (green ≥55, amber ≥30, red <30).
  // Hospitality is driven by Booking (annualRevenue is symbolic for OpEx anchor).
  // RE indicators want debt service > 0 for RE_DEBT_SERVICE_COVERAGE.
  const baseAnnualRevenue: Record<string, Record<Severity, number>> = {
    industrial: { green: 24_000_000, amber: 12_000_000, red: 6_000_000 },
    pharma: { green: 18_000_000, amber: 9_000_000, red: 4_000_000 },
    food_processing: { green: 16_000_000, amber: 8_000_000, red: 4_000_000 },
    beverage: { green: 14_000_000, amber: 7_000_000, red: 3_500_000 },
    poultry: { green: 11_000_000, amber: 5_500_000, red: 2_500_000 },
    agro_crops: { green: 9_000_000, amber: 4_500_000, red: 2_000_000 },
    real_estate: { green: 13_000_000, amber: 6_500_000, red: 3_000_000 },
    logistics: { green: 8_000_000, amber: 4_000_000, red: 2_000_000 },
    retail: { green: 22_000_000, amber: 11_000_000, red: 5_000_000 },
    construction: { green: 19_000_000, amber: 9_500_000, red: 4_000_000 },
    entertainment: { green: 6_000_000, amber: 3_000_000, red: 1_500_000 },
    education: { green: 7_500_000, amber: 3_750_000, red: 1_800_000 },
    hospitality: { green: 5_000_000, amber: 2_500_000, red: 1_200_000 },
  };
  const annual = baseAnnualRevenue[industry]?.[severity] ?? 5_000_000;
  // Pharma uses different threshold band; otherwise use industrial-style template.
  const isPharma = industry === 'pharma';
  const cogsShare = isPharma
    ? { green: 0.35, amber: 0.6, red: 0.78 }[severity]
    : { green: 0.4, amber: 0.78, red: 0.92 }[severity];
  const opexShare = { green: 0.15, amber: 0.3, red: 0.42 }[severity];
  return {
    annualRevenue: annual,
    cogsShare,
    importedCogsShare: { green: 0.25, amber: 0.5, red: 0.7 }[severity],
    opexShare,
    deprShare: 0.04,
    debtServiceShare: industry === 'real_estate' ? { green: 0.08, amber: 0.13, red: 0.2 }[severity] : 0.02,
    taxShare: 0.04,
    yearMultiplier: { 2025: 0.92, 2026: 1.0 },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Monthly distribution shape vectors (sum to 1.0 within rounding).
// ─────────────────────────────────────────────────────────────────────────

const SHAPE: Record<string, number[]> = {
  // Industrial / pharma / food / beverage / construction — moderate spring/summer peak
  flat: [0.078, 0.078, 0.082, 0.085, 0.090, 0.090, 0.090, 0.088, 0.085, 0.082, 0.078, 0.074],
  // Hospitality — strong summer peak, weak winter
  summer: [0.045, 0.050, 0.060, 0.080, 0.105, 0.130, 0.140, 0.130, 0.100, 0.075, 0.045, 0.040],
  // Agro crops — harvest spike Aug-Oct
  harvest: [0.030, 0.030, 0.040, 0.050, 0.065, 0.080, 0.110, 0.165, 0.180, 0.135, 0.070, 0.045],
  // Education — Sept + Feb spikes
  academic: [0.040, 0.135, 0.080, 0.075, 0.075, 0.040, 0.040, 0.060, 0.190, 0.110, 0.080, 0.075],
  // Entertainment — Dec + Jul peaks
  festive: [0.060, 0.055, 0.065, 0.070, 0.080, 0.090, 0.110, 0.090, 0.075, 0.080, 0.085, 0.140],
  // Retail — Q4 peak
  retail: [0.065, 0.060, 0.070, 0.075, 0.080, 0.080, 0.075, 0.080, 0.085, 0.100, 0.110, 0.120],
};

function shapeFor(industry: string): number[] {
  if (industry === 'hospitality') return SHAPE.summer;
  if (industry === 'agro_crops') return SHAPE.harvest;
  if (industry === 'education') return SHAPE.academic;
  if (industry === 'entertainment') return SHAPE.festive;
  if (industry === 'retail') return SHAPE.retail;
  return SHAPE.flat;
}

// ─────────────────────────────────────────────────────────────────────────
// Operational fact recipes — sector-specific metrics.
// ─────────────────────────────────────────────────────────────────────────

function opFactsFor(industry: string, severity: Severity): Array<{ metric: string; baseValue: number; unit?: string }> {
  switch (industry) {
    case 'agro_crops': {
      // AGRO_YIELD wants harvest_tons / area_hectares (resolver averages
      // per metric in window; we encode the ratio directly).
      const yieldVal = { green: 4.2, amber: 3.0, red: 2.1 }[severity];
      const droughtVal = { green: 18, amber: 45, red: 75 }[severity];
      // Commodity price stdev/mean ratio drives AGRO_COMMODITY_VOL.
      const commodityBase = { green: 250, amber: 240, red: 220 }[severity];
      return [
        { metric: 'yield_per_hectare', baseValue: yieldVal, unit: 'ton/ha' },
        { metric: 'drought_index', baseValue: droughtVal, unit: 'idx' },
        { metric: 'commodity_price', baseValue: commodityBase, unit: 'AZN/ton' },
      ];
    }
    case 'poultry': {
      const fcr = { green: 1.65, amber: 1.85, red: 2.05 }[severity];
      const mortality = { green: 0.03, amber: 0.06, red: 0.09 }[severity];
      return [
        { metric: 'fcr', baseValue: fcr, unit: 'kg/kg' },
        { metric: 'mortality_rate', baseValue: mortality, unit: 'pct' },
      ];
    }
    case 'real_estate': {
      const occ = { green: 0.92, amber: 0.8, red: 0.65 }[severity];
      const rentColl = { green: 0.99, amber: 0.94, red: 0.85 }[severity];
      return [
        { metric: 'occupancy_rate', baseValue: occ, unit: 'pct' },
        { metric: 'rent_collection_rate', baseValue: rentColl, unit: 'pct' },
      ];
    }
    case 'entertainment': {
      const utilization = { green: 0.75, amber: 0.55, red: 0.35 }[severity];
      const revPerVisit = { green: 28, amber: 18, red: 11 }[severity];
      return [
        { metric: 'attendance_utilization', baseValue: utilization, unit: 'pct' },
        { metric: 'revenue_per_visit', baseValue: revPerVisit, unit: 'AZN' },
      ];
    }
    case 'education': {
      const fillRate = { green: 0.95, amber: 0.78, red: 0.55 }[severity];
      const collection = { green: 0.97, amber: 0.85, red: 0.7 }[severity];
      return [
        { metric: 'enrollment_fill_rate', baseValue: fillRate, unit: 'pct' },
        { metric: 'tuition_collection_rate', baseValue: collection, unit: 'pct' },
      ];
    }
    case 'food_processing': {
      const yieldLoss = { green: 0.04, amber: 0.09, red: 0.16 }[severity];
      const inventoryTurns = { green: 12, amber: 7, red: 4 }[severity];
      return [
        { metric: 'yield_loss_rate', baseValue: yieldLoss, unit: 'pct' },
        { metric: 'inventory_turns', baseValue: inventoryTurns, unit: 'times' },
      ];
    }
    case 'retail': {
      const turns = { green: 14, amber: 8, red: 4 }[severity];
      return [{ metric: 'inventory_turns', baseValue: turns, unit: 'times' }];
    }
    default:
      return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Hospitality booking recipe.
// ─────────────────────────────────────────────────────────────────────────

interface HotelRecipe {
  occupancyTarget: number; // fraction of room-nights filled
  adrAzn: number; // average daily rate (AZN)
  fxShare: number; // fraction of bookings priced in USD/EUR
  countryMix: Array<{ code: string; weight: number; currency: 'AZN' | 'USD' | 'EUR' }>;
}

function hotelRecipeFor(severity: Severity): HotelRecipe {
  if (severity === 'green') {
    return {
      occupancyTarget: 0.78,
      adrAzn: 145,
      fxShare: 0.25,
      countryMix: [
        { code: 'AZ', weight: 0.45, currency: 'AZN' },
        { code: 'TR', weight: 0.15, currency: 'AZN' },
        { code: 'RU', weight: 0.12, currency: 'AZN' },
        { code: 'AE', weight: 0.10, currency: 'USD' },
        { code: 'DE', weight: 0.08, currency: 'EUR' },
        { code: 'GB', weight: 0.05, currency: 'EUR' },
        { code: 'IR', weight: 0.05, currency: 'USD' },
      ],
    };
  }
  if (severity === 'amber') {
    return {
      occupancyTarget: 0.58,
      adrAzn: 105,
      fxShare: 0.5,
      countryMix: [
        { code: 'AZ', weight: 0.35, currency: 'AZN' },
        { code: 'RU', weight: 0.30, currency: 'AZN' },
        { code: 'IR', weight: 0.20, currency: 'USD' },
        { code: 'TR', weight: 0.15, currency: 'AZN' },
      ],
    };
  }
  // red
  return {
    occupancyTarget: 0.38,
    adrAzn: 72,
    fxShare: 0.8,
    countryMix: [
      { code: 'IR', weight: 0.65, currency: 'USD' },
      { code: 'AZ', weight: 0.30, currency: 'AZN' },
      { code: 'GE', weight: 0.05, currency: 'AZN' },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Idempotent helpers
// ─────────────────────────────────────────────────────────────────────────

async function findOrCreateOrg(): Promise<{ id: string; slug: string }> {
  const existing = await prisma.organization.findUnique({
    where: { slug: ORG_SLUG },
    select: { id: true, slug: true },
  });
  if (existing) return existing;
  const created = await prisma.organization.create({
    data: { name: ORG_NAME, slug: ORG_SLUG },
    select: { id: true, slug: true },
  });
  console.log(`Organization created: ${created.slug}`);
  return created;
}

async function assertIndustriesSeeded(): Promise<void> {
  const industries = await prisma.industry.count();
  if (industries < 14) {
    throw new Error(
      `Industries table has only ${industries} rows; expected ≥14. ` +
      `Run \`npx tsx scripts/seed-industries.ts\` first.`,
    );
  }
}

async function assertCurrenciesSeeded(orgId: string): Promise<void> {
  // Currency is org-scoped (compound unique organizationId_code). For demo
  // org the rates may not yet be seeded — fall back to any-org currency row
  // existing as a softer check (the data we care about is exchangeRate
  // which currencyRateResolver reads from CurrencyRateHistory, not from
  // Currency itself for FX_IMPORTED_INPUT). Hard-fail only if no AZN at all.
  const codes = ['AZN', 'USD', 'EUR'];
  for (const code of codes) {
    const orgScoped = await prisma.currency.findFirst({
      where: { organizationId: orgId, code },
    });
    if (orgScoped) continue;
    const anyOrg = await prisma.currency.findFirst({ where: { code } });
    if (!anyOrg) {
      throw new Error(
        `Currency "${code}" not found anywhere. Run \`npx tsx scripts/seed-currency-rates.ts\` first.`,
      );
    }
    console.warn(
      `  ⚠ Currency "${code}" not seeded for demo org; FX indicators may stay unknown until seed-currency-rates is run for this org.`,
    );
  }
}

async function ensureBudgetPlan(orgId: string, year: number): Promise<string> {
  const name = `Demo Holdings ${year} Budget`;
  const existing = await prisma.budgetPlan.findFirst({
    where: { organizationId: orgId, year, name, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.budgetPlan.create({
    data: {
      organizationId: orgId,
      name,
      year,
      periodType: 'monthly',
      status: 'approved',
    },
    select: { id: true },
  });
  return created.id;
}

async function upsertChartOfAccounts(orgId: string): Promise<Map<string, string>> {
  const codeToId = new Map<string, string>();
  for (const coa of COA_SEEDS) {
    const existing = await prisma.chartOfAccount.findUnique({
      where: { organizationId_code: { organizationId: orgId, code: coa.code } },
      select: { id: true },
    });
    if (existing) {
      await prisma.chartOfAccount.update({
        where: { id: existing.id },
        data: {
          name: coa.name,
          accountType: coa.accountType,
          category: coa.category ?? null,
          sortOrder: coa.sortOrder,
          isActive: true,
        },
      });
      codeToId.set(coa.code, existing.id);
    } else {
      const created = await prisma.chartOfAccount.create({
        data: {
          organizationId: orgId,
          code: coa.code,
          name: coa.name,
          accountType: coa.accountType,
          category: coa.category ?? null,
          sortOrder: coa.sortOrder,
          isActive: true,
        },
        select: { id: true },
      });
      codeToId.set(coa.code, created.id);
    }
  }
  return codeToId;
}

async function upsertCompany(
  orgId: string,
  seed: CompanySeed,
  parentLookup: Map<string, string>,
): Promise<string> {
  const parentId = seed.parentCode ? parentLookup.get(seed.parentCode) : null;
  if (seed.parentCode && !parentId) {
    throw new Error(`Parent ${seed.parentCode} not resolved when upserting ${seed.code}`);
  }
  const existing = await prisma.company.findUnique({
    where: { organizationId_code: { organizationId: orgId, code: seed.code } },
    select: { id: true },
  });
  const settingsValue = seed.settings
    ? (seed.settings as unknown as Prisma.InputJsonValue)
    : Prisma.JsonNull;
  const shared = {
    parentCompanyId: parentId ?? null,
    code: seed.code,
    name: seed.name,
    nameEn: seed.nameEn ?? seed.name,
    industry: seed.industry ?? null,
    level: seed.level,
    country: seed.country,
    baseCurrencyCode: seed.baseCurrencyCode,
    isActive: true,
    sortOrder: seed.sortOrder,
    settings: settingsValue,
  };
  if (existing) {
    await prisma.company.update({ where: { id: existing.id }, data: shared });
    return existing.id;
  }
  const created = await prisma.company.create({
    data: { ...shared, organizationId: orgId },
    select: { id: true },
  });
  return created.id;
}

// ─────────────────────────────────────────────────────────────────────────
// BudgetLine seeding — transactional replace per (company, year, account).
// Mirrors the import-azmade-budgets.ts pattern: deleteMany scoped, then
// createMany the new 12-month slice. Idempotent + safe re-run.
// ─────────────────────────────────────────────────────────────────────────

async function seedBudgetLinesForCompany(
  orgId: string,
  companyId: string,
  industry: string,
  severity: Severity,
  planByYear: Map<number, string>,
  coaIds: Map<string, string>,
): Promise<number> {
  const recipe = recipeFor(industry, severity);
  const shape = shapeFor(industry);
  let totalRows = 0;
  for (const year of YEARS) {
    const planId = planByYear.get(year);
    if (!planId) continue;
    const yearMul = recipe.yearMultiplier[year] ?? 1.0;
    const annualRevenue = recipe.annualRevenue * yearMul;
    const annualCogs = annualRevenue * recipe.cogsShare;
    const importedCogs = annualCogs * recipe.importedCogsShare;
    const domesticCogs = annualCogs - importedCogs;
    const annualOpexBase = annualRevenue * recipe.opexShare;
    const annualSalesOpex = annualOpexBase * 0.5;
    const annualAdminOpex = annualOpexBase * 0.5;
    const annualDepr = annualRevenue * recipe.deprShare;
    const annualDebtService = annualRevenue * recipe.debtServiceShare;
    const annualTax = Math.max(annualRevenue - annualCogs - annualOpexBase - annualDepr - annualDebtService, 0) * recipe.taxShare;
    const feedCogs = industry === 'poultry' ? annualCogs * 0.55 : 0;
    const nonFeedCogs = industry === 'poultry' ? annualCogs - feedCogs : 0;

    type LineSpec = {
      coaCode: string;
      annual: number;
      currency?: 'USD' | null;
      exchangeRate?: number | null;
    };
    const specs: LineSpec[] = [
      { coaCode: '601-REV', annual: annualRevenue * 0.85 },
      { coaCode: '602-REV-FX', annual: annualRevenue * 0.15, currency: 'USD', exchangeRate: 1.7 },
      ...(industry === 'poultry'
        ? [
            { coaCode: '703-COGS-FEED', annual: feedCogs },
            { coaCode: '701-COGS', annual: nonFeedCogs },
          ]
        : [{ coaCode: '701-COGS', annual: domesticCogs }]),
      { coaCode: '702-COGS-IMPORTED', annual: importedCogs, currency: 'USD' as const, exchangeRate: 1.7 },
      { coaCode: '711-OPEX-SALES', annual: annualSalesOpex },
      { coaCode: '721-OPEX-ADMIN', annual: annualAdminOpex },
      { coaCode: '731-DEPR', annual: annualDepr },
      { coaCode: '741-DEBT-SERVICE', annual: annualDebtService },
      { coaCode: '771-TAX', annual: annualTax },
    ];

    // Transactional replace: delete old slice, insert new.
    await prisma.$transaction(async (tx) => {
      const accountIds = specs
        .map((s) => coaIds.get(s.coaCode))
        .filter((id): id is string => Boolean(id));
      await tx.budgetLine.deleteMany({
        where: {
          organizationId: orgId,
          companyId,
          planId,
          accountId: { in: accountIds },
        },
      });
      const rows: Prisma.BudgetLineCreateManyInput[] = [];
      for (const spec of specs) {
        const accountId = coaIds.get(spec.coaCode);
        if (!accountId) continue;
        if (spec.annual <= 0) continue;
        for (let m = 0; m < 12; m++) {
          rows.push({
            organizationId: orgId,
            planId,
            companyId,
            accountId,
            category: spec.coaCode,
            lineType:
              spec.coaCode.startsWith('601') || spec.coaCode.startsWith('602')
                ? 'revenue'
                : spec.coaCode.startsWith('70')
                  ? 'cogs'
                  : 'expense',
            plannedAmount: Math.round(spec.annual * shape[m] * 100) / 100,
            sortOrder: m,
            currencyCode: spec.currency ?? null,
            exchangeRate: spec.exchangeRate ?? null,
          });
        }
      }
      if (rows.length > 0) {
        await tx.budgetLine.createMany({ data: rows });
        totalRows += rows.length;
      }
    });
  }
  return totalRows;
}

// ─────────────────────────────────────────────────────────────────────────
// Booking seeding — hospitality only.
// ─────────────────────────────────────────────────────────────────────────

async function seedBookingsForHotel(
  orgId: string,
  companyId: string,
  totalRooms: number,
  severity: Severity,
): Promise<number> {
  const recipe = hotelRecipeFor(severity);
  let inserted = 0;
  for (const year of YEARS) {
    // Replace scope: all bookings for this hotel this year.
    await prisma.$transaction(async (tx) => {
      await tx.booking.deleteMany({
        where: {
          organizationId: orgId,
          companyId,
          arrivalDate: {
            gte: new Date(Date.UTC(year, 0, 1)),
            lt: new Date(Date.UTC(year + 1, 0, 1)),
          },
        },
      });
      const rows: Prisma.BookingCreateManyInput[] = [];
      for (let m = 0; m < 12; m++) {
        const monthShape = SHAPE.summer[m];
        const seasonalOcc = recipe.occupancyTarget * (0.6 + 1.2 * monthShape * 12); // amplify around mean
        const targetRoomNights = Math.round(totalRooms * 30 * Math.min(seasonalOcc, 0.95));
        const avgNightsPerBooking = 3;
        const bookingsThisMonth = Math.max(Math.round(targetRoomNights / avgNightsPerBooking / 4), 8); // ~1 booking covers 4 room-nights typical mix
        for (let b = 0; b < bookingsThisMonth; b++) {
          // Pick country deterministically by booking index → country mix weights.
          const pickIdx = (b * 17) % 100; // deterministic spread
          let cumWeight = 0;
          let country = recipe.countryMix[0];
          for (const cm of recipe.countryMix) {
            cumWeight += cm.weight * 100;
            if (pickIdx < cumWeight) {
              country = cm;
              break;
            }
          }
          const day = Math.min(((b * 7) % 28) + 1, 28);
          const arrivalDate = new Date(Date.UTC(year, m, day));
          const nights = avgNightsPerBooking + ((b % 3) - 1); // 2/3/4 spread
          const departureDate = new Date(arrivalDate);
          departureDate.setUTCDate(departureDate.getUTCDate() + nights);
          // Revenue per night: USD/EUR bookings are quoted in their currency
          // at AZN-equivalent ADR (resolver applies exchangeRate to base).
          const adr = recipe.adrAzn;
          const fxRate = country.currency === 'USD' ? 1.7 : country.currency === 'EUR' ? 1.85 : null;
          const revenue =
            fxRate != null
              ? +(((adr / fxRate) * nights * 1) ).toFixed(2) // revenue in foreign currency
              : +(adr * nights * 1).toFixed(2);
          rows.push({
            organizationId: orgId,
            companyId,
            arrivalDate,
            departureDate,
            nights,
            revenue,
            currencyCode: country.currency,
            exchangeRate: fxRate,
            sourceCountry: country.code,
            roomsBooked: 1,
            channel: country.code === 'AZ' ? 'direct' : 'ota',
            isCancelled: false,
          });
        }
      }
      if (rows.length > 0) {
        await tx.booking.createMany({ data: rows });
        inserted += rows.length;
      }
    });
  }
  return inserted;
}

// ─────────────────────────────────────────────────────────────────────────
// OperationalFact seeding.
// ─────────────────────────────────────────────────────────────────────────

async function seedOperationalFactsForCompany(
  orgId: string,
  companyId: string,
  industry: string,
  severity: Severity,
): Promise<number> {
  const facts = opFactsFor(industry, severity);
  if (facts.length === 0) return 0;
  let inserted = 0;
  for (const year of YEARS) {
    await prisma.$transaction(async (tx) => {
      await tx.operationalFact.deleteMany({
        where: {
          organizationId: orgId,
          companyId,
          metric: { in: facts.map((f) => f.metric) },
          date: {
            gte: new Date(Date.UTC(year, 0, 1)),
            lt: new Date(Date.UTC(year + 1, 0, 1)),
          },
        },
      });
      const rows: Prisma.OperationalFactCreateManyInput[] = [];
      for (const fact of facts) {
        for (let m = 0; m < 12; m++) {
          // Add small deterministic month-over-month variance (±5%) so
          // commodity_price has a non-zero stdev (drives AGRO_COMMODITY_VOL).
          const variance = fact.metric === 'commodity_price'
            ? (severity === 'red' ? 0.32 : severity === 'amber' ? 0.18 : 0.08)
            : 0.05;
          const phase = (m / 12) * 2 * Math.PI;
          const value = fact.baseValue * (1 + variance * Math.sin(phase + (fact.metric.length % 7)));
          rows.push({
            organizationId: orgId,
            companyId,
            metric: fact.metric,
            date: new Date(Date.UTC(year, m, 15)),
            value: +value.toFixed(4),
            unit: fact.unit ?? null,
            source: 'seed',
          });
        }
      }
      if (rows.length > 0) {
        await tx.operationalFact.createMany({ data: rows });
        inserted += rows.length;
      }
    });
  }
  return inserted;
}

// ─────────────────────────────────────────────────────────────────────────
// Main orchestrator
// ─────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const shouldRecompute = args.includes('--recompute');

  console.log('Phase 7.E demo-data expansion (seed-demo-companies)');
  console.log('---------------------------------------------------');

  await assertIndustriesSeeded();
  const org = await findOrCreateOrg();
  await assertCurrenciesSeeded(org.id);

  const planByYear = new Map<number, string>();
  for (const y of YEARS) {
    planByYear.set(y, await ensureBudgetPlan(org.id, y));
  }
  console.log(`✓ Budget plans ready (${YEARS.join(', ')})`);

  const coaIds = await upsertChartOfAccounts(org.id);
  console.log(`✓ Chart of accounts seeded (${coaIds.size} accounts)`);

  const companyIds = new Map<string, string>();
  // Pass 1: L1 sub-groups
  for (const sg of SUB_GROUPS) {
    const id = await upsertCompany(org.id, sg, companyIds);
    companyIds.set(sg.code, id);
  }
  // Pass 2: L2 operational
  for (const op of OP_COMPANIES) {
    const id = await upsertCompany(org.id, op, companyIds);
    companyIds.set(op.code, id);
  }
  console.log(`✓ Companies upserted: ${SUB_GROUPS.length} L1 + ${OP_COMPANIES.length} L2`);

  // Cascading data per L2 op-co
  let budgetLineCount = 0;
  let bookingCount = 0;
  let factCount = 0;
  for (const op of OP_COMPANIES) {
    const id = companyIds.get(op.code);
    if (!id || !op.industry || !op.severity) continue;
    budgetLineCount += await seedBudgetLinesForCompany(
      org.id,
      id,
      op.industry,
      op.severity,
      planByYear,
      coaIds,
    );
    if (op.industry === 'hospitality' && op.settings?.totalRooms) {
      bookingCount += await seedBookingsForHotel(org.id, id, op.settings.totalRooms, op.severity);
    }
    factCount += await seedOperationalFactsForCompany(org.id, id, op.industry, op.severity);
  }
  console.log(`✓ BudgetLines: ${budgetLineCount}`);
  console.log(`✓ Bookings: ${bookingCount}`);
  console.log(`✓ OperationalFacts: ${factCount}`);

  if (shouldRecompute) {
    console.log('\nRunning recompute pipeline for demo org...');
    const affected = OP_COMPANIES
      .map((c) => companyIds.get(c.code))
      .filter((id): id is string => Boolean(id))
      .flatMap((companyId) => YEARS.map((year) => ({ companyId, year })));
    const result = await runRecomputeForCompanies(prisma, org.id, affected, {});
    console.log(`  ok=${result.ok} unknown=${result.unknown} failed=${result.failed} targets=${result.targets}`);
  } else {
    console.log('\nNext steps:');
    console.log('  1. Run recompute:  npx tsx scripts/seed-demo-companies.ts --recompute');
    console.log('     (or: curl -X POST http://localhost:3000/api/indicators -H "Content-Type: application/json" -d \'{}\')');
    console.log('  2. Sparklines:     npx tsx scripts/compute-sparklines.ts --orgSlug=demo');
    console.log('  3. Login as a demo-org user → /budgeting/terminal');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
