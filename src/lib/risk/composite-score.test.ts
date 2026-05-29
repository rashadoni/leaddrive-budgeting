/**
 * Phase C5 — composite risk score tests.
 *
 * Locks in:
 *   - All-green → score 100, band green
 *   - All-red → score 0, band red
 *   - All-amber → score 50, band amber
 *   - Mixed → weighted average rounded
 *   - All-unknown / missing → score null, band 'unknown', contributingCount 0
 *   - Mix of scoreable + unknown → average over scoreable only
 *   - Band thresholds: 67 → green, 66 → amber; 34 → amber, 33 → red
 *   - totalCount + contributingCount tracked separately
 */

import { describe, it, expect } from 'vitest';
import {
  computeCompositeScore,
  computeCompositeByCompany,
  scoreToBand,
  RISK_TAG_PENALTY_TABLE,
} from './composite-score';
import { isAggregateRollup, type HeatMapCell } from './heatmap-matrix';

function cell(status: HeatMapCell['status']): HeatMapCell {
  return {
    companyId: 'c',
    indicatorId: `ind-${Math.random()}`,
    value: 0,
    status,
  };
}

describe('computeCompositeScore (Phase C5)', () => {
  it('all-green → score 100, band green', () => {
    const result = computeCompositeScore([cell('green'), cell('green')]);
    expect(result.score).toBe(100);
    expect(result.band).toBe('green');
    expect(result.contributingCount).toBe(2);
    expect(result.totalCount).toBe(2);
  });

  it('all-red → score 0, band red', () => {
    const result = computeCompositeScore([cell('red'), cell('red'), cell('red')]);
    expect(result.score).toBe(0);
    expect(result.band).toBe('red');
  });

  it('all-amber → score 50, band amber', () => {
    const result = computeCompositeScore([cell('amber'), cell('amber')]);
    expect(result.score).toBe(50);
    expect(result.band).toBe('amber');
  });

  it('mixed: 1g+1r → 50, amber band', () => {
    const result = computeCompositeScore([cell('green'), cell('red')]);
    expect(result.score).toBe(50);
    expect(result.band).toBe('amber');
  });

  it('mixed: 2g+1r → round((100+100+0)/3) = 67 → green band', () => {
    const result = computeCompositeScore([
      cell('green'),
      cell('green'),
      cell('red'),
    ]);
    expect(result.score).toBe(67);
    expect(result.band).toBe('green');
  });

  it('mixed: 1g+2r → round((100+0+0)/3) = 33 → red band', () => {
    const result = computeCompositeScore([
      cell('green'),
      cell('red'),
      cell('red'),
    ]);
    expect(result.score).toBe(33);
    expect(result.band).toBe('red');
  });

  it('all-unknown → score null, band unknown, contributingCount 0', () => {
    const result = computeCompositeScore([
      cell('unknown'),
      cell('unknown'),
    ]);
    expect(result.score).toBeNull();
    expect(result.band).toBe('unknown');
    expect(result.contributingCount).toBe(0);
    expect(result.totalCount).toBe(2);
  });

  it('mix scoreable + unknown → average over scoreable only', () => {
    const result = computeCompositeScore([
      cell('green'), // 100
      cell('unknown'), // ignored (no DB-emitted "missing"; unknown is the catch-all)
      cell('red'), // 0
      cell('unknown'), // ignored
    ]);
    // Avg over (green, red) = (100+0)/2 = 50
    expect(result.score).toBe(50);
    expect(result.contributingCount).toBe(2);
    expect(result.totalCount).toBe(4);
  });

  it('empty cells → score null, totalCount 0', () => {
    const result = computeCompositeScore([]);
    expect(result.score).toBeNull();
    expect(result.band).toBe('unknown');
    expect(result.contributingCount).toBe(0);
    expect(result.totalCount).toBe(0);
  });
});

