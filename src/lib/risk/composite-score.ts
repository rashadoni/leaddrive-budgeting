/**
 * Phase C5 (Bloomberg uplift plan) — composite risk score.
 *
 * Reduces a company's HeatMap cells (one per indicator) into a single
 * 0-100 health score. Bloomberg-style "one-glance" summary that makes
 * the matrix scannable without inspecting every cell.
 *
 * Scoring contract:
 *   - green  → 100 pts
 *   - amber  → 50 pts
 *   - red    → 0 pts
 *   - unknown / missing → ignored (no penalty for "data gap")
 *   - `scoring === false` → skipped entirely, and dropped from `totalCount`
 *     (11.71 — constants, and the informational legal/compliance indicators
 *     the owner directed must not interact with the financial part)
 *
 * Phase 7.N C5 v2 — weighted average.
 * Each cell carries a `weight` (from `IndicatorDefinition.weight`, default 1.0).
 * Score = Σ(pts_i × weight_i) / Σ(weight_i) — only over scoreable cells.
 * Backward-compat: cells without `weight` field are treated as weight=1.0.
 *
 * Weight scheme:
 *   1.5 — profitability + liquidity (gross margin, net margin, debt coverage)
 *   1.3 — FX / macro exposure (FX_IMPORTED_INPUT, sector FX indicators)
 *   1.2 — core operational efficiency (EBITDA margin, OpEx ratio)
 *   1.0 — default (everything not explicitly weighted)
 *   0.8 — news / sentiment (directional signal only)
 *   0.7 — ESG / emissions (important for compliance; lower urgency for composite)
 *
 * Band classifier:
 *   - score ≥ 67 → 'green'  (healthy)
 *   - score ≥ 34 → 'amber'  (watch)
 *   - score <  34 → 'red'   (urgent)
 */

import { isAggregateRollup, type HeatMapCell } from './heatmap-matrix';
import type { IndicatorStatus } from './formula-engine';

export type CompositeBand = 'green' | 'amber' | 'red' | 'unknown';

/**
 * 11.81 — coverage floor. A composite is a mean, and below four observations
 * one indicator decides the band: at n=3 the assignment [red, green, green]
 * averages to 66.67 → rounds to 67 → GREEN, and flipping one green to red
 * gives 33.33 → 33 → RED. One cell, two bands apart. At n=4 no assignment
 * permits a single-cell green→red flip; with the production weight range
 * (0.7–1.5) the maximum single-cell influence falls to 25.0–30.2%, the first
 * value below the 33-point amber band, so amber finally works as the buffer
 * it was drawn to be.
 *
 * The integer is read off the data, not chosen. Cross-tabbing the 143 scored
 * (company, period) pairs on production against `indicatorProvenance()`:
 * every pair with 1, 2 or 3 contributing cells contains ZERO client-supplied
 * figures — it is entirely commodity feeds and a rainfall forecast, computed
 * whether or not the client ever uploaded anything. 4 is the first count at
 * which a score rests on a number the client supplied (9 of 18 such pairs).
 * So N≥4 withholds every purely-external low-coverage score and destroys none
 * that contains a client figure. N≥3 leaves 18 external-only scores standing
 * (`3/23 → 83 green`, a clean bill of health from three commodity feeds);
 * N≥5 destroys 9 scores that do rest on client data, including EDEN's
 * genuine customer-concentration reading.
 *
 * Deliberately a module constant, NOT org config. `criticalComposite.scoreMax`
 * is per-org; a configurable coverage floor is a knob an org can use to
 * configure its way back into one-cell scores. When a second customer arrives
 * with a different taxonomy the correct shape is `makeCompositeScorer(config)`
 * resolved once per request — not a twelfth call site passing a threshold.
 */
export const MIN_SCORING_CELLS = 4;

