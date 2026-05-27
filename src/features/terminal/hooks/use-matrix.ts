"use client";

/**
 * Shared `useMatrix()` hook — single source of truth for the
 * `/api/indicators/matrix` fetch across terminal panels.
 *
 * **Closes a multi-turn architectural 🔄** that surfaced when 4 terminal
 * surfaces (`HeatMap`, `ComparePanel`, `CompanySnapshot`,
 * `CommandBar.IND`) all self-fetched the matrix endpoint. At Phase F
 * (60 cos × 80 inds matrix proxy) the duplicated round-trips would
 * compound — Bloomberg-layout demos with Compare modal open over
 * Snapshot drilldown = 3 simultaneous matrix fetches today.
 *
 * **Implementation strategy:**
 *  - Module-level cache keyed by `period` (`Map<string, CacheState>`)
 *    so different periods are independent cache entries (a sparkline
 *    switching periods doesn't blow away the active panel's cache).
 *  - `useMatrix(period?)` — reactive hook for components that subscribe
 *    to the data.
 *  - `ensureMatrix(period)` — async accessor for one-shot reads (e.g.
 *    `CommandBar.IND` resolving an indicator code).
 *  - `getMatrixSync(period)` — sync accessor returning cached data or
 *    null. Useful for quick sanity reads without subscribing.
 *  - `refresh(period)` — purges cache entry + re-fetches; called by
 *    HeatMap on SSE indicator-changed events.
 *
 * **What this hook DOESN'T do (v1 scope):**
 *  - SSE-driven cache invalidation built into the hook (consumers
 *    still wire their own SSE listener and call `refresh()` —
 *    centralizing this is a v2 follow-up since debounce / partial-cell
 *    semantics differ per consumer).
 *  - Stale-while-revalidate (callers explicit-refresh on stale data).
 *
 * **Naming:** `MatrixResponse` mirrors `/api/indicators/matrix` shape;
 * if that endpoint changes, this hook AND callers update in lockstep —
 * single point of truth.
 */

import { useEffect, useMemo, useState } from "react";
import type { HeatMapCell } from "@/lib/risk/heatmap-matrix";

export interface MatrixCompanyRow {
  id: string;
  code: string;
  name: string;
  industry: string;
  /** Set true on sub-group rollup rows (Turn 33.5); leaf ops cos omit. */
  isSubgroup?: boolean;
  /**
   * Truth-infra C.1 — onboarding readiness gate. Default matrix excludes
   * `'pending'` companies; only present in response when the matrix was
   * fetched with `?includePending=true` (admin "Show pending" toggle).
   * Values: `'pending' | 'active' | 'archived'`.
   */
  status?: string;
  /**
   * Phase 7.M Step 5 (2026-05-19) — per-company data-completeness score.
   * Drives the CompanyTree badge, a low-readiness banner in the
   * HeatMap header for the active entity, and the Variance Explainer
   * prompt context. `null` when the readiness helper failed or this
   * row is a sub-group rollup (level=1 parents aren't scored —
   * CompanyTree derives their tier from worst-of-children).
   */
  readiness?: {
    score: number;
    tier: "complete" | "good" | "partial" | "thin" | "empty";
    areas: ReadonlyArray<{
      id: string;
      weight: number;
      earned: number;
      label: string;
      missing: string | null;
    }>;
  } | null;
}

export type MatrixIndicatorDirection = "higher_better" | "lower_better" | "band";

export interface MatrixIndicatorCol {
  id: string;
  code: string;
  nameEn: string;
  /** Optional locale-specific name fields — sub-27 cont'd multi-lingual MVP. */
  nameAz?: string | null;
  nameRu?: string | null;
  /**
   * Threshold direction — narrowed to literal union to match consumer
   * shape (ComparePanel, CompanySnapshot). Server-side enum mirror at
   * `IndicatorDefinition.direction` in prisma/schema.prisma.
   */
  direction: MatrixIndicatorDirection;
  unit: string;
  /**
   * Phase 7.I — list of industries this indicator targets. Empty array
   * means universal (applies to every industry — e.g. financial ratios).
   * HeatMap filters out indicators whose `industries` is non-empty and
   * doesn't include the active company's industry when the "Material
   * only" toggle is on. Source: `IndicatorDefinition.industries`.
   */
  industries?: string[];
  /**
   * 2026-05-27 — resolver-input tokens this indicator's formula
   * depends on (e.g. `["weather:rainfall_mm_90d"]`,
   * `["currencyRate", "budgetLine"]`). Threaded to HeatMap so cells
   * can flag «source is stale» by cross-referencing with the Drift
   * Dashboard's freshness map (via `inputToSourceCode()`). Source:
   * `IndicatorDefinition.requiredInputs`.
   */
  requiredInputs?: string[];
}

export interface MatrixResponse {
  period: string;
  companies: MatrixCompanyRow[];
  indicators: MatrixIndicatorCol[];
  cells: HeatMapCell[];
  /** 2026-05-27 A4 — max(IndicatorValue.computedAt) across all rendered
   *  cells, ISO 8601 string. Null when matrix has no cells (empty org /
   *  no recompute fired). HeatMap header turns this into «Updated 2h ago»
   *  via a relative-time formatter, refreshed every 30s without re-fetch. */
  lastComputedAt?: string | null;
}

