/**
 * Phase C slice C3.1 — cost-sign classifier tests.
 *
 * Locks the Codex-flagged adversarial cases: a small refund row is tolerated,
 * a single huge contra/outlier row does NOT flip the verdict (→ ambiguous),
 * and near-50:50 mixes are ambiguous (→ review gate blocks).
 */
import { describe, it, expect } from 'vitest';
import { classifyCostSign } from './sign-infer';

describe('classifyCostSign', () => {
  it('all-negative costs → negative_costs (today\'s AZ convention)', () => {
    expect(classifyCostSign([-100, -200, -50]).convention).toBe('negative_costs');
  });

  it('all-positive costs → positive_costs (debit convention)', () => {
    expect(classifyCostSign([100, 200, 50]).convention).toBe('positive_costs');
  });

  it('no rows / all zero → no_evidence', () => {
    expect(classifyCostSign([]).convention).toBe('no_evidence');
    expect(classifyCostSign([0, 0, 0]).convention).toBe('no_evidence');
  });

  it('tolerates a small refund row in a negative-cost section', () => {
    // 4 negative rows (Σabs 1000) + one +50 refund (5% by value) → still negative.
    expect(classifyCostSign([-250, -250, -250, -250, 50]).convention).toBe('negative_costs');
  });

  it('a single huge positive outlier among many negatives → ambiguous (not positive)', () => {
    // abs-share would say positive (+5000 vs Σ-1000), but row-count majority is
    // negative (10 vs 1) → disagreement → ambiguous → blocked for review.
    const vals = [-100, -100, -100, -100, -100, -100, -100, -100, -100, -100, 5000];
    expect(classifyCostSign(vals).convention).toBe('ambiguous');
  });

  it('near-50:50 mix → ambiguous', () => {
    expect(classifyCostSign([-100, -100, 100, 90]).convention).toBe('ambiguous');
  });

  it('positive costs with a small negative correction → positive_costs', () => {
    expect(classifyCostSign([250, 250, 250, 250, -40]).convention).toBe('positive_costs');
  });

  it('evidence reports row counts + abs sums', () => {
    const { evidence } = classifyCostSign([-100, -200, 50]);
    expect(evidence.negRows).toBe(2);
    expect(evidence.posRows).toBe(1);
    expect(evidence.negAbs).toBe(300);
    expect(evidence.posAbs).toBe(50);
    expect(evidence.netSum).toBe(-250);
  });
});