/**
 * Why there is (or is not) a score.
 *   - `none`         — not one applicable indicator has a figure.
 *   - `insufficient` — some do, but fewer than `MIN_SCORING_CELLS`.
 *   - `full`         — enough to publish a number.
 *
 * REQUIRED on `CompositeScore`, and that is the point: five surfaces have to
 * print different sentences for `none` and `insufficient` ("none of the 28
 * applicable indicators has figures" vs "2 of 28 — at least 4 needed"), and
 * re-deriving that predicate at five sites is 11.66's failure mode
 * transcribed into copy. Making it required turns `tsc --noEmit` into the
 * checklist.
 */
export type CompositeCoverage = 'none' | 'insufficient' | 'full';

export interface CompositeScore {
  /** 0-100, or null whenever `coverage !== 'full'`. */
  score: number | null;
  /** Band classifier; 'unknown' when score is null. */
  band: CompositeBand;
  /** Count of cells that contributed to the average (excludes unknown/missing). */
  contributingCount: number;
  /** Total cells inspected (for "X of Y indicators" UX). */
  totalCount: number;
  /**
   * 11.81 — REQUIRED. Invariant every consumer may rely on:
   * `score === null` ⟺ `coverage !== 'full'`. Every pre-existing
   * `if (score === null)` branch therefore keeps its exact present meaning.
   */
  coverage: CompositeCoverage;
  /**
   * Phase 7.N wiring (2026-05-26) — qualitative risk-tag penalty.
   * When riskTags are passed in, the score is reduced by the sum of
   * per-tag penalties. `scoreBeforeTags` is the un-penalised score so
   * the UI can show «60 (-15 risk flags)» if it wants to explain the
   * delta.
   */
  scoreBeforeTags?: number;
  /** Sum of penalties applied (≥0). */
  riskTagPenalty?: number;
  /**
   * 11.81 — set ONLY by `deriveParentComposites`. A board reads "4 of 6
   * subsidiaries", not "41 of 153 indicators"; `revenueCoveredPct` says how
   * much of the holding's money the mean actually saw.
   */
  children?: { scored: number; total: number; revenueCoveredPct: number };
}

/**
 * Phase 7.N wiring (2026-05-26) — per-tag composite-score penalty.
 *
 * Rationale per tag:
 *   - `data_absence` (-12): biggest. If key metrics are missing we
 *     can't trust the rest of the data either; the composite should
 *     reflect lower confidence.
 *   - `non_transparent_structure` (-8): related parties / opaque
 *     ownership = audit risk.
 *   - `subsidy_dependency` (-5): gov policy exposure; quantifiable
 *     but not as severe as audit risk.
 *
 * Max stacked penalty: 25. Floor: 0 (Math.max in apply).
 */
const RISK_TAG_PENALTY: Record<string, number> = {
  data_absence: 12,
  non_transparent_structure: 8,
  subsidy_dependency: 5,
};

function computeRiskTagPenalty(riskTags: readonly string[] | undefined): number {
  if (!riskTags || riskTags.length === 0) return 0;
  let total = 0;
  for (const t of riskTags) total += RISK_TAG_PENALTY[t] ?? 0;
  return total;
}

// 'missing' isn't a real DB-emitted status — `HeatMapCell.status` is
// always one of the 4 IndicatorStatus values (matrix endpoint at
// `/api/indicators/matrix/route.ts:184` casts to IndicatorStatus before
// emitting). 'missing' only appears as a UI fallback in HeatMap.tsx
// when the cell itself is undefined; this helper sees real cells only.
const STATUS_PTS: Record<IndicatorStatus, number | null> = {
  green: 100,
  amber: 50,
  red: 0,
  unknown: null,
};

/**
 * Compute a company's composite score from a list of cells (typically
 * filtered to one company already, but the helper itself is agnostic
 * — it just averages whatever it's given).
 *
 * Phase 7.N C5 v2: weighted average using `cell.weight` (default 1.0).
 * Back-compat: cells without `weight` are treated as weight=1.0 so
 * existing callers and tests continue to work unchanged.
 */
