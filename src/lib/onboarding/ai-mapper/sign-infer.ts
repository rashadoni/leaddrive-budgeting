/**
 * Phase C slice C3.1 — cost-sign convention inference.
 *
 * The generic applier historically flipped EVERY cogs/expense value by -1,
 * assuming the AZ convention "costs are stored negative". That silently
 * CORRUPTS a file that stores costs POSITIVE (debit convention): the flip
 * negates real costs, inflating profit. Codex (2026-06-20): make sign an
 * INFERRED, file-internal dimension; never globally flip on weak evidence;
 * hard-block when the convention looks wrong or ambiguous.
 *
 * This module classifies a cost section's stored sign from the RAW (pre-flip)
 * annual values of its rows. Pure + deterministic.
 *
 * Robustness (Codex): a single huge contra/correction/outlier row must not
 * flip the verdict, so a convention is only declared when BOTH the
 * abs-weighted amount AND the non-zero row COUNT agree on the same sign.
 * Otherwise → `ambiguous` (the review gate blocks it). A small refund row
 * (minority by both measures) is tolerated and does not change the verdict.
 */

export type SignConvention =
  | 'negative_costs' // costs stored negative → flip to positive (today's default)
  | 'positive_costs' // costs stored positive → must NOT be flipped
  | 'ambiguous' // mixed / near-50:50 / dominated by an outlier → review-required
  | 'no_evidence'; // all-zero / no cost rows → keep the default, harmless

export interface SignEvidence {
  /** Non-zero rows with a negative raw annual. */
  negRows: number;
  /** Non-zero rows with a positive raw annual. */
  posRows: number;
  /** Σ |rawAnnual| over negative rows. */
  negAbs: number;
  /** Σ |rawAnnual| over positive rows. */
  posAbs: number;
  /** Σ rawAnnual (signed). */
  netSum: number;
}

export interface SignClassification {
  convention: SignConvention;
  evidence: SignEvidence;
}

/** Dominant side must hold ≥70% of the section's gross abs amount AND the
 *  row-count majority. Tolerates a contra/refund row up to ~30% by value. */
const DOMINANT_SHARE = 0.7;

export function buildSignEvidence(rawAnnuals: number[]): SignEvidence {
  let negRows = 0;
  let posRows = 0;
  let negAbs = 0;
  let posAbs = 0;
  let netSum = 0;
  for (const v of rawAnnuals) {
    if (!Number.isFinite(v) || v === 0) continue;
    netSum += v;
    if (v < 0) {
      negRows += 1;
      negAbs += -v;
    } else {
      posRows += 1;
      posAbs += v;
    }
  }
  return { negRows, posRows, negAbs, posAbs, netSum };
}

export function classifyCostSign(rawAnnuals: number[]): SignClassification {
  const evidence = buildSignEvidence(rawAnnuals);
  const totalAbs = evidence.negAbs + evidence.posAbs;
  if (totalAbs === 0) return { convention: 'no_evidence', evidence };

  const negShare = evidence.negAbs / totalAbs;
  const posShare = evidence.posAbs / totalAbs;

  // BOTH measures must agree — abs-share AND row-count majority. This guards
  // the single-huge-outlier case (e.g. many small negative rows + one giant
  // positive correction): abs-share would say "positive" but row-count says
  // "negative" → they disagree → ambiguous → blocked for review.
  if (negShare >= DOMINANT_SHARE && evidence.negRows >= evidence.posRows) {
    return { convention: 'negative_costs', evidence };
  }
  if (posShare >= DOMINANT_SHARE && evidence.posRows >= evidence.negRows) {
    return { convention: 'positive_costs', evidence };
  }
  return { convention: 'ambiguous', evidence };
}
