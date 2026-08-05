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
 * ## 2026-08-05 — subscriber registry (defect B + the request storm)
 *
 * v1 was a bare `Map<key, {promise, data, error}>` that every consumer
 * read ONCE into its own React state. Two defects fell out of that:
 *
 *  - **Stale forever.** A hit returned `entry.promise` unconditionally and
 *    nothing ever revalidated, so a period visited earlier in the session
 *    was served its first payload for the rest of the session. `refresh()`
 *    deleted one key and refetched into the CALLING component's state —
 *    the other mounted consumers of that same key kept rendering the old
 *    payload they had copied at mount.
 *  - **The request storm.** `indicator_values_notify_trg` is `FOR EACH ROW`
 *    (`prisma/migrations/00000000000000_init/migration.sql:2983`), so one
 *    SSE `indicator:changed` reaches the client per IndicatorValue row.
 *    `CompanySnapshot` calls `refresh()` per event with no debounce, and
 *    each call deleted the key the other subscribers read from. A full
 *    recompute with a company selected therefore fired up to one
 *    full-matrix GET per (company × indicator) pair — ~221 today, ~4801 at
 *    the Phase F target.
 *
 * The shape now: a module-local **subscriber registry** read through
 * `useSyncExternalStore`. One entry per cache key; every mounted consumer
 * of that key subscribes to the SAME snapshot object, so
 *
 *  - N simultaneous subscribers produce exactly ONE in-flight GET;
 *  - an invalidation updates EVERY subscriber of the key instead of one,
 *    and is debounced AT THE REGISTRY (`INVALIDATE_DEBOUNCE_MS`) so an
 *    undebounced caller like `CompanySnapshot` cannot reintroduce the
 *    storm — a 221-event burst collapses to a single refetch;
 *  - a response is dropped if its entry's `generation` moved while it was
 *    in flight, so a late response cannot overwrite newer data;
 *  - entries nobody subscribes to are dropped on invalidation (that is the
 *    stale-forever fix) and the surviving warm set is LRU-capped at
 *    `WARM_ENTRY_CAP`, so switching back to a recent period stays instant
 *    without unbounded memory.
 *
 * Public accessors:
 *  - `useMatrix(period?, includePending?, { enabled })` — reactive
 *    subscription. `enabled: false` subscribes to NOTHING and fetches
 *    NOTHING (`TerminalOverlayHost.runtime.test.tsx` asserts zero matrix
 *    GETs at mount on mobile — a real cost guarantee, not a nicety).
 *  - `ensureMatrix(period?)` — async one-shot read (e.g. `CommandBar.IND`,
 *    the export buttons). Shares the same in-flight request; adds no
 *    subscriber.
 *  - `getMatrixSync(period?)` — sync peek. NEVER fetches; `ScenarioPanel`
 *    depends on exactly that to stay inside the zero-GET guarantee above.
 *  - `invalidateMatrix(period?)` / `refresh()` — coalesced revalidation.
 *
 * **Naming:** `MatrixResponse` mirrors `/api/indicators/matrix` shape;
 * if that endpoint changes, this hook AND callers update in lockstep —
 * single point of truth.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { HeatMapCell } from "@/lib/risk/heatmap-matrix";
import { useTerminalStore } from "../store/terminalStore";

export interface MatrixCompanyRow {
  id: string;
  code: string;
  name: string;
  industry: string | null;
  /** Runtime hierarchy edge used for subgroup activity/profile roll-ups. */
  parentCompanyId?: string | null;
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
   * HeatMap hides explicit activity mismatches by default and exposes them
   * through the "Show all" disclosure. Source: `IndicatorDefinition.industries`.
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
  /**
   * 11.71 — `IndicatorDefinition.category` ("operational", "commodity",
   * "governance", …). Already on the wire (the matrix endpoint selects it for
   * its internal-category render filter and emits the rows verbatim); this only
   * declares what was always arriving.
   *
   * Feeds the composite scoring gate: the `governance` legal/compliance
   * indicators are informational by product directive and must not move a
   * financial score. Optional — a caller that does not project it gets the
   * default that changes nothing (the indicator keeps scoring).
   */
  category?: string | null;
}