export function computeCompositeScore(
  cells: readonly HeatMapCell[],
  /**
   * Phase 7.N wiring (2026-05-26) — optional qualitative tags from
   * `Company.settings.riskTags`. When provided, the final score is
   * reduced by the summed per-tag penalty (clamped to ≥0). Callers
   * that don't pass tags get identical pre-wiring behaviour.
   */
  riskTags?: readonly string[],
): CompositeScore {
  let weightedSum = 0;
  let totalWeight = 0;
  let contributingCount = 0;
  let nonScoringCount = 0;
  for (const c of cells) {
    // 11.71 — the single enforcement point for "this indicator does not move
    // the score". Everything else in the repo either calls this function or
    // re-aggregates its output, so a rule applied here cannot be forgotten by a
    // caller — and there are twelve callers, across the terminal, both exports,
    // the alert engine, the board deck, the PPTX route and the scenario
    // simulator. Filtering at each of them is what 11.66 tried; it reached two.
    //
    // The flag is set by `markNonScoringCells` (indicator-provenance.ts), which
    // owns the rule: constants, plus the informational `governance` category
    // (court cases + audit findings). Product directive, not a bug fix — legal
    // exposure is real and stays fully visible, it is simply not a term in a
    // FINANCIAL score. Absent flag ⇒ the cell scores.
    if (c.scoring === false) {
      nonScoringCount++;
      continue;
    }
    const pts = STATUS_PTS[c.status];
    if (pts !== null) {
      const w = c.weight ?? 1.0;
      weightedSum += pts * w;
      totalWeight += w;
      contributingCount++;
    }
  }
  // Coverage denominator — a deliberate decision, and it is NOT the same
  // decision for both exclusion reasons even though the arithmetic is.
  //
  // A constant leaves the denominator because it never could have scored. A
  // governance cell leaves it because the fraction the UI renders ("5 / 104")
  // reads as "of the indicators feeding this score, how many have data" — keep
  // the four in the denominator and the fraction describes a population the
  // numerator was never averaged against, which is a worse lie than a smaller
  // total. The four remain fully counted where they are actually about
  // coverage: the Compliance Hub, the indicator backlog, the freshness
  // dashboard, and the matrix's own green/amber/red tallies.
  //
  // Shrinking also keeps this identical to pre-filtering with
  // `excludeNonScoringCells`, which removes the cell and so shrinks
  // `cells.length` — the two mechanisms must agree while both exist, or the
  // terminal and the board deck report different denominators for one company.
  const totalCount = cells.length - nonScoringCount;
  // 11.81 — the coverage floor, at the same chokepoint and for the same
  // reason as the 11.71 scoring gate. DASTAN and SAF read «0 / 100, critical»
  // on the board deck because exactly one red cell — a rainfall forecast —
  // was all there was. That is a statement about missing data wearing the
  // costume of a risk verdict, and it fired RULE_COMPANY_CRITICAL_COMPOSITE,
  // which persists an AlertEvent row. Below the floor we publish no number at
  // all: a reader who wants a number and does not get one can ask why, and
  // the fraction next to the blank answers them. A reader who gets a number
  // that is not one never asks.
  if (contributingCount < MIN_SCORING_CELLS) {
    return {
      score: null,
      band: 'unknown',
      contributingCount,
      totalCount,
      coverage: contributingCount === 0 ? 'none' : 'insufficient',
    };
  }
  const baseScore = Math.round(weightedSum / totalWeight);
  const penalty = computeRiskTagPenalty(riskTags);
  const score = Math.max(0, baseScore - penalty);
  return {
    score,
    band: scoreToBand(score),
    contributingCount,
    totalCount,
    coverage: 'full',
    ...(penalty > 0 ? { scoreBeforeTags: baseScore, riskTagPenalty: penalty } : {}),
  };
}

export function scoreToBand(score: number): CompositeBand {
  if (score >= 67) return 'green';
  if (score >= 34) return 'amber';
  return 'red';
}

