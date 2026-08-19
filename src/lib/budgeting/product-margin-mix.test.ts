/**
 * 2026-08-19 — rates or the basket?
 *
 * The decisive property is that the parts add up to the whole: a
 * decomposition whose pieces quietly fail to sum is worse than no
 * decomposition, because each piece still looks authoritative on its own. Most
 * of what follows is that identity, pushed at from the angles where it breaks.
 */
import { describe, it, expect } from "vitest"
import { decomposeMixAndRate } from "./product-margin-mix"
import type { ComparedProduct } from "./product-margin-compare"

function p(
  code: string,
  budget: [number, number] | null,
  actual: [number, number] | null,
): ComparedProduct {
  return {
    productCode: code,
    productName: code,
    budget: budget ? { revenue: budget[0], cost: null, marginPct: budget[1] } : null,
    actual: actual ? { revenue: actual[0], cost: null, marginPct: actual[1] } : null,
    gapPoints: budget && actual ? actual[1] - budget[1] : null,
  }
}

/** Group margin as the screen computes it: revenue-weighted. */
function group(rows: Array<[number, number]>): number {
  const rev = rows.reduce((s, [r]) => s + r, 0)
  return rows.reduce((s, [r, m]) => s + r * m, 0) / rev
}

describe("rate against mix", () => {
  it("calls it a rate problem when only margins moved", () => {
    // Same basket, both products earning 5 points less.
    const rows = [p("a", [600, 40], [600, 35]), p("b", [400, 20], [400, 15])]
    const d = decomposeMixAndRate(rows, group([[600, 40], [400, 20]]), group([[600, 35], [400, 15]]))
    expect(d.ratePoints).toBeCloseTo(-5, 6)
    expect(d.mixPoints).toBeCloseTo(0, 6)
  })

  it("calls it a basket problem when only the weights moved", () => {
    // Nobody's margin changed; the high-margin product just sold less.
    const rows = [p("a", [600, 40], [400, 40]), p("b", [400, 20], [600, 20])]
    const d = decomposeMixAndRate(rows, group([[600, 40], [400, 20]]), group([[400, 40], [600, 20]]))
    expect(d.ratePoints).toBeCloseTo(0, 6)
    expect(d.mixPoints).toBeCloseTo(-4, 6)
  })

  it("charges nothing to mix when weight moves between average products", () => {
    // Both sit exactly on the plan average, so shifting weight between them
    // changes nothing — the `− M_b` centring is what makes this come out zero.
    const rows = [p("a", [500, 30], [900, 30]), p("b", [500, 30], [100, 30])]
    const d = decomposeMixAndRate(rows, 30, 30)
    expect(d.mixPoints).toBeCloseTo(0, 6)
    expect(d.ratePoints).toBeCloseTo(0, 6)
  })

  it("adds up to the gap exactly", () => {
    const budget: Array<[number, number]> = [[600, 40], [400, 20]]
    const actual: Array<[number, number]> = [[300, 38], [700, 25]]
    const rows = [p("a", budget[0], actual[0]), p("b", budget[1], actual[1])]
    const d = decomposeMixAndRate(rows, group(budget), group(actual))
    expect(d.ratePoints + d.mixPoints).toBeCloseTo(d.gapPoints as number, 6)
    expect(d.unattributedPoints).toBeCloseTo(0, 6)
  })

  it("reproduces the split measured on the client's own months", () => {
    // Malt, fructose and barley all lost share against plan while their own
    // margins barely moved — the shape that made mix the whole story.
    const rows = [
      p("malt", [8_190_000 * 5 / 12, 33.9], [1_934_994, 32.0]),
      p("glucose", [7_149_110 * 5 / 12, 38.3], [3_581_237, 33.3]),
    ]
    const d = decomposeMixAndRate(
      rows,
      group([[8_190_000 * 5 / 12, 33.9], [7_149_110 * 5 / 12, 38.3]]),
      group([[1_934_994, 32.0], [3_581_237, 33.3]]),
    )
    expect(d.ratePoints + d.mixPoints).toBeCloseTo(d.gapPoints as number, 6)
    // Glucose gained share and is the better product, so mix is positive here.
    expect(d.mixPoints).toBeGreaterThan(0)
  })

  it("states what it cannot attribute instead of burying it", () => {
    // Cotton on the client's data: sold in the window, budgeted at nothing.
    // There is no planned margin to value its weight against, and inventing
    // one would make the parts sum only because the invention absorbed the
    // difference.
    const rows = [p("a", [600, 40], [600, 40]), p("cotton", null, [400, 1.1])]
    const d = decomposeMixAndRate(rows, 40, group([[600, 40], [400, 1.1]]))
    const cotton = d.products.find((x) => x.productCode === "cotton")!
    expect(cotton.budgetShare).toBeNull()
    expect(cotton.ratePoints).toBeNull()
    expect(cotton.mixPoints).toBeNull()
    // The whole of cotton's effect shows up as unattributed, not as zero.
    expect(d.unattributedPoints).toBeLessThan(-10)
    expect(d.ratePoints + d.mixPoints + d.unattributedPoints).toBeCloseTo(
      d.gapPoints as number,
      6,
    )
  })

  it("has nothing to say when a side has no margin at all", () => {
    const d = decomposeMixAndRate([p("a", [100, 10], [100, 10])], null, 10)
    expect(d.gapPoints).toBeNull()
    expect(d.ratePoints).toBe(0)
    expect(d.mixPoints).toBe(0)
  })
})