export interface MatrixApplicabilityOverride {
  companyId: string;
  indicatorId: string;
  enabled: boolean;
}

export interface MatrixResponse {
  period: string;
  /** 2026-07-15 — every year with any IndicatorValue plus the current Baku
   *  year, ascending. Drives the PeriodChips year row so data outside the
   *  data-aware default year is reachable. Optional for back-compat with
   *  cached/older payloads. */
  availableYears?: number[];
  companies: MatrixCompanyRow[];
  indicators: MatrixIndicatorCol[];
  /** Explicit per-company applicability assignments. When absent, clients
   *  fall back to IndicatorDefinition.industries for backwards compatibility. */
  applicabilityOverrides?: MatrixApplicabilityOverride[];
  cells: HeatMapCell[];
  /** 2026-05-27 A4 — max(IndicatorValue.computedAt) across all rendered
   *  cells, ISO 8601 string. Null when matrix has no cells (empty org /
   *  no recompute fired). HeatMap header turns this into «Updated 2h ago»
   *  via a relative-time formatter, refreshed every 30s without re-fetch. */
  lastComputedAt?: string | null;
}

export interface UseMatrixOptions {
  /** Skip the request until an event-driven consumer becomes active. */
  enabled?: boolean;
}

export interface UseMatrixResult {
  /** Resolved matrix or null until first fetch lands / on error. */
  matrix: MatrixResponse | null;
  /** True until first fetch resolves (success OR error). */
  loading: boolean;
  /** Set on fetch failure; null on success. */
  error: string | null;
  /** Force re-fetch. Invalidates the SHARED entry for this key: every
   *  mounted subscriber gets the new payload, and a burst of calls
   *  coalesces into one request. Resolves when that request settles. */
  refresh: () => Promise<void>;
  /**
   * OPTIONAL — true while a revalidation is in flight over data that is
   * already on screen (stale-while-revalidate). Never gates rendering;
   * `loading` keeps its original meaning ("nothing to show yet"). Optional
   * so pre-existing typed mocks of this hook still compile.
   */
  revalidating?: boolean;
}

/**
 * Immutable per-key view handed to `useSyncExternalStore`. A new object is
 * published on every change; the reference is stable between changes, which
 * is what keeps `getSnapshot` loop-free.
 */
interface MatrixSnapshot {
  readonly data: MatrixResponse | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly revalidating: boolean;
}

const COLD_SNAPSHOT: MatrixSnapshot = {
  data: null,
  error: null,
  loading: true,
  revalidating: false,
};

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

interface CacheEntry {
  key: string;
  period: string | undefined;
  includePending: boolean;
  snapshot: MatrixSnapshot;
  /**
   * Last request promise, RETAINED after it settles so a late `ensureMatrix`
   * gets the same rejected promise instead of retrying a failing endpoint
   * (the "sticky error" contract locked in use-matrix.test.tsx).
   */
  promise: Promise<MatrixResponse> | null;
  inFlight: boolean;
  /**
   * Epoch guard. Every invalidation bumps it; a response whose captured
   * generation no longer matches is discarded, so two refetches landing out
   * of order cannot leave the older payload on screen.
   */
  generation: number;
  subscribers: Set<() => void>;
  refetchTimer: ReturnType<typeof setTimeout> | null;
  refetchDeferred: Deferred | null;
  /** Monotonic tick, for LRU ordering of the unsubscribed (warm) set. */
  lastUsed: number;
}

/**
 * Debounce applied to invalidations AT THE REGISTRY. Deliberately not in the
 * components: `CompanySnapshot` calls `refresh()` straight out of the SSE
 * handler, and the per-row NOTIFY trigger means one recompute delivers
 * hundreds of those. Coalescing here is the only placement a future
 * undebounced caller cannot undo.
 */
const INVALIDATE_DEBOUNCE_MS = 120;

/**
 * How many settled entries with NO subscribers stay cached. Keeps
 * "switch to Q1 and back" instant while bounding memory (a Phase F payload
 * is ~4800 cells). Subscribed entries are never counted or evicted.
 */
const WARM_ENTRY_CAP = 6;

