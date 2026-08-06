import { describe, it, expect } from 'vitest'
import {
  resolveImportShare,
  resolveCompanyDriver,
  buildImportShareNote,
  buildDriverNote,
  COMPANY_DRIVERS,
  resolveShockOverrides,
  type ImportShareReport,
  type ResolvedScalars,
} from './scenario-shock'

/**
 * Phase 16.6 — the imported-input share stops being one literal for ~60
 * businesses.
 *
 * `crisis-catalog.ts` hard-codes `assumedImportShare: 0.3` on every FX
 * scenario, so a devaluation hit a refinery buying raw sugar abroad and a
 * domestic logistics arm with the same coefficient, and the worst-hit ranking
 * that produced was an artifact of the constant rather than a finding.
 */

describe('resolveImportShare — precedence', () => {
  it('measured imported cost wins and makes the share inert', () => {
    const r = resolveImportShare({ importedInputCost: 500_000, assumption: 0.7, catalogDefault: 0.3 })
    expect(r.source).toBe('measured')
    expect(r.share).toBe(0)
  })

  it("a company's stated share beats the scenario's literal", () => {
    const r = resolveImportShare({ importedInputCost: 0, assumption: 0.7, catalogDefault: 0.3 })
    expect(r).toEqual({ share: 0.7, source: 'assumption' })
  })

  it("falls back to the scenario's literal when nothing was stated", () => {
    const r = resolveImportShare({ importedInputCost: 0, assumption: null, catalogDefault: 0.3 })
    expect(r).toEqual({ share: 0.3, source: 'catalog' })
  })

  it('reports "none" when there is no measurement, no assumption and no literal', () => {
    const r = resolveImportShare({ importedInputCost: 0, assumption: null, catalogDefault: undefined })
    expect(r).toEqual({ share: 0, source: 'none' })
  })

  it('treats a stated 0 as a real statement, not as absent', () => {
    // A domestic business genuinely importing nothing must not inherit 30%.
    const r = resolveImportShare({ importedInputCost: 0, assumption: 0, catalogDefault: 0.3 })
    expect(r).toEqual({ share: 0, source: 'assumption' })
  })

  it('accepts the boundary value 1 (a fully imported cost base)', () => {
    expect(resolveImportShare({ importedInputCost: 0, assumption: 1, catalogDefault: 0.3 })).toEqual({
      share: 1,
      source: 'assumption',
    })
  })

  it('a non-finite imported cost does not count as measured', () => {
    const r = resolveImportShare({ importedInputCost: NaN, assumption: 0.7, catalogDefault: 0.3 })
    expect(r.source).toBe('assumption')
  })

  it('a negative or zero imported cost does not count as measured', () => {
    expect(resolveImportShare({ importedInputCost: 0, assumption: null, catalogDefault: 0.3 }).source).toBe('catalog')
    expect(resolveImportShare({ importedInputCost: -5, assumption: null, catalogDefault: 0.3 }).source).toBe('catalog')
  })
})

describe('resolveImportShare — refuses to guess a percent scale', () => {
  it('rejects a share above 1 and falls through, reporting the value', () => {
    // 70 typed under a "%" unit means 70%. Dividing by 100 would be a guess,
    // and `cogs * 70` would be a seventy-fold cost shock that reorders the
    // whole ranking while looking like a finding.
    const r = resolveImportShare({ importedInputCost: 0, assumption: 70, catalogDefault: 0.3 })
    expect(r.share).toBe(0.3)
    expect(r.source).toBe('catalog')
    expect(r.rejected).toMatchObject({ value: 70 })
    expect(r.rejected?.reason).toMatch(/is above 1/)
    // The percent-scale hint is the actionable half of the message.
    expect(r.rejected?.reason).toMatch(/70 means 70%/)
  })

  it('rejects a negative share', () => {
    const r = resolveImportShare({ importedInputCost: 0, assumption: -0.2, catalogDefault: 0.3 })
    expect(r.source).toBe('catalog')
    expect(r.rejected?.reason).toMatch(/is below 0/)
  })

  it('carries the rejection through even when there is no literal to fall back on', () => {
    const r = resolveImportShare({ importedInputCost: 0, assumption: 70, catalogDefault: undefined })
    expect(r).toMatchObject({ share: 0, source: 'none' })
    expect(r.rejected?.value).toBe(70)
  })

  it('a rejected assumption never silently becomes the share', () => {
    for (const bad of [70, 100, 1.0001, -0.0001]) {
      const r = resolveImportShare({ importedInputCost: 0, assumption: bad, catalogDefault: 0.3 })
      expect(r.share).not.toBe(bad)
    }
  })
})

