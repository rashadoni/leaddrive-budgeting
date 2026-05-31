/**
 * operationalFactResolver — snapshot-vs-flow aggregation (2026-05-31).
 *
 * The decision is now driven by `IndicatorDefinition.aggregation` threaded as
 * `ctx.aggregation` (replaces the old SNAPSHOT_METRIC_RE regex). Regression for
 * the CPC LEGAL_CASES_ACTIVE bug: re-imports leave several point-in-time facts
 * for a stock metric (6 @ May + 8 @ Dec); under aggregation="snapshot" the
 * resolver must take the LATEST (8), not the mean (7). "flow" keeps averaging.
 */
import { describe, it, expect } from 'vitest';
import { operationalFactResolver } from './recompute-resolvers-a';

type Fact = { value: number; date: Date };

function makeCtx(facts: Record<string, Fact[]>, aggregation: 'snapshot' | 'flow') {
  return {
    organizationId: 'org_test_0000000001',
    companyId: 'co_test_0000000001',
    period: { start: new Date('2026-01-01'), end: new Date('2027-01-01') },
    aggregation,
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

describe('operationalFactResolver — snapshot vs flow aggregation (ctx-driven)', () => {
  it('aggregation="snapshot" resolves to the LATEST fact, not the mean', async () => {
    const ctx = makeCtx(
      {
        LEGAL_CASES_ACTIVE: [
          { value: 6, date: new Date('2026-05-01') }, // stale, earlier import
          { value: 8, date: new Date('2026-12-31') }, // current
        ],
      },
      'snapshot',
    );
    const state = makeState();
    await operationalFactResolver.resolve(['operationalFact:LEGAL_CASES_ACTIVE'], ctx, state);
    expect(state.context.LEGAL_CASES_ACTIVE).toBe(8); // NOT (6+8)/2 = 7
  });

  it('snapshot latest is picked regardless of row order', async () => {
    const ctx = makeCtx(
      {
        audit_findings_major_open: [
          { value: 8, date: new Date('2026-12-31') }, // current first
          { value: 6, date: new Date('2026-05-01') },
        ],
      },
      'snapshot',
    );
    const state = makeState();
    await operationalFactResolver.resolve(['operationalFact:audit_findings_major_open'], ctx, state);
    expect(state.context.audit_findings_major_open).toBe(8);
  });

  it('aggregation="flow" averages multiple in-period facts', async () => {
    const ctx = makeCtx(
      {
        harvest_tons: [
          { value: 10, date: new Date('2026-03-01') },
          { value: 20, date: new Date('2026-06-01') },
        ],
      },
      'flow',
    );
    const state = makeState();
    await operationalFactResolver.resolve(['operationalFact:harvest_tons'], ctx, state);
    expect(state.context.harvest_tons).toBe(15); // mean
  });

  it('the FLAG, not the metric name, drives aggregation (rot-proof — the whole point of the migration)', async () => {
    // A metric NAMED like a stock count, but the indicator computing it is
    // declared "flow" → averages. And vice-versa. Under the old regex the name
    // alone decided; now only the seed-declared flag does.
    const facts = {
      LEGAL_CASES_ACTIVE: [
        { value: 6, date: new Date('2026-05-01') },
        { value: 8, date: new Date('2026-12-31') },
      ],
      some_volume: [
        { value: 6, date: new Date('2026-05-01') },
        { value: 8, date: new Date('2026-12-31') },
      ],
    };
    const flowState = makeState();
    await operationalFactResolver.resolve(
      ['operationalFact:LEGAL_CASES_ACTIVE'],
      makeCtx(facts, 'flow'),
      flowState,
    );
    expect(flowState.context.LEGAL_CASES_ACTIVE).toBe(7); // flow flag → mean despite the name

    const snapState = makeState();
    await operationalFactResolver.resolve(
      ['operationalFact:some_volume'],
      makeCtx(facts, 'snapshot'),
      snapState,
    );
    expect(snapState.context.some_volume).toBe(8); // snapshot flag → latest despite the name
  });

  it('single fact resolves to its own value for both flags', async () => {
    const facts = { m: [{ value: 4, date: new Date('2026-12-31') }] };
    const snap = makeState();
    await operationalFactResolver.resolve(['operationalFact:m'], makeCtx(facts, 'snapshot'), snap);
    const flow = makeState();
    await operationalFactResolver.resolve(['operationalFact:m'], makeCtx(facts, 'flow'), flow);
    expect(snap.context.m).toBe(4);
    expect(flow.context.m).toBe(4);
  });
});
