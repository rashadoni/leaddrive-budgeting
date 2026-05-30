import { describe, it, expect } from 'vitest'
import { hasShock, resolveShockOverrides, type ScenarioShock, type ResolvedScalars } from './scenario-shock'

const base: ResolvedScalars = {
  revenue: 1000, cogs: 600, opex: 200, gross_profit: 400, ebitda: 200, net_income: 150,
  da_total: 50, total_input_cost: 600, imported_input_cost: 0, yield_per_ha: 10,
}

describe('hasShock', () => {
  it('true when overrides.shock has at least one non-zero lever', () => {
    expect(hasShock({ shock: { inputCostShock: 0.3 } })).toBe(true)
  })
  it('false for legacy adjustments / empty / all-zero / null / assumedImportShare-only', () => {
    expect(hasShock({ adjustments: [] })).toBe(false)
    expect(hasShock({ shock: {} })).toBe(false)
    expect(hasShock({ shock: { revenueShock: 0, inputCostShock: 0 } })).toBe(false)
    expect(hasShock({ shock: { assumedImportShare: 0.3 } })).toBe(false)
    expect(hasShock(null)).toBe(false)
    expect(hasShock(undefined)).toBe(false)
  })
})

describe('resolveShockOverrides — consistent P&L recompute', () => {
  it('input-cost +25% raises cogs, compresses gross_profit/ebitda/net_income (revenue unchanged)', () => {
    const o = resolveShockOverrides({ inputCostShock: 0.25 }, base)
    // new_cogs = 600 + 600*0.25 = 750 ; new_gross_profit = 1000 - 750 = 250
    expect(o.cogs).toBeCloseTo(750)
    expect(o.gross_profit).toBeCloseTo(250)
    expect(o.ebitda).toBeCloseTo(250 - 200) // 50
    expect(o.net_income).toBeCloseTo(50 - 50) // 0
    expect(o.revenue).toBeCloseTo(1000)
    expect(o.total_input_cost).toBeCloseTo(750)
  })
  it('revenue (volume) −30% scales revenue AND variable cogs together', () => {
    const o = resolveShockOverrides({ revenueShock: -0.3 }, base)
    expect(o.revenue).toBeCloseTo(700)
    expect(o.cogs).toBeCloseTo(420) // 600*0.7
    expect(o.gross_profit).toBeCloseTo(280) // 700-420
    expect(o.ebitda).toBeCloseTo(80) // 280-200
  })
  it('price −20% scales revenue only → margin compresses hard', () => {
    const o = resolveShockOverrides({ priceShock: -0.2 }, base)
    expect(o.revenue).toBeCloseTo(800)
    expect(o.cogs).toBeCloseTo(600) // unchanged
    expect(o.gross_profit).toBeCloseTo(200) // 800-600
  })
  it('fxShock with assumedImportShare raises cost when imported_input_cost==0', () => {
    const o = resolveShockOverrides({ fxShock: 0.2, assumedImportShare: 0.3 }, base)
    // importBase = cogs*0.3 = 180 ; cost_increase = 180*0.2 = 36 ; new_cogs = 636
    expect(o.cogs).toBeCloseTo(636)
    expect(o.gross_profit).toBeCloseTo(1000 - 636)
    expect(o.imported_input_cost).toBeCloseTo(180 * 1.2) // 216
    expect(o.total_input_cost).toBeCloseTo(636)
  })
  it('combined stagflation shock stays consistent (cost +25%, volume −15%)', () => {
    const o = resolveShockOverrides({ inputCostShock: 0.25, revenueShock: -0.15 }, base)
    // new_revenue = 1000*0.85 = 850 ; new_cogs = 600*0.85 + 600*0.25 = 510 + 150 = 660
    expect(o.revenue).toBeCloseTo(850)
    expect(o.cogs).toBeCloseTo(660)
    expect(o.gross_profit).toBeCloseTo(850 - 660) // 190
    expect(o.ebitda).toBeCloseTo(190 - 200) // -10
  })
  it('yieldShock −30% lowers yield_per_ha', () => {
    const o = resolveShockOverrides({ yieldShock: -0.3 }, base)
    expect(o.yield_per_ha).toBeCloseTo(7)
  })
  it('skips non-finite baseline scalars (missing for some company)', () => {
    const o = resolveShockOverrides({ inputCostShock: 0.25 }, { revenue: NaN, cogs: NaN } as ResolvedScalars)
    expect(Object.keys(o).every((k) => Number.isFinite(o[k]))).toBe(true)
  })
})
