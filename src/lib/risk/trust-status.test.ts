import { describe, it, expect } from 'vitest';
import { computeCompanyTrustStatus } from './trust-status';
import type { HeatMapCell } from './heatmap-matrix';

// Default `lastReconciledAt` to "now" so existing tests that don't set
// it explicitly remain in the verified-window (L6 staleness fallback).
// Tests exercising staleness explicitly override with an older ISO date.
const NOW_ISO = new Date().toISOString();
const baseCell = (over: Partial<HeatMapCell>): HeatMapCell => ({
  companyId: 'co1',
  indicatorId: 'ind1',
  value: 1,
  status: 'green',
  lastReconciledAt: NOW_ISO,
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

  describe('L6 staleness fallback', () => {
    const STALE_ISO = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
    const FRESH_ISO = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

    it('degrades verified → partial when all material cells audited > 30 days ago', () => {
      const cells = [
        baseCell({ status: 'green', lastReconciledAt: STALE_ISO }),
        baseCell({ status: 'amber', indicatorId: 'i2', lastReconciledAt: STALE_ISO }),
      ];
      expect(computeCompanyTrustStatus('co1', cells)).toBe('partial');
    });

    it('stays verified when at least one material cell audited within 30 days', () => {
      const cells = [
        baseCell({ status: 'green', lastReconciledAt: STALE_ISO }),
        baseCell({ status: 'green', indicatorId: 'i2', lastReconciledAt: FRESH_ISO }),
      ];
      expect(computeCompanyTrustStatus('co1', cells)).toBe('verified');
    });

    it('degrades to partial when material cells have no lastReconciledAt at all (never audited)', () => {
      const cells: HeatMapCell[] = [
        // Drop the default NOW_ISO via explicit undefined.
        { ...baseCell({ status: 'green' }), lastReconciledAt: undefined },
        { ...baseCell({ status: 'amber', indicatorId: 'i2' }), lastReconciledAt: undefined },
      ];
      expect(computeCompanyTrustStatus('co1', cells)).toBe('partial');
    });
  });
});
