/**
 * Phase 14.2 (2026-08-02) — the one setting a workbook can never carry.
 *
 * `REVENUE_FX_EXPOSURE` reads `company.settings.fxRevenueAzn` and computes
 * `100 - fx_revenue_azn`. There is no sheet in any of the client's files that
 * states it: it is a property of how the business invoices, not a line in a
 * statement. Eight terminal cells across four companies depend on it and all
 * eight are empty, which is what makes a form the only route rather than one
 * of several.
 *
 * The field is also the most dangerous one on that form, and these tests exist
 * for that rather than for the plumbing. It asks for the MANAT share; entering
 * the foreign share instead inverts the answer. Both are valid percentages, so
 * no downstream check can catch it — 90% domestic typed as 10 reads as 90% FX
 * exposure and turns a green company red. The bound below is the only
 * mechanical guard there is; the rest is the wording on the form.
 */
import { describe, it, expect } from "vitest"
import { settingsSchemaForIndustry } from "./validate"

const parse = (industry: string, value: unknown) =>
  settingsSchemaForIndustry(industry).safeParse({ fxRevenueAzn: value })

describe("fxRevenueAzn", () => {
  it("is accepted by every industry, not just one", () => {
    // The indicator lists all twelve industries. A field living in one
    // per-industry schema would silently reject it for the other eleven,
    // because those schemas are `.strict()`.
    for (const industry of [
      "agro_crops",
      "hospitality",
      "food_processing",
      "industrial",
      "retail",
      "logistics",
    ]) {
      expect(parse(industry, 90).success, industry).toBe(true)
    }
  })

  it("accepts the whole legitimate range, ends included", () => {
    // 0 = everything invoiced in foreign currency; 100 = everything in manat.
    // Both are real businesses and neither is an error.
    expect(parse("agro_crops", 0).success).toBe(true)
    expect(parse("agro_crops", 100).success).toBe(true)
    expect(parse("agro_crops", 62.5).success).toBe(true)
  })

  it("refuses a percentage outside 0–100, on strict AND generic industries", () => {
    // `100 - fx_revenue_azn` on a value of 500 is -400% exposure, which is not
    // a number anyone can act on. The generic path is a record that accepts
    // any primitive, so it needs its own guard — that is the one an
    // industry-less company would otherwise fall through.
    for (const industry of ["agro_crops", "hospitality", "food_processing", "industrial"]) {
      expect(parse(industry, 500).success, `${industry} 500`).toBe(false)
      expect(parse(industry, -1).success, `${industry} -1`).toBe(false)
    }
  })

  it("refuses a percentage written as a string", () => {
    // "90" through the generic record would be a valid primitive and would
    // then fail silently in the formula engine, whose context is numbers only.
    expect(parse("industrial", "90").success).toBe(false)
    expect(parse("agro_crops", "90").success).toBe(false)
  })

  it("stays optional — a company that has not answered is not invalid", () => {
    // The honest state for all four companies today. An empty setting must
    // leave the indicator `unknown`, not block the rest of the form.
    for (const industry of ["agro_crops", "industrial"]) {
      expect(settingsSchemaForIndustry(industry).safeParse({}).success, industry).toBe(true)
    }
  })

  it("does not loosen the industry schemas it was merged into", () => {
    // `.strict()` is what stops an agro field landing on a hotel. Merging a
    // shared field must not turn that off.
    expect(
      settingsSchemaForIndustry("hospitality").safeParse({ hectaresPlanted: 10 }).success,
    ).toBe(false)
  })
})