describe('REGRESSION: sub-group rollup-cell exclusion (architect Round-1 ⚠️ closure)', () => {
  // The HeatMap-level useMemo `compositeByCompany` is responsible for
  // filtering out rollup cells before calling computeCompositeScore.
  // This test documents the contract: the helper itself does NOT
  // filter — it averages whatever cells it gets. Caller must pre-filter.
  it('helper averages all input cells regardless of isSubgroupRollup flag (caller responsibility)', () => {
    const cells: HeatMapCell[] = [
      { ...cell('green') },
      { ...cell('red'), kind: 'synthetic-rollup' as const}, // would skew avg if not pre-filtered
    ];
    const result = computeCompositeScore(cells);
    // Helper sees both → avg = 50, NOT 100. This proves caller filtering
    // is the contract — composite-score.ts stays a pure averager.
    expect(result.score).toBe(50);
  });

  it('caller filtering pattern: passing only non-rollup cells gives accurate score', () => {
    const allCells: HeatMapCell[] = [
      { ...cell('green') },
      { ...cell('green') },
      { ...cell('green') },
      { ...cell('green') },
      { ...cell('red'), kind: 'synthetic-rollup' as const}, // pretend this is sub-group worst-of
    ];
    // Caller filter — what HeatMap.compositeByCompany does:
    const filtered = allCells.filter((c) => !isAggregateRollup(c));
    const result = computeCompositeScore(filtered);
    // 4 green + 0 red = 100 (NOT 80 from including the rollup cell)
    expect(result.score).toBe(100);
    expect(result.band).toBe('green');
  });
});

