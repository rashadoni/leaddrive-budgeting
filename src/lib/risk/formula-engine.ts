/**
 * Phase 7.A.0 — pure formula engine used to compute IndicatorValue rows.
 *
 * Stays DB-free: the recompute pipeline resolves bookings / facts / FX rates
 * into a plain context object and passes it in. That keeps this layer unit-
 * testable without Prisma and lets the engine run both server-side (recompute
 * worker) and server-side-during-request (scenario stress-tests).
 */

import { Parser } from 'expr-eval';

// expr-eval defaults disallow side-effects and eval; we further narrow the
// surface by constructing a parser with only arithmetic + comparison + logical.
const parser = new Parser({
  operators: {
    add: true,
    concatenate: false,
    conditional: true,
    divide: true,
    factorial: false,
    multiply: true,
    power: true,
    remainder: true,
    subtract: true,
    logical: true,
    comparison: true,
    in: false,
    assignment: false,
  },
});

// Context variables must be plain numbers — anything else would produce NaN
// via expr-eval's coercion. String/literal values belong as arguments to
// custom functions (e.g. `fact("rooms_sold")`), not as variables.
export type FormulaContext = Record<string, number>;

// Custom functions accept the values expr-eval actually passes in: numbers
// (from context or arithmetic) and strings (from quoted literals in the
// formula). They must return a finite number.
export type FormulaFunctionArg = number | string;
export type FormulaFunction = (...args: FormulaFunctionArg[]) => number;

export type FormulaErrorCode = 'parse' | 'eval' | 'non_finite';

export class FormulaError extends Error {
  constructor(
    message: string,
    readonly formula: string,
    readonly code: FormulaErrorCode,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FormulaError';
  }
}

export type FormulaResult =
  | { ok: true; value: number }
  | { ok: false; code: FormulaErrorCode; reason: string };

/**
 * Evaluate without throwing — returns a discriminated Result. Preferred by
 * batch recompute: one broken indicator must not abort the rest of a tenant's
 * indicators. Callers map `{ ok: false }` → `status: "unknown"` on the
 * `IndicatorValue` row, and stash `{ error: { code, reason } }` inside the
 * `IndicatorValue.inputs` Json blob (same field already used for the resolved-
 * variable snapshot) so the terminal drill-down panel can render it.
 */
export function tryEvaluateFormula(
  formula: string,
  context: FormulaContext = {},
  functions: Record<string, FormulaFunction> = {},
): FormulaResult {
  let expr;
  try {
    expr = parser.parse(formula);
  } catch (err) {
    return {
      ok: false,
      code: 'parse',
      reason: `Failed to parse formula: ${(err as Error).message}`,
    };
  }

  const scope: Record<string, number | FormulaFunction> = {
    ...context,
    ...functions,
  };

  let raw: unknown;
  try {
    // expr-eval's Value type is narrower than the shapes we actually support
    // at runtime (e.g. functions). Cast at the boundary — runtime accepts it.
    raw = expr.evaluate(scope as unknown as Record<string, never>);
  } catch (err) {
    return {
      ok: false,
      code: 'eval',
      reason: `Failed to evaluate formula: ${(err as Error).message}`,
    };
  }

  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return {
      ok: false,
      code: 'non_finite',
      reason: `Formula did not produce a finite number (got ${String(raw)})`,
    };
  }
  return { ok: true, value: raw };
}

/**
 * Throwing variant for call sites that prefer exceptions (scenario UI
 * preview, dev tooling). Batch recompute must use `tryEvaluateFormula`
 * instead — one bad indicator should not abort the tenant's run.
 */
export function evaluateFormula(
  formula: string,
  context: FormulaContext = {},
  functions: Record<string, FormulaFunction> = {},
): number {
  const result = tryEvaluateFormula(formula, context, functions);
  if (!result.ok) {
    throw new FormulaError(result.reason, formula, result.code);
  }
  return result.value;
}

// --- Threshold classifier ----------------------------------------------------

export type ThresholdOp = '>=' | '>' | '<=' | '<' | 'between';

export type ThresholdBand =
  | { op: Exclude<ThresholdOp, 'between'>; value: number }
  | { op: 'between'; value: [number, number] };

export type Thresholds = {
  green: ThresholdBand;
  amber: ThresholdBand;
  red: ThresholdBand;
};

export type IndicatorStatus = 'green' | 'amber' | 'red' | 'unknown';

function matchBand(value: number, band: ThresholdBand): boolean {
  switch (band.op) {
    case '>=':
      return value >= band.value;
    case '>':
      return value > band.value;
    case '<=':
      return value <= band.value;
    case '<':
      return value < band.value;
    case 'between': {
      const [lo, hi] = band.value;
      return value >= lo && value <= hi;
    }
  }
}

