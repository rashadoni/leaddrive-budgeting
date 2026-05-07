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
): HoldingComposite {
  let sum = 0;
  let count = 0;
  for (const id of operationalIds) {
    const c = composites.get(id);
    if (c && typeof c.score === "number" && Number.isFinite(c.score)) {
      sum += c.score;
      count++;
    }
  }
  if (count === 0) {
    return {
      score: null,
      contributingCount: 0,
      totalCount: operationalIds.length,
      band: null,
    };
  }
  const score = Math.round(sum / count);
  return {
    score,
    contributingCount: count,
    totalCount: operationalIds.length,
    band: scoreToBand(score),
  };
}
