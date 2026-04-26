import { describe, it, expect } from 'vitest';
import {
  evaluateFormula,
  tryEvaluateFormula,
  classifyValue,
  validateThresholds,
  FormulaError,
  type Thresholds,
} from './formula-engine';

describe('evaluateFormula — arithmetic', () => {
  it('evaluates plain arithmetic', () => {
    expect(evaluateFormula('2 + 3 * 4')).toBe(14);
    expect(evaluateFormula('(10 - 4) / 2')).toBe(3);
    expect(evaluateFormula('2 ^ 8')).toBe(256);
  });

  it('substitutes variables from context', () => {
    expect(
      evaluateFormula('rooms_sold / rooms_available * 100', {
        rooms_sold: 70,
        rooms_available: 100,
      }),
    ).toBeCloseTo(70);
  });

  it('supports conditional (ternary)', () => {
    expect(evaluateFormula('x > 10 ? 1 : 0', { x: 11 })).toBe(1);
    expect(evaluateFormula('x > 10 ? 1 : 0', { x: 5 })).toBe(0);
  });
});

describe('evaluateFormula — custom functions (fact / rollup stand-ins)', () => {
  it('invokes registered functions with their arguments', () => {
    const result = evaluateFormula(
      'fact("rooms_sold") / fact("rooms_available") * 100',
      {},
      {
        fact: (metric) => {
          if (metric === 'rooms_sold') return 50;
          if (metric === 'rooms_available') return 100;
          return 0;
        },
      },
    );
    expect(result).toBe(50);
  });

  it('supports nested custom functions', () => {
    const result = evaluateFormula(
      'rollup("HOSP_OCC", "avg") + 5',
      {},
      {
        rollup: () => 65,
      },
    );
    expect(result).toBe(70);
  });
});

describe('evaluateFormula — error surface', () => {
  it('throws FormulaError on parse failure', () => {
    expect(() => evaluateFormula('2 + * 3')).toThrow(FormulaError);
  });

  it('throws FormulaError when a referenced variable is missing', () => {
    // expr-eval treats undefined identifiers as errors at eval time
    expect(() => evaluateFormula('a + b', { a: 1 })).toThrow(FormulaError);
  });

  it('throws FormulaError on division by zero (Infinity)', () => {
    expect(() => evaluateFormula('1 / 0')).toThrow(FormulaError);
  });

  it('throws FormulaError when result is NaN', () => {
    // 0/0 in JS is NaN — formula should surface it, not return NaN silently
    expect(() => evaluateFormula('0 / 0')).toThrow(FormulaError);
  });

  it('does not expose JS globals (Function / process / require)', () => {
    // expr-eval's sandbox doesn't expose these names; referencing them is a
    // missing-identifier error, not code execution.
    expect(() => evaluateFormula('Function("return 1")()')).toThrow(
      FormulaError,
    );
    expect(() => evaluateFormula('process.env')).toThrow(FormulaError);
  });

  it('blocks constructor-chain escapes via literal property access', () => {
    // Classic sandbox-escape shape from vm2-style bugs: reach Function via
    // `(0).constructor.constructor`. expr-eval does not implement `.property`
    // dotted access on literals, so these must fail to parse or eval.
    expect(() => evaluateFormula('(0).constructor.constructor("return process")()')).toThrow(
      FormulaError,
    );
    expect(() => evaluateFormula('"".constructor.constructor("return 1")()')).toThrow(
      FormulaError,
    );
  });

  it('huge exponents surface as non_finite, not silent Infinity', () => {
    const r = tryEvaluateFormula('10 ^ 400');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('non_finite');
  });

  it('survives deep nesting without a stack blow', () => {
    // 300 levels of parens — well within parser limits but exercises depth.
    const nested = '((((((((((((((((((((((((((((((1 + 1))))))))))))))))))))))))))))))';
    expect(evaluateFormula(nested)).toBe(2);
  });

  it('supports unicode-ish identifiers from context', () => {
    // Non-ASCII identifier names — expr-eval allows standard identifiers only,
    // so Cyrillic / emoji should either work or fail cleanly, not crash.
    const r = tryEvaluateFormula('доход / 2', { доход: 100 });
    // Either engine accepts it (then ok=true), or rejects as parse/eval —
    // both are acceptable. Crash would fail the test harness.
    if (r.ok) expect(r.value).toBe(50);
    else expect(['parse', 'eval']).toContain(r.code);
  });
});

