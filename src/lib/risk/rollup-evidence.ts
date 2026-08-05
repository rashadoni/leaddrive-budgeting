/**
 * Is a rollup aggregate backed by anything at all?
 *
 * 2026-08-05 audit. The zombie-row guard (Phase 7.L, `recompute.ts`) demotes a
 * rollup indicator to `unknown` when the company has NO children. It says
 * nothing about the other empty shape: a holding that HAS children, none of
 * which have a value for the period. `rollupResolver` pre-seeds
 * `sums[code] = { sum: 0, matched_count: 0 }` for every requested code
 * (`recompute-resolvers-b.ts`), and `getIndicatorValue` returns null both for a
 * missing row and for a stored `status === 'unknown'` row
 * (`recompute-data-source.ts`) — so a period with no child data leaves the sum
 * at a finite 0. `classifyValue` then scores it: `IND_HOLDING_REVENUE`'s bands
 * (`amber: { op: ">=", value: 0 }`) paint it AMBER.
 *
 * Amber is the damaging part. Nine surfaces now call `hasEvidencedValue`, but
 * that predicate keys on status — and this row's status is a scored one. So
 * PeerPanel ranks the empty sum, reconciliation certifies it, and the board
 * deck and XLSX export print it. An absent measurement is reported as a
 * measured zero at holding level.
 *
 * `matched_count` is the evidence: it counts child values that actually
 * arrived. Zero contributors across every requested code, with children
 * present, means the sum is empty rather than zero.
 *
 * THE LOAD-BEARING RULE — a guard must never fire on ABSENT metadata.
 * Two guards in this repo were narrowed after keying on evidence ALSO skipped
 * rows the caller never meant to select, turning a whole pass into a no-op.
 * Anything unrecognisable here returns `'indeterminate'`, whose contract is:
 * the caller does nothing and the existing behaviour stands. A snapshot
 * written before `matched_count` existed, a hand-edited `inputs` blob, a
 * future resolver that reshapes the aggregate — all of them must leave the
 * pipeline exactly as it is today, not silently blank a holding's row.
 */

import { ROLLUP_INPUT_PREFIX } from './recompute-resolvers-b';

export type RollupContribution =
  /** At least one child produced a value for at least one requested code. */
  | 'contributes'
  /** The company has no children — the existing `rollup_no_children` case. */
  | 'no_children'
  /** Children exist, but not one of them had a value for any requested code. */
  | 'no_contributors'
  /** The aggregate can't be read. Callers MUST treat this as "no signal". */
  | 'indeterminate';

/** Shape `rollupResolver` writes to `inputs.aggregates.rollup`. */
interface RollupSumEntry {
  sum?: unknown;
  matched_count?: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Classify an `inputs.aggregates.rollup` blob by whether real child values
 * stand behind it.
 *
 * Structural validation runs FIRST and in full: every malformed or partial
 * shape resolves to `'indeterminate'` before any verdict is reached. That
 * ordering is deliberate — `'no_contributors'` is the only value that makes a
 * caller act, and it must be reachable only from an aggregate whose every
 * field was read and understood.
 *
 * Note the real resolver always pre-seeds one entry per requested code, so a
 * genuinely childless leaf still arrives here well-formed (`sums` non-empty,
 * `matched_count: 0`) and correctly reports `'no_children'`.
 */
export function rollupContribution(agg: unknown): RollupContribution {
  if (!isPlainObject(agg)) return 'indeterminate';

  const childrenCount = agg.children_count;
  // Number.isFinite rejects NaN/Infinity as well as non-numbers. A count we
  // cannot compare is a count we do not act on.
  if (typeof childrenCount !== 'number' || !Number.isFinite(childrenCount)) {
    return 'indeterminate';
  }

  const sums = agg.sums;
  if (!isPlainObject(sums)) return 'indeterminate';

  const entries = Object.values(sums);
  // No requested codes at all: nothing was asked for, so nothing is evidence
  // of absence. (Reachable via a bare `rollup` requiredInput, which declares
  // the function without naming a code.)
  if (entries.length === 0) return 'indeterminate';

  let anyContribution = false;
  let everyEntryExplicitZero = true;
  for (const raw of entries) {
    if (!isPlainObject(raw)) return 'indeterminate';
    const matched = (raw as RollupSumEntry).matched_count;
    if (typeof matched !== 'number' || !Number.isFinite(matched)) {
      return 'indeterminate';
    }
    if (matched > 0) anyContribution = true;
    // A negative or fractional count is not a count. It is not evidence of
    // contribution and it is not an explicit zero either, so it falls to
    // 'indeterminate' below rather than being read as emptiness.
    if (matched !== 0) everyEntryExplicitZero = false;
  }

  // Childless leaf — the pre-existing `rollup_no_children` case keeps its own
  // identity so its remediation ("correct for a leaf company") still applies.
  // Checked ahead of `contributes` to match the pipeline, where
  // `rollup_no_children` has always been the first test.
  if (childrenCount === 0) return 'no_children';

  if (anyContribution) return 'contributes';

  // Children present, every requested code matched exactly zero of them.
  if (everyEntryExplicitZero) return 'no_contributors';

  return 'indeterminate';
}

/**
 * Does this indicator compute from rollups and NOTHING else?
 *
 * The child-values guard is only sound for a pure rollup: if a formula also
 * reads budget lines, facts or a feed, an empty rollup term may be a
 * legitimate zero inside a larger expression, and demoting the whole cell
 * would hide a real measurement.
 *
 * Absent, empty, non-array or mixed `requiredInputs` → false. Same rule as
 * above: no metadata, no guard.
 */
export function isRollupOnlyIndicator(requiredInputs: unknown): boolean {
  if (!Array.isArray(requiredInputs)) return false;
  if (requiredInputs.length === 0) return false;
  return requiredInputs.every(
    (r) => typeof r === 'string' && r.startsWith(ROLLUP_INPUT_PREFIX),
  );
}