const registry = new Map<string, CacheEntry>();
let lruClock = 0;

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
    Array.isArray((v as { cells: unknown }).cells) &&
    ((v as { applicabilityOverrides?: unknown }).applicabilityOverrides ===
      undefined ||
      Array.isArray(
        (v as { applicabilityOverrides?: unknown }).applicabilityOverrides,
      ))
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
  // operating-view cache). CompanyTree passes a component-local
  // `showPending` with NO explicit period (CompanyTree.tsx:84), so the
  // pending variant must key off the same store-selected period.
  const base = period ?? "__default__";
  return includePending ? `${base}:pending` : base;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function touch(entry: CacheEntry): void {
  entry.lastUsed = ++lruClock;
}

/** An entry is "warm" when nothing is watching it and nothing is pending. */
function isWarm(entry: CacheEntry): boolean {
  return (
    entry.subscribers.size === 0 && !entry.inFlight && entry.refetchTimer === null
  );
}

function cancelPendingRefetch(entry: CacheEntry): void {
  if (entry.refetchTimer !== null) {
    clearTimeout(entry.refetchTimer);
    entry.refetchTimer = null;
  }
  // Nobody is left to receive the refetch — release awaiting callers so a
  // `refresh()` promise can never hang.
  entry.refetchDeferred?.resolve();
  entry.refetchDeferred = null;
}

function enforceWarmCap(): void {
  const warm: CacheEntry[] = [];
  for (const entry of registry.values()) {
    if (isWarm(entry)) warm.push(entry);
  }
  if (warm.length <= WARM_ENTRY_CAP) return;
  warm.sort((a, b) => a.lastUsed - b.lastUsed);
  for (const entry of warm.slice(0, warm.length - WARM_ENTRY_CAP)) {
    registry.delete(entry.key);
  }
}

function getOrCreateEntry(
  period: string | undefined,
  includePending: boolean,
): CacheEntry {
  const key = cacheKey(period, includePending);
  let entry = registry.get(key);
  if (!entry) {
    entry = {
      key,
      period,
      includePending,
      snapshot: COLD_SNAPSHOT,
      promise: null,
      inFlight: false,
      generation: 0,
      subscribers: new Set(),
      refetchTimer: null,
      refetchDeferred: null,
      lastUsed: 0,
    };
    registry.set(key, entry);
    // Touch BEFORE capping so the entry we just created is the
    // most-recently-used one and can never be the eviction victim.
    touch(entry);
    enforceWarmCap();
  }
  touch(entry);
  return entry;
}

function publish(entry: CacheEntry, next: Partial<MatrixSnapshot>): void {
  const merged: MatrixSnapshot = { ...entry.snapshot, ...next };
  if (
    merged.data === entry.snapshot.data &&
    merged.error === entry.snapshot.error &&
    merged.loading === entry.snapshot.loading &&
    merged.revalidating === entry.snapshot.revalidating
  ) {
    return;
  }
  entry.snapshot = merged;
  // Copy first: a subscriber may unmount (and unsubscribe) as it re-renders.
  for (const notify of Array.from(entry.subscribers)) notify();
}

/** True while `entry` is still the live entry for its key AND un-invalidated. */
function isCurrent(entry: CacheEntry, generation: number): boolean {
  return registry.get(entry.key) === entry && entry.generation === generation;
}

function startFetch(entry: CacheEntry): Promise<MatrixResponse> {
  const generation = entry.generation;
  const promise = fetchMatrix(entry.period, entry.includePending);
  entry.promise = promise;
  entry.inFlight = true;
  if (entry.snapshot.data) {
    // Stale-while-revalidate: keep the payload on screen. Blanking every
    // panel on each SSE recompute is exactly the thrash this rewrite exists
    // to remove.
    publish(entry, { revalidating: true });
  } else {
    // Cold start. Publishing the same content COLD_SNAPSHOT already carries
    // is a no-op by design (see `publish`) — a first mount must not cost an
    // extra render just to say "still loading".
    publish(entry, { loading: true, error: null, revalidating: false });
  }
  promise.then(
    (data) => {
      if (!isCurrent(entry, generation)) return;
      entry.inFlight = false;
      publish(entry, { data, error: null, loading: false, revalidating: false });
    },
    (err: unknown) => {
      if (!isCurrent(entry, generation)) return;
      entry.inFlight = false;
      publish(entry, {
        error: errorMessage(err),
        loading: false,
        revalidating: false,
      });
    },
  );
  return promise;
}

