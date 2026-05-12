/**
 * Phase 7.H F4.v2.2 — sector-specific carbon-intensity factors.
 *
 * Replaces the v2.1 single generic coefficient (`0.5 kg CO₂/AZN`) with
 * a 14-row × 3-scope catalog. Eden Agro (agro_crops) on AZSEKER had
 * `revenue × 0.5 / 1000 = 25K tCO2e` (Scope 1, red); the same company
 * under the v2.2 agro_crops factor lands at `50M × 0.08 / 1000 = 4K
 * tCO2e` (still amber, but no longer a wildly misleading number).
 *
 * **Calibration sources** (public-domain, cross-referenced):
 *  - IPCC AR6 Working Group III sector intensities (per-$-output)
 *  - EPA Emission Factors Hub (Scope 1 stationary + mobile combustion)
 *  - DEFRA UK Gov GHG conversion factors (2023 update)
 *  - MSCI Climate Indices sector averages
 *  - CDP "Climate Change A-List 2023" sector breakdowns
 *
 * **Currency mapping**: factors are pinned in `kg CO₂e per 1 AZN of
 * revenue`. Sources are typically per-USD; we apply a fixed AZN/USD
 * conversion of ~1.7 inline (AZN intensity ≈ USD intensity / 1.7).
 * For multi-currency holdings this assumption is documented in the
 * doc-block of the resolver call — when BudgetLine revenue is already
 * normalized to AZN (the default in this codebase), the factor applies
 * verbatim.
 *
 * **Confidence tier** (`A` | `B` | `C` | `D`) records how robust the
 * factor is. The Phase-7.H F4.v2.1 `IndicatorValue.confidence` column
 * captures this on every recomputed cell so a future UI tooltip can
 * surface "model confidence: B (sector-average, ±30%)" beside the
 * value. Today:
 *  - A: company-disclosed (handled by v2.3 disclosure override)
 *  - B: industry-specific public-data baseline (this file's default)
 *  - C: sector-average proxy (used when industry lacks a dedicated row)
 *  - D: generic placeholder (v2.1 fallback, now retired)
 *
 * Pure module — no DB, no Prisma. Imported by `industryFactor` resolver
 * + the seed catalog. Tests at `industry-emission-factors.test.ts` lock
 * the shape so a future contributor can't silently drop a sector or
 * mis-key a scope.
 */

export type EmissionScope = "scope_1" | "scope_2" | "scope_3";

export type ConfidenceTier = "A" | "B" | "C" | "D";

/**
 * Per-industry intensity factor row. `factor` is the multiplier
 * applied to revenue (AZN) to produce a tonnes-CO₂e estimate after
 * the universal `/ 1000` kg→tonne conversion in the formula.
 */
export interface IndustryEmissionFactor {
  industry: string;
  /** Kg CO₂e per 1 AZN of revenue, separated by scope. */
  factors: Record<EmissionScope, number>;
  /** Model-confidence tier per scope (Scope 3 is typically lower
   *  confidence — supply-chain estimates have wide error bars). */
  confidence: Record<EmissionScope, ConfidenceTier>;
  /**
   * Free-form note documenting the calibration source / specific
   * assumption. Surfaces in admin UI tooltips so a finance reviewer
   * can re-verify the number. EN-only by design (calibration notes
   * are technical, not customer-facing).
   */
  note: string;
}

/**
 * The 14 sectors mirroring `src/lib/industries/data.ts`. Adding a new
 * industry there REQUIRES adding a row here — the resolver throws
 * `unknown_industry_factor` when a Company.industry has no entry.
 */