/**
 * Phase C5 (architect Round-1 sub-12 closure) — shared aggregator for
 * HeatMap.tsx + board-deck/page.tsx.
 *

 * Groups cells by `companyId` (skipping aggregate-rollup rows via the
 * shared `isAggregateRollup(c)` helper — covers both Turn 33.5 synthetic
 * averages AND sub-44 cont'd real parent-co rollup IVs) and computes the
 * composite per company. Two modes via the `companyIds` arg:
 *   - omitted: result includes only companies that have at least one
 *     non-rollup cell (HeatMap pattern — sparse map)
 *   - provided: result includes EVERY listed id, with empty-cell
 *     companies getting a `score: null` "no data" composite (board-deck
 *     pattern — table renders one row per operational sub-co even
 *     when missing IndicatorValues)
 *
 * Locks the rollup-skip invariant in one place — divergent skip logic
 * across call-sites would silently shift sub-group composites between
 * the Terminal and Board Deck (architect Round-1 sub-12 ⚠️ closure).
 * Sub-44 cont'd architect closure: gate switched from raw
 * `isSubgroupRollup` field-check to the `isAggregateRollup` helper so
 * adding a new aggregate variant doesn't require touching every site.
 */
export function computeCompositeByCompany(
  cells: readonly HeatMapCell[],
  companyIds?: readonly string[],
  /**
   * Phase 7.N wiring (2026-05-26) — per-company qualitative tags.
   * Look-up by companyId; companies absent from the map get no penalty.
   */
  riskTagsByCompany?: ReadonlyMap<string, readonly string[]>,
): Map<string, CompositeScore> {
  const byCo = new Map<string, HeatMapCell[]>();
  for (const c of cells) {
    if (isAggregateRollup(c)) continue;
    const list = byCo.get(c.companyId);
    if (list) list.push(c);
    else byCo.set(c.companyId, [c]);
  }
  const out = new Map<string, CompositeScore>();
  if (companyIds) {
    for (const id of companyIds) {
      out.set(id, computeCompositeScore(byCo.get(id) ?? [], riskTagsByCompany?.get(id)));
    }
  } else {
    for (const [id, list] of byCo) {
      out.set(id, computeCompositeScore(list, riskTagsByCompany?.get(id)));
    }
  }
  return out;
}

/**
 * Roll sub-group / holding (parent) composites up from their children as a
 * REVENUE-WEIGHTED mean of the children's composite scores.
 *
 * Why revenue-weighted (2026-05-30): a holding's risk is dominated by where
 * the money is — a 0-revenue shell (e.g. a JV "awaiting data") must NOT lift
 * the parent score. An unweighted mean gave AZSEKER 48 (inflated by a
 * 0-revenue R78 shell); revenue-weighting gives ~45, dominated by the large
 * operating subs — the same principle as a cap-weighted index. Falls back to
 * an unweighted mean only when every child revenue is 0/absent (no
 * materiality signal). Walks the tree to a fixpoint so multi-level
 * hierarchies (sub-group of sub-groups) resolve bottom-up.
 *
 * Used by BOTH the CompanyTree (Panel 1) and the HeatMap row headers
 * (Panel 2) so the SAME parent number shows in both — a parent is never
 * blank in one view and scored in the other (terminal "numbers must tie
 * out" rule). Returns a NEW map = `leafById` + derived parents, keyed by id.
 */
