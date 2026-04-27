import { describe, it, expect } from "vitest"
import {
  BUILT_IN_PRESETS,
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

describe("BUILT_IN_PRESETS (Phase B8)", () => {
  it("has at least 3 presets (default / bloomberg / analyst)", () => {
    expect(Object.keys(BUILT_IN_PRESETS).length).toBeGreaterThanOrEqual(3)
    expect(BUILT_IN_PRESETS.default).toBeTruthy()
    expect(BUILT_IN_PRESETS.bloomberg).toBeTruthy()
    expect(BUILT_IN_PRESETS.analyst).toBeTruthy()
  })

  it("every preset's sizes pass validateLayoutSizes", () => {
    for (const [key, preset] of Object.entries(BUILT_IN_PRESETS)) {
      const validated = validateLayoutSizes(preset.sizes)
      expect(validated, `preset "${key}" failed validation`).not.toBeNull()
    }
  })

  it("every preset has a non-empty label", () => {
    for (const preset of Object.values(BUILT_IN_PRESETS)) {
      expect(preset.label.trim().length).toBeGreaterThan(0)
    }
  })

  it("'default' preset matches DEFAULT_LAYOUT_SIZES", () => {
    expect(BUILT_IN_PRESETS.default.sizes).toEqual(DEFAULT_LAYOUT_SIZES)
  })

  it("'bloomberg' preset is heatmap-dominant (Panel 2 width >= 70%)", () => {
    expect(
      BUILT_IN_PRESETS.bloomberg.sizes.top[PANEL_IDS.panel2],
    ).toBeGreaterThanOrEqual(70)
  })

  it("'analyst' preset has fat IndicatorDetail bottom (Panel 3 >= 55%)", () => {
    expect(
      BUILT_IN_PRESETS.analyst.sizes.bottom[PANEL_IDS.panel3],
    ).toBeGreaterThanOrEqual(55)
  })

  it("all presets keep total = 100% per group", () => {
    for (const [key, preset] of Object.entries(BUILT_IN_PRESETS)) {
      for (const group of ["outer", "top", "bottom"] as const) {
        const sum = Object.values(preset.sizes[group]).reduce(
          (a, b) => a + b,
          0,
        )
        expect(sum, `preset ${key} group ${group} sum`).toBeCloseTo(100, 0)
      }
    }
  })
})