describe('computeCompositeByCompany — shared HeatMap + Board Deck aggregator', () => {
  // Architect Round-1 sub-12 ⚠️ closure: this helper consolidates the
  // composite-by-company loop that was duplicated across HeatMap.tsx
  // and board-deck/page.tsx. Tests lock both modes (sparse vs dense).
  function cellWith(companyId: string, status: HeatMapCell['status']): HeatMapCell {
    return {
      companyId,
      indicatorId: `ind-${Math.random()}`,
      value: 0,
      status,
    };
  }

  it('sparse mode (no companyIds): only companies with cells appear', () => {
    const cells: HeatMapCell[] = [
      cellWith('co_a', 'green'),
      cellWith('co_a', 'red'),
      cellWith('co_b', 'amber'),
    ];
    const result = computeCompositeByCompany(cells);
    expect(result.size).toBe(2);
    expect(result.get('co_a')?.score).toBe(50);
    expect(result.get('co_b')?.score).toBe(50);
    expect(result.has('co_c')).toBe(false);
  });

  it('dense mode (companyIds arg): every listed id appears, missing → null score', () => {
    const cells: HeatMapCell[] = [
      cellWith('co_a', 'green'),
      cellWith('co_a', 'green'),
    ];
    const result = computeCompositeByCompany(cells, ['co_a', 'co_b', 'co_c']);
    expect(result.size).toBe(3);
    expect(result.get('co_a')?.score).toBe(100);
    // co_b + co_c had no cells → null score, unknown band.
    expect(result.get('co_b')?.score).toBeNull();
    expect(result.get('co_b')?.band).toBe('unknown');
    expect(result.get('co_c')?.score).toBeNull();
  });

  it('skips isSubgroupRollup cells before grouping (sub-8 invariant)', () => {
    const cells: HeatMapCell[] = [
      cellWith('co_a', 'green'),
      cellWith('co_a', 'green'),
      // Synthetic rollup row that should NOT contribute to the average.
      { ...cellWith('co_a', 'red'), kind: 'synthetic-rollup' as const},
    ];
    const result = computeCompositeByCompany(cells);
    // 2 green + 0 red (rollup skipped) = 100, NOT 67 (which would be
    // (100+100+0)/3 if rollup leaked through).
    expect(result.get('co_a')?.score).toBe(100);
  });

  it('dense mode + sub-group: rollup-only sub-group → empty cells → null score', () => {
    // Sub-group row only has `isSubgroupRollup: true` cells (the matrix
    // endpoint emits these for level=1 wrappers). After filter the
    // sub-group has zero cells; dense mode returns score=null.
    const cells: HeatMapCell[] = [
      cellWith('co_a', 'green'),
      { ...cellWith('subgroup_x', 'amber'), kind: 'synthetic-rollup' as const},
    ];
    const result = computeCompositeByCompany(cells, ['co_a', 'subgroup_x']);
    expect(result.get('co_a')?.score).toBe(100);
    expect(result.get('subgroup_x')?.score).toBeNull();
    expect(result.get('subgroup_x')?.band).toBe('unknown');
  });

  it('sub-44 cont\'d: skips isRealParentRollup cells (gate-via-isAggregateRollup invariant)', () => {
    // Sub-44 cont'd render-path adds REAL parent-co rollup IVs
    // (`isRealParentRollup: true`) alongside synthetic Turn 33.5 rollups.
    // Composite scoring MUST skip BOTH variants — locked via the shared
    // `isAggregateRollup` helper. Without this gate, a sub-group with a
    // single real-rollup IV would compute a meaningful composite (e.g.
    // 100/green) which violates the documented "sub-groups are
    // navigation rollups, not measurable entities" invariant.
    const cells: HeatMapCell[] = [
      cellWith('co_a', 'green'),
      cellWith('co_a', 'green'),
      // Real parent IV from sub-44 prereq #1 — would skew the composite
      // if not filtered. Distinct id so its presence in `byCo` would be
      // observable.
      {
        ...cellWith('subgroup_x', 'green'),
        indicatorValueId: 'iv_real_holding_revenue',
        kind: 'real-rollup' as const,
      },
    ];
    const result = computeCompositeByCompany(cells, ['co_a', 'subgroup_x']);
    expect(result.get('co_a')?.score).toBe(100);
    // Sub-group's only cell was a real-rollup → filtered → empty → null.
    // Without the isAggregateRollup gate, this would be 100/green (LEAK).
    expect(result.get('subgroup_x')?.score).toBeNull();
    expect(result.get('subgroup_x')?.band).toBe('unknown');
  });

  it("sub-44 cont'd: BOTH rollup variants on same sub-group both skipped", () => {
    // Defensive: ensure neither isSubgroupRollup nor isRealParentRollup
    // contributes to the composite, even when both appear on the same
    // sub-group row (e.g. one indicator has Turn 33.5 average, another
    // has a real rollup IV).
    const cells: HeatMapCell[] = [
      { ...cellWith('subgroup_x', 'red'), kind: 'synthetic-rollup' as const},
      {
        ...cellWith('subgroup_x', 'green'),
        indicatorValueId: 'iv_real',
        kind: 'real-rollup' as const,
      },
    ];
    const result = computeCompositeByCompany(cells, ['subgroup_x']);
    expect(result.get('subgroup_x')?.score).toBeNull();
    expect(result.get('subgroup_x')?.band).toBe('unknown');
  });
});

describe('scoreToBand (Phase C5)', () => {
  it('100 → green', () => {
    expect(scoreToBand(100)).toBe('green');
  });

  it('67 → green (lower edge)', () => {
    expect(scoreToBand(67)).toBe('green');
  });

  it('66 → amber (just below green)', () => {
    expect(scoreToBand(66)).toBe('amber');
  });

  it('50 → amber (mid-band)', () => {
    expect(scoreToBand(50)).toBe('amber');
  });

  it('34 → amber (lower edge)', () => {
    expect(scoreToBand(34)).toBe('amber');
  });

  it('33 → red (just below amber)', () => {
    expect(scoreToBand(33)).toBe('red');
  });

  it('0 → red', () => {
    expect(scoreToBand(0)).toBe('red');
  });
});

