import { describe, it, expect } from "vitest"
import {
  DEFAULT_LAYOUT_SIZES,
  PANEL_IDS,
  validateLayoutSizes,
  validateLayoutName,
} from "./layout-sizes"

describe("validateLayoutSizes", () => {
  it("accepts the default shape", () => {
    expect(validateLayoutSizes(DEFAULT_LAYOUT_SIZES)).toEqual(DEFAULT_LAYOUT_SIZES)
  })

  it("accepts a hand-tuned shape with float values", () => {
    const v = {
      outer: { [PANEL_IDS.outerTop]: 33.5, [PANEL_IDS.outerBottom]: 66.5 },
      top: { [PANEL_IDS.panel1]: 40, [PANEL_IDS.panel2]: 60 },
      bottom: { [PANEL_IDS.panel3]: 25, [PANEL_IDS.panel4]: 75 },
    }
    expect(validateLayoutSizes(v)).toEqual(v)
  })

  it("rejects null / undefined / non-object", () => {
    expect(validateLayoutSizes(null)).toBeNull()
    expect(validateLayoutSizes(undefined)).toBeNull()
    expect(validateLayoutSizes(42)).toBeNull()
    expect(validateLayoutSizes("hello")).toBeNull()
  })

  it("rejects missing top-level keys", () => {
    expect(
      validateLayoutSizes({
        outer: { [PANEL_IDS.outerTop]: 50, [PANEL_IDS.outerBottom]: 50 },
        top: { [PANEL_IDS.panel1]: 50, [PANEL_IDS.panel2]: 50 },
      }),
    ).toBeNull()
  })

  it("rejects unknown panel id (stale layout from a structure migration)", () => {
    expect(
      validateLayoutSizes({
        outer: { [PANEL_IDS.outerTop]: 50, [PANEL_IDS.outerBottom]: 50 },
        top: { [PANEL_IDS.panel1]: 50, "extra-panel": 50 },
        bottom: { [PANEL_IDS.panel3]: 50, [PANEL_IDS.panel4]: 50 },
      }),
    ).toBeNull()
  })

  it("rejects pairs that don't sum to 100", () => {
    expect(
      validateLayoutSizes({
        outer: { [PANEL_IDS.outerTop]: 40, [PANEL_IDS.outerBottom]: 40 },
        top: { [PANEL_IDS.panel1]: 50, [PANEL_IDS.panel2]: 50 },
        bottom: { [PANEL_IDS.panel3]: 50, [PANEL_IDS.panel4]: 50 },
      }),
    ).toBeNull()
  })

  it("tolerates floating-point summation noise (sum=99.7)", () => {
    expect(
      validateLayoutSizes({
        outer: { [PANEL_IDS.outerTop]: 49.85, [PANEL_IDS.outerBottom]: 49.85 },
        top: { [PANEL_IDS.panel1]: 50, [PANEL_IDS.panel2]: 50 },
        bottom: { [PANEL_IDS.panel3]: 50, [PANEL_IDS.panel4]: 50 },
      }),
    ).not.toBeNull()
  })

  it("rejects negative values", () => {
    expect(
      validateLayoutSizes({
        outer: { [PANEL_IDS.outerTop]: -10, [PANEL_IDS.outerBottom]: 110 },
        top: { [PANEL_IDS.panel1]: 50, [PANEL_IDS.panel2]: 50 },
        bottom: { [PANEL_IDS.panel3]: 50, [PANEL_IDS.panel4]: 50 },
      }),
    ).toBeNull()
  })

  it("rejects non-finite values", () => {
    expect(
      validateLayoutSizes({
        outer: { [PANEL_IDS.outerTop]: Number.NaN, [PANEL_IDS.outerBottom]: 100 },
        top: { [PANEL_IDS.panel1]: 50, [PANEL_IDS.panel2]: 50 },
        bottom: { [PANEL_IDS.panel3]: 50, [PANEL_IDS.panel4]: 50 },
      }),
    ).toBeNull()
  })

  it("rejects values >100", () => {
    expect(
      validateLayoutSizes({
        outer: { [PANEL_IDS.outerTop]: 150, [PANEL_IDS.outerBottom]: -50 },
        top: { [PANEL_IDS.panel1]: 50, [PANEL_IDS.panel2]: 50 },
        bottom: { [PANEL_IDS.panel3]: 50, [PANEL_IDS.panel4]: 50 },
      }),
    ).toBeNull()
  })
})

describe("validateLayoutName", () => {
  it.each([
    "morning brief",
    "Audit",
    "FX scan",
    "x",
    "a".repeat(40),
    "Имя на русском",
    "Ad-hoc 123",
  ])("accepts %s", (name) => {
    expect(validateLayoutName(name)).toBe(name)
  })

  it("trims surrounding whitespace", () => {
    expect(validateLayoutName("  audit  ")).toBe("audit")
  })

  it.each([
    "",
    "   ",
    "a".repeat(41),
    "name\nwith\nnewline",
    "ctrl\u0001char",
    "zero\u200Bwidth",
  ])("rejects %j", (name) => {
    expect(validateLayoutName(name)).toBeNull()
  })

  it("rejects non-string types", () => {
    expect(validateLayoutName(42)).toBeNull()
    expect(validateLayoutName(null)).toBeNull()
    expect(validateLayoutName(undefined)).toBeNull()
    expect(validateLayoutName({})).toBeNull()
  })
})
