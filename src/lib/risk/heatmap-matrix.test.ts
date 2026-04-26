import { describe, it, expect } from 'vitest';
import {
  cellKey,
  buildCellMap,
  summarizeMatrix,
  statusColor,
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