describe('Phase 7.N C5 v2 — weighted composite', () => {
  function wcell(
    status: HeatMapCell['status'],
    weight: number,
    id?: string,
  ): HeatMapCell {
    return {
      companyId: 'c',
      indicatorId: id ?? `ind-${Math.random()}`,
      value: 0,
      status,
      weight,
    };
  }

  it('equal weights behave identically to unweighted average', () => {
    // 1g + 1r with weight=1 → (100×1 + 0×1) / 2 = 50 → amber
    const result = computeCompositeScore([wcell('green', 1.0), wcell('red', 1.0)]);
    expect(result.score).toBe(50);
    expect(result.band).toBe('amber');
  });

  it('high-weight red pulls score lower than low-weight red', () => {
    // Scenario A: 1g(w=1.5) + 1r(w=0.7)
    //   = (100×1.5 + 0×0.7) / (1.5+0.7) = 150/2.2 ≈ 68 → green
    const a = computeCompositeScore([wcell('green', 1.5), wcell('red', 0.7)]);
    // Scenario B: 1g(w=0.7) + 1r(w=1.5)
    //   = (100×0.7 + 0×1.5) / (0.7+1.5) = 70/2.2 ≈ 32 → red
    const b = computeCompositeScore([wcell('green', 0.7), wcell('red', 1.5)]);
    expect(a.score).toBeGreaterThan(b.score!);
    expect(a.band).toBe('green');
    expect(b.band).toBe('red');
  });

  it('cells without weight field treated as 1.0 (back-compat)', () => {
    // 1 unweighted green + 1 unweighted red → same as weight=1 both
    const cellA = cell('green'); // no weight field
    const cellB = cell('red');   // no weight field
    const r1 = computeCompositeScore([cellA, cellB]);
    const r2 = computeCompositeScore([wcell('green', 1.0), wcell('red', 1.0)]);
    expect(r1.score).toBe(r2.score);
  });

  it('single heavy-weight red among many greens drags composite below unweighted result', () => {
    // 4g(w=1.0) + 1r(w=1.5) → weighted = (400+0)/(4+1.5) = 400/5.5 ≈ 73 → green
    // vs unweighted: (400+0)/5 = 80 → green
    // The point: red at 1.5 contributes proportionally more than at 1.0
    const weighted = computeCompositeScore([
      wcell('green', 1.0), wcell('green', 1.0), wcell('green', 1.0), wcell('green', 1.0),
      wcell('red', 1.5),
    ]);
    const unweighted = computeCompositeScore([
      wcell('green', 1.0), wcell('green', 1.0), wcell('green', 1.0), wcell('green', 1.0),
      wcell('red', 1.0),
    ]);
    expect(weighted.score).toBeLessThan(unweighted.score!);
  });

  it('unknown cells excluded from weighted sum AND from total weight denominator', () => {
    // 1g(w=1.4) + 1unknown(w=1.4) → score = 100×1.4 / 1.4 = 100 (unknown excluded)
    const result = computeCompositeScore([wcell('green', 1.4), wcell('unknown', 1.4)]);
    expect(result.score).toBe(100);
    expect(result.contributingCount).toBe(1);
    expect(result.totalCount).toBe(2);
  });
});

