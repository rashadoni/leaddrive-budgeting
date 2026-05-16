/**
 * Unit tests for pure helpers extracted from `scripts/drift-watchdog.cjs`
 * (F2 closure 2026-05-16).
 *
 * Watchdog flow that used to be untestable:
 *   1. Snapshot IVs before audit (raw rows).
 *   2. Run audit-company.cjs --write (mutates sanityBand + value).
 *   3. Snapshot IVs after, diff against before, emit drifts[] entries.
 *
 * `buildBeforeMap` + `computeDrifts` cover step 1 and step 3 — the parts
 * that don't need Postgres or child processes.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
// `value` is `number | string` end-to-end because Prisma's Decimal columns
// round-trip as strings in some paths; computeDrifts coerces via `Number(...)`.
type IvRow = {
  indicator: { code: string };
  sanityBand: string | null;
  value: number | string;
};
const helpers = require('./drift-watchdog-helpers.cjs') as {
  DRIFT_THRESHOLD_PCT: number;
  computeDrifts: (
    beforeMap: Map<string, { sanityBand: string | null; value: number | string }>,
    ivsAfter: IvRow[],
    thresholdPct?: number,
  ) => Array<{
    indicatorCode: string;
    beforeBand: string | null;
    afterBand: string | null;
    beforeValue: number;
    afterValue: number;
    valueDriftPct: number;
    bandChanged: boolean;
  }>;
  buildBeforeMap: (
    ivsBefore: IvRow[],
  ) => Map<string, { sanityBand: string | null; value: number | string }>;
};

describe('DRIFT_THRESHOLD_PCT', () => {
  it('defaults to 0.5%', () => {
    expect(helpers.DRIFT_THRESHOLD_PCT).toBe(0.5);
  });
});

describe('buildBeforeMap', () => {
  it('keys IVs by indicator code', () => {
    const map = helpers.buildBeforeMap([
      { indicator: { code: 'IND_GROSS_MARGIN' }, sanityBand: 'normal', value: 25 },
      { indicator: { code: 'FP_OPEX_RATIO' }, sanityBand: 'high_extreme', value: 80 },
    ]);
    expect(map.size).toBe(2);
    expect(map.get('IND_GROSS_MARGIN')?.value).toBe(25);
    expect(map.get('FP_OPEX_RATIO')?.sanityBand).toBe('high_extreme');
  });

  it('returns empty map for empty input', () => {
    expect(helpers.buildBeforeMap([]).size).toBe(0);
  });
});

describe('computeDrifts', () => {
  it('flags a band change (low_extreme → high_extreme) regardless of value drift', () => {
    const before = helpers.buildBeforeMap([
      { indicator: { code: 'FP_GROSS_MARGIN' }, sanityBand: 'low_extreme', value: 5 },
    ]);
    const drifts = helpers.computeDrifts(before, [
      { indicator: { code: 'FP_GROSS_MARGIN' }, sanityBand: 'high_extreme', value: 5 },
    ]);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toMatchObject({
      indicatorCode: 'FP_GROSS_MARGIN',
      beforeBand: 'low_extreme',
      afterBand: 'high_extreme',
      bandChanged: true,
      valueDriftPct: 0,
    });
  });

  it('flags a value drift above threshold even when band unchanged', () => {
    const before = helpers.buildBeforeMap([
      { indicator: { code: 'IND_GROSS_MARGIN' }, sanityBand: 'normal', value: 30 },
    ]);
    const drifts = helpers.computeDrifts(
      before,
      [{ indicator: { code: 'IND_GROSS_MARGIN' }, sanityBand: 'normal', value: 31 }],
      0.5,
    );
    expect(drifts).toHaveLength(1);
    expect(drifts[0].valueDriftPct).toBeCloseTo(3.33, 1);
    expect(drifts[0].bandChanged).toBe(false);
  });

  it('ignores drift below the threshold when band unchanged', () => {
    const before = helpers.buildBeforeMap([
      { indicator: { code: 'IND_REVENUE_TOTAL' }, sanityBand: 'normal', value: 1_000_000 },
    ]);
    const drifts = helpers.computeDrifts(
      before,
      [{ indicator: { code: 'IND_REVENUE_TOTAL' }, sanityBand: 'normal', value: 1_000_100 }],
      0.5,
    );
    expect(drifts).toHaveLength(0);
  });

  it('skips indicators that were not in the before-map (newly recompiled)', () => {
    const before = helpers.buildBeforeMap([
      { indicator: { code: 'IND_GROSS_MARGIN' }, sanityBand: 'normal', value: 30 },
    ]);
    const drifts = helpers.computeDrifts(before, [
      { indicator: { code: 'IND_GROSS_MARGIN' }, sanityBand: 'normal', value: 30 },
      // AGRO_YIELD_PER_HA only appeared in the "after" set — no comparison.
      { indicator: { code: 'AGRO_YIELD_PER_HA' }, sanityBand: 'normal', value: 65 },
    ]);
    expect(drifts).toHaveLength(0);
  });

  it('uses max(|before|, 1) as the denominator so zero-baselines do not divide by zero', () => {
    // before=0, after=10 → drift = |10 - 0| / max(0,1) * 100 = 1000%
    const before = helpers.buildBeforeMap([
      { indicator: { code: 'IND_NET_MARGIN' }, sanityBand: 'normal', value: 0 },
    ]);
    const drifts = helpers.computeDrifts(before, [
      { indicator: { code: 'IND_NET_MARGIN' }, sanityBand: 'normal', value: 10 },
    ]);
    expect(drifts).toHaveLength(1);
    expect(drifts[0].valueDriftPct).toBe(1000);
  });

  it('coerces string values to numbers (Prisma Decimal serialization)', () => {
    const before = helpers.buildBeforeMap([
      { indicator: { code: 'IND_GROSS_MARGIN' }, sanityBand: 'normal', value: '30' },
    ]);
    const drifts = helpers.computeDrifts(before, [
      { indicator: { code: 'IND_GROSS_MARGIN' }, sanityBand: 'normal', value: '40' },
    ]);
    expect(drifts).toHaveLength(1);
    expect(drifts[0].beforeValue).toBe(30);
    expect(drifts[0].afterValue).toBe(40);
  });

  it('respects a custom threshold (10% — accept anything below)', () => {
    const before = helpers.buildBeforeMap([
      { indicator: { code: 'IND_OPEX_RATIO' }, sanityBand: 'normal', value: 50 },
    ]);
    const drifts = helpers.computeDrifts(
      before,
      [{ indicator: { code: 'IND_OPEX_RATIO' }, sanityBand: 'normal', value: 52 }],
      10, // 10% threshold — 4% drift below this
    );
    expect(drifts).toHaveLength(0);
  });
});
