import { describe, it, expect } from 'vitest'
import { orderCascade } from './cascade-order'

describe('orderCascade', () => {
  it('orders changed cells worst-first (red→amber→green), only changed', () => {
    expect(
      orderCascade([
        { companyId: 'c1', code: 'A', scenarioStatus: 'amber', changed: true },
        { companyId: 'c2', code: 'B', scenarioStatus: 'red', changed: true },
        { companyId: 'c3', code: 'C', scenarioStatus: 'green', changed: false },
        { companyId: 'c4', code: 'D', scenarioStatus: 'green', changed: true },
      ]),
    ).toEqual(['c2:B', 'c1:A', 'c4:D'])
  })
  it('returns [] for no changes', () => {
    expect(orderCascade([{ companyId: 'c1', code: 'A', scenarioStatus: 'green', changed: false }])).toEqual([])
  })
  it('stable within the same rank (preserves input order)', () => {
    expect(
      orderCascade([
        { companyId: 'c1', code: 'A', scenarioStatus: 'red', changed: true },
        { companyId: 'c2', code: 'B', scenarioStatus: 'red', changed: true },
      ]),
    ).toEqual(['c1:A', 'c2:B'])
  })
})