/**
 * Classify a numeric value against green/amber/red bands. First matching band
 * wins, in green → amber → red order. Non-finite values return "unknown".
 *
 * Ordering note: for `higher_better` direction, seed thresholds are ordered so
 * that `value >= green.value` wins before `value >= amber.value`. For
 * `lower_better`, they are flipped (`value <= green.value` ...). The band
 * definitions themselves encode direction — the classifier stays direction-
 * agnostic.
 *
 * Because green matches first, seed definitions must respect direction — a
 * typo like `green: >=50, amber: >=70` silently mis-classifies. Use
 * `validateThresholds(thresholds, direction)` at seed/API write time to
 * catch this before it reaches runtime.
 */
export function classifyValue(
  value: number,
  thresholds: Thresholds,
): IndicatorStatus {
  if (!Number.isFinite(value)) return 'unknown';
  if (matchBand(value, thresholds.green)) return 'green';
  if (matchBand(value, thresholds.amber)) return 'amber';
  if (matchBand(value, thresholds.red)) return 'red';
  return 'unknown';
}

export type Direction = 'higher_better' | 'lower_better' | 'band';

export type ThresholdValidation =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Write-time validator for threshold seed/API input. Catches:
 *  - green band that's weaker than amber for the direction (silent mis-class);
 *  - between-band with lo >= hi;
 *  - wrong band.op type.
 * Recompute itself stays direction-agnostic and uses `classifyValue` directly.
 */
export function validateThresholds(
  thresholds: Thresholds,
  direction: Direction,
): ThresholdValidation {
  for (const key of ['green', 'amber', 'red'] as const) {
    const band = thresholds[key];
    if (band.op === 'between') {
      const [lo, hi] = band.value;
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        return { ok: false, reason: `${key} between band has non-finite bounds` };
      }
      if (lo >= hi) {
        return { ok: false, reason: `${key} between band requires lo < hi (got [${lo}, ${hi}])` };
      }
    } else if (!Number.isFinite(band.value)) {
      return { ok: false, reason: `${key} band has non-finite value` };
    }
  }

  // Direction-specific consistency between green and amber thresholds.
  const g = thresholds.green;
  const a = thresholds.amber;
  if (direction === 'higher_better' || direction === 'lower_better') {
    // `between` bands in green/amber don't compose with directional classify —
    // value=50 passes `between [40,60]` green AND `between [20,80]` amber, so
    // the "tighter band wins first" invariant collapses. Forbid explicitly.
    if (g.op === 'between' || a.op === 'between') {
      return {
        ok: false,
        reason: `${direction} direction forbids "between" bands in green/amber (use directional ops >=/>/<=/<); "between" is only valid with direction="band"`,
      };
    }
    if (direction === 'higher_better' && g.value < a.value) {
      // Green should be at least as strict as amber: green.value >= amber.value
      return {
        ok: false,
        reason: `higher_better thresholds inverted: green (${g.value}) must be >= amber (${a.value})`,
      };
    }
    if (direction === 'lower_better' && g.value > a.value) {
      // Green should be tighter: green.value <= amber.value
      return {
        ok: false,
        reason: `lower_better thresholds inverted: green (${g.value}) must be <= amber (${a.value})`,
      };
    }
  }

  // For direction='band' both green and amber must be `between` bands, and
  // amber MUST contain green entirely (a_lo <= g_lo AND a_hi >= g_hi).
  // Why: the classifier evaluates green → amber → red, first match wins. If
  // amber is narrower or non-overlapping with green, values that miss green
  // and don't reach red fall through to `unknown`, creating silent dead
  // zones in the matrix. The original EDU_STUDENT_TEACHER_RATIO bug
  // (2026-04-24) had green=[10,20], amber=[20,25], red=>25 — values <10
  // landed in `unknown` because amber didn't span the under-10 region.
  if (direction === 'band') {
    if (g.op !== 'between' || a.op !== 'between') {
      return {
        ok: false,
        reason: `band direction requires green AND amber to be "between" bands (got green=${g.op}, amber=${a.op})`,
      };
    }
    const [gLo, gHi] = g.value;
    const [aLo, aHi] = a.value;
    if (aLo > gLo || aHi < gHi) {
      return {
        ok: false,
        reason: `band thresholds: amber [${aLo}, ${aHi}] must contain green [${gLo}, ${gHi}] (a_lo<=g_lo AND a_hi>=g_hi). Otherwise values just outside green fall through to "unknown".`,
      };
    }
    // Red must cover values OUTSIDE amber. If red is `between [rLo, rHi]`
    // entirely contained in amber, red can never trigger — every value in
    // red's range would already match amber first. Reject.
    const r = thresholds.red;
    if (r.op === 'between') {
      const [rLo, rHi] = r.value;
      if (rLo >= aLo && rHi <= aHi) {
        return {
          ok: false,
          reason: `band thresholds: red [${rLo}, ${rHi}] is fully contained in amber [${aLo}, ${aHi}] — red can never trigger because amber matches first. Red must cover at least some values OUTSIDE amber.`,
        };
      }
    }
  }

  return { ok: true };
}
