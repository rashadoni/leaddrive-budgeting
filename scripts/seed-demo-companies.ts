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

/**
 * Returns the OperationalFact rows to emit per month for the given
 * (industry, severity). CRITICAL: metric names MUST match the
 * `requiredInputs: ["operationalFact:<metric>"]` entries in
 * `src/lib/risk/indicator-seeds.ts`. Indicator formulas read the AVG of
 * each metric over the period, so we emit raw input pairs (e.g.
 * harvest_tons + area_hectares for AGRO_YIELD), NOT pre-computed ratios.
 *
 * Pairs that produce target ratios:
 *   AGRO_YIELD     = harvest_tons / area_hectares
 *   POULTRY_FCR    = feed_consumed_kg / weight_gain_kg
 *   POULTRY_MORTALITY = deaths / starting_flock
 *   RE_OCCUPANCY   = leased_area / total_area
 *   RE_RENT_COLL   = rent_collected / rent_billed
 *   ENT_ATTEND_UTIL= attendees / capacity
 *   EDU_FILL       = enrolled_students / target_enrollment
 *   EDU_TUITION    = tuition_collected / tuition_billed
 *   EDU_STR        = enrolled_students / teachers
 *   FP_YIELD_LOSS  = (raw_input - finished_output) / raw_input
 *   AGRO_DROUGHT   = drought_index (single metric)
 *   AGRO_COMM_VOL  = stdev(commodity_price) / mean(commodity_price)
 *   ENT_REV_PER_VST= revenue / attendees (revenue from budgetLine; emit attendees)
 */
