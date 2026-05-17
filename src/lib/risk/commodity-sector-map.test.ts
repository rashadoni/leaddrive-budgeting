/**
 * Phase 7.L — commodity-sector-map unit tests.
 *
 * Locks the metric → industries mapping. Adding a new mapping requires
 * adding a test case here to prove the pattern matches as intended.
 */
import { describe, it, expect, vi } from "vitest"
import {
  resolveAffectedIndustries,
  findAffectedCompanies,
  COMMODITY_SECTOR_MAP,
} from "./commodity-sector-map"

describe("resolveAffectedIndustries", () => {
  it("FAO FFPI → food_processing + agro_crops + retail + beverage", () => {
    const { industries, sensitivity } = resolveAffectedIndustries(
      "FAO_FFPI_NOMINAL",
    )
    expect(industries).toEqual([
      "food_processing",
      "agro_crops",
      "retail",
      "beverage",
    ])
    expect(sensitivity).toBe("high")
  })

  it("FAO sub-indices match same band", () => {
    for (const metric of [
      "FAO_SUGAR_INDEX",
      "FAO_MEAT_INDEX",
      "FAO_DAIRY_INDEX",
      "FAO_CEREAL_INDEX",
      "FAO_OILS_INDEX",
    ]) {
      const { industries } = resolveAffectedIndustries(metric)
      expect(industries).toContain("food_processing")
    }
  })

  it("Brent → logistics + industrial + hospitality + agro", () => {
    const { industries } = resolveAffectedIndustries("BRENT_USD_BBL")
    expect(industries).toContain("logistics")
    expect(industries).toContain("industrial")
    expect(industries).toContain("hospitality")
  })

  it("WTI matches same pattern as Brent", () => {
    const { industries } = resolveAffectedIndustries("WTI_USD_BBL")
    expect(industries.length).toBeGreaterThan(0)
    expect(industries).toContain("logistics")
  })

  it("Steel → industrial + construction + real_estate", () => {
    const { industries } = resolveAffectedIndustries("STEEL_USD_TONNE")
    expect(industries).toEqual(["industrial", "construction", "real_estate"])
  })

  it("Copper / Aluminum / Lumber share same industries", () => {
    for (const metric of ["COPPER_USD_TONNE", "ALUMINUM_USD_TONNE", "LUMBER_USD_MBF"]) {
      const { industries } = resolveAffectedIndustries(metric)
      expect(industries).toEqual(["industrial", "construction", "real_estate"])
    }
  })

  it("AZN_USD → broad import-dependent sectors", () => {
    const { industries, sensitivity } = resolveAffectedIndustries("AZN_USD")
    expect(industries).toContain("pharma")
    expect(industries).toContain("retail")
    expect(industries).toContain("food_processing")
    expect(industries.length).toBeGreaterThanOrEqual(7)
    expect(sensitivity).toBe("high")
  })

  it("AZN_EUR follows same pattern as AZN_USD", () => {
    const { industries } = resolveAffectedIndustries("AZN_EUR")
    expect(industries).toContain("pharma")
  })

  it("AZ_CPI_FOOD → retail + food_processing + beverage + hospitality", () => {
    const { industries } = resolveAffectedIndustries("AZ_CPI_FOOD")
    expect(industries).toEqual([
      "retail",
      "food_processing",
      "beverage",
      "hospitality",
    ])
  })

  it("AZ_CPI_HOUSING falls into non-food bucket", () => {
    const { industries } = resolveAffectedIndustries("AZ_CPI_HOUSING")
    expect(industries).toContain("real_estate")
    expect(industries).not.toContain("food_processing")
  })

  it("AZ_TOURISM_ARRIVALS → hospitality + entertainment", () => {
    const { industries, sensitivity } = resolveAffectedIndustries(
      "AZ_TOURISM_ARRIVALS",
    )
    expect(industries).toContain("hospitality")
    expect(industries).toContain("entertainment")
    expect(sensitivity).toBe("high")
  })

  it("USDA poultry metrics → poultry + retail + food_processing", () => {
    for (const metric of [
      "BROILER_PRICE_USD_LB",
      "EGG_PRICE_USD_DOZ",
      "CHICK_PLACEMENT_THOUSAND",
    ]) {
      const { industries } = resolveAffectedIndustries(metric)
      expect(industries).toContain("poultry")
    }
  })

  it("Google Trends → retail + entertainment + beverage", () => {
    const { industries } = resolveAffectedIndustries("AZ_TREND_FOOD_RETAIL")
    expect(industries).toContain("retail")
    expect(industries).toContain("entertainment")
  })

  it("SALYAN rainfall forecast → agro_crops + food_processing", () => {
    const { industries } = resolveAffectedIndustries(
      "SALYAN_RAINFALL_MM_14D_FCST",
    )
    expect(industries).toEqual(["agro_crops", "food_processing"])
  })

  it("Temperature max → broader (heatwave demand surge)", () => {
    const { industries } = resolveAffectedIndustries("SALYAN_TEMP_MAX_C_14D_FCST")
    expect(industries).toContain("hospitality")
    expect(industries).toContain("entertainment")
    expect(industries).toContain("logistics")
  })

  it("Unknown metric → empty industries + low sensitivity", () => {
    const { industries, sensitivity } = resolveAffectedIndustries(
      "MADE_UP_METRIC_NOT_IN_MAP",
    )
    expect(industries).toEqual([])
    expect(sensitivity).toBe("low")
  })

  it("Every mapping has non-empty industries + rationale", () => {
    for (const m of COMMODITY_SECTOR_MAP) {
      expect(m.industries.length).toBeGreaterThan(0)
      expect(m.rationale.length).toBeGreaterThan(20)
    }
  })
})

describe("findAffectedCompanies", () => {
  it("Returns companies whose industry matches the metric's affected list", async () => {
    const prismaMock = {
      company: {
        findMany: vi.fn().mockResolvedValue([
          { id: "c1", code: "AAC", name: "AAC", industry: "industrial" },
          {
            id: "c2",
            code: "ATL-DBZ",
            name: "Polad Boru Zavodu",
            industry: "industrial",
          },
        ]),
      },
    }
    const rows = await findAffectedCompanies(
      prismaMock as never,
      "org_test",
      "STEEL_USD_TONNE",
    )
    expect(prismaMock.company.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org_test",
        industry: { in: ["industrial", "construction", "real_estate"] },
      },
      select: { id: true, code: true, name: true, industry: true },
      orderBy: { code: "asc" },
    })
    expect(rows.length).toBe(2)
  })

  it("Returns empty array when metric is unknown — no DB call", async () => {
    const prismaMock = { company: { findMany: vi.fn() } }
    const rows = await findAffectedCompanies(
      prismaMock as never,
      "org_test",
      "UNKNOWN_METRIC",
    )
    expect(rows).toEqual([])
    expect(prismaMock.company.findMany).not.toHaveBeenCalled()
  })
})
