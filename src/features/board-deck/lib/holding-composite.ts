/**
 * Phase 7.G Turn XLVIII (Board Deck v2 Turn 2) — holding-level
 * composite score helper.
 *
 * The Hero section needs ONE big number that tells the board "how is
 * the holding doing this period". v1 didn't have such a number — it
 * showed `green / amber / red` cell counts, which forces the reader
 * to triangulate. v2 promotes the composite-score concept (already
 * computed per-company by `computeCompositeByCompany`) to the
 * holding-level by averaging across operational sub-cos.
 *
 * **Weighting**: weight=1 per sub-co for v1 (simple unweighted mean).
 * A revenue-weighted or risk-budget-weighted version is a v2.x
 * follow-up — the simple mean is defensible because composites are
 * already 0-100 normalized and the holding's sub-cos are
 * comparably-sized. Sub-cos with `null` score (e.g. no data this
 * period) are excluded from both numerator AND denominator.
 *
 * Pure function. No DB. Test-friendly.
 */

import {
  scoreToBand as canonicalScoreToBand,
  type CompositeScore,
  type CompositeBand,
} from "@/lib/risk/composite-score";

export interface HoldingComposite {
  /** Mean composite (0-100), rounded to nearest integer. `null` when
   *  no operational sub-co has a numeric score this period. */
  score: number | null;
  /** Number of sub-cos that contributed (had a numeric score). */
  contributingCount: number;
  /** Number of operational sub-cos in scope (denominator candidate;
   *  `contributingCount + null-score count`). */
  totalCount: number;
  /** Aggregate band derived via the canonical `scoreToBand` (≥67
   *  green / ≥34 amber / else red). `null` when score is null. */
  band: CompositeBand | null;
  /**
   * 11.81 — share of the in-scope sub-cos' revenue that the mean actually
   * saw, 0-100. Removing data makes a holding look better (the 2025 annual
   * rises 57 → 70 once three amber children drop out for thin coverage), so
   * the disclosure ships next to the number, always rendered. 100 when no
   * revenue basis is supplied or every sub-co carries 0 — the mean is
   * unweighted there anyway.
   */
  revenueCoveredPct: number;
}

/** Wrap canonical `scoreToBand` (non-null input) for nullable scores. */
function scoreToBand(score: number | null): CompositeBand | null {
  if (score === null) return null;
  return canonicalScoreToBand(score);
}

/** Average composite scores across operational sub-cos. Skips nulls
 *  in both numerator + denominator. */
export function computeHoldingComposite(
  composites: ReadonlyMap<string, CompositeScore>,
  operationalIds: readonly string[],
  /**
   * 11.81 — optional per-sub-co revenue, for the materiality disclosure only.
   * It does NOT weight the mean (that stays equal-weight by the Turn XLVIII
   * decision) and it does NOT gate the score: a revenue-materiality gate is
   * a second threshold whose firing behaviour cannot be predicted from the
   * data currently on hand, and shipping a guard that may or may not blank
   * the holding in nine production periods is a coin flip, not a guard.
   */
  revenueById?: ReadonlyMap<string, number>,
): HoldingComposite {
  let sum = 0;
  let count = 0;
  let scoredRev = 0;
  let allRev = 0;
  for (const id of operationalIds) {
    const rev = Math.max(0, revenueById?.get(id) ?? 0);
    allRev += rev;
    const c = composites.get(id);
    // 11.81 — `coverage === 'full'` is the same set as `score !== null` by
    // the CompositeScore invariant; stated explicitly so a sub-co withheld
    // for thin coverage is visibly dropped rather than incidentally skipped.
    if (c && c.coverage === "full" && typeof c.score === "number" && Number.isFinite(c.score)) {
      sum += c.score;
      count++;
      scoredRev += rev;
    }
  }
  const revenueCoveredPct = allRev > 0 ? Math.round((scoredRev / allRev) * 100) : 100;
  if (count === 0) {
    return {
      score: null,
      contributingCount: 0,
      totalCount: operationalIds.length,
      band: null,
      revenueCoveredPct,
    };
  }
  const score = Math.round(sum / count);
  return {
    score,
    contributingCount: count,
    totalCount: operationalIds.length,
    band: scoreToBand(score),
    revenueCoveredPct,
  };
}
