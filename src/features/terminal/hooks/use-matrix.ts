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
}

export type MatrixIndicatorDirection = "higher_better" | "lower_better" | "band";

export interface MatrixIndicatorCol {
  id: string;
  code: string;
  nameEn: string;
  /**
   * Threshold direction — narrowed to literal union to match consumer
   * shape (ComparePanel, CompanySnapshot). Server-side enum mirror at
   * `IndicatorDefinition.direction` in prisma/schema.prisma.
   */
  direction: MatrixIndicatorDirection;
  unit: string;
}

export interface MatrixResponse {
  period: string;
  companies: MatrixCompanyRow[];
  indicators: MatrixIndicatorCol[];
  cells: HeatMapCell[];
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

function buildUrl(period: string | undefined): string {
  return period
    ? `/api/indicators/matrix?period=${encodeURIComponent(period)}`
    : `/api/indicators/matrix`;
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

function fetchMatrix(period: string | undefined): Promise<MatrixResponse> {
  return fetch(buildUrl(period))
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

function cacheKey(period: string | undefined): string {
  return period ?? "__default__";
}

/**
 * Ensure a cache entry exists for the given period. Returns the
 * shared promise; multiple callers subscribe to the same in-flight
 * request. Sets `cache.data` on resolve / `cache.error` on reject.
 */
export function ensureMatrix(
  period?: string,
): Promise<MatrixResponse> {
  const key = cacheKey(period);
  let entry = cacheByPeriod.get(key);
  if (!entry) {
    const promise = fetchMatrix(period);
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
export function getMatrixSync(period?: string): MatrixResponse | null {
  return cacheByPeriod.get(cacheKey(period))?.data ?? null;
}

export function useMatrix(period?: string): UseMatrixResult {
  const key = cacheKey(period);
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
    ensureMatrix(period)
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
    // `period` is the cache key — depending on it triggers a re-fetch
    // when the panel's period prop changes (HeatMap doesn't currently
    // change period mid-session, but ComparePanel could in v2).
  }, [period]);

  const refresh = useMemo(
    () => async (): Promise<void> => {
      // `key` is derived from `period` via cacheKey() — single dep
      // suffices (architect sub-20 💡 closure).
      cacheByPeriod.delete(cacheKey(period));
      setLoading(true);
      setError(null);
      try {
        const data = await ensureMatrix(period);
        setMatrix(data);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [period],
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
