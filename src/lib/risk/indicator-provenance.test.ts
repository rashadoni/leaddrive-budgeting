/**
 * 11.66 — «при удалении почему риск терминал не удален?»
 *
 * It had been. Every financial table was at zero and the reset was correct.
 * But 531 of 6,426 indicator values were still lit, because their inputs never
 * came from the client's workbook — and the screen said nothing about that, so
 * the only available conclusion was that the delete had failed.
 *
 * The fixtures below are the real definitions from production on 2026-07-31.
 */
import { describe, it, expect } from "vitest"
import {
  indicatorProvenance,
  countsTowardComposite,
  excludeNonScoringCells,
} from "./indicator-provenance"

describe("indicatorProvenance", () => {
  it("calls a pure market feed external — it survives a reset by design", () => {
    // FP_WHEAT_PRICE_SIGNAL, 87 values still lit on an emptied database.
    expect(
      indicatorProvenance({ requiredInputs: ["commodityPrice:wheat_price_latest"] }),
    ).toBe("external-feed")
  })

  it("covers every external family that actually exists in the catalog", () => {
    // Read off production, not guessed: these five prefixes are the complete
    // set of non-client input families.
    for (const input of [
      "commodityPrice:sugar_no11",
      "industryFactor:az_climate",
      "currencyRate:USD",
      "weather:salyan_rainfall_14d",
      "news.sentiment30d",
    ]) {
      expect(indicatorProvenance({ requiredInputs: [input] })).toBe("external-feed")
    }
  })

  it("calls a BLEND client-data — one client input is enough to keep it dark", () => {
    // The rule that matters. An indicator mixing a commodity price with the
    // client's P&L cannot compute on an empty database, so labelling it
    // "external" would be a lie the operator could catch.
    expect(
      indicatorProvenance({
        requiredInputs: ["commodityPrice:wheat_price_latest", "budgetLine.feed_cost"],
      }),
    ).toBe("client-data")
  })

  it("treats every import-written family as client data", () => {
    for (const input of [
      "budgetLine",
      "budgetLine.cogs",
      "balanceSheetLine.inventory",
      "operationalFact:harvest_tons",
      "counterparty:hhi",
      "booking.sourceCountry",
      "company.settings.hectaresPlanted",
      "fact",
      "rollup",
    ]) {
      expect(indicatorProvenance({ requiredInputs: [input] })).toBe("client-data")
    }
  })

  it("calls an input-less definition a CONSTANT, not external", () => {
    // IND_GOV_CLIMATE_SCORE: `requiredInputs: {}`, `formula: 38`. The single
    // biggest contributor to a populated-looking terminal on an empty
    // database — 204 identical values, ~40% of everything lit. Calling it
    // "external" would still imply a source; there isn't one.
    expect(indicatorProvenance({ requiredInputs: [] })).toBe("constant")
    expect(indicatorProvenance({ requiredInputs: null })).toBe("constant")
  })

  it("treats an ABSENT field as unknown, NOT as a constant", () => {
    // The distinction that matters operationally. `requiredInputs` is a
    // non-nullable String[], so a real definition always has one and an
    // undefined means the CALLER did not supply it — a partial projection or
    // a test fixture. Answering "constant" there silently drops the indicator
    // from every composite score; four HeatMap tests whose fixtures omit the
    // field went blank on the first version of this rule. A guess must not
    // cost a score, so unknown falls back to the option that changes nothing.
    expect(indicatorProvenance({})).toBe("client-data")
    expect(countsTowardComposite({})).toBe(true)
  })

  it("does not crash on a malformed entry", () => {
    // Same leniency as isRollupIndicator: strictness lives one layer up at
    // seed-author time, and a bad row must not take down a render.
    expect(
      indicatorProvenance({
        requiredInputs: [null as unknown as string, "commodityPrice:x"],
      }),
    ).toBe("external-feed")
    expect(indicatorProvenance({ requiredInputs: ["" as string] })).toBe("constant")
  })
})

describe("countsTowardComposite", () => {
  it("excludes a constant — a literal must not become part of a risk score", () => {
    // 38, forever, for every company. An amber cell that can never move was
    // dragging the composite of companies holding no data at all.
    expect(countsTowardComposite({ requiredInputs: [] })).toBe(false)
  })

  it("KEEPS external feeds — a sugar price is real risk, just not client-reported", () => {
    // The distinction the product turns on. Dropping market signal would throw
    // away the thing this terminal exists to surface.
    expect(
      countsTowardComposite({ requiredInputs: ["commodityPrice:sugar_no11"] }),
    ).toBe(true)
  })

  it("keeps client data", () => {
    expect(countsTowardComposite({ requiredInputs: ["budgetLine"] })).toBe(true)
  })
})

describe("excludeNonScoringCells", () => {
  const indicators = [
    { id: "i_const", requiredInputs: [] },
    { id: "i_market", requiredInputs: ["commodityPrice:sugar_no11"] },
    { id: "i_pl", requiredInputs: ["budgetLine"] },
  ]
  const cells = [
    { indicatorId: "i_const", companyId: "c1" },
    { indicatorId: "i_market", companyId: "c1" },
    { indicatorId: "i_pl", companyId: "c1" },
  ]

  it("removes constant cells and keeps everything else", () => {
    const out = excludeNonScoringCells(cells, indicators)
    expect(out.map((c) => c.indicatorId)).toEqual(["i_market", "i_pl"])
  })

  it("shrinks the DENOMINATOR too, not just the numerator", () => {
    // The coverage a company sees must count indicators that COULD have
    // scored. Leaving a constant in the total would understate coverage and
    // make a well-covered company look thin.
    const out = excludeNonScoringCells(cells, indicators)
    expect(out).toHaveLength(2)
  })

  it("is a no-op when the catalog holds no constants", () => {
    const clean = indicators.filter((i) => i.id !== "i_const")
    expect(excludeNonScoringCells(cells, clean)).toHaveLength(3)
  })
})
