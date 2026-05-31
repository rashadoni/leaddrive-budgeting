/**
 * operationalFactResolver — snapshot-vs-flow aggregation (2026-05-31).
 *
 * Regression for the CPC LEGAL_CASES_ACTIVE bug: re-imports leave several
 * point-in-time facts for a stock metric (6 @ May + 8 @ Dec); the resolver
 * must take the LATEST (8), not the mean (7). Flow metrics keep averaging.
 */
import { describe, it, expect } from 'vitest';
import { operationalFactResolver, SNAPSHOT_METRIC_RE } from './recompute-resolvers-a';

type Fact = { value: number; date: Date };

function makeCtx(facts: Record<string, Fact[]>) {
  return {
    organizationId: 'org_test_0000000001',
    companyId: 'co_test_0000000001',
    period: { start: new Date('2026-01-01'), end: new Date('2027-01-01') },
    ds: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      listOperationalFacts: async ({ metric }: any) => facts[metric] ?? [],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
function makeState() {
  return {
    context: {} as Record<string, unknown>,
    inputs: { resolved: {} as Record<string, unknown>, aggregates: {} as Record<string, unknown> },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('operationalFactResolver — snapshot vs flow aggregation', () => {
  it('SNAPSHOT metric (LEGAL_CASES_ACTIVE) resolves to the LATEST fact, not the mean', async () => {
    const ctx = makeCtx({
      LEGAL_CASES_ACTIVE: [
        { value: 6, date: new Date('2026-05-01') }, // stale, earlier import
        { value: 8, date: new Date('2026-12-31') }, // current
      ],
    });
    const state = makeState();
    await operationalFactResolver.resolve(['operationalFact:LEGAL_CASES_ACTIVE'], ctx, state);
    expect(state.context.LEGAL_CASES_ACTIVE).toBe(8); // NOT (6+8)/2 = 7
  });

  it('snapshot latest is picked regardless of row order', async () => {
    const ctx = makeCtx({
      audit_findings_major_open: [
        { value: 8, date: new Date('2026-12-31') }, // current first
        { value: 6, date: new Date('2026-05-01') },
      ],
    });
    const state = makeState();
    await operationalFactResolver.resolve(['operationalFact:audit_findings_major_open'], ctx, state);
    expect(state.context.audit_findings_major_open).toBe(8);
  });

  it('FLOW metric averages multiple in-period facts (unchanged behaviour)', async () => {
    const ctx = makeCtx({
      harvest_tons: [
        { value: 10, date: new Date('2026-03-01') },
        { value: 20, date: new Date('2026-06-01') },
      ],
    });
    const state = makeState();
    await operationalFactResolver.resolve(['operationalFact:harvest_tons'], ctx, state);
    expect(state.context.harvest_tons).toBe(15); // mean
  });

  it('single fact resolves to its own value for both classes', async () => {
    const ctx = makeCtx({
      LEGAL_CASES_ACTIVE: [{ value: 4, date: new Date('2026-12-31') }],
      drought_index: [{ value: 11.4, date: new Date('2026-12-31') }],
    });
    const state = makeState();
    await operationalFactResolver.resolve(
      ['operationalFact:LEGAL_CASES_ACTIVE', 'operationalFact:drought_index'],
      ctx,
      state,
    );
    expect(state.context.LEGAL_CASES_ACTIVE).toBe(4);
    expect(state.context.drought_index).toBe(11.4);
  });

  it('intensive ratio/index metric (yield_per_ha) takes LATEST, not mean', async () => {
    const ctx = makeCtx({
      yield_per_ha: [
        { value: 60, date: new Date('2026-05-01') },
        { value: 65, date: new Date('2026-12-31') },
      ],
    });
    const state = makeState();
    await operationalFactResolver.resolve(['operationalFact:yield_per_ha'], ctx, state);
    expect(state.context.yield_per_ha).toBe(65); // NOT (60+65)/2 = 62.5
  });

  it('SNAPSHOT_METRIC_RE matches the compliance class AND intensive ratios/indices, but not additive flows', () => {
    // compliance/legal/audit counts + intensive ratios (%, per-ha, indices)
    for (const m of [
      'LEGAL_CASES_ACTIVE', 'LEGAL_CASES_TOTAL', 'AUDIT_CLOSED_PCT', 'AUDIT_MAJOR_OPEN',
      'court_disputes_open', 'audit_findings_total',
      'drought_index', 'yield_per_ha', 'sugar_content_pct', 'water_use_m3_per_ha',
      'fertilizer_kg_per_ha', 'cane_buyer_concentration_pct', 'cane_hectares_harvested_pct',
      'extraction_rate_pct',
    ]) {
      expect(SNAPSHOT_METRIC_RE.test(m), `${m} should be snapshot`).toBe(true);
    }
    // additive flow metrics keep averaging
    for (const m of ['harvest_tons', 'area_hectares', 'broiler_weight_avg_kg', 'corn_purchase_tons']) {
      expect(SNAPSHOT_METRIC_RE.test(m), `${m} should be flow`).toBe(false);
    }
  });
});
