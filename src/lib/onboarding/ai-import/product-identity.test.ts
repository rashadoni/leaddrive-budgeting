/**
 * 2026-07-15 — guards for the sales product-identity resolver.
 *
 * The load-bearing property: a product named in ENGLISH on a budget sheet and
 * in AZERBAIJANI on the actuals sheet must resolve to the SAME ProductLine
 * code, or budget-vs-actual comparison silently splits into two products.
 */
import { describe, it, expect } from "vitest"
import {
  resolveProductIdentity,
  slugifyProductLabel,
  isSectionBannerLabel,
} from "./product-identity"

const EDEN = "AZSEKER-EDEN"
const CPC = "AZSEKER-CPC"

describe("resolveProductIdentity — cross-language pairing", () => {
  it.each([
    ["Sales volume of Wheat", "Buğda", EDEN, "WHEAT"],
    ["Revenue from Sale of Barley", "Arpa", EDEN, "BARLEY"],
    ["Price of Cotton", "Pambıq", EDEN, "COTTON"],
    ["Sales volume of Sugar Beet", "Şəkər Çuğunduru", EDEN, "SUGAR_BEET"],
    ["Revenue from Sale of Almond", "Badam", EDEN, "ALMOND"],
    ["Glucose", "Qlükoza", CPC, "GLUCOSE"],
    ["Fructose", "Fruktoza", CPC, "FRUCTOSE"],
    ["Corn starch", "Nişasta", CPC, "CORN_STARCH"],
  ])("%s (budget) and %s (actual) → same code", (en, az, entity, slug) => {
    const a = resolveProductIdentity(en, entity)
    const b = resolveProductIdentity(az, entity)
    expect(a.slug).toBe(slug)
    expect(b.slug).toBe(slug)
    expect(a.code).toBe(b.code)
    expect(a.known && b.known).toBe(true)
  })

  it("namespaces the code by entity so two entities never collide", () => {
    expect(resolveProductIdentity("Wheat", EDEN).code).toBe("AZSEKER_EDEN__WHEAT")
    expect(resolveProductIdentity("Wheat", CPC).code).toBe("AZSEKER_CPC__WHEAT")
  })

  it("strips every budget-grid affix (volume / revenue / price / costs)", () => {
    for (const label of [
      "Sales volume of Wheat",
      "Revenue from Sale of Wheat",
      "Revenue from Sales of Wheat",
      "Price of Wheat",
      "Wheat Costs",
    ]) {
      expect(resolveProductIdentity(label, EDEN).slug).toBe("WHEAT")
    }
  })

  it("keeps Export as a separate identity from the domestic product", () => {
    const dom = resolveProductIdentity("Corn starch", CPC)
    const exp = resolveProductIdentity("Corn starch (Export)", CPC)
    expect(dom.slug).toBe("CORN_STARCH")
    expect(exp.slug).toBe("CORN_STARCH__EXPORT")
    expect(exp.location).toBe("EXPORT")
    expect(dom.code).not.toBe(exp.code)
  })

  it("an unknown label gets its OWN transliterated slug — never merged, flagged for review", () => {
    const r = resolveProductIdentity("Qarğıdalı Kəpəyi", CPC)
    expect(r.known).toBe(false)
    expect(r.slug).toBe("QARGIDALI_KEPEYI")
    expect(r.code).toBe("AZSEKER_CPC__QARGIDALI_KEPEYI")
    // and it must not collide with a different unknown label
    expect(r.slug).not.toBe(resolveProductIdentity("Qarğıdalı Özəyi", CPC).slug)
  })

  it("name keeps the human label with affixes stripped", () => {
    expect(resolveProductIdentity("Sales volume of Sugar Beet", EDEN).name).toBe(
      "Sugar Beet",
    )
  })
})

describe("slugifyProductLabel", () => {
  it("transliterates Azerbaijani letters to portable ASCII", () => {
    expect(slugifyProductLabel("Şəkər Çuğunduru")).toBe("SEKER_CUGUNDURU")
    expect(slugifyProductLabel("Qlükoza-G40 Çəki ilə")).toBe("QLUKOZA_G40_CEKI_ILE")
  })
})

describe("isSectionBannerLabel", () => {
  it("recognises the farming grid's section banners", () => {
    expect(isSectionBannerLabel("Satış plan, Ton")).toBe(true)
    expect(isSectionBannerLabel("Satış plan, AZN")).toBe(true)
    expect(isSectionBannerLabel("Satış plan, Qiymət")).toBe(true)
    expect(isSectionBannerLabel("Sales volume of Wheat")).toBe(false)
  })
})
