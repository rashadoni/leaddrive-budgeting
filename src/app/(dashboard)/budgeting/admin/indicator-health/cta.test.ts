import { describe, it, expect } from "vitest"
import {
  MANUAL_METRICS,
  resolveManualMetric,
  buildCtas,
  type GapForCta,
} from "./cta"

const gap = (over: Partial<GapForCta>): GapForCta => ({
  indicatorCode: "TEST_IND",
  affectedEntities: ["AZSEKER-AZSF"],
  missingVariable: null,
  category: "no-data",
  ...over,
})

describe("resolveManualMetric", () => {
  it("returns the var unchanged when it IS an enterable operational metric", () => {
    // sanity: these live in the manual-entry catalog
    expect(MANUAL_METRICS.has("commodity_price")).toBe(true)
    expect(MANUAL_METRICS.has("harvest_tons")).toBe(true)
    expect(resolveManualMetric("commodity_price")).toBe("commodity_price")
    expect(resolveManualMetric("harvest_tons")).toBe("harvest_tons")
  })

  it("returns null for feed-derived statistics (NOT hand-enterable)", () => {
    // commodity_price_stdev is produced by the commodityPrice resolver from a
    // price feed (IntelDataPoint) — entering commodity_price by hand does NOT
    // feed it, so manual entry is a dead-end. Direct-match only, no suffix strip.
    expect(MANUAL_METRICS.has("commodity_price_stdev")).toBe(false)
    expect(resolveManualMetric("commodity_price_stdev")).toBeNull()
  })

  it("returns null for vars that cannot be hand-entered (no catalog match)", () => {
    expect(resolveManualMetric("inventory")).toBeNull()
    expect(resolveManualMetric("revenue_line_hhi")).toBeNull()
    expect(resolveManualMetric(null)).toBeNull()
    // a derived suffix whose base is also not in the catalog → still null
    expect(resolveManualMetric("inventory_stdev")).toBeNull()
  })
})

describe("buildCtas", () => {
  it("no-data with an enterable metric → manual (prefilled) + import", () => {
    const ctas = buildCtas(
      gap({ missingVariable: "harvest_tons", category: "no-data" }),
    )
    expect(ctas.map((c) => c.labelKey)).toEqual(["ctaManual", "ctaImport"])
    const manual = ctas.find((c) => c.labelKey === "ctaManual")!
    expect(manual.href).toContain("/budgeting/admin/data-entry?")
    expect(manual.href).toContain("company=AZSEKER-AZSF")
    expect(manual.href).toContain("metric=harvest_tons")
  })

  it("no-data with a feed-derived var → manual hidden, import only", () => {
    // commodity_price_stdev (the AGRO_COMMODITY_VOL case) is feed-backed; even
    // if it slips through as no-data, the CTA must not offer dead-end manual.
    const ctas = buildCtas(
      gap({
        missingVariable: "commodity_price_stdev",
        affectedEntities: ["AZSEKER-EDEN", "AZSEKER-AZSF"],
        category: "no-data",
      }),
    )
    expect(ctas.map((c) => c.labelKey)).toEqual(["ctaImport"])
  })

  it("no-data with a NON-enterable var → manual hidden, import only", () => {
    // this is the bug fix: AGRO_COMMODITY_VOL-style rows whose var the form
    // can't accept must NOT offer a dead-end "enter manually" button.
    const ctas = buildCtas(
      gap({ missingVariable: "inventory", category: "no-data" }),
    )
    expect(ctas.map((c) => c.labelKey)).toEqual(["ctaImport"])
  })

  it("ingest-gap → import only; external-feed → feed only", () => {
    expect(
      buildCtas(gap({ category: "ingest-gap" })).map((c) => c.labelKey),
    ).toEqual(["ctaImport"])
    const feed = buildCtas(gap({ category: "external-feed" }))
    expect(feed.map((c) => c.labelKey)).toEqual(["ctaFeed"])
    expect(feed[0].href).toBe("/budgeting/admin/data-sources")
  })

  it("unknown / no-action categories → no CTA", () => {
    expect(buildCtas(gap({ category: "formula-edge-case" }))).toEqual([])
    expect(buildCtas(gap({ category: "code-bug" }))).toEqual([])
  })

  it("omits company param when there are no affected entities", () => {
    const ctas = buildCtas(
      gap({ missingVariable: "harvest_tons", affectedEntities: [] }),
    )
    const manual = ctas.find((c) => c.labelKey === "ctaManual")!
    expect(manual.href).not.toContain("company=")
    expect(manual.href).toContain("metric=harvest_tons")
  })
})
