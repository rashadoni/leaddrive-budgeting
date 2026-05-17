/**
 * Phase 7.L — Commodity metric → affected industries reverse map.
 *
 * Complement to `macro-drivers.ts` (indicator → metric). Used by the
 * crossing-scan-runner: given a metric that just breached a threshold
 * (e.g. FAO_FFPI_NOMINAL, BRENT_USD_BBL), figure out WHICH SECTORS of
 * the holding are exposed → query companies in those sectors → run
 * impact-forecast LLM per company.
 *
 * Pure module — no I/O, no Prisma. The `findAffectedCompanies` helper
 * is a thin wrapper that combines this with a `company.findMany` query.
 */
import type { PrismaClient } from "@prisma/client"

export type SectorSensitivity = "high" | "medium" | "low"

export interface SectorMapping {
  /** RegExp matched against the metric code. First match wins. */
  metricPattern: RegExp
  /** Industries that consume / are exposed to this metric. */
  industries: readonly string[]
  /** How directly this metric affects the listed industries' financials. */
  sensitivity: SectorSensitivity
  /** Free-text rationale shown in audit logs + admin UI. */
  rationale: string
}

/**
 * The mapping table. Order matters: first metricPattern match wins.
 * Patterns are anchored loosely (`^` / `_`) so we can match prefix +
 * suffix variants from any adapter.
 */
export const COMMODITY_SECTOR_MAP: readonly SectorMapping[] = [
  // ── Food commodities (FAO sub-indices, sugar, grains) ────────────
  {
    metricPattern: /^FAO_(FFPI|MEAT|DAIRY|CEREAL|OILS|SUGAR)/,
    industries: ["food_processing", "agro_crops", "retail", "beverage"],
    sensitivity: "high",
    rationale:
      "FAO sub-indices proxy global food input costs. Food processors + retailers + beverage producers face direct COGS impact.",
  },
  {
    metricPattern: /^(SUGAR|CORN|WHEAT|SOYBEAN|OATS|COTTON)_USD/,
    industries: ["food_processing", "agro_crops", "poultry", "beverage"],
    sensitivity: "high",
    rationale:
      "Grain/sugar/cotton futures drive feed + raw material costs for food processing, poultry feed, beverage syrups, agro budgets.",
  },

  // ── Energy ───────────────────────────────────────────────────────
  {
    metricPattern: /^(BRENT|WTI)_USD/,
    industries: ["logistics", "industrial", "hospitality", "agro_crops"],
    sensitivity: "high",
    rationale:
      "Crude oil drives fuel costs (diesel/gasoline for fleet) + petrochemical inputs (plastic packaging) + heating for hospitality + farm equipment fuel.",
  },
  {
    metricPattern: /^NATGAS_USD/,
    industries: ["industrial", "hospitality", "construction"],
    sensitivity: "high",
    rationale:
      "Natural gas drives industrial heat + electricity, hospitality water heating + cooking, construction-materials kiln fuel.",
  },
  {
    metricPattern: /^(DIESEL|GASOLINE)_USD/,
    industries: ["logistics", "agro_crops", "construction", "retail"],
    sensitivity: "high",
    rationale:
      "Retail-fuel prices flow directly into fleet operating cost (last-mile delivery, farm equipment, construction machinery).",
  },

  // ── Metals & building materials ──────────────────────────────────
  {
    metricPattern: /^(STEEL|COPPER|ALUMINUM|LUMBER)_USD/,
    industries: ["industrial", "construction", "real_estate"],
    sensitivity: "high",
    rationale:
      "Steel/copper/aluminum/lumber input costs hit manufacturing margins, construction project budgets, real-estate development costs.",
  },

  // ── Shipping / freight ───────────────────────────────────────────
  {
    metricPattern: /^BALTIC_DRY/,
    industries: ["logistics", "industrial", "retail", "food_processing"],
    sensitivity: "medium",
    rationale:
      "Dry-bulk freight rates predict import-good landed cost (grain, metal, cement). Logistics revenue tracks BDI directly.",
  },

  // ── FX ───────────────────────────────────────────────────────────
  {
    metricPattern: /^AZN_(USD|EUR)/,
    industries: [
      "pharma",
      "retail",
      "food_processing",
      "industrial",
      "construction",
      "logistics",
      "real_estate",
      "hospitality",
    ],
    sensitivity: "high",
    rationale:
      "AZN/USD shift hits every import-dependent sector. Hospitality also affected via USD-denominated foreign visitor revenue.",
  },
  {
    metricPattern: /^AZN_(RUB|TRY)/,
    industries: ["retail", "food_processing", "construction"],
    sensitivity: "medium",
    rationale:
      "AZ retail/food/construction source significant share from Turkey + Russia. Cross-rate shift affects landed cost.",
  },

  // ── CPI / inflation ──────────────────────────────────────────────
  {
    metricPattern: /^AZ_CPI_FOOD/,
    industries: ["retail", "food_processing", "beverage", "hospitality"],
    sensitivity: "high",
    rationale:
      "AZ food CPI = consumer staple inflation. Retail + restaurants + hospitality F&B pass through pricing.",
  },
  {
    metricPattern: /^AZ_CPI_(NON_FOOD|SERVICES|HOUSING|ALL_ITEMS)/,
    industries: ["retail", "real_estate", "services", "hospitality"],
    sensitivity: "medium",
    rationale:
      "Non-food + services CPI drives retail margins + rent indexation + hospitality wage cost pass-through.",
  },
  {
    metricPattern: /^FP_CPI/,
    industries: [
      "retail",
      "food_processing",
      "real_estate",
      "services",
      "hospitality",
      "logistics",
    ],
    sensitivity: "medium",
    rationale:
      "World Bank regional CPI is a macro proxy when AZ-specific data is unavailable.",
  },

  // ── Macro indicators ─────────────────────────────────────────────
  {
    metricPattern: /^AZ_TOURISM/,
    industries: ["hospitality", "entertainment", "retail", "services"],
    sensitivity: "high",
    rationale:
      "Tourism arrivals + receipts drive hotel occupancy, entertainment venue demand, retail/services consumer flow.",
  },
  {
    metricPattern: /^AZ_(POP|SCHOOL|EDU)/,
    industries: ["education", "retail"],
    sensitivity: "low",
    rationale:
      "Population + school enrollment data shifts slowly — long-term TAM signal for education/retail, not short-term shock.",
  },
  {
    metricPattern: /^AZ_TRADE_(EXPORTS|IMPORTS|BALANCE)/,
    industries: ["services", "logistics", "industrial"],
    sensitivity: "medium",
    rationale:
      "AZ trade balance signals macro demand for cross-border services + freight + industrial output.",
  },

  // ── Poultry-specific ─────────────────────────────────────────────
  {
    metricPattern: /^(BROILER|EGG|CHICK)/,
    industries: ["poultry", "retail", "food_processing"],
    sensitivity: "high",
    rationale:
      "USDA broiler/egg/chick prices = leading indicator for AZ poultry margins (US is global benchmark, AZ prices lag 4-6 weeks).",
  },

  // ── Retail / consumer trends ─────────────────────────────────────
  {
    metricPattern: /^AZ_TREND_/,
    industries: ["retail", "entertainment", "beverage"],
    sensitivity: "medium",
    rationale:
      "Search-trend signals = leading indicator for retail / entertainment / beverage demand (1-2 weeks ahead of sales).",
  },

  // ── Weather forecast ─────────────────────────────────────────────
  {
    metricPattern: /_RAINFALL_MM/,
    industries: ["agro_crops", "food_processing"],
    sensitivity: "high",
    rationale:
      "Rainfall directly affects crop yields → upstream supply for food processing.",
  },
  {
    metricPattern: /_TEMP_(AVG|MAX)_C/,
    industries: ["agro_crops", "hospitality", "entertainment", "logistics"],
    sensitivity: "medium",
    rationale:
      "Extreme temperatures affect crop health, hospitality demand (heatwave hotel pool / cooling cost), outdoor venue events, fleet thermal stress.",
  },
]

