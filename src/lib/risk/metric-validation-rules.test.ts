/**
 * Phase 7.H F4.v2.3 — validation-rule catalog tests.
 *
 * Locks the shape so a future seed-author can't silently widen a
 * sanity bound or drop a metric from the curated list. The catalog is
 * load-bearing for the data-entry admin: any drift here propagates to
 * the Zod `z.enum(...)` accept-list in the API routes, so any
 * un-catalogued metric becomes 400 at the boundary.
 */

import { describe, it, expect } from "vitest"
import {
  OPERATIONAL_METRIC_RULES,
  ESG_DISCLOSURE_RULES,
  OPERATIONAL_METRIC_KEYS,
  ESG_DISCLOSABLE_INDICATOR_CODES,
  getOperationalRule,
  getEsgDisclosureRule,
  validateValue,
} from "./metric-validation-rules"

describe("metric-validation-rules — catalog shape", () => {
  it("ships 31 operational metric rules (13 base indicators + 6 Phase 7.I sugar/agro + 4 cane-seller 2026-05-16)", () => {
    // 13 operational indicators consume between 1 and 5 distinct
    // metrics each (e.g. AGRO_YIELD reads `harvest_tons` ÷
    // `area_hectares` = 2; some single-metric like AGRO_DROUGHT_RISK).
    // Base count: 21.
    // Phase 7.I added 6 sugar/agro metrics:
    // hectares_planted, yield_per_ha, sugar_content_pct,
    // water_use_m3_per_ha, fertilizer_kg_per_ha, extraction_rate_pct → 27.
    // 2026-05-16 cane-seller pilot added 4 metrics:
    // cane_cut_to_mill_hours, cane_buyer_concentration_pct,
    // cane_hectares_harvested_pct, cane_harvest_season_progress → 31.
    expect(OPERATIONAL_METRIC_RULES).toHaveLength(31)
    const codes = OPERATIONAL_METRIC_RULES.map((r) => r.metric)
    // Spot-check the canonical metrics the F4 audit identified —
    // dropping one of these (e.g. removing `harvest_tons`) silently
    // breaks `AGRO_YIELD` which depends on `harvest_tons / area_hectares`.
    for (const expected of [
      "harvest_tons",
      "area_hectares",
      "leased_area",
      "feed_consumed_kg",
      "weight_gain_kg",
      "deaths",
      "enrolled_students",
      "teachers",
      "raw_input",
      "finished_output",
      // Cane-seller specific (2026-05-16):
      "cane_cut_to_mill_hours",
      "cane_buyer_concentration_pct",
      "cane_hectares_harvested_pct",
      "cane_harvest_season_progress",
    ]) {
      expect(codes).toContain(expected)
    }
  })

  it("cane-seller metrics have lower-is-better warn-bounds calibrated for AzerSheker (2026-05-16)", () => {
    const ruleByMetric = Object.fromEntries(
      OPERATIONAL_METRIC_RULES.map((r) => [r.metric, r]),
    )
    // Cut-to-mill warns above 48h (sucrose loss material at that point).
    expect(ruleByMetric["cane_cut_to_mill_hours"].warnMax).toBe(48)
    // Buyer concentration warns above 70% (cash-crisis threshold).
    expect(ruleByMetric["cane_buyer_concentration_pct"].warnMax).toBe(70)
    // Harvest progress warns below 80% (standing crop degrades after).
    expect(ruleByMetric["cane_hectares_harvested_pct"].warnMin).toBe(80)
    // All 4 cane metrics tagged "agro" sector.
    for (const m of [
      "cane_cut_to_mill_hours",
      "cane_buyer_concentration_pct",
      "cane_hectares_harvested_pct",
      "cane_harvest_season_progress",
    ]) {
      expect(ruleByMetric[m].sector).toBe("agro")
    }
  })

  it("ships 4 ESG disclosable indicators (all v2.1 modeled_generic codes)", () => {
    expect(ESG_DISCLOSURE_RULES).toHaveLength(4)
    const codes = ESG_DISCLOSURE_RULES.map((r) => r.indicatorCode).sort()
    expect(codes).toEqual([
      "IND_CARBON_SCOPE_1",
      "IND_CARBON_SCOPE_2",
      "IND_CARBON_SCOPE_3",
      "IND_ESG_COMPOSITE",
    ])
  })

  it("every operational metric key is exposed via the helper export", () => {
    expect(OPERATIONAL_METRIC_KEYS).toHaveLength(OPERATIONAL_METRIC_RULES.length)
    expect(new Set(OPERATIONAL_METRIC_KEYS)).toEqual(
      new Set(OPERATIONAL_METRIC_RULES.map((r) => r.metric)),
    )
  })

  it("every ESG disclosable indicator code is exposed via the helper export", () => {
    expect(ESG_DISCLOSABLE_INDICATOR_CODES).toHaveLength(
      ESG_DISCLOSURE_RULES.length,
    )
    expect(new Set(ESG_DISCLOSABLE_INDICATOR_CODES)).toEqual(
      new Set(ESG_DISCLOSURE_RULES.map((r) => r.indicatorCode)),
    )
  })

  it("every rule has labels in all 3 locales", () => {
    for (const r of [...OPERATIONAL_METRIC_RULES, ...ESG_DISCLOSURE_RULES]) {
      expect(r.labelEn.length, `${r.unit} ${r.sector}`).toBeGreaterThan(0)
      expect(r.labelRu.length).toBeGreaterThan(0)
      expect(r.labelAz.length).toBeGreaterThan(0)
    }
  })

  it("min < max on every rule, warnMin/warnMax stay within hard bounds", () => {
    for (const r of [...OPERATIONAL_METRIC_RULES, ...ESG_DISCLOSURE_RULES]) {
      expect(r.min).toBeLessThan(r.max)
      if (r.warnMin != null) expect(r.warnMin).toBeGreaterThanOrEqual(r.min)
      if (r.warnMax != null) expect(r.warnMax).toBeLessThanOrEqual(r.max)
    }
  })

  it("anomalyDeltaPct is a positive finite number", () => {
    for (const r of [...OPERATIONAL_METRIC_RULES, ...ESG_DISCLOSURE_RULES]) {
      expect(r.anomalyDeltaPct).toBeGreaterThan(0)
      expect(Number.isFinite(r.anomalyDeltaPct)).toBe(true)
    }
  })
})