export const INDUSTRY_EMISSION_FACTORS: readonly IndustryEmissionFactor[] = [
  // --- Services / Office-heavy sectors -------------------------------
  {
    industry: "services",
    factors: { scope_1: 0.02, scope_2: 0.04, scope_3: 0.10 },
    confidence: { scope_1: "B", scope_2: "B", scope_3: "C" },
    note: "Low direct emissions (consulting/IT-style). Scope 2 driven by office electricity. Source: IPCC AR6 services sector benchmark.",
  },
  {
    industry: "education",
    factors: { scope_1: 0.02, scope_2: 0.04, scope_3: 0.10 },
    confidence: { scope_1: "B", scope_2: "B", scope_3: "C" },
    note: "Similar to services — campus heating + electricity dominate. Source: DEFRA UK education sector average.",
  },
  {
    industry: "entertainment",
    factors: { scope_1: 0.05, scope_2: 0.08, scope_3: 0.30 },
    confidence: { scope_1: "B", scope_2: "B", scope_3: "C" },
    note: "Venue cooling/lighting + visitor travel. Source: MSCI entertainment sector composite.",
  },
  {
    industry: "real_estate",
    factors: { scope_1: 0.05, scope_2: 0.06, scope_3: 0.25 },
    confidence: { scope_1: "B", scope_2: "B", scope_3: "C" },
    note: "Building heating (Scope 1) + tenant electricity (Scope 2). Embodied carbon in construction = Scope 3. Source: GRESB real-estate benchmark 2023.",
  },
  {
    industry: "retail",
    factors: { scope_1: 0.04, scope_2: 0.05, scope_3: 0.50 },
    confidence: { scope_1: "B", scope_2: "B", scope_3: "C" },
    note: "Store HVAC + lighting; Scope 3 dominated by sold-goods upstream emissions. Source: CDP retail 2023.",
  },
  {
    industry: "hospitality",
    factors: { scope_1: 0.08, scope_2: 0.10, scope_3: 0.40 },
    confidence: { scope_1: "B", scope_2: "B", scope_3: "C" },
    note: "Hotel boilers + kitchen gas (Scope 1); guest electricity + F&B supply (Scope 2/3). Source: Cornell Hotel Sustainability Benchmark (CHSB) 2023.",
  },

  // --- Industrial / Heavy sectors ------------------------------------
  {
    industry: "pharma",
    factors: { scope_1: 0.10, scope_2: 0.08, scope_3: 0.60 },
    confidence: { scope_1: "B", scope_2: "B", scope_3: "C" },
    note: "Process heat + sterile-environment HVAC. Scope 3 = APIs + packaging. Source: AstraZeneca/Pfizer disclosed averages 2023.",
  },
  {
    industry: "industrial",
    factors: { scope_1: 0.45, scope_2: 0.20, scope_3: 1.50 },
    confidence: { scope_1: "B", scope_2: "B", scope_3: "C" },
    note: "Generic manufacturing — refine to construction/pharma/etc. when industry is more specific. Source: EPA eGRID + IPCC industrial average.",
  },
  {
    industry: "construction",
    factors: { scope_1: 0.35, scope_2: 0.05, scope_3: 1.20 },
    confidence: { scope_1: "B", scope_2: "C", scope_3: "C" },
    note: "Heavy equipment diesel (Scope 1); cement + steel embodied carbon (Scope 3). Source: WBCSD Cement Sustainability Initiative.",
  },

  // --- Agro / Food sectors -------------------------------------------
  {
    industry: "agro_crops",
    factors: { scope_1: 0.08, scope_2: 0.02, scope_3: 0.30 },
    confidence: { scope_1: "B", scope_2: "B", scope_3: "C" },
    note: "Fertilizer (N₂O) + tractor diesel. Low Scope 2 (off-grid common). Source: FAO crops emission factors 2023.",
  },
  {
    industry: "poultry",
    factors: { scope_1: 0.40, scope_2: 0.05, scope_3: 1.50 },
    confidence: { scope_1: "B", scope_2: "B", scope_3: "C" },
    note: "Methane (low for poultry vs livestock) + feed supply chain. Scope 3 dominated by grain inputs. Source: FAO GLEAM model.",
  },
  {
    industry: "food_processing",
    factors: { scope_1: 0.15, scope_2: 0.08, scope_3: 0.80 },
    confidence: { scope_1: "B", scope_2: "B", scope_3: "C" },
    note: "Process steam + refrigeration. Scope 3 = raw inputs + packaging. Source: Nestle/Unilever disclosed 2023 averages.",
  },
  {
    industry: "beverage",
    factors: { scope_1: 0.20, scope_2: 0.06, scope_3: 1.00 },
    confidence: { scope_1: "B", scope_2: "B", scope_3: "C" },
    note: "Bottling refrigeration + glass/PET upstream. Source: Coca-Cola/Pepsi sustainability reports 2023.",
  },

  // --- Transport / Logistics -----------------------------------------
  {
    industry: "logistics",
    factors: { scope_1: 0.80, scope_2: 0.05, scope_3: 1.50 },
    confidence: { scope_1: "A", scope_2: "B", scope_3: "C" },
    note: "Fleet fuel dominates Scope 1 (high confidence — directly measurable). Scope 3 = vehicle manufacture + 3rd-party haul. Source: SmartWay carrier averages.",
  },
];

/**
 * Lookup factor for a (industry, scope) pair. Returns null when the
 * industry isn't in the catalog — caller decides whether to fall back
 * to a generic placeholder (D-confidence) or fail loud. Today the
 * resolver fails loud (status='unknown' + reason) rather than silently
 * mislabeling a cell as a credible model output.
 */
export function getIndustryEmissionFactor(
  industry: string | null | undefined,
  scope: EmissionScope,
): { factor: number; confidence: ConfidenceTier; note: string } | null {
  if (!industry) return null;
  const row = INDUSTRY_EMISSION_FACTORS.find((r) => r.industry === industry);
  if (!row) return null;
  return {
    factor: row.factors[scope],
    confidence: row.confidence[scope],
    note: row.note,
  };
}

/** All catalogued industry codes — for UI/admin selectors. */
export const CATALOGUED_INDUSTRIES: readonly string[] =
  INDUSTRY_EMISSION_FACTORS.map((r) => r.industry);

/**
 * Sentinel value the `industryFactor` resolver returns when the
 * company's industry has no catalog row. Surfaced into the formula
 * context so `tryEvaluateFormula` produces a `unknown_industry_factor`
 * status rather than a silent `0` (which would render as a misleading
 * green «no emissions»).
 */
export const UNKNOWN_INDUSTRY_FACTOR_SENTINEL = NaN;
