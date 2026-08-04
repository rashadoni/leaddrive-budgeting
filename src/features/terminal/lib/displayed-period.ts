/**
 * Defect C — "what period is the terminal actually showing?"
 *
 * ONE rule, one file, so a panel that acts on the displayed period cannot drift
 * from the grid that draws it.
 *
 * The grid's rule is `HeatMap.tsx:78`:
 *
 *     renderedPeriod = data?.period ?? selectedPeriod ?? period ?? ''
 *
 * where `data` comes from `useMatrix(selectedPeriod)` (`use-heat-map-model.ts:150`)
 * and `period` (the prop) is `undefined` in the only mount that exists
 * (`PanelGrid.tsx:302` renders `<HeatMap />` with no period prop).
 *
 * This helper reverses the first two terms — store first, payload second — and
 * that reversal is safe, not a coincidence: `/api/indicators/matrix` echoes an
 * explicit `?period=` back verbatim. `route.ts:432` is literally
 * `const period = explicitPeriod ?? periodCtx.defaultPeriod`, and the only thing
 * that happens to `explicitPeriod` before that line is `parsePeriod()` at
 * `route.ts:139` — a *validator* that 400s on garbage and normalises nothing.
 * So whenever `selectedPeriod` is set and its payload has landed,
 * `payload.period === selectedPeriod` and the two orderings return the same
 * string. Where they differ is only where the payload is ABSENT — mid-flight or
 * cold — and there the store value is the right answer, because it is the one
 * the grid itself falls back to on exactly the same tick.
 *
 * Store-first also removes a footgun: `getMatrixSync()` with no argument reads
 * the `__default__` key, which is the WRONG key the moment the user picks a
 * period. Callers must peek with `getMatrixSync(selectedPeriod)` — the same key
 * `useMatrix(selectedPeriod)` builds — and this helper's contract assumes that.
 *
 * The guard is deliberately fail-OPEN. See `blockedReason`.
 */

import { hasEvidencedValue } from '@/lib/risk/heatmap-matrix';
import type { HeatMapCell } from '@/lib/risk/heatmap-matrix';

/** The slice of a matrix payload this rule needs. */
export interface PeekedMatrix {
  period: string;
  cells: readonly HeatMapCell[];
}

export type ScenarioBlockedReason = 'no-computed-values';

export interface DisplayedPeriodPlan {
  /** The period the grid is rendering. Send THIS to `/simulate`. */
  period: string;
  /**
   * Non-null ONLY when we are holding the payload for `period` itself and that
   * payload contains no evidenced cell — i.e. we positively know a simulation
   * would come back empty (`simulate/route.ts:545` returns 404 "No
   * IndicatorValues found for period").
   *
   * Null whenever the payload is absent, still in flight, or belongs to another
   * period. Absent metadata must never fire a guard: the previous attempt at
   * this defect disabled the button on `matrix === null` and cost 5 red tests
   * and a 450s vitest file, because "I have no evidence" was read as "there is
   * no data".
   */
  blockedReason: ScenarioBlockedReason | null;
}

export function planDisplayedPeriod(
  selectedPeriod: string | undefined,
  peeked: PeekedMatrix | null,
  fallbackPeriod: string,
): DisplayedPeriodPlan {
  const period = selectedPeriod ?? peeked?.period ?? fallbackPeriod;

  // Structural, not argued: only a payload whose OWN period equals the period
  // we would simulate is allowed to speak about that period's evidence.
  const evidence = peeked !== null && peeked.period === period ? peeked : null;

  const blockedReason: ScenarioBlockedReason | null =
    evidence !== null &&
    !evidence.cells.some((c) => hasEvidencedValue(c.status, c.value))
      ? 'no-computed-values'
      : null;

  return { period, blockedReason };
}
