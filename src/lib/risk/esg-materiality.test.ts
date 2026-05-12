/**
 * Phase 7.H F4.v2.4 — SASB materiality catalog tests.
 *
 * Locks the calibration so a future contributor can't silently flip
 * services × Scope 1 from `not_material` → `material` (which would
 * re-introduce the v2.1 heatmap-noise the materiality matrix was
 * built to remove).
 */

import { describe, it, expect } from "vitest"
import {
  ESG_MATERIALITY_OVERRIDES,
  getMateriality,
  getMaterialityNote,
  isMaterialityScoped,
  ESG_INDICATOR_CODES,
} from "./esg-materiality"

describe("esg-materiality — catalog calibration", () => {
  it("services × Scope 1 is NOT material (the canonical heat-map-noise case)", () => {
    expect(getMateriality("services", "IND_CARBON_SCOPE_1")).toBe(
      "not_material",
    )
  })

  it("education × Scope 1 is NOT material (no direct combustion)", () => {
    expect(getMateriality("education", "IND_CARBON_SCOPE_1")).toBe(
      "not_material",
    )
  })

  it("real_estate × Scope 1 is LOW materiality (boiler ops, not the primary metric)", () => {
    expect(getMateriality("real_estate", "IND_CARBON_SCOPE_1")).toBe(
      "low_materiality",
    )
  })

  it("retail × Scope 1 is LOW materiality (store HVAC vs direct combustion)", () => {
    expect(getMateriality("retail", "IND_CARBON_SCOPE_1")).toBe(
      "low_materiality",
    )
  })

  it("industrial × Scope 1 is MATERIAL (heavy ops emit directly)", () => {
    expect(getMateriality("industrial", "IND_CARBON_SCOPE_1")).toBe("material")
  })

  it("agro_crops × Scope 1 is MATERIAL (fertilizer + tractor diesel)", () => {
    expect(getMateriality("agro_crops", "IND_CARBON_SCOPE_1")).toBe("material")
  })

  it("ESG composite is MATERIAL everywhere (umbrella metric)", () => {
    // Composite never appears in the override list — default falls
    // through to material for all sectors.
    for (const sector of [
      "services",
      "education",
      "industrial",
      "agro_crops",
      "real_estate",
      "retail",
      "entertainment",
      "hospitality",
    ]) {
      expect(getMateriality(sector, "IND_ESG_COMPOSITE")).toBe("material")
    }
  })

  it("AZ government climate score is LOW for light-ops sectors", () => {
    expect(getMateriality("services", "IND_GOV_CLIMATE_SCORE")).toBe(
      "low_materiality",
    )
    expect(getMateriality("education", "IND_GOV_CLIMATE_SCORE")).toBe(
      "low_materiality",
    )
  })

  it("AZ government climate score stays MATERIAL for resource-heavy sectors", () => {
    expect(getMateriality("industrial", "IND_GOV_CLIMATE_SCORE")).toBe(
      "material",
    )
    expect(getMateriality("agro_crops", "IND_GOV_CLIMATE_SCORE")).toBe(
      "material",
    )
    expect(getMateriality("logistics", "IND_GOV_CLIMATE_SCORE")).toBe(
      "material",
    )
  })
})

describe("esg-materiality — defensive defaults", () => {
  it("null industry → material (don't accidentally hide cells)", () => {
    expect(getMateriality(null, "IND_CARBON_SCOPE_1")).toBe("material")
    expect(getMateriality(undefined, "IND_CARBON_SCOPE_1")).toBe("material")
    expect(getMateriality("", "IND_CARBON_SCOPE_1")).toBe("material")
  })

  it("unknown industry → material (no entry = no override)", () => {
    expect(getMateriality("not_a_real_industry", "IND_CARBON_SCOPE_1")).toBe(
      "material",
    )
  })

  it("unknown indicator → material (no entry = no override)", () => {
    expect(getMateriality("services", "IND_TOTALLY_FAKE")).toBe("material")
  })
})

describe("esg-materiality — notes for tooltip surface", () => {
  it("non-default ratings always carry a calibration note", () => {
    for (const row of ESG_MATERIALITY_OVERRIDES) {
      expect(
        row.note.length,
        `${row.industry} × ${row.indicatorCode} note empty`,
      ).toBeGreaterThan(10)
    }
  })

  it("material default cells return null note (nothing to surface)", () => {
    expect(getMaterialityNote("industrial", "IND_CARBON_SCOPE_1")).toBeNull()
    expect(getMaterialityNote("services", "IND_ESG_COMPOSITE")).toBeNull()
  })

  it("non-default cells return the calibration note", () => {
    const note = getMaterialityNote("services", "IND_CARBON_SCOPE_1")
    expect(note).toBeTruthy()
    expect(note?.toLowerCase()).toContain("scope 1")
  })
})

describe("esg-materiality — gate scope", () => {
  it("isMaterialityScoped lights up exactly the 5 ESG codes", () => {
    expect(ESG_INDICATOR_CODES).toHaveLength(5)
    for (const code of ESG_INDICATOR_CODES) {
      expect(isMaterialityScoped(code)).toBe(true)
    }
  })

  it("financial/operational indicators don't participate", () => {
    expect(isMaterialityScoped("IND_OPEX_RATIO")).toBe(false)
    expect(isMaterialityScoped("IND_NET_MARGIN")).toBe(false)
    expect(isMaterialityScoped("HOSP_OCC")).toBe(false)
  })
})
