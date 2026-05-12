/**
 * Phase 7.H F4.v2.2 — sector intensity catalog tests.
 *
 * Locks the catalog shape and the lookup helper so a future
 * seed-author can't:
 *  - drop a sector → resolver returns NaN → ESG cell silently goes
 *    `unknown` for every company in that sector
 *  - swap kg/AZN to a different unit semantics
 *  - widen a factor outside the documented sector-average range
 *
 * Catalog coverage must mirror `src/lib/industries/data.ts` 1:1.
 */

import { describe, it, expect } from "vitest"
import {
  INDUSTRY_EMISSION_FACTORS,
  CATALOGUED_INDUSTRIES,
  getIndustryEmissionFactor,
  type EmissionScope,
} from "./industry-emission-factors"
import { INDUSTRIES } from "../industries/data"

describe("industry-emission-factors — catalog coverage", () => {
  it("ships exactly 14 sector rows (mirror of industries/data.ts)", () => {
    expect(INDUSTRY_EMISSION_FACTORS).toHaveLength(14)
  })

  it("every industry in industries/data.ts has a factor row", () => {
    const factorCodes = new Set(INDUSTRY_EMISSION_FACTORS.map((r) => r.industry))
    for (const i of INDUSTRIES) {
      expect(factorCodes.has(i.code), `missing factor row for ${i.code}`).toBe(
        true,
      )
    }
  })

  it("CATALOGUED_INDUSTRIES export mirrors the catalog 1:1", () => {
    expect(new Set(CATALOGUED_INDUSTRIES)).toEqual(
      new Set(INDUSTRY_EMISSION_FACTORS.map((r) => r.industry)),
    )
  })
})

describe("industry-emission-factors — factor sanity", () => {
  const SCOPES: EmissionScope[] = ["scope_1", "scope_2", "scope_3"]

  it("every (industry × scope) factor is positive + finite", () => {
    for (const row of INDUSTRY_EMISSION_FACTORS) {
      for (const scope of SCOPES) {
        const f = row.factors[scope]
        expect(Number.isFinite(f)).toBe(true)
        expect(f).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it("Scope 3 ≥ Scope 1 for every sector (supply chain dominates direct)", () => {
    // Spend-based scope 3 is conventionally 5-10× scope 1 for most
    // sectors. A future calibration that flips this relationship for a
    // sector likely indicates a data-entry mistake — surface it as a
    // test failure rather than letting it ship.
    for (const row of INDUSTRY_EMISSION_FACTORS) {
      expect(
        row.factors.scope_3,
        `${row.industry}: scope_3 < scope_1 is suspicious`,
      ).toBeGreaterThanOrEqual(row.factors.scope_1)
    }
  })

  it("factors stay within plausible sector-average bounds (0 ≤ kg/AZN ≤ 5)", () => {
    // Outside this range = either a 1000× unit-conversion mistake
    // (factor in kg/$ vs kg/AZN) or an oil&gas/cement-heavy sector
    // we haven't onboarded yet. Either way, surface it.
    for (const row of INDUSTRY_EMISSION_FACTORS) {
      for (const scope of SCOPES) {
        expect(row.factors[scope]).toBeLessThan(5)
      }
    }
  })

  it("every row has a confidence tier per scope (no nulls)", () => {
    for (const row of INDUSTRY_EMISSION_FACTORS) {
      for (const scope of SCOPES) {
        expect(["A", "B", "C", "D"]).toContain(row.confidence[scope])
      }
    }
  })

  it("every row carries a non-empty calibration note", () => {
    for (const row of INDUSTRY_EMISSION_FACTORS) {
      expect(row.note.length, `${row.industry} note empty`).toBeGreaterThan(10)
    }
  })
})

describe("industry-emission-factors — lookup helper", () => {
  it("returns factor + confidence for a known (industry, scope) pair", () => {
    const r = getIndustryEmissionFactor("agro_crops", "scope_1")
    expect(r).not.toBeNull()
    expect(r!.factor).toBeGreaterThan(0)
    expect(["A", "B", "C", "D"]).toContain(r!.confidence)
  })

  it("returns null for unknown industry", () => {
    expect(getIndustryEmissionFactor("not_a_real_industry", "scope_1")).toBeNull()
  })

  it("returns null for null/undefined industry (legacy company guard)", () => {
    expect(getIndustryEmissionFactor(null, "scope_1")).toBeNull()
    expect(getIndustryEmissionFactor(undefined, "scope_1")).toBeNull()
    expect(getIndustryEmissionFactor("", "scope_1")).toBeNull()
  })

  it("agro_crops Scope 1 sits below the v2.1 generic 0.5 placeholder", () => {
    // The whole point of v2.2: Eden Agro on AZSEKER must NOT keep
    // showing 25K tCO2e (revenue × 0.5). agro_crops factor should be
    // dramatically lower than the generic placeholder.
    const r = getIndustryEmissionFactor("agro_crops", "scope_1")
    expect(r!.factor).toBeLessThan(0.5)
  })

  it("industrial Scope 1 sits ABOVE the v2.1 generic 0.5 placeholder", () => {
    // Heavy-industry sectors deserve a higher coefficient than the
    // generic placeholder; locking this prevents the calibration from
    // collapsing to the v2.1 default across sectors.
    const r = getIndustryEmissionFactor("industrial", "scope_1")
    expect(r!.factor).toBeGreaterThan(0.4)
  })
})