/** Run a scheduled refetch NOW (timer fired, or a one-shot reader demanded it). */
function flushRefetch(entry: CacheEntry): Promise<MatrixResponse> {
  if (entry.refetchTimer !== null) {
    clearTimeout(entry.refetchTimer);
    entry.refetchTimer = null;
  }
  const deferred = entry.refetchDeferred;
  entry.refetchDeferred = null;
  const promise = startFetch(entry);
  if (deferred) {
    // Resolve either way — `refresh()` reports "the revalidation finished",
    // not "it succeeded"; the error lands in the snapshot.
    promise.then(
      () => deferred.resolve(),
      () => deferred.resolve(),
    );
  }
  return promise;
}

function scheduleRefetch(entry: CacheEntry): Promise<void> {
  if (!entry.refetchDeferred) entry.refetchDeferred = createDeferred();
  if (entry.refetchTimer !== null) clearTimeout(entry.refetchTimer);
  entry.refetchTimer = setTimeout(() => {
    entry.refetchTimer = null;
    flushRefetch(entry);
  }, INVALIDATE_DEBOUNCE_MS);
  return entry.refetchDeferred.promise;
}

/**
 * Ensure a cache entry exists for the given period. Returns the shared
 * promise; multiple callers subscribe to the same in-flight request.
 * Adds no subscriber — a one-shot read must not keep an entry alive.
 *
 * ⚠ Pass the period. A bare `ensureMatrix()` keys on `__default__`, which is
 * a DIFFERENT entry from the one every panel is showing the moment a period
 * chip is picked — so it costs a second full-matrix GET and answers about
 * the wrong period. Same footgun `displayed-period.ts:27-30` documents for
 * `getMatrixSync()`. `CommandBar.tsx:179` still calls it bare.
 */
export function ensureMatrix(
  period?: string,
  includePending: boolean = false,
): Promise<MatrixResponse> {
  const entry = getOrCreateEntry(period, includePending);
  if (entry.snapshot.data) return Promise.resolve(entry.snapshot.data);
  // A revalidation is queued behind the debounce and this caller wants data
  // now — run it immediately rather than firing a second, parallel request.
  if (entry.refetchTimer !== null) return flushRefetch(entry);
  if (entry.promise) return entry.promise;
  return startFetch(entry);
}

/**
 * Sync accessor: return cached matrix for `period` or null. NEVER triggers a
 * fetch — `ScenarioPanel` mounts unconditionally inside `TerminalOverlayHost`
 * and relies on that to keep the mobile zero-GET guarantee
 * (`TerminalOverlayHost.runtime.test.tsx:105`).
 */
export function getMatrixSync(
  period?: string,
  includePending: boolean = false,
): MatrixResponse | null {
  const entry = registry.get(cacheKey(period, includePending));
  if (!entry) return null;
  // A peeked entry is in use — keep it out of the LRU firing line.
  touch(entry);
  return entry.snapshot.data;
}

/**
 * Invalidate one cache key: bump its epoch, drop every entry nobody is
 * subscribed to, and schedule ONE debounced refetch shared by all
 * subscribers of that key. Returns a promise that settles when that
 * refetch settles (immediately if there is nothing to refetch).
 *
 * Dropping the unsubscribed entries is deliberate and is the stale-forever
 * fix: their data just moved underneath them and nothing on screen is
 * showing them, so a re-visit must go back to the server. The LRU cap
 * governs plain navigation; an invalidation clears the warm set outright.
 */
export function invalidateMatrix(
  period?: string,
  includePending: boolean = false,
): Promise<void> {
  const key = cacheKey(period, includePending);
  const entry = registry.get(key) ?? null;

  for (const other of Array.from(registry.values())) {
    if (other === entry) continue;
    if (!isWarm(other)) continue;
    registry.delete(other.key);
  }

  if (!entry) return Promise.resolve();

  entry.generation += 1;
  entry.inFlight = false;
  entry.promise = null;
  touch(entry);

  if (entry.subscribers.size === 0) {
    cancelPendingRefetch(entry);
    registry.delete(key);
    return Promise.resolve();
  }

  if (entry.snapshot.error) {
    publish(entry, { error: null, loading: !entry.snapshot.data });
  }
  return scheduleRefetch(entry);
}