/**
 * Resolve which industries are affected by a given metric. Returns
 * the first matching mapping's industries + sensitivity. Empty array
 * means the metric has no defined sector consumers (caller skips).
 */
export function resolveAffectedIndustries(metric: string): {
  industries: readonly string[]
  sensitivity: SectorSensitivity
  rationale: string
} {
  for (const mapping of COMMODITY_SECTOR_MAP) {
    if (mapping.metricPattern.test(metric)) {
      return {
        industries: mapping.industries,
        sensitivity: mapping.sensitivity,
        rationale: mapping.rationale,
      }
    }
  }
  return { industries: [], sensitivity: "low", rationale: "" }
}

/**
 * Thin Prisma wrapper — given a metric, return the list of operational
 * companies in matching industries. Caller filters further if needed
 * (e.g. by `level === 2` or `role !== 'admin'`).
 *
 * NOTE on placeholder companies: this returns BOTH real operational
 * companies AND macro-only placeholders (DEMO-*) since both carry the
 * matching industry tag. The downstream forecaster decides whether
 * to run an LLM call per placeholder (skipping them is recommended
 * to save tokens — placeholders carry no financials so the LLM has
 * nothing to anchor on).
 */
export async function findAffectedCompanies(
  prisma: Pick<PrismaClient, "company">,
  organizationId: string,
  metric: string,
): Promise<
  Array<{
    id: string
    code: string
    name: string
    industry: string | null
  }>
> {
  const { industries } = resolveAffectedIndustries(metric)
  if (industries.length === 0) return []
  const rows = await prisma.company.findMany({
    where: {
      organizationId,
      industry: { in: [...industries] },
    },
    select: { id: true, code: true, name: true, industry: true },
    orderBy: { code: "asc" },
  })
  return rows
}