describe('Phase 7.N — riskTag composite penalty', () => {
  it('no riskTags → no penalty, no scoreBeforeTags/riskTagPenalty fields', () => {
    const r = computeCompositeScore([cell('green'), cell('green')]);
    expect(r.score).toBe(100);
    expect(r.scoreBeforeTags).toBeUndefined();
    expect(r.riskTagPenalty).toBeUndefined();
  });

  it('subsidy_dependency penalises -5 (matches live AZSEKER-EDEN diff)', () => {
    // all-green base = 100; EDEN observed 57/57 vs penalised 52 on real
    // data — the -5 delta is the subsidy_dependency tag.
    const r = computeCompositeScore([cell('green'), cell('green')], ['subsidy_dependency']);
    expect(r.score).toBe(95);
    expect(r.scoreBeforeTags).toBe(100);
    expect(r.riskTagPenalty).toBe(5);
  });

  it('non_transparent_structure penalises -8', () => {
    const r = computeCompositeScore([cell('green')], ['non_transparent_structure']);
    expect(r.score).toBe(92);
    expect(r.riskTagPenalty).toBe(8);
  });

  it('data_absence penalises -12', () => {
    const r = computeCompositeScore([cell('green')], ['data_absence']);
    expect(r.score).toBe(88);
    expect(r.riskTagPenalty).toBe(12);
  });

  it('stacked non_transparent + data_absence = -20 (matches live AZSEKER-AZSF diff)', () => {
    // AZSF observed 30 (penalised) vs 50 (unpenalised) on real data → -20.
    const r = computeCompositeScore(
      [cell('green'), cell('green')],
      ['non_transparent_structure', 'data_absence'],
    );
    expect(r.riskTagPenalty).toBe(20);
    expect(r.score).toBe(80);
  });

  it('stacked subsidy + non_transparent = -13 (matches live AZSEKER-CPC diff)', () => {
    // CPC observed 49 (penalised) vs 62 (unpenalised) → -13.
    const r = computeCompositeScore(
      [cell('green')],
      ['subsidy_dependency', 'non_transparent_structure'],
    );
    expect(r.riskTagPenalty).toBe(13);
  });

  it('all three tags = max -25 penalty', () => {
    const r = computeCompositeScore(
      [cell('green')],
      ['subsidy_dependency', 'non_transparent_structure', 'data_absence'],
    );
    expect(r.riskTagPenalty).toBe(25);
    expect(r.score).toBe(75);
  });

  it('penalty floors the score at 0, never negative', () => {
    // all-red base = 0; -25 would be -25 but Math.max clamps to 0.
    const r = computeCompositeScore(
      [cell('red')],
      ['subsidy_dependency', 'non_transparent_structure', 'data_absence'],
    );
    expect(r.score).toBe(0);
    expect(r.scoreBeforeTags).toBe(0);
    expect(r.riskTagPenalty).toBe(25);
  });

  it('unrecognised tag strings contribute 0 penalty', () => {
    const r = computeCompositeScore([cell('green')], ['totally_made_up_tag']);
    expect(r.score).toBe(100);
    expect(r.scoreBeforeTags).toBeUndefined();
    expect(r.riskTagPenalty).toBeUndefined();
  });

  it('empty riskTags array → no penalty', () => {
    const r = computeCompositeScore([cell('green')], []);
    expect(r.score).toBe(100);
    expect(r.riskTagPenalty).toBeUndefined();
  });

  it('computeCompositeByCompany applies per-company penalties via the 3rd arg', () => {
    const coCell = (companyId: string, status: HeatMapCell['status']): HeatMapCell => ({
      companyId,
      indicatorId: `ind-${Math.random()}`,
      value: 0,
      status,
    });
    // co_a all-green (100) flagged data_absence → 88; co_b all-green, no
    // tags → 100. Proves the map routes each company's tags correctly.
    const cells = [
      coCell('co_a', 'green'),
      coCell('co_a', 'green'),
      coCell('co_b', 'green'),
      coCell('co_b', 'green'),
    ];
    const riskTagsByCompany = new Map<string, readonly string[]>([
      ['co_a', ['data_absence']],
    ]);
    const result = computeCompositeByCompany(cells, undefined, riskTagsByCompany);
    expect(result.get('co_a')?.score).toBe(88);
    expect(result.get('co_a')?.riskTagPenalty).toBe(12);
    expect(result.get('co_b')?.score).toBe(100);
    expect(result.get('co_b')?.riskTagPenalty).toBeUndefined();
  });

  it('RISK_TAG_PENALTY_TABLE exposes the canonical penalties and is frozen', () => {
    expect(RISK_TAG_PENALTY_TABLE).toEqual({
      data_absence: 12,
      non_transparent_structure: 8,
      subsidy_dependency: 5,
    });
    expect(Object.isFrozen(RISK_TAG_PENALTY_TABLE)).toBe(true);
  });
});