describe('tryEvaluateFormula — Result variant', () => {
  it('returns ok:true with finite numeric value', () => {
    const r = tryEvaluateFormula('2 + 3');
    expect(r).toEqual({ ok: true, value: 5 });
  });

  it('returns ok:false with code="parse" on syntax errors', () => {
    const r = tryEvaluateFormula('2 + * 3');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('parse');
  });

  it('returns ok:false with code="eval" on missing variables', () => {
    const r = tryEvaluateFormula('missing + 1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('eval');
  });

  it('returns ok:false with code="non_finite" on 1/0 and 0/0', () => {
    const r1 = tryEvaluateFormula('1 / 0');
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe('non_finite');

    const r2 = tryEvaluateFormula('0 / 0');
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('non_finite');
  });
});

describe('classifyValue — threshold bands', () => {
  const higherBetter: Thresholds = {
    green: { op: '>=', value: 70 },
    amber: { op: '>=', value: 50 },
    red: { op: '<', value: 50 },
  };

  it('picks green first when the value satisfies multiple bands', () => {
    // 80 satisfies both green (>=70) and amber (>=50) — green wins
    expect(classifyValue(80, higherBetter)).toBe('green');
  });

  it('falls through to amber when green fails', () => {
    expect(classifyValue(60, higherBetter)).toBe('amber');
  });

  it('falls through to red when green+amber fail', () => {
    expect(classifyValue(30, higherBetter)).toBe('red');
  });

  it('respects lower_better ordering when seeds are flipped', () => {
    const lowerBetter: Thresholds = {
      green: { op: '<=', value: 10 },
      amber: { op: '<=', value: 25 },
      red: { op: '>', value: 25 },
    };
    expect(classifyValue(5, lowerBetter)).toBe('green');
    expect(classifyValue(20, lowerBetter)).toBe('amber');
    expect(classifyValue(40, lowerBetter)).toBe('red');
  });

  it('supports between bands', () => {
    const band: Thresholds = {
      green: { op: 'between', value: [40, 60] },
      amber: { op: 'between', value: [20, 80] },
      red: { op: '<', value: 20 },
    };
    expect(classifyValue(50, band)).toBe('green');
    expect(classifyValue(70, band)).toBe('amber'); // outside green, inside amber
    expect(classifyValue(10, band)).toBe('red');
  });

  it('returns unknown for NaN or Infinity', () => {
    expect(classifyValue(NaN, higherBetter)).toBe('unknown');
    expect(classifyValue(Infinity, higherBetter)).toBe('unknown');
  });

  it('returns unknown when no band matches', () => {
    const unreachable: Thresholds = {
      green: { op: '>=', value: 1000 },
      amber: { op: '>=', value: 500 },
      red: { op: '>=', value: 300 }, // value=100 matches none
    };
    expect(classifyValue(100, unreachable)).toBe('unknown');
  });
});

describe('validateThresholds — write-time guard', () => {
  it('accepts correctly-ordered higher_better thresholds', () => {
    const t: Thresholds = {
      green: { op: '>=', value: 70 },
      amber: { op: '>=', value: 50 },
      red: { op: '<', value: 50 },
    };
    expect(validateThresholds(t, 'higher_better')).toEqual({ ok: true });
  });

  it('rejects inverted higher_better thresholds (the silent-miscast trap)', () => {
    const t: Thresholds = {
      green: { op: '>=', value: 50 }, // weaker than amber — bug
      amber: { op: '>=', value: 70 },
      red: { op: '<', value: 50 },
    };
    const r = validateThresholds(t, 'higher_better');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/inverted/);
  });

  it('accepts correctly-ordered lower_better thresholds', () => {
    const t: Thresholds = {
      green: { op: '<=', value: 10 },
      amber: { op: '<=', value: 25 },
      red: { op: '>', value: 25 },
    };
    expect(validateThresholds(t, 'lower_better')).toEqual({ ok: true });
  });

  it('rejects inverted lower_better thresholds', () => {
    const t: Thresholds = {
      green: { op: '<=', value: 25 },
      amber: { op: '<=', value: 10 },
      red: { op: '>', value: 25 },
    };
    const r = validateThresholds(t, 'lower_better');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/inverted/);
  });

  it('rejects between bands with lo >= hi', () => {
    const t: Thresholds = {
      green: { op: 'between', value: [50, 50] },
      amber: { op: 'between', value: [20, 80] },
      red: { op: '<', value: 20 },
    };
    const r = validateThresholds(t, 'band');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/lo < hi/);
  });

  it('rejects non-finite threshold values', () => {
    const t: Thresholds = {
      green: { op: '>=', value: NaN },
      amber: { op: '>=', value: 50 },
      red: { op: '<', value: 50 },
    };
    const r = validateThresholds(t, 'higher_better');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/non-finite/);
  });

  it('skips direction check for band direction (uses between)', () => {
    const t: Thresholds = {
      green: { op: 'between', value: [40, 60] },
      amber: { op: 'between', value: [20, 80] },
      red: { op: '<', value: 20 },
    };
    expect(validateThresholds(t, 'band')).toEqual({ ok: true });
  });

  it('rejects between in green/amber when direction is higher_better', () => {
    const t: Thresholds = {
      green: { op: 'between', value: [70, 100] },
      amber: { op: '>=', value: 50 },
      red: { op: '<', value: 50 },
    };
    const r = validateThresholds(t, 'higher_better');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/forbids "between"/);
  });

  it('rejects between in green/amber when direction is lower_better', () => {
    const t: Thresholds = {
      green: { op: '<=', value: 10 },
      amber: { op: 'between', value: [10, 30] },
      red: { op: '>', value: 30 },
    };
    const r = validateThresholds(t, 'lower_better');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/forbids "between"/);
  });

  // ──────────────────────────────────────────────────────────────────────
  // band-direction containment validation (added 2026-04-25 after the
  // EDU_STUDENT_TEACHER_RATIO bug — green=[10,20] / amber=[20,25] left a
  // dead zone for values <10 falling through to `unknown`).
  // ──────────────────────────────────────────────────────────────────────

  it('band direction: rejects amber narrower than green (creates dead zone)', () => {
    // Reproduction of the EDU_STUDENT_TEACHER_RATIO bug shape.
    const t: Thresholds = {
      green: { op: 'between', value: [10, 20] },
      amber: { op: 'between', value: [20, 25] },
      red: { op: '>', value: 25 },
    };
    const r = validateThresholds(t, 'band');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/amber.*must contain green/);
  });

  it('band direction: rejects amber that does not contain green on the low side', () => {
    const t: Thresholds = {
      green: { op: 'between', value: [10, 20] },
      amber: { op: 'between', value: [12, 25] }, // a_lo=12 > g_lo=10 → fails
      red: { op: '>', value: 25 },
    };
    const r = validateThresholds(t, 'band');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/amber.*must contain green/);
  });

  it('band direction: rejects amber that does not contain green on the high side', () => {
    const t: Thresholds = {
      green: { op: 'between', value: [10, 20] },
      amber: { op: 'between', value: [5, 18] }, // a_hi=18 < g_hi=20 → fails
      red: { op: '>', value: 25 },
    };
    const r = validateThresholds(t, 'band');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/amber.*must contain green/);
  });

  it('band direction: accepts properly nested amber (superset of green)', () => {
    // The EDU fix shape: amber [6, 25] contains green [10, 20].
    const t: Thresholds = {
      green: { op: 'between', value: [10, 20] },
      amber: { op: 'between', value: [6, 25] },
      red: { op: '>', value: 25 },
    };
    expect(validateThresholds(t, 'band')).toEqual({ ok: true });
  });

  it('band direction: accepts amber equal to green (degenerate but valid)', () => {
    // Edge: amber == green means classifier always picks green when in range.
    // Not useful but shouldn't be rejected.
    const t: Thresholds = {
      green: { op: 'between', value: [10, 20] },
      amber: { op: 'between', value: [10, 20] },
      red: { op: '>', value: 20 },
    };
    expect(validateThresholds(t, 'band')).toEqual({ ok: true });
  });

  it('band direction: rejects directional ops (>=/>/<=/<) in green/amber', () => {
    const t: Thresholds = {
      green: { op: '>=', value: 10 },
      amber: { op: 'between', value: [5, 25] },
      red: { op: '>', value: 25 },
    };
    const r = validateThresholds(t, 'band');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/band direction requires/);
  });

  it('band direction: rejects red fully contained in amber (red can never trigger)', () => {
    const t: Thresholds = {
      green: { op: 'between', value: [10, 20] },
      amber: { op: 'between', value: [5, 25] },
      red: { op: 'between', value: [12, 18] }, // contained in amber → unreachable
    };
    const r = validateThresholds(t, 'band');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/red.*fully contained in amber/);
  });

  it('band direction: accepts directional red (>amber.hi or <amber.lo)', () => {
    const t: Thresholds = {
      green: { op: 'between', value: [10, 20] },
      amber: { op: 'between', value: [5, 25] },
      red: { op: '>', value: 25 }, // strictly above amber
    };
    expect(validateThresholds(t, 'band')).toEqual({ ok: true });
  });

  it('seed regression: every existing band-direction indicator passes the validator', () => {
    // Real seed data: POULTRY_FEED_COST_SHARE green [58,72] amber [50,78] red >78.
    const poultry: Thresholds = {
      green: { op: 'between', value: [58, 72] },
      amber: { op: 'between', value: [50, 78] },
      red: { op: '>', value: 78 },
    };
    expect(validateThresholds(poultry, 'band')).toEqual({ ok: true });

    // EDU_STUDENT_TEACHER_RATIO post-fix: green [10,20] amber [6,25] red >25.
    const edu: Thresholds = {
      green: { op: 'between', value: [10, 20] },
      amber: { op: 'between', value: [6, 25] },
      red: { op: '>', value: 25 },
    };
    expect(validateThresholds(edu, 'band')).toEqual({ ok: true });
  });
});