export function deriveParentComposites(
  companies: ReadonlyArray<{ id: string; parentCompanyId?: string | null; revenue?: number | null }>,
  leafById: ReadonlyMap<string, CompositeScore>,
): Map<string, CompositeScore> {
  const out = new Map<string, CompositeScore>(leafById);
  const revById = new Map<string, number>(
    companies.map((c) => [
      c.id,
      typeof c.revenue === 'number' && Number.isFinite(c.revenue) ? Math.max(0, c.revenue) : 0,
    ]),
  );
  const childrenByParent = new Map<string, string[]>();
  for (const c of companies) {
    const pid = c.parentCompanyId ?? null;
    if (!pid) continue;
    const list = childrenByParent.get(pid);
    if (list) list.push(c.id);
    else childrenByParent.set(pid, [c.id]);
  }
  let progressed = true;
  let safety = 8; // depth cap (fixpoint for >2-level hierarchies)
  // 11.81 — a parent whose children ALL fell below the coverage floor now
  // gets an explicit no-score entry rather than no entry at all, so it can be
  // told apart from "not a parent" downstream. `resolved` keeps that entry
  // from being mistaken for "still pending" by the bottom-up deferral below.
  const resolved = new Set<string>();
  while (progressed && safety-- > 0) {
    progressed = false;
    for (const [parentId, kidIds] of childrenByParent) {
      if (resolved.has(parentId)) continue;
      const existing = out.get(parentId);
      if (existing && existing.score !== null) continue; // already scored
      // Defer until every child that is ITSELF a parent has resolved
      // (correct bottom-up order for multi-level holdings).
      const childParentsPending = kidIds.some(
        (id) =>
          childrenByParent.has(id) &&
          !resolved.has(id) &&
          (out.get(id)?.score ?? null) === null,
      );
      if (childParentsPending) continue;
      // 11.81 — the drop is explicit on `coverage`, not implicit in `score`.
      // Same set today (insufficient ⇒ null) and it cannot drift if the null
      // invariant is ever relaxed.
      const kids = kidIds
        .map((id) => ({ s: out.get(id), rev: revById.get(id) ?? 0 }))
        .filter(
          (k): k is { s: CompositeScore; rev: number } =>
            !!k.s && k.s.coverage === 'full' && k.s.score !== null,
        );
      // 11.81 — `totalCount` sums over ALL children, `contributingCount` only
      // over the included ones. Before this, both summed over included
      // children, so a subsidiary dropped for thin coverage vanished from the
      // denominator too — the code picked "drop, and conceal the drop".
      // AZSEKER 2026 is 41/153, not 41/97; 153 is the truth, that most of the
      // holding's indicator surface is empty. Consistent with 11.71, not
      // against it: 11.71 shrank the denominator for cells that could NEVER
      // score, and an under-covered child COULD, so it stays in the frame.
      const totalCountAllKids = kidIds.reduce(
        (acc, id) => acc + (out.get(id)?.totalCount ?? 0),
        0,
      );
      const allKidsRev = kidIds.reduce((acc, id) => acc + (revById.get(id) ?? 0), 0);
      const scoredRev = kids.reduce((acc, k) => acc + k.rev, 0);
      const children = {
        scored: kids.length,
        total: kidIds.length,
        // 100 when nobody carries revenue — the mean falls back to unweighted
        // there anyway, so "materiality covered" is vacuously complete.
        revenueCoveredPct:
          allKidsRev > 0 ? Math.round((scoredRev / allKidsRev) * 100) : 100,
      };
      if (kids.length === 0) {
        // Averaging the withheld children in at their own low-coverage scores
        // is the reported bug at holding scale: the deck hero read 49 for the
        // 2026 annual precisely because DASTAN's and SAF's rainfall forecasts
        // were averaged in as two whole zeros. Excluding them gives 74. So we
        // drop — and when there is nobody left to average, we say so.
        out.set(parentId, {
          score: null,
          band: 'unknown',
          contributingCount: 0,
          totalCount: totalCountAllKids,
          coverage: 'none',
          children,
        });
        resolved.add(parentId);
        progressed = true;
        continue;
      }
      const score =
        scoredRev > 0
          ? Math.round(kids.reduce((acc, k) => acc + (k.s.score as number) * k.rev, 0) / scoredRev)
          : Math.round(kids.reduce((acc, k) => acc + (k.s.score as number), 0) / kids.length);
      out.set(parentId, {
        score,
        band: scoreToBand(score),
        contributingCount: kids.reduce((acc, k) => acc + k.s.contributingCount, 0),
        totalCount: totalCountAllKids,
        // MIN_SCORING_CELLS deliberately does NOT apply here: the parent's
        // unit is children, not cells, and this branch builds its result as an
        // object literal rather than calling `computeCompositeScore`, so the
        // leaf gate reaches every leaf and no parent by construction.
        coverage: 'full',
        children,
      });
      resolved.add(parentId);
      progressed = true;
    }
  }
  return out;
}

/** Phase 7.N wiring — expose the per-tag penalty table so UIs can
 *  explain WHY a flag changes the score. Read-only. */
export const RISK_TAG_PENALTY_TABLE = Object.freeze({ ...RISK_TAG_PENALTY });