export interface UseMatrixResult {
  /** Resolved matrix or null until first fetch lands / on error. */
  matrix: MatrixResponse | null;
  /** True until first fetch resolves (success OR error). */
  loading: boolean;
  /** Set on fetch failure; null on success. */
  error: string | null;
  /** Force re-fetch (purges cache entry for this period). */
  refresh: () => Promise<void>;
}

interface CacheState {
  promise: Promise<MatrixResponse>;
  data: MatrixResponse | null;
  error: string | null;
}

const cacheByPeriod = new Map<string, CacheState>();

function buildUrl(period: string | undefined, includePending: boolean): string {
  const base = period
    ? `/api/indicators/matrix?period=${encodeURIComponent(period)}`
    : `/api/indicators/matrix`;
  return includePending
    ? `${base}${period ? '&' : '?'}includePending=true`
    : base;
}

function isMatrixResponseShape(v: unknown): v is MatrixResponse {
  // Defensive shape check — endpoint returns an object with `period`
  // string + `companies`, `indicators`, `cells` arrays. Mirror of
  // sub-19 useCompanies's `isCompanyNode` pattern (architect sub-20
  // 💡 closure: harmonize defensive filtering between two hooks of
  // the same architectural shape).
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { period: unknown }).period === "string" &&
    Array.isArray((v as { companies: unknown }).companies) &&
    Array.isArray((v as { indicators: unknown }).indicators) &&
    Array.isArray((v as { cells: unknown }).cells)
  );
}

function fetchMatrix(
  period: string | undefined,
  includePending: boolean,
): Promise<MatrixResponse> {
  return fetch(buildUrl(period, includePending))
    .then((r) => {
      if (!r.ok) throw new Error(`/api/indicators/matrix ${r.status}`);
      return r.json() as Promise<unknown>;
    })
    .then((data) => {
      if (!isMatrixResponseShape(data)) {
        throw new Error(
          `/api/indicators/matrix returned malformed payload (missing period/companies/indicators/cells)`,
        );
      }
      return data;
    });
}

function cacheKey(period: string | undefined, includePending: boolean): string {
  // Truth-infra C.3 — cache key includes includePending so the admin
  // toggle gets its own cached response (independent of the default
  // operating-view cache).
  const base = period ?? "__default__";
  return includePending ? `${base}:pending` : base;
}

/**
 * Ensure a cache entry exists for the given period. Returns the
 * shared promise; multiple callers subscribe to the same in-flight
 * request. Sets `cache.data` on resolve / `cache.error` on reject.
 */
export function ensureMatrix(
  period?: string,
  includePending: boolean = false,
): Promise<MatrixResponse> {
  const key = cacheKey(period, includePending);
  let entry = cacheByPeriod.get(key);
  if (!entry) {
    const promise = fetchMatrix(period, includePending);
    entry = { promise, data: null, error: null };
    cacheByPeriod.set(key, entry);
    promise
      .then((data) => {
        const e = cacheByPeriod.get(key);
        if (e) e.data = data;
      })
      .catch((err: unknown) => {
        const e = cacheByPeriod.get(key);
        if (e) e.error = err instanceof Error ? err.message : String(err);
      });
  }
  return entry.promise;
}

/**
 * Sync accessor: return cached matrix for `period` or null. Doesn't
 * trigger a fetch. Useful for quick reads (e.g. one-shot lookups in
 * keyboard handlers) where the caller already knows the cache should
 * be primed by an upstream consumer.
 */
export function getMatrixSync(
  period?: string,
  includePending: boolean = false,
): MatrixResponse | null {
  return cacheByPeriod.get(cacheKey(period, includePending))?.data ?? null;
}

export function useMatrix(
  period?: string,
  includePending: boolean = false,
): UseMatrixResult {
  const key = cacheKey(period, includePending);
  const [matrix, setMatrix] = useState<MatrixResponse | null>(
    () => cacheByPeriod.get(key)?.data ?? null,
  );
  const [error, setError] = useState<string | null>(
    () => cacheByPeriod.get(key)?.error ?? null,
  );
  const [loading, setLoading] = useState<boolean>(() => {
    const entry = cacheByPeriod.get(key);
    return !(entry?.data || entry?.error);
  });

  useEffect(() => {
    let cancelled = false;
    ensureMatrix(period, includePending)
      .then((data) => {
        if (cancelled) return;
        setMatrix(data);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `period` + `includePending` together form the cache key — toggling
    // includePending triggers a separate fetch (admin "Show pending" view).
  }, [period, includePending]);

  const refresh = useMemo(
    () => async (): Promise<void> => {
      cacheByPeriod.delete(cacheKey(period, includePending));
      setLoading(true);
      setError(null);
      try {
        const data = await ensureMatrix(period, includePending);
        setMatrix(data);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [period, includePending],
  );

  return { matrix, loading, error, refresh };
}

/**
 * Test-only: clear the module-level cache between test runs.
 *
 * **Convention (mirror of `useCompanies` sub-19 pattern):** call from
 * `beforeEach` in EVERY test file that mocks `/api/indicators/matrix`
 * AT MODULE LEVEL. Additionally, call again INSIDE any test that
 * overrides `global.fetch` mid-suite — beforeEach reset alone is
 * insufficient because the first `it()` would have already populated
 * the cache from the success-path mock; per-test overrides need their
 * own reset to make the new mock visible.
 */
export function __resetMatrixCacheForTests(): void {
  cacheByPeriod.clear();
}
