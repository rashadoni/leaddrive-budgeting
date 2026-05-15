import { describe, it, expect } from 'vitest';
import { computeCompanyTrustStatus } from './trust-status';
import type { HeatMapCell } from './heatmap-matrix';

const baseCell = (over: Partial<HeatMapCell>): HeatMapCell => ({
  companyId: 'co1',
  indicatorId: 'ind1',
  value: 1,
  status: 'green',
  ...over,
});

describe('computeCompanyTrustStatus', () => {
  it('returns pending when no cells for the company', () => {
    expect(computeCompanyTrustStatus('co1', [])).toBe('pending');
    expect(computeCompanyTrustStatus('co1', [baseCell({ companyId: 'co2' })])).toBe('pending');
  });

  it('returns verified when all material cells have real status', () => {
    const cells = [
      baseCell({ status: 'green' }),
      baseCell({ status: 'amber', indicatorId: 'i2' }),
      baseCell({ status: 'red', indicatorId: 'i3' }),
    ];
    expect(computeCompanyTrustStatus('co1', cells)).toBe('verified');
  });

  it('returns partial when most material cells are unknown', () => {
    const cells = [
      baseCell({ status: 'green' }),
      baseCell({ status: 'unknown', indicatorId: 'i2' }),
      baseCell({ status: 'unknown', indicatorId: 'i3' }),
      baseCell({ status: 'unknown', indicatorId: 'i4' }),
    ];
    expect(computeCompanyTrustStatus('co1', cells)).toBe('partial');
  });

  it('ignores not_material cells when computing coverage', () => {
    const cells = [
      baseCell({ status: 'green' }),
      baseCell({ status: 'green', indicatorId: 'i2' }),
      // unknown but not_material — should be skipped, doesn't drag down coverage
      baseCell({ status: 'unknown', indicatorId: 'i3', materiality: 'not_material' }),
      baseCell({ status: 'unknown', indicatorId: 'i4', materiality: 'not_material' }),
    ];
    expect(computeCompanyTrustStatus('co1', cells)).toBe('verified');
  });

  it('returns suspicious when any material cell has extreme sanityBand', () => {
    const cells = [
      baseCell({ status: 'green' }),
      // Cast through unknown to attach sanityBand (not yet on the type).
      {
        ...baseCell({ status: 'green', indicatorId: 'i2' }),
        sanityBand: 'high_extreme',
      } as unknown as HeatMapCell,
    ];
    expect(computeCompanyTrustStatus('co1', cells)).toBe('suspicious');
  });

  it('returns pending when only not_material cells exist (no signal)', () => {
    const cells = [
      baseCell({ status: 'green', materiality: 'not_material' }),
      baseCell({ status: 'amber', indicatorId: 'i2', materiality: 'not_material' }),
    ];
    expect(computeCompanyTrustStatus('co1', cells)).toBe('pending');
  });
});
