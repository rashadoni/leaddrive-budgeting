import { describe, it, expect } from 'vitest'
import { CRISIS_CATALOG, CRISIS_CATEGORY_LABEL_RU } from './crisis-catalog'
import { hasShock } from './scenario-shock'

describe('CRISIS_CATALOG', () => {
  it('every entry has a unique code + a well-formed shock + tri-lingual names', () => {
    const codes = new Set(CRISIS_CATALOG.map((s) => s.code))
    expect(codes.size).toBe(CRISIS_CATALOG.length)
    for (const s of CRISIS_CATALOG) {
      expect(hasShock({ shock: s.shock })).toBe(true)
      expect(CRISIS_CATEGORY_LABEL_RU[s.category]).toBeTruthy()
      expect(s.nameEn && s.nameRu && s.nameAz).toBeTruthy()
      expect(s.description).toBeTruthy()
    }
  })
  it('the 3 user-selected flagships are present + marked', () => {
    const flags = CRISIS_CATALOG.filter((s) => s.flagship).map((s) => s.code)
    expect(flags).toEqual(expect.arrayContaining(['INPUT_COST_30', 'DROUGHT_2026', 'AZN_DEVAL_20']))
    expect(flags).toHaveLength(3)
  })
})
