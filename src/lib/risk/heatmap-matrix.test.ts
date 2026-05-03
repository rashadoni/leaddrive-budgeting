import { describe, it, expect } from 'vitest';
import {
  cellKey,
  buildCellMap,
  isAggregateRollup,
  summarizeMatrix,
  statusColor,
  statusShape,
  type HeatMapCell,
} from './heatmap-matrix';

function cell(
  companyId: string,
  indicatorId: string,
  status: HeatMapCell['status'],
  value = 0,
): HeatMapCell {
  return { companyId, indicatorId, status, value };
}

describe('cellKey', () => {
  it('produces stable composite keys', () => {
    expect(cellKey('c1', 'i1')).toBe('c1:i1');
  });

  it('distinguishes swapped ids', () => {
    expect(cellKey('c1', 'i1')).not.toBe(cellKey('i1', 'c1'));
  });
});

describe('buildCellMap', () => {
  it('maps cells by `${companyId}:${indicatorId}`', () => {
    const map = buildCellMap([
      cell('c1', 'i1', 'green', 75),
      cell('c2', 'i1', 'red', 20),
    ]);
    expect(map.size).toBe(2);
    expect(map.get('c1:i1')?.status).toBe('green');
    expect(map.get('c2:i1')?.status).toBe('red');
  });

  it('last cell wins on duplicate key (upstream data bug surfaces, not silent merge)', () => {
    const map = buildCellMap([
      cell('c1', 'i1', 'green', 80),
      cell('c1', 'i1', 'red', 10),
    ]);
    expect(map.get('c1:i1')?.status).toBe('red');
  });

  it('empty input yields empty map', () => {
    expect(buildCellMap([]).size).toBe(0);
  });
});

describe('summarizeMatrix', () => {
  const companies = ['c1', 'c2'];
  const indicators = ['i1', 'i2'];

  it('counts green / amber / red / unknown across the grid', () => {
    const counts = summarizeMatrix(companies, indicators, [
      cell('c1', 'i1', 'green'),
      cell('c1', 'i2', 'amber'),
      cell('c2', 'i1', 'red'),
      cell('c2', 'i2', 'unknown'),
    ]);
    expect(counts).toEqual({
      green: 1,
      amber: 1,
      red: 1,
      unknown: 1,
      missing: 0,
      total: 4,
    });
  });

  it('reports grid positions without any cell as missing, not unknown', () => {
    const counts = summarizeMatrix(companies, indicators, [
      cell('c1', 'i1', 'green'),
    ]);
    expect(counts.green).toBe(1);
    expect(counts.missing).toBe(3);
    expect(counts.unknown).toBe(0);
    expect(counts.total).toBe(4);
  });

  it('total always equals companies × indicators, regardless of payload size', () => {
    const counts = summarizeMatrix(['a', 'b', 'c'], ['x', 'y'], []);
    expect(counts.total).toBe(6);
    expect(counts.missing).toBe(6);
  });

  it('ignores stray cells that do not belong to the grid axes', () => {
    // Cell for a company NOT in the companies array shouldn't skew counts.
    const counts = summarizeMatrix(companies, indicators, [
      cell('c1', 'i1', 'green'),
      cell('ghost', 'i1', 'red'),
    ]);
    expect(counts.green).toBe(1);
    expect(counts.red).toBe(0);
    expect(counts.missing).toBe(3);
  });
});

describe('statusColor', () => {
  it('maps known statuses to distinct accent colors', () => {
    const colors = new Set([
      statusColor('green'),
      statusColor('amber'),
      statusColor('red'),
      statusColor('unknown'),
      statusColor('missing'),
    ]);
    expect(colors.size).toBe(5);
  });
});

describe('statusShape (Tier-3 M7 — color-blind redundant signal)', () => {
  it('maps every status to a distinct single-glyph shape', () => {
    const shapes = new Set([
      statusShape('green'),
      statusShape('amber'),
      statusShape('red'),
      statusShape('unknown'),
      statusShape('missing'),
    ]);
    expect(shapes.size).toBe(5);
  });

  it('returns a single-codepoint glyph (one visible char) for each status', () => {
    const statuses = ['green', 'amber', 'red', 'unknown', 'missing'] as const;
    for (const s of statuses) {
      const shape = statusShape(s);
      // Each shape is a single Unicode code point (length 1).
      expect(shape.length).toBe(1);
      // Glyph is non-empty + not a control char.
      expect(shape.charCodeAt(0)).toBeGreaterThan(0x20);
    }
  });

  it('matches the M7 spec: green=●, amber=▲, red=■, unknown=◇, missing=·', () => {
    expect(statusShape('green')).toBe('●');
    expect(statusShape('amber')).toBe('▲');
    expect(statusShape('red')).toBe('■');
    expect(statusShape('unknown')).toBe('◇');
    expect(statusShape('missing')).toBe('·');
  });
});

// Sub-44 cont'd architect ⚠️ closure (inline this turn) — direct
// contract test for the gate predicate. Without this, future variants
// added to the discriminated union would only be caught transitively
// via composite-score / alert-rules tests; here it's the bottleneck.
describe("isAggregateRollup (sub-44 cont'd discriminated-union gate)", () => {
  it("kind === 'op' → false (operational cell, contributes to composite + alerts)", () => {
    expect(isAggregateRollup({ kind: 'op' })).toBe(false);
  });

  it("kind === 'synthetic-rollup' → true (Turn 33.5 children-average; sub-group navigation row)", () => {
    expect(isAggregateRollup({ kind: 'synthetic-rollup' })).toBe(true);
  });

  it("kind === 'real-rollup' → true (sub-44 real parent-co rollup IV; sub-group navigation row)", () => {
    expect(isAggregateRollup({ kind: 'real-rollup' })).toBe(true);
  });

  it('kind undefined → false (back-compat default = op; legacy cells without kind treated as operational)', () => {
    // Guards back-compat: cells emitted by the route before the
    // discriminated-union refactor (or by future ad-hoc producers that
    // don't set kind) MUST be treated as operational, not aggregates.
    // Otherwise composite + alerts would silently exclude all such
    // cells (catastrophic).
    expect(isAggregateRollup({})).toBe(false);
    expect(isAggregateRollup({ kind: undefined })).toBe(false);
  });
});