describe('resolveImportShare — feeds a materially different shock', () => {
  const base: ResolvedScalars = {
    revenue: 1_000_000,
    cogs: 600_000,
    opex: 200_000,
    gross_profit: 400_000,
    ebitda: 200_000,
    net_income: 150_000,
    da_total: 50_000,
    total_input_cost: 600_000,
    imported_input_cost: 0,
  }

  it('a stated share moves EBITDA differently from the catalog default', () => {
    const shock = { fxShock: 0.2 }
    const atDefault = resolveShockOverrides({ ...shock, assumedImportShare: 0.3 }, base)
    const atStated = resolveShockOverrides({ ...shock, assumedImportShare: 0.7 }, base)
    // 600k × 0.3 × 0.2 = 36k of cost vs 600k × 0.7 × 0.2 = 84k.
    expect(atDefault.ebitda).toBeCloseTo(200_000 - 36_000, 6)
    expect(atStated.ebitda).toBeCloseTo(200_000 - 84_000, 6)
  })

  it('a stated 0 leaves the FX shock with no cost base to act on', () => {
    const out = resolveShockOverrides({ fxShock: 0.2, assumedImportShare: 0 }, base)
    expect(out.ebitda).toBeCloseTo(200_000, 6)
    expect(out.imported_input_cost).toBeUndefined()
  })

  it('measured imported cost is used instead of any share', () => {
    const measured = { ...base, imported_input_cost: 100_000 }
    const out = resolveShockOverrides({ fxShock: 0.2, assumedImportShare: 0.7 }, measured)
    // 100k × 0.2 = 20k — the share is not consulted at all.
    expect(out.ebitda).toBeCloseTo(200_000 - 20_000, 6)
  })
})

