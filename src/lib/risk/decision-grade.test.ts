/**
 * Phase 10 / Stage A6 — proof that stale or untraced values cannot look
 * decision-grade.
 *
 * The gate may only ever *withhold* decision-grade, never grant it. Each test
 * below is one way a number could have sneaked onto the screen wearing a
 * confident colour it had not earned.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyObservationGrade,
  summarizeSurfaceGrade,
  worstReason,
  DEFAULT_STALE_AFTER_MS,
} from './decision-grade';
import type { HeatMapCell } from './heatmap-matrix';

const NOW = Date.parse('2026-07-16T12:00:00.000Z');
const FRESH = new Date(NOW - 60 * 60 * 1000).toISOString(); // 1h ago
const OLD = new Date(NOW - 40 * 24 * 60 * 60 * 1000).toISOString(); // 40d ago

/** A cell that clears every gate — the only shape allowed to be decision-grade. */
function goodCell(over: Partial<HeatMapCell> = {}): HeatMapCell {
  return {
    companyId: 'co-1',
    indicatorId: 'ind-1',
    value: 42,
    status: 'green',
    computedAt: FRESH,
    lastReconciledAt: FRESH,
    revisionId: 'rev-1',
    signalConfidence: 'high',
    ...over,
  };
}

describe('decision-grade gate', () => {
  describe('the only path to decision-grade', () => {
    it('admits a fresh, traced, error-free coloured cell', () => {
      expect(classifyObservationGrade(goodCell(), NOW)).toEqual({
        grade: 'decision-grade',
        reasons: [],
      });
    });

    it.each(['green', 'amber', 'red'] as const)(
      'admits a clean %s cell — the gate is about trust, not about severity',
      (status) => {
        expect(classifyObservationGrade(goodCell({ status }), NOW).grade).toBe(
          'decision-grade',
        );
      },
    );
  });

  describe('stale values cannot look decision-grade', () => {
    it('demotes a cell computed beyond the freshness window', () => {
      const v = classifyObservationGrade(goodCell({ computedAt: OLD }), NOW);
      expect(v.grade).toBe('provisional');
      expect(v.reasons).toContain('stale');
    });

    it('treats a missing computedAt as stale, not as fresh', () => {
      // Absence of evidence is not evidence of freshness.
      for (const computedAt of [undefined, null]) {
        const v = classifyObservationGrade(goodCell({ computedAt }), NOW);
        expect(v.grade).toBe('provisional');
        expect(v.reasons).toContain('stale');
      }
    });

    it('treats an unparseable computedAt as stale', () => {
      const v = classifyObservationGrade(
        goodCell({ computedAt: 'not-a-date' }),
        NOW,
      );
      expect(v.reasons).toContain('stale');
    });

    it('holds the boundary: exactly at the window is still fresh, one ms past is not', () => {
      const at = new Date(NOW - DEFAULT_STALE_AFTER_MS).toISOString();
      const past = new Date(NOW - DEFAULT_STALE_AFTER_MS - 1).toISOString();
      expect(classifyObservationGrade(goodCell({ computedAt: at }), NOW).grade).toBe(
        'decision-grade',
      );
      expect(
        classifyObservationGrade(goodCell({ computedAt: past }), NOW).reasons,
      ).toContain('stale');
    });

    it('honours a caller-supplied window without touching the default', () => {
      const cell = goodCell({ computedAt: OLD });
      expect(
        classifyObservationGrade(cell, NOW, { staleAfterMs: 365 * 24 * 3600e3 })
          .grade,
      ).toBe('decision-grade');
      expect(classifyObservationGrade(cell, NOW).grade).toBe('provisional');
    });
  });

  describe('untraced values cannot look decision-grade', () => {
    it('demotes a cell with no revisionId once lineage is required', () => {
      const v = classifyObservationGrade(
        goodCell({ revisionId: null }),
        NOW,
        { requireLineage: true },
      );
      expect(v.grade).toBe('provisional');
      expect(v.reasons).toContain('no_lineage');
    });

    it('does not demote for lineage while the requirement is off — the documented default', () => {
      // 0 of 1,269 rows carry a revisionId (measured 2026-07-16), so a
      // default-on requirement would grey the entire product the moment this
      // module gained a caller. The stage that populates lineage flips this.
      const v = classifyObservationGrade(goodCell({ revisionId: null }), NOW);
      expect(v.grade).toBe('decision-grade');
      expect(v.reasons).not.toContain('no_lineage');
    });

    it('still admits a traced cell when lineage is required', () => {
      expect(
        classifyObservationGrade(goodCell(), NOW, { requireLineage: true }).grade,
      ).toBe('decision-grade');
    });

    it('does not accept a reconciliation stamp as lineage', () => {
      // The conflation this test exists to prevent: lastReconciledAt answers
      // "was it checked against source?", revisionId answers "where did it come
      // from?". One must never stand in for the other.
      const v = classifyObservationGrade(
        goodCell({ revisionId: null, lastReconciledAt: FRESH }),
        NOW,
        { requireLineage: true },
      );
      expect(v.grade).toBe('provisional');
      expect(v.reasons).toContain('no_lineage');
    });

    it('lineage alone does not make a cell decision-grade', () => {
      // B5's whole caveat: a revisionId is evidence, not a verdict. A traced
      // but stale cell stays provisional.
      const v = classifyObservationGrade(
        goodCell({ revisionId: 'rev-9', computedAt: OLD }),
        NOW,
        { requireLineage: true },
      );
      expect(v.grade).toBe('provisional');
      expect(v.reasons).toContain('stale');
      expect(v.reasons).not.toContain('no_lineage');
    });
  });

  describe('unreliable and errored values cannot look decision-grade', () => {
    it('demotes a cell carrying a recompute error', () => {
      const v = classifyObservationGrade(
        goodCell({ error: { code: 'non_finite', reason: 'x' } }),
        NOW,
      );
      expect(v.grade).toBe('provisional');
      expect(v.reasons).toContain('calculation_error');
    });

    it('demotes a cell the zombie guard flagged low', () => {
      const v = classifyObservationGrade(
        goodCell({ signalConfidence: 'low' }),
        NOW,
      );
      expect(v.grade).toBe('provisional');
      expect(v.reasons).toContain('unreliable_signal');
    });

    it('leaves medium confidence decision-grade — indicative is not untrustworthy', () => {
      expect(
        classifyObservationGrade(goodCell({ signalConfidence: 'medium' }), NOW)
          .grade,
      ).toBe('decision-grade');
    });
  });

  describe('non-observations are never decision-grade', () => {
    it.each(['unknown', 'na', 'missing'] as const)(
      'refuses status %s',
      (status) => {
        const v = classifyObservationGrade(
          goodCell({ status: status as HeatMapCell['status'] }),
          NOW,
        );
        expect(v.grade).toBe('provisional');
        expect(v.reasons).toEqual(['no_observation']);
      },
    );

    it('refuses an absent cell', () => {
      expect(classifyObservationGrade(undefined, NOW)).toEqual({
        grade: 'provisional',
        reasons: ['no_observation'],
      });
    });

    it('refuses a fresh, traced cell whose status is unknown', () => {
      // The trap from the original bug report: `AGRO_YIELD: 0 [unknown]` read
      // as a real, alarming zero. Perfect provenance must not rescue a non-signal.
      const v = classifyObservationGrade(goodCell({ status: 'unknown' }), NOW);
      expect(v.grade).toBe('provisional');
    });
  });

  describe('reasons accumulate and rank', () => {
    it('reports every failed rule, not just the first', () => {
      const v = classifyObservationGrade(
        goodCell({
          computedAt: OLD,
          revisionId: null,
          signalConfidence: 'low',
          error: { code: 'eval', reason: 'x' },
        }),
        NOW,
        { requireLineage: true },
      );
      expect(v.reasons).toEqual([
        'calculation_error',
        'unreliable_signal',
        'no_lineage',
        'stale',
      ]);
    });

    it('ranks worst-first for a one-slot label', () => {
      expect(worstReason(['stale', 'calculation_error'])).toBe('calculation_error');
      expect(worstReason(['stale', 'no_lineage'])).toBe('no_lineage');
      expect(worstReason(['stale'])).toBe('stale');
      expect(worstReason([])).toBeNull();
    });
  });

  describe('surface summary', () => {
    it('counts only coloured cells — neutrals are not a trust problem', () => {
      const s = summarizeSurfaceGrade(
        [
          goodCell(),
          goodCell({ status: 'unknown' }),
          goodCell({ status: 'na' as HeatMapCell['status'] }),
        ],
        NOW,
      );
      expect(s).toEqual({
        coloured: 1,
        decisionGrade: 1,
        provisional: 0,
        hasProvisional: false,
        allProvisional: false,
      });
    });

    it('reports the real state of this database: every coloured cell untraced', () => {
      // The measured 2026-07-16 shape — 498/498 coloured cells with no lineage.
      const cells = [
        goodCell({ revisionId: null }),
        goodCell({ status: 'red', revisionId: null }),
      ];
      const s = summarizeSurfaceGrade(cells, NOW, { requireLineage: true });
      expect(s.coloured).toBe(2);
      expect(s.decisionGrade).toBe(0);
      expect(s.provisional).toBe(2);
      expect(s.allProvisional).toBe(true);
    });

    it('separates "some" from "all" — a partial surface must not claim total distrust', () => {
      const s = summarizeSurfaceGrade(
        [goodCell(), goodCell({ status: 'red', computedAt: OLD })],
        NOW,
      );
      expect(s).toMatchObject({
        coloured: 2,
        decisionGrade: 1,
        provisional: 1,
        hasProvisional: true,
        allProvisional: false,
      });
    });

    it('does not call an empty matrix provisional — there is nothing to qualify', () => {
      const s = summarizeSurfaceGrade([], NOW);
      expect(s.hasProvisional).toBe(false);
      expect(s.allProvisional).toBe(false);
    });
  });

  describe('the gate changes no financial value', () => {
    it('never reads or mutates the cell value', () => {
      const cell = goodCell({ value: 1234.5, computedAt: OLD });
      const snapshot = JSON.parse(JSON.stringify(cell));
      classifyObservationGrade(cell, NOW);
      summarizeSurfaceGrade([cell], NOW);
      expect(cell).toEqual(snapshot);
      // A demoted cell keeps its number; only its presentation changes.
      expect(cell.value).toBe(1234.5);
    });
  });
});