function opFactsFor(industry: string, severity: Severity): Array<{ metric: string; baseValue: number; unit?: string }> {
  switch (industry) {
    case 'agro_crops': {
      // AGRO_YIELD: harvest_tons / area_hectares. Hold area constant at
      // 1000 ha; vary harvest to produce target yields (4.2/3.0/2.1 t/ha).
      const harvestTons = { green: 4200, amber: 3000, red: 2100 }[severity];
      const droughtIdx = { green: 18, amber: 45, red: 75 }[severity];
      // Commodity price stdev/mean ratio drives AGRO_COMMODITY_VOL.
      // Variance is applied below in seed loop based on (severity, metric).
      const commodityBase = { green: 250, amber: 240, red: 220 }[severity];
      return [
        { metric: 'harvest_tons', baseValue: harvestTons, unit: 'ton' },
        { metric: 'area_hectares', baseValue: 1000, unit: 'ha' },
        { metric: 'drought_index', baseValue: droughtIdx, unit: 'idx' },
        { metric: 'commodity_price', baseValue: commodityBase, unit: 'AZN/ton' },
      ];
    }
    case 'poultry': {
      // POULTRY_FCR: feed_consumed_kg / weight_gain_kg. Hold weight gain
      // constant at 50000 kg/month; vary feed to produce 1.65/1.85/2.05.
      const feedKg = { green: 82500, amber: 92500, red: 102500 }[severity];
      // POULTRY_MORTALITY: deaths / starting_flock × 100. Hold flock at
      // 100000 birds; vary deaths to produce 3%/6%/9%.
      const deaths = { green: 3000, amber: 6000, red: 9000 }[severity];
      return [
        { metric: 'feed_consumed_kg', baseValue: feedKg, unit: 'kg' },
        { metric: 'weight_gain_kg', baseValue: 50000, unit: 'kg' },
        { metric: 'deaths', baseValue: deaths, unit: 'birds' },
        { metric: 'starting_flock', baseValue: 100000, unit: 'birds' },
      ];
    }
    case 'real_estate': {
      // RE_OCCUPANCY: leased_area / total_area × 100. Hold total at
      // 25000 sqm; vary leased to produce 92%/80%/65%.
      const total = 25000;
      const leased = { green: 23000, amber: 20000, red: 16250 }[severity];
      // RE_RENT_COLLECTION: rent_collected / rent_billed × 100. Hold
      // billed at 100000 AZN/month; vary collected to produce 99%/94%/85%.
      const billed = 100000;
      const collected = { green: 99000, amber: 94000, red: 85000 }[severity];
      return [
        { metric: 'leased_area', baseValue: leased, unit: 'sqm' },
        { metric: 'total_area', baseValue: total, unit: 'sqm' },
        { metric: 'rent_collected', baseValue: collected, unit: 'AZN' },
        { metric: 'rent_billed', baseValue: billed, unit: 'AZN' },
      ];
    }
    case 'entertainment': {
      // ENT_ATTENDANCE_UTIL: attendees / capacity × 100. Hold capacity
      // at 2400 seats; vary attendees to produce 75%/55%/35%.
      const capacity = 2400;
      const attendees = { green: 1800, amber: 1320, red: 840 }[severity];
      return [
        { metric: 'attendees', baseValue: attendees, unit: 'visits' },
        { metric: 'capacity', baseValue: capacity, unit: 'seats' },
      ];
    }
    case 'education': {
      // EDU_ENROLLMENT_FILL: enrolled_students / target_enrollment × 100.
      // EDU_STUDENT_TEACHER_RATIO: enrolled_students / teachers (band 10-20).
      // Hold target=1200, teachers=80; vary enrolled to produce
      // green: 1140 (95% fill, 14.25 ratio — both green).
      // amber: 950 (79% fill, 11.9 ratio — green ratio still).
      // red: 600 (50% fill, 7.5 ratio — amber ratio).
      const target = 1200;
      const enrolled = { green: 1140, amber: 950, red: 600 }[severity];
      // EDU_TUITION_COLLECTION: tuition_collected / tuition_billed × 100.
      const billed = 200000;
      const collected = { green: 194000, amber: 170000, red: 140000 }[severity];
      return [
        { metric: 'enrolled_students', baseValue: enrolled, unit: 'students' },
        { metric: 'target_enrollment', baseValue: target, unit: 'students' },
        { metric: 'teachers', baseValue: 80, unit: 'staff' },
        { metric: 'tuition_collected', baseValue: collected, unit: 'AZN' },
        { metric: 'tuition_billed', baseValue: billed, unit: 'AZN' },
      ];
    }
    case 'food_processing': {
      // FP_YIELD_LOSS: (raw_input - finished_output) / raw_input × 100.
      // Hold raw_input at 100000 kg/month; vary finished to produce
      // 4%/9%/16% loss.
      const rawInput = 100000;
      const finished = { green: 96000, amber: 91000, red: 84000 }[severity];
      return [
        { metric: 'raw_input', baseValue: rawInput, unit: 'kg' },
        { metric: 'finished_output', baseValue: finished, unit: 'kg' },
      ];
    }
    // retail: RETAIL_INVENTORY_TURNS uses budgetLine.inventory (sub-aggregator),
    // not operationalFact. Skipping — RETAIL_GROSS_MARGIN is driven by
    // budgetLine alone via the recipe in recipeFor().
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
  // CALIBRATION (cross-checked against indicator-seeds.ts thresholds):
  //   HOSP_OCC      ≥70 green, ≥50 amber, <50 red       → adjust occupancyTarget
  //   HOSP_REVPAR   ≥80 green, ≥50 amber, <50 red       → ADR × occ ≈ revenue/avail
  //   HOSP_ADR      ≥120 green, ≥80 amber, <80 red      → adrAzn directly
  //   HOSP_FX_EXPOSURE ≤20 green, ≤50 amber, >50 red    → AZN-denominated weight
  //   HOSP_SOURCE_HHI  ≤1500 green, ≤2500 amber, >2500 red → diversify country mix
  if (severity === 'green') {
    // 6-country AZN-heavy mix (85% AZN, FX 15%) so HOSP_FX_EXPOSURE lands ≤20.
    // HHI: 0.0625 + 0.0225 + 0.0225 + 0.0144 + 0.0169 + 0.0025 + 0.0025 +
    //      0.0025 + 0.0009 + 0.0004 = 0.1476 = 1476 → ≤1500 (green band).
    return {
      occupancyTarget: 0.78,
      adrAzn: 145,
      fxShare: 0.15,
      countryMix: [
        { code: 'AZ', weight: 0.25, currency: 'AZN' },
        { code: 'TR', weight: 0.15, currency: 'AZN' },
        { code: 'RU', weight: 0.15, currency: 'AZN' },
        { code: 'KZ', weight: 0.13, currency: 'AZN' },
        { code: 'GE', weight: 0.12, currency: 'AZN' },
        { code: 'UZ', weight: 0.05, currency: 'AZN' },
        { code: 'AE', weight: 0.05, currency: 'USD' },
        { code: 'DE', weight: 0.05, currency: 'EUR' },
        { code: 'IT', weight: 0.03, currency: 'EUR' },
        { code: 'GB', weight: 0.02, currency: 'EUR' },
      ],
    };
  }
  if (severity === 'amber') {
    // 6-country mix, FX 40% (amber band ≤50). HHI: 0.0625 + 0.0625 +
    // 0.04 + 0.01 + 0.01 + 0.01 = 0.195 = 1950 → ≤2500 (amber band).
    return {
      occupancyTarget: 0.58,
      adrAzn: 105,
      fxShare: 0.40,
      countryMix: [
        { code: 'AZ', weight: 0.25, currency: 'AZN' },
        { code: 'RU', weight: 0.25, currency: 'AZN' },
        { code: 'IR', weight: 0.20, currency: 'USD' },
        { code: 'TR', weight: 0.10, currency: 'AZN' },
        { code: 'AE', weight: 0.10, currency: 'USD' },
        { code: 'DE', weight: 0.10, currency: 'EUR' },
      ],
    };
  }
  // red — Iran-dominated mix; HHI 0.4225 + 0.0625 + 0.01 = 0.495 = 4950
  // (clearly red band >2500); FX 65% > 50 → red.
  return {
    occupancyTarget: 0.38,
    adrAzn: 72,
    fxShare: 0.65,
    countryMix: [
      { code: 'IR', weight: 0.65, currency: 'USD' },
      { code: 'AZ', weight: 0.25, currency: 'AZN' },
      { code: 'GE', weight: 0.10, currency: 'AZN' },
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
    // Architect Round-1 sub-27 closure: L1 sub-groups are navigation
    // wrappers, not measurable entities — set role='admin' so Phase 7.E
    // operational scoring + alert engine skip them. L2 ops keep schema
    // default 'operational'.
    role: (seed.level === 1 ? 'admin' : 'operational') as 'admin' | 'operational',
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
    // Vary feed-cost share to hit POULTRY_FEED_COST_SHARE bands
    // (green between 58-72, amber between 50-78, red >78). Architect
    // sub-27 Round-2 closure: prior constant 0.55 landed below all
    // bands → unknown.
    const feedShare = industry === 'poultry'
      ? { green: 0.65, amber: 0.72, red: 0.85 }[severity]
      : 0;
    const feedCogs = industry === 'poultry' ? annualCogs * feedShare : 0;
    const nonFeedCogs = industry === 'poultry' ? annualCogs - feedCogs : 0;

    type LineSpec = {
      coaCode: string;
      annual: number;
      currency?: 'USD' | null;
      exchangeRate?: number | null;
    };
    // FX storage convention: `annual` for USD-tagged lines is the
    // FOREIGN-currency amount; the resolver multiplies by exchangeRate
    // to convert to AZN base. To make the AZN-equivalent match the
    // intent (e.g. "15% of AZN revenue is FX"), divide the AZN-intent
    // by exchangeRate. Architect Round-1 sub-27-cont'd: original code
    // stored AZN-intent directly as the USD amount, inflating
    // AZN-equivalent revenue/cogs by ×exchangeRate (1.7 → +70%) and
    // pushing every amber company into red gross-margin band.
    const FX_RATE = 1.7;
    const fxRevenueIntentAzn = annualRevenue * 0.15;
    const fxRevenueUsd = fxRevenueIntentAzn / FX_RATE;
    const importedCogsUsd = importedCogs / FX_RATE;
    const specs: LineSpec[] = [
      { coaCode: '601-REV', annual: annualRevenue * 0.85 },
      { coaCode: '602-REV-FX', annual: fxRevenueUsd, currency: 'USD', exchangeRate: FX_RATE },
      ...(industry === 'poultry'
        ? [
            { coaCode: '703-COGS-FEED', annual: feedCogs },
            { coaCode: '701-COGS', annual: nonFeedCogs },
          ]
        : [{ coaCode: '701-COGS', annual: domesticCogs }]),
      { coaCode: '702-COGS-IMPORTED', annual: importedCogsUsd, currency: 'USD' as const, exchangeRate: FX_RATE },
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
            // Phase 7.G Turn XL (A.1): explicit 0-indexed month for
            // sparkline + per-month aggregation queries.
            monthIndex: m,
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
    // Replace scope: all bookings for this hotel this year. Transaction
    // timeout raised to 60s (default 5s) — green hotel produces ~24k
    // bookings/year (block reservations 2-4 rooms × 2-4 nights) and the
    // bulk createMany regularly exceeds the default. Architect Round-2
    // sub-27 cont'd: prior commit had this comment but no actual options
    // arg, leaving the default 5s active and causing TX timeouts on first
    // execute. Now passes `{ timeout: 60_000 }` for real.
    await prisma.$transaction(
      async (tx) => {
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
        // monthShape sums to 1.0 over 12 months (avg ≈0.083). Map to a
        // multiplier that varies smoothly around 1.0: 0.5 + 6×monthShape
        // ranges roughly 0.77 → 1.34 across the summer-shape vector,
        // giving ~25% seasonal swing instead of every-month-clamped-to-95%.
        // Architect Round-1 sub-27 closure (was: `0.6 + 1.2 * monthShape * 12`
        // which produced ≥1.0 every month → green hotel flat at 0.95 occ).
        const seasonalMultiplier = 0.5 + monthShape * 6;
        const seasonalOcc = Math.min(recipe.occupancyTarget * seasonalMultiplier, 0.95);
        const daysInMonth = 30;
        // CRITICAL: bookingResolver semantics are
        // `rooms_sold = sum(roomsBooked)` (each Booking row counts its
        // roomsBooked once, regardless of nights). So to hit a target
        // monthly occupancy:
        //   target rooms_sold = totalRooms × daysInMonth × seasonalOcc
        //   bookingsThisMonth × avgRoomsPerBooking ≈ target rooms_sold
        // Using avg roomsBooked=3 (range 2-4 below) → divisor=3.
        // This is "block reservations" — each booking represents a
        // multi-room family/group stay rather than a single-room walk-in.
        // Architect sub-27 cont'd: prior version divided by `5`
        // (avgRoomNightsPerBooking) treating roomsBooked × nights as the
        // resolver semantic — which it isn't. HOSP_OCC landed at ~22%
        // for green hotels post-fix-1 because of this misinterpretation.
        const targetRoomsSold = Math.round(totalRooms * daysInMonth * seasonalOcc);
        const avgRoomsPerBooking = 3;
        const bookingsThisMonth = Math.max(Math.round(targetRoomsSold / avgRoomsPerBooking), 8);
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
          // 2/3/4 nights × 2/3/4 rooms = "block reservations" with avg
          // 3 rooms × 3 nights ≈ 9 room-nights per Booking row.
          const nights = 2 + (b % 3); // 2/3/4
          const roomsBooked = 2 + (b % 3); // 2/3/4
          const departureDate = new Date(arrivalDate);
          departureDate.setUTCDate(departureDate.getUTCDate() + nights);
          // Revenue: USD/EUR bookings stored in foreign currency; resolver
          // applies exchangeRate to convert to base. Per-room-per-night ADR.
          const adr = recipe.adrAzn;
          const isFx = country.currency !== 'AZN';
          const fxRate = country.currency === 'USD' ? 1.7 : country.currency === 'EUR' ? 1.85 : null;
          const revenueAzn = adr * nights * roomsBooked;
          const revenue = isFx && fxRate != null ? +(revenueAzn / fxRate).toFixed(2) : +revenueAzn.toFixed(2);
          rows.push({
            organizationId: orgId,
            companyId,
            arrivalDate,
            departureDate,
            nights,
            revenue,
            // CRITICAL: bookingResolver counts ANY booking with
            // currencyCode != null as FX revenue (recompute.ts:562).
            // To prevent AZN bookings from inflating HOSP_FX_EXPOSURE
            // to 100%, leave currencyCode null for the base currency.
            // Architect sub-27 cont'd closure.
            currencyCode: isFx ? country.currency : null,
            exchangeRate: isFx ? fxRate : null,
            sourceCountry: country.code,
            roomsBooked,
            channel: country.code === 'AZ' ? 'direct' : 'ota',
            isCancelled: false,
          });
        }
      }
      if (rows.length > 0) {
        await tx.booking.createMany({ data: rows });
        inserted += rows.length;
      }
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
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
