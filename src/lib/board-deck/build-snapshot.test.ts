// @vitest-environment node
/**
 * Phase 7.E C3 v2 — buildBoardSnapshot helper test.
 *
 * Locks in: (a) returns null when org row missing; (b) only operational
 * (level=2 + role='operational') sub-cos count toward composite + counts
 * + alerts; (c) totals + matchesBySeverity buckets are derived
 * deterministically from the same cell set the page renders.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    organization: { findUnique: vi.fn() },
    company: { findMany: vi.fn() },
    indicatorDefinition: { findMany: vi.fn() },
    indicatorValue: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { buildBoardSnapshot } from './build-snapshot';

const ORG_ID = 'org_demo';

beforeEach(() => {
  prismaMock.organization.findUnique
    .mockReset()
    .mockResolvedValue({
      name: 'Demo Holding',
      slug: 'demo',
      settings: null,
    });
  prismaMock.company.findMany.mockReset().mockResolvedValue([]);
  prismaMock.indicatorDefinition.findMany.mockReset().mockResolvedValue([]);
  prismaMock.indicatorValue.findMany.mockReset().mockResolvedValue([]);
});

describe('buildBoardSnapshot', () => {
  it('applies an explicit company allow-list at the first company query', async () => {
    await buildBoardSnapshot({
      orgId: ORG_ID,
      period: '2025',
      companyIds: ['co_visible_1', 'co_visible_2'],
    });
    expect(prismaMock.company.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG_ID,
          isActive: true,
          id: { in: ['co_visible_1', 'co_visible_2'] },
        }),
      }),
    );
  });

  it('returns null when org row is missing', async () => {
    prismaMock.organization.findUnique.mockResolvedValue(null);
    const snap = await buildBoardSnapshot({ orgId: ORG_ID, period: '2025' });
    expect(snap).toBeNull();
    // Other queries still ran (Promise.all fan-out) but caller short-circuits.
    expect(prismaMock.organization.findUnique).toHaveBeenCalledTimes(1);
  });

  it('keeps only canonical risk tags at the shared snapshot boundary', async () => {
    prismaMock.company.findMany.mockResolvedValue([
      {
        id: 'co_alpha',
        code: 'ALPHA',
        name: 'Alpha LLC',
        industry: 'hospitality',
        level: 2,
        isActive: true,
        role: 'operational',
        sortOrder: 1,
        settings: {
          riskTags: ['data_absence', 'legacy_unknown_tag', 42],
        },
      },
    ]);
    const snap = await buildBoardSnapshot({ orgId: ORG_ID, period: '2025' });
    expect(snap?.riskTagsByCompany.get('co_alpha')).toEqual(['data_absence']);
  });

  it('assembles snapshot — composite + counts + alerts byte-equal page', async () => {
    prismaMock.company.findMany.mockResolvedValue([
      // Operational (level=2, role=operational) — included
      {
        id: 'co_alpha',
        code: 'ALPHA',
        name: 'Alpha LLC',
        industry: 'hospitality',
        level: 2,
        isActive: true,
        role: 'operational',
        sortOrder: 1,
      },
      {
        id: 'co_beta',
        code: 'BETA',
        name: 'Beta LLC',
        industry: 'agro',
        level: 2,
        isActive: true,
        role: 'operational',
        sortOrder: 2,
      },
      // Sub-group (level=1) — filtered out
      {
        id: 'co_root',
        code: 'ROOT',
        name: 'Root Holding',
        industry: null,
        level: 1,
        isActive: true,
        role: 'sub-group',
        sortOrder: 0,
      },
    ]);
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: 'ind_gm',
        code: 'IND_GROSS_MARGIN',
        nameEn: 'Gross Margin',
        direction: 'higher_is_better',
        unit: '%',
        sortOrder: 1,
      },
      {
        id: 'ind_nm',
        code: 'IND_NET_MARGIN',
        nameEn: 'Net Margin',
        direction: 'higher_is_better',
        unit: '%',
        sortOrder: 2,
      },
      {
        id: 'ind_dso',
        code: 'IND_DSO',
        nameEn: 'Days Sales Outstanding',
        direction: 'lower_is_better',
        unit: 'days',
        // Phase 8 — heavier weight so this test LOCKS the weighted composite:
        // ALPHA = (100×1 + 100×1 + 50×3)/5 = 70 weighted (vs 83 unweighted).
        // If the deck stops passing cell weights, ALPHA reverts to 83 → fails.
        weight: 3,
        sortOrder: 3,
      },
      // 11.81 — a fourth scoring indicator so both companies clear the
      // coverage floor and this test keeps measuring the WEIGHTED composite.
      {
        id: 'ind_ccc',
        code: 'IND_CASH_CONVERSION',
        nameEn: 'Cash Conversion Cycle',
        direction: 'lower_is_better',
        unit: 'days',
        weight: 1,
        sortOrder: 4,
      },
      // Phase 8 lock: an internal-category indicator. The deck must FILTER it
      // out (mirroring the matrix endpoint), so snap.indicators stays 3 codes
      // and totals.cells stays 6. If the internal-filter regresses, this
      // indicator leaks in and those assertions fail.
      {
        id: 'ind_rev',
        code: 'IND_REVENUE_TOTAL',
        nameEn: 'Total Revenue',
        direction: 'higher_is_better',
        unit: '₼',
        category: 'internal',
        requiredInputs: [],
        sortOrder: 5,
      },
    ]);
    prismaMock.indicatorValue.findMany.mockResolvedValue([
      // ALPHA: 3 green, 1 amber → weighted (100+100+150+100)/6 = 75 → 'green'
      {
        companyId: 'co_alpha',
        indicatorId: 'ind_gm',
        value: 60,
        status: 'green',
      },
      {
        companyId: 'co_alpha',
        indicatorId: 'ind_nm',
        value: 30,
        status: 'green',
      },
      {
        companyId: 'co_alpha',
        indicatorId: 'ind_dso',
        value: 45,
        status: 'amber',
      },
      {
        companyId: 'co_alpha',
        indicatorId: 'ind_ccc',
        value: 20,
        status: 'green',
      },
      // BETA: 4 red → composite = 0 → 'red'
      {
        companyId: 'co_beta',
        indicatorId: 'ind_gm',
        value: 5,
        status: 'red',
      },
      {
        companyId: 'co_beta',
        indicatorId: 'ind_nm',
        value: 0,
        status: 'red',
      },
      {
        companyId: 'co_beta',
        indicatorId: 'ind_dso',
        value: 0,
        status: 'red',
      },
      {
        companyId: 'co_beta',
        indicatorId: 'ind_ccc',
        value: 0,
        status: 'red',
      },
    ]);

    const snap = await buildBoardSnapshot({
      orgId: ORG_ID,
      period: '2025',
    });

    expect(snap).not.toBeNull();
    if (!snap) throw new Error('snap=null');

    // Org metadata flows through
    expect(snap.org.name).toBe('Demo Holding');
    expect(snap.org.slug).toBe('demo');

    // Operational filter — sub-group dropped
    expect(snap.operational.map((c) => c.code)).toEqual(['ALPHA', 'BETA']);
    expect(snap.totals.operational).toBe(2);

    // 3 indicators
    expect(snap.indicators.map((i) => i.code)).toEqual([
      'IND_GROSS_MARGIN',
      'IND_NET_MARGIN',
      'IND_DSO',
      'IND_CASH_CONVERSION',
    ]);
    expect(snap.totals.indicators).toBe(4);
    expect(snap.totals.cells).toBe(8);

    // Composite: ALPHA = 75/green (WEIGHTED — dso amber carries weight 3;
    // unweighted would be 88). Phase 8 lock: the deck must apply indicator
    // weights, identical to the Risk Terminal. BETA = 0/red.
    const alpha = snap.compositeByCompany.get('co_alpha');
    expect(alpha?.score).toBe(75);
    expect(alpha?.band).toBe('green');
    expect(alpha?.coverage).toBe('full');
    const beta = snap.compositeByCompany.get('co_beta');
    expect(beta?.score).toBe(0);
    expect(beta?.band).toBe('red');

    // Counts (per-co g/a/r/u)
    expect(snap.countsByCompany.get('co_alpha')).toEqual({
      green: 3,
      amber: 1,
      red: 0,
      unknown: 0,
    });
    expect(snap.countsByCompany.get('co_beta')).toEqual({
      green: 0,
      amber: 0,
      red: 4,
      unknown: 0,
    });

    // Totals roll up
    expect(snap.totals.green).toBe(3);
    expect(snap.totals.amber).toBe(1);
    expect(snap.totals.red).toBe(4);

    // matches bucket exists for every severity
    expect(Object.keys(snap.matchesBySeverity).sort()).toEqual([
      'critical',
      'info',
      'warning',
    ]);

    // Cell lookup uses `|` separator (preserves page semantics)
    expect(snap.cellByKey.get('co_alpha|ind_gm')?.status).toBe('green');
    expect(snap.cellByKey.get('co_beta|ind_gm')?.status).toBe('red');

    // generatedAt is ISO8601
    expect(snap.generatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it('skips IndicatorValue query when no operational companies', async () => {
    // Only sub-groups → operationalIds is empty → no IV findMany at all
    prismaMock.company.findMany.mockResolvedValue([
      {
        id: 'co_root',
        code: 'ROOT',
        name: 'Root',
        industry: null,
        level: 1,
        isActive: true,
        role: 'sub-group',
        sortOrder: 0,
      },
    ]);
    prismaMock.indicatorDefinition.findMany.mockResolvedValue([
      {
        id: 'i1',
        code: 'IND_X',
        nameEn: 'X',
        direction: 'higher_is_better',
        unit: '%',
        sortOrder: 1,
      },
    ]);

    const snap = await buildBoardSnapshot({
      orgId: ORG_ID,
      period: '2025',
    });

    expect(snap).not.toBeNull();
    if (!snap) throw new Error('snap=null');
    expect(prismaMock.indicatorValue.findMany).not.toHaveBeenCalled();
    expect(snap.cells).toEqual([]);
    expect(snap.totals.operational).toBe(0);
    expect(snap.totals.green + snap.totals.amber + snap.totals.red).toBe(0);
  });
});
