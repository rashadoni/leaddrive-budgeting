/**
 * Financial-truth-infra Phase B.1 — per-company trust status helper.
 *
 * Derives a 4-state badge from the matrix payload so CompanyTree can show
 * a one-glance signal "is this entity's data trustworthy?". States:
 *
 *   - 'verified'    🟢 — has material IVs, all in expected sanity bands
 *                       (or sanityBand not yet populated).
 *   - 'partial'     🟡 — at least one material indicator has no IV or
 *                       `unknown` status (data gap, not a real signal).
 *   - 'suspicious'  🔴 — at least one IV with sanityBand IN
 *                       ('low_extreme' | 'high_extreme'). Surfaced only
 *                       after audit-company.cjs has run + populated the
 *                       DB column. Until then this state is never
 *                       returned (cells carry no sanityBand on the wire).
 *   - 'pending'     ⚪ — no cells at all for this company (just imported
 *                       or never recomputed).
 *
 * Future (Phase D.2) — adds a 'stale' sub-state when `lastReconciledAt`
 * is older than 30 days. For now the 4-state shape is enough.
 */

import type { HeatMapCell } from './heatmap-matrix';

export type TrustStatus = 'verified' | 'partial' | 'suspicious' | 'pending';

/** Visual palette for the badge — Bloomberg-style terminal colors. */
export const TRUST_COLOR: Record<TrustStatus, string> = {
  verified: '#00D4AA',
  partial: '#FFA502',
  suspicious: '#FF4757',
  pending: '#6B7280',
};

export const TRUST_LABEL: Record<TrustStatus, string> = {
  verified: 'Verified — all material indicators populated and within sanity bands',
  partial: 'Partial — some material indicators missing or unknown',
  suspicious: 'Suspicious — at least one indicator outside expected range',
  pending: 'Pending — no indicator values yet (just imported or not recomputed)',
};

/**
 * Compute trust status for a single company from the matrix cell list.
 *
 * @param companyId   Company id (matches HeatMapCell.companyId).
 * @param cells       Full matrix cell array (will be filtered by company).
 * @returns 4-state trust status.
 */
export function computeCompanyTrustStatus(
  companyId: string,
  cells: ReadonlyArray<HeatMapCell>,
): TrustStatus {
  const own = cells.filter((c) => c.companyId === companyId);
  if (own.length === 0) return 'pending';

  // Material indicators only — `not_material` cells are by-design dimmed,
  // their absence (or `unknown` status) shouldn't bring down the trust
  // score because the indicator isn't relevant to this company anyway.
  const material = own.filter(
    (c) => !c.materiality || c.materiality === 'material',
  );

  // sanityBand check — promoted to the wire by future API change.
  // Surfaced as `(cell as unknown).sanityBand` until the matrix payload
  // explicitly exposes it; until then this branch is dormant.
  type CellWithBand = HeatMapCell & { sanityBand?: string | null };
  const suspicious = material.some(
    (c) =>
      (c as CellWithBand).sanityBand === 'low_extreme' ||
      (c as CellWithBand).sanityBand === 'high_extreme',
  );
  if (suspicious) return 'suspicious';

  // Coverage check — what fraction of material cells have *real* status.
  // IndicatorStatus type is 'green' | 'amber' | 'red' | 'unknown'; only
  // `unknown` represents "no data ingested" and drags the coverage down.
  // (`na` / `missing` strings are runtime-only variants used by aggregate
  // rollup cells; they're not on the wire type.)
  const real = material.filter((c) => c.status !== 'unknown');
  // No material indicators at all => pending (e.g. company has only
  // `not_material` rows or only rollup cells).
  if (material.length === 0) return 'pending';
  const coverage = real.length / material.length;

  // Threshold: ≥80% of material indicators populated → verified.
  // 0 < coverage < 0.8 → partial.
  if (coverage >= 0.8) {
    // Phase L6 — staleness fallback. If the most-recent audit-company
    // pass across all material cells is older than 30 days (or no cell
    // was ever audited), degrade verified → partial. Prevents an
    // initially-clean company from looking trustworthy forever after
    // its audit goes cold.
    const STALENESS_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    type WithReconciled = HeatMapCell & { lastReconciledAt?: string };
    const auditedAts = material
      .map((c) => (c as WithReconciled).lastReconciledAt)
      .filter((s): s is string => typeof s === 'string')
      .map((s) => Date.parse(s))
      .filter((t) => !Number.isNaN(t));
    if (auditedAts.length === 0) return 'partial'; // never audited
    const mostRecent = Math.max(...auditedAts);
    if (now - mostRecent > STALENESS_THRESHOLD_MS) return 'partial';
    return 'verified';
  }
  if (coverage > 0) return 'partial';
  return 'pending';
}