function subscribeToMatrix(
  period: string | undefined,
  includePending: boolean,
  onStoreChange: () => void,
): () => void {
  const entry = getOrCreateEntry(period, includePending);
  entry.subscribers.add(onStoreChange);
  touch(entry);
  const settled = entry.snapshot.data !== null || entry.snapshot.error !== null;
  if (!settled && !entry.inFlight && entry.refetchTimer === null) {
    startFetch(entry);
  }
  return () => {
    entry.subscribers.delete(onStoreChange);
    touch(entry);
    if (entry.subscribers.size === 0) {
      if (entry.refetchTimer !== null) {
        // The last watcher left before the coalesced refetch fired — no one
        // is waiting for it. Drop the entry rather than spend the request.
        cancelPendingRefetch(entry);
        registry.delete(entry.key);
        return;
      }
      enforceWarmCap();
    }
  };
}

function readSnapshot(key: string): MatrixSnapshot {
  return registry.get(key)?.snapshot ?? COLD_SNAPSHOT;
}

/**
 * SSR snapshot. The registry is client-only (nothing populates it during a
 * server render), so the server always reports the cold state and hydration
 * starts from the same place.
 */
function getServerSnapshot(): MatrixSnapshot {
  return COLD_SNAPSHOT;
}

export function useMatrix(
  period?: string,
  includePending: boolean = false,
  options: UseMatrixOptions = {},
): UseMatrixResult {
  const enabled = options.enabled ?? true;
  // When no explicit period is passed, follow the terminal-wide selected period
  // (2026-06-03 terminal-audit P2) so every panel re-scopes together when the
  // user picks a quarter/month from the HeatMap chips. HeatMap passes its period
  // explicitly, which is the same store value, so all consumers stay in lockstep.
  const storePeriod = useTerminalStore((s) => s.selectedPeriod);
  const effectivePeriod = period ?? storePeriod;
  const key = cacheKey(effectivePeriod, includePending);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      // `enabled: false` subscribes to nothing and fetches nothing. Overlay
      // hosts mount their panels eagerly; this is what keeps the mobile
      // zero-request guarantee.
      if (!enabled) return () => {};
      return subscribeToMatrix(effectivePeriod, includePending, onStoreChange);
    },
    [effectivePeriod, includePending, enabled],
  );

  const getSnapshot = useCallback(() => readSnapshot(key), [key]);

  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const refresh = useCallback(
    () => invalidateMatrix(effectivePeriod, includePending),
    [effectivePeriod, includePending],
  );

  return useMemo(() => {
    const visibleLoading =
      enabled && (snapshot.loading || (!snapshot.data && !snapshot.error));
    return {
      matrix: snapshot.data,
      loading: visibleLoading,
      error: snapshot.error,
      refresh,
      revalidating: enabled && snapshot.revalidating,
    };
  }, [snapshot, enabled, refresh]);
}

/**
 * Test-only: clear the module-level registry between test runs.
 *
 * **Convention (mirror of `useCompanies` sub-19 pattern):** call from
 * `beforeEach` in EVERY test file that mocks `/api/indicators/matrix`
 * AT MODULE LEVEL. Additionally, call again INSIDE any test that
 * overrides `global.fetch` mid-suite — beforeEach reset alone is
 * insufficient because the first `it()` would have already populated
 * the cache from the success-path mock; per-test overrides need their
 * own reset to make the new mock visible.
 *
 * Reset BEFORE rendering, never with components still mounted: their
 * subscriptions belong to the entries this discards, so they would keep a
 * dead handle and re-read as cold. `cleanup()` in `afterEach` (every suite
 * here does it) makes that automatic.
 */
export function __resetMatrixCacheForTests(): void {
  for (const entry of Array.from(registry.values())) {
    // Bump the epoch so a request still in flight from the previous test
    // cannot publish into the next one.
    entry.generation += 1;
    entry.inFlight = false;
    entry.promise = null;
    cancelPendingRefetch(entry);
  }
  registry.clear();
  lruClock = 0;
}