describe("metric-validation-rules — lookup helpers", () => {
  it("getOperationalRule returns rule for known metric", () => {
    expect(getOperationalRule("harvest_tons")?.metric).toBe("harvest_tons")
    expect(getOperationalRule("harvest_tons")?.unit).toBe("tons")
  })

  it("getOperationalRule returns null for unknown metric", () => {
    expect(getOperationalRule("kgkajdkajdsf")).toBeNull()
    expect(getOperationalRule("")).toBeNull()
  })

  it("getEsgDisclosureRule returns rule for known indicator code", () => {
    expect(getEsgDisclosureRule("IND_CARBON_SCOPE_1")?.indicatorCode).toBe(
      "IND_CARBON_SCOPE_1",
    )
    expect(getEsgDisclosureRule("IND_CARBON_SCOPE_1")?.unit).toBe("tCO2e")
  })

  it("getEsgDisclosureRule returns null for non-ESG indicator", () => {
    // IND_OPEX_RATIO exists in the catalog but is NOT disclosable —
    // only the 4 modeled_generic ESG seeds are eligible for override.
    expect(getEsgDisclosureRule("IND_OPEX_RATIO")).toBeNull()
    expect(getEsgDisclosureRule("IND_GOV_CLIMATE_SCORE")).toBeNull()
  })
})

describe("metric-validation-rules — validateValue", () => {
  const fcrRule = getOperationalRule("feed_consumed_kg")!

  it("happy path: value within bounds + matching unit → ok=true, no warnings", () => {
    const r = validateValue(fcrRule, 5000, "kg")
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual([])
    expect(r.anomalyWarning).toBeNull()
  })

  it("hard min violation → ok=false with error", () => {
    const r = validateValue(fcrRule, -10, "kg")
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("below the minimum")
  })

  it("hard max violation → ok=false with error", () => {
    const r = validateValue(fcrRule, 999_999_999_999, "kg")
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("above the maximum")
  })

  it("unit mismatch → ok=false (prevents kg→tonnes silent error)", () => {
    const r = validateValue(fcrRule, 5000, "tonnes")
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.includes("Unit"))).toBe(true)
  })

  it("soft-max breach inside hard bounds → ok=true with warning", () => {
    // feed_consumed_kg: warnMax=1_000_000 hard max=10_000_000
    const r = validateValue(fcrRule, 5_000_000, "kg")
    expect(r.ok).toBe(true)
    expect(r.warnings.length).toBe(1)
    expect(r.warnings[0]).toContain("unusually high")
  })

  it("anomaly check fires when value > anomalyDeltaPct from historical mean", () => {
    // historical mean 2000, anomaly threshold 50% → 1000 < value < 3000.
    // Submit 10_000 → 400% deviation → anomalyWarning populated.
    const r = validateValue(fcrRule, 10_000, "kg", 2_000)
    expect(r.ok).toBe(true)
    expect(r.anomalyWarning).toContain("deviates")
    expect(r.anomalyWarning).toContain("400%")
  })

  it("anomaly check absent when historicalMean undefined", () => {
    const r = validateValue(fcrRule, 999_999, "kg")
    expect(r.anomalyWarning).toBeNull()
  })

  it("anomaly check skips zero-mean baseline (would divide by 0)", () => {
    const r = validateValue(fcrRule, 999, "kg", 0)
    expect(r.anomalyWarning).toBeNull()
  })

  it("NaN value → hard error", () => {
    const r = validateValue(fcrRule, NaN, "kg")
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("finite number")
  })

  it("ESG rule: composite score caps at 0..100", () => {
    const rule = getEsgDisclosureRule("IND_ESG_COMPOSITE")!
    expect(validateValue(rule, -1, "score").ok).toBe(false)
    expect(validateValue(rule, 101, "score").ok).toBe(false)
    expect(validateValue(rule, 50, "score").ok).toBe(true)
  })

  it("ESG rule: Scope 1 unit must be tCO2e exactly (no kg confusion)", () => {
    const rule = getEsgDisclosureRule("IND_CARBON_SCOPE_1")!
    expect(validateValue(rule, 1000, "kg").ok).toBe(false)
    expect(validateValue(rule, 1000, "tCO2e").ok).toBe(true)
  })
})
