/**
 * Relative-time formatter for terminal freshness markers — Phase 8 A4.
 *
 * Single source of truth for the «just now / 5m ago / 2h ago / 3d ago»
 * staleness vocabulary used by the HeatMap header `FreshnessLabel` (org-wide
 * `matrix.lastComputedAt`) AND the per-company CompanyTree row chip
 * (MAX(computedAt) per entity). Pure — the caller passes `nowMs` so the
 * function stays deterministic + testable (no `Date.now()` inside).
 *
 * `label` is the long form (header). `short` is the compact form (dense
 * rows). `isStale` flips at the 24h boundary — drives teal→amber on the dot,
 * matching the trust-badge convention (live = emerald, known-old = amber).
 */
export interface FreshnessParts {
  /** Long relative form: "just now" / "5m ago" / "2h ago" / "3d ago". */
  label: string;
  /** Compact form for dense rows: "now" / "5m" / "2h" / "3d". */
  short: string;
  /** True when older than 24h. */
  isStale: boolean;
}

export function formatFreshness(
  iso: string | null | undefined,
  nowMs: number,
): FreshnessParts | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const deltaSec = Math.max(0, Math.round((nowMs - ts) / 1000));
  if (deltaSec < 60) return { label: 'just now', short: 'now', isStale: false };
  if (deltaSec < 3600) {
    const m = Math.round(deltaSec / 60);
    return { label: `${m}m ago`, short: `${m}m`, isStale: false };
  }
  if (deltaSec < 86400) {
    const h = Math.round(deltaSec / 3600);
    return { label: `${h}h ago`, short: `${h}h`, isStale: false };
  }
  const d = Math.round(deltaSec / 86400);
  // Match FreshnessLabel exactly: stale strictly AFTER 24h (deltaSec === 86400
  // is "1d ago" but not yet amber).
  return { label: `${d}d ago`, short: `${d}d`, isStale: deltaSec > 86400 };
}