describe('buildImportShareNote', () => {
  const empty: ImportShareReport = {
    measured: [],
    fromAssumption: [],
    fromCatalogDefault: [],
    unresolved: [],
    rejected: [],
    catalogDefault: 0.3,
  }

  it('returns null for a non-FX scenario (null report)', () => {
    expect(buildImportShareNote(null)).toBeNull()
  })

  it('returns null when every company measured — nothing is being assumed', () => {
    expect(buildImportShareNote({ ...empty, measured: ['A', 'B'] })).toBeNull()
  })

  it('names the companies that stated a share, with the value', () => {
    const note = buildImportShareNote({
      ...empty,
      fromAssumption: [{ companyCode: 'AZSEKER-CPC', share: 0.7 }],
    })
    expect(note).toMatch(/AZSEKER-CPC 70%/)
    expect(note).toMatch(/stated for 1 company/)
  })

  it('counts the companies still standing on the literal and says it is a modelling choice', () => {
    const note = buildImportShareNote({ ...empty, fromCatalogDefault: ['A', 'B', 'C'] })
    expect(note).toMatch(/3 companies have/)
    expect(note).toMatch(/30% default/)
    expect(note).toMatch(/modelling choice, not this business's data/)
  })

  it('distinguishes the mixed case rather than implying the whole holding is grounded', () => {
    const note = buildImportShareNote({
      ...empty,
      fromAssumption: [{ companyCode: 'CPC', share: 0.7 }],
      fromCatalogDefault: ['EDEN', 'MALT'],
    })
    expect(note).toMatch(/stated for 1 company \(CPC 70%\)/)
    expect(note).toMatch(/2 companies have no stated share/)
  })

  it('discloses a rejected assumption with its value', () => {
    const note = buildImportShareNote({
      ...empty,
      fromCatalogDefault: ['CPC'],
      rejected: [{ companyCode: 'CPC', value: 70, reason: 'a share above 1 is not a fraction' }],
    })
    expect(note).toMatch(/CPC's stated share of 70 was not used/)
    expect(note).toMatch(/rather than rescaled/)
  })

  it('says plainly when the shock reached no cost base at all', () => {
    const note = buildImportShareNote({ ...empty, unresolved: ['X'], catalogDefault: null })
    expect(note).toMatch(/did not reach its cost base/)
  })

  it('uses singular and plural correctly', () => {
    expect(buildImportShareNote({ ...empty, fromCatalogDefault: ['A'] })).toMatch(/1 company has/)
    expect(buildImportShareNote({ ...empty, fromCatalogDefault: ['A', 'B'] })).toMatch(/2 companies have/)
  })

  it('falls back to "own default" wording when the literal is absent', () => {
    const note = buildImportShareNote({ ...empty, fromCatalogDefault: ['A'], catalogDefault: null })
    expect(note).toMatch(/the scenario's own default/)
  })
})

describe('buildImportShareNote — bounded output', () => {
  const base: ImportShareReport = {
    measured: [], fromAssumption: [], fromCatalogDefault: [], unresolved: [],
    rejected: [], catalogDefault: 0.3,
  }

  it('names at most 12 stated companies and says how many were elided', () => {
    const note = buildImportShareNote({
      ...base,
      fromAssumption: Array.from({ length: 60 }, (_, i) => ({ companyCode: `CO${i}`, share: 0.5 })),
    })!
    expect(note).toMatch(/stated for 60 companies/)
    expect(note).toMatch(/and 48 others/)
    // The cap must not hide the scale — the true count leads the sentence.
    expect(note).not.toMatch(/CO12\b/)
  })

  it('does not elide when the list fits', () => {
    const note = buildImportShareNote({
      ...base,
      fromAssumption: Array.from({ length: 12 }, (_, i) => ({ companyCode: `CO${i}`, share: 0.5 })),
    })!
    expect(note).not.toMatch(/others/)
    expect(note).toMatch(/CO11 50%/)
  })

  it('caps the rejection list and states the remainder', () => {
    const note = buildImportShareNote({
      ...base,
      rejected: Array.from({ length: 15 }, (_, i) => ({ companyCode: `CO${i}`, value: 70, reason: 'above 1' })),
    })!
    expect(note).toMatch(/3 further stated shares were unusable/)
  })

  it("the counts a catalog-default sentence reports are never truncated", () => {
    // This branch reports a NUMBER, not a list, so a 60-company holding still
    // reads honestly without any cap applying.
    const note = buildImportShareNote({
      ...base,
      fromCatalogDefault: Array.from({ length: 60 }, (_, i) => `CO${i}`),
    })!
    expect(note).toMatch(/60 companies have no stated share/)
  })
})

describe('COMPANY_DRIVERS registry (16.7)', () => {
  it('every entry feeds a real ScenarioShock field', () => {
    for (const d of COMPANY_DRIVERS) {
      expect(['assumedImportShare', 'costRigidity']).toContain(d.feeds)
    }
  })

  it('keys are unique — a duplicate would make resolution order matter', () => {
    const keys = COMPANY_DRIVERS.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every entry has a usable range and a reason to state when it is violated', () => {
    for (const d of COMPANY_DRIVERS) {
      expect(d.min).toBeLessThan(d.max)
      expect(d.rangeNote.length).toBeGreaterThan(10)
    }
  })

  it('deliberately does NOT wire drivers no lever consumes', () => {
    // Guard, not decoration: `resolveShockOverrides` holds opex and da_total
    // fixed and has no tax step, so a `tax_rate` driver would have nowhere to
    // go. Adding one here without adding the lever would mean a driver that
    // reports as "applied" and changes nothing. If a lever lands later, delete
    // the key from this list in the same commit.
    const keys = COMPANY_DRIVERS.map((d) => d.key)
    for (const unconsumed of ['inflation', 'tax_rate', 'vat_rate', 'fx_usd', 'wage_growth']) {
      expect(keys).not.toContain(unconsumed)
    }
  })
})

describe('resolveCompanyDriver — generic behaviour', () => {
  const rigidity = COMPANY_DRIVERS.find((d) => d.key === 'cost_rigidity')!

  it('has no measured tier unless the caller supplies one', () => {
    const r = resolveCompanyDriver(rigidity, { assumption: 0.2, catalogDefault: 0.8 })
    expect(r).toEqual({ value: 0.2, source: 'assumption' })
  })

  it('honours an explicit measured flag', () => {
    const r = resolveCompanyDriver(rigidity, { measured: true, assumption: 0.2, catalogDefault: 0.8 })
    expect(r).toEqual({ value: 0, source: 'measured' })
  })

  it('refuses an out-of-range value and names the direction', () => {
    const high = resolveCompanyDriver(rigidity, { assumption: 80, catalogDefault: 0.8 })
    expect(high.value).toBe(0.8)
    expect(high.rejected?.reason).toMatch(/is above 1/)
    const low = resolveCompanyDriver(rigidity, { assumption: -1, catalogDefault: 0.8 })
    expect(low.rejected?.reason).toMatch(/is below 0/)
  })
})

describe('buildDriverNote (16.7)', () => {
  const base: ImportShareReport = {
    measured: [], fromAssumption: [], fromCatalogDefault: [], unresolved: [],
    rejected: [], catalogDefault: 0.3,
  }

  it('joins one sentence per driver, labelled', () => {
    const note = buildDriverNote([
      { ...base, driverKey: 'import_share', fromAssumption: [{ companyCode: 'CPC', share: 0.7 }] },
      { ...base, driverKey: 'cost_rigidity', catalogDefault: 0.8, fromAssumption: [{ companyCode: 'EDEN', share: 0 }] },
    ])!
    expect(note).toMatch(/Imported-input share stated for 1 company \(CPC 70%\)/)
    expect(note).toMatch(/Sunk-cost share stated for 1 company \(EDEN 0%\)/)
  })

  it('returns null when nothing needs disclosing', () => {
    expect(buildDriverNote([])).toBeNull()
    expect(buildDriverNote([{ ...base, measured: ['A'] }])).toBeNull()
  })

  it('tolerates a missing list rather than failing the whole response', () => {
    // This builds a caveat. A simulation that produced real numbers must not
    // 500 because the sentence describing its assumptions could not be built.
    expect(buildDriverNote(undefined)).toBeNull()
    expect(buildDriverNote(null)).toBeNull()
  })

  it('skips a null entry among real ones', () => {
    const note = buildDriverNote([null, { ...base, fromCatalogDefault: ['A'] }])
    expect(note).toMatch(/1 company has no stated share/)
  })
})