/**
 * Phase 10 / Stage B5 review closure — lineage is necessary, not sufficient.
 *
 * These tests exist because a real defect got this far: once B5 gave imports a
 * writer, `requireLineage: true` alone would have certified every freshly
 * imported cell as decision-grade — never reconciled, never coverage-checked.
 * The gate must refuse that.
 */
describe('classifyObservationGrade — revisionId alone does not certify', () => {
  const freshTracedCell = {
    companyId: 'c1',
    indicatorId: 'i1',
    value: 42,
    status: 'green' as const,
    valueSource: 'computed' as const,
    signalConfidence: 'high' as const,
    revisionId: 'rev_1',
    computedAt: new Date().toISOString(),
  };

  it('a freshly imported, fully traced cell is STILL provisional — it was never reconciled', () => {
    const verdict = classifyObservationGrade(freshTracedCell, Date.now(), {
      requireLineage: true,
      requireReconciliation: true,
    });
    expect(verdict.grade).toBe('provisional');
    expect(verdict.reasons).toContain('no_reconciliation');
    // Lineage is genuinely satisfied — that is the point. It just isn't enough.
    expect(verdict.reasons).not.toContain('no_lineage');
  });

  it('names lineage and reconciliation as separate failures', () => {
    const verdict = classifyObservationGrade(
      { ...freshTracedCell, revisionId: undefined },
      Date.now(),
      { requireLineage: true, requireReconciliation: true },
    );
    expect(verdict.reasons).toContain('no_lineage');
    expect(verdict.reasons).toContain('no_reconciliation');
  });

  it('certifies only when BOTH lineage and reconciliation are present and it is fresh', () => {
    const verdict = classifyObservationGrade(
      { ...freshTracedCell, lastReconciledAt: new Date().toISOString() },
      Date.now(),
      { requireLineage: true, requireReconciliation: true },
    );
    expect(verdict.grade).toBe('decision-grade');
    expect(verdict.reasons).toEqual([]);
  });

  it('a reconciled but untraced cell is provisional — reconciliation is not provenance', () => {
    const verdict = classifyObservationGrade(
      {
        ...freshTracedCell,
        revisionId: undefined,
        lastReconciledAt: new Date().toISOString(),
      },
      Date.now(),
      { requireLineage: true, requireReconciliation: true },
    );
    expect(verdict.grade).toBe('provisional');
    expect(verdict.reasons).toEqual(['no_lineage']);
  });

  it('requireReconciliation defaults off — no caller is demoted by upgrading', () => {
    const verdict = classifyObservationGrade(freshTracedCell, Date.now(), {
      requireLineage: true,
    });
    expect(verdict.reasons).not.toContain('no_reconciliation');
  });

  it('ranks no_lineage above no_reconciliation when both fail', () => {
    expect(worstReason(['no_reconciliation', 'no_lineage'])).toBe('no_lineage');
  });
});
