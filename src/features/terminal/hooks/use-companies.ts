"use client";

/**
 * Shared `useCompanies()` hook — single source of truth for the
 * `/api/companies` fetch across terminal panels.
 *
 * **Closes a multi-turn architectural 🔄** that surfaced when 4 terminal
 * surfaces (`PanelGrid`, `RelatedFunctionsMenu`, `AlertsPanel`,
 * `ScenarioPanel-via-similar-pattern`) all self-fetched `/api/companies`
 * on mount. At v1 scale (13 cos × 13 KB payload) the redundancy was
 * tolerable; at Phase F (60 cos × 80 inds matrix proxy) the duplicated
 * round-trips would compound with `/api/indicators/matrix` re-fetches.
 *
 * **Implementation strategy:**
 *  - Module-level cache (`cachedPromise`) so concurrent first-call
 *    consumers all subscribe to the SAME in-flight request — no
 *    thundering-herd on session start when multiple panels mount
 *    simultaneously.
 *  - Hook returns `{companies, idToCode, codeToId, loading, error,
 *    refresh}`. Refresh purges cache + re-fetches; useful after
 *    onboarding apply or company-rename flows.
 *  - Companies API returns a HIERARCHICAL tree: roots with embedded
 *    `children` array. Hook flattens for `idToCode` / `codeToId`
 *    convenience but keeps the original tree on `.companies` for
 *    consumers that want hierarchy (e.g. CompanyTree).
 *
 * **What this hook DOESN'T do (v1 scope):**
 *  - SSE-driven cache invalidation when companies change server-side
 *    (Phase B1+ already publishes `audit_events_changed` on company
 *    role-change; future hook v2 can subscribe and auto-refresh).
 *  - Cross-tab sync via BroadcastChannel.
 *  - Stale-while-revalidate (current 10s server-side `Cache-Control`
 *    handles browser-level coalescing).
 *
 * **API stability:** companies array shape mirrors `/api/companies`
 * GET response. If that endpoint changes, this hook AND callers
 * update in lockstep — single point of truth.
 */

import { useEffect, useMemo, useState } from "react";

/**
 * Sub-19: shape mirrors `CompanyTree`'s `CompanyNode` so PanelGrid can
 * pass-through the hook's output without casting. `country` and `level`
 * are extras CompanyTree consumes; included here for shape-parity.
 */
export interface CompanyTreeNode {
  id: string;
  code: string;
  name: string;
  industry?: string | null;
  country?: string | null;
  level?: number;
  parentCompanyId?: string | null;
  children?: CompanyTreeNode[];
  /** Phase 7.N — qualitative risk tags stored in Company.settings.riskTags.
   *  Examples: "subsidy_dependency", "non_transparent_structure", "data_absence".
   *  Rendered as small colored chips on CompanyTree rows. */
  riskTags?: string[];
}

export interface UseCompaniesResult {
  /** Hierarchical tree as returned by `/api/companies` GET. `null` until first resolve. */
  companies: readonly CompanyTreeNode[] | null;
  /** Flattened lookup: company UUID → code. Empty until first resolve. */
  idToCode: ReadonlyMap<string, string>;
  /** Flattened lookup: code → UUID. Empty until first resolve. */
  codeToId: ReadonlyMap<string, string>;
  /** True until first fetch resolves (success OR error). */
  loading: boolean;
  /** Set when the fetch fails; null on success. */
  error: string | null;
  /** Force re-fetch (purges module cache). Use after company CRUD flows. */
  refresh: () => Promise<void>;
}

interface CacheState {
  promise: Promise<readonly CompanyTreeNode[]>;
  data: readonly CompanyTreeNode[] | null;
  error: string | null;
}

let cache: CacheState | null = null;

function isCompanyNode(v: unknown): v is CompanyTreeNode {
  return (
    typeof v === "object" &&
    v !== null &&
    "id" in v &&
    "code" in v &&
    typeof (v as { id: unknown }).id === "string" &&
    typeof (v as { code: unknown }).code === "string"
  );
}

/** Extract Company.settings.riskTags from the raw API response object. */
function extractRiskTags(raw: unknown): string[] | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const settings = (raw as { settings?: unknown }).settings;
  if (typeof settings !== "object" || settings === null) return undefined;
  const tags = (settings as { riskTags?: unknown }).riskTags;
  if (!Array.isArray(tags)) return undefined;
  return tags.filter((t): t is string => typeof t === "string");
}

/** Recursively map a raw API company node to CompanyTreeNode. */
function mapCompanyNode(raw: unknown): CompanyTreeNode | null {
  if (!isCompanyNode(raw)) return null;
  const r = raw as CompanyTreeNode & { children?: unknown[]; settings?: unknown };
  return {
    ...r,
    riskTags: extractRiskTags(raw),
    children: r.children
      ? (r.children.map(mapCompanyNode).filter(Boolean) as CompanyTreeNode[])
      : undefined,
  };
}

function fetchCompanies(): Promise<readonly CompanyTreeNode[]> {
  return fetch("/api/companies")
    .then((r) => {
      if (!r.ok) throw new Error(`/api/companies ${r.status}`);
      return r.json();
    })
    .then((data: unknown): readonly CompanyTreeNode[] => {
      // /api/companies returns a flat-array of roots with embedded
      // `children`. Defensive shape-check to handle a future {companies}
      // wrapper without breaking the hook.
      const rawArr = Array.isArray(data)
        ? data
        : typeof data === "object" &&
            data !== null &&
            "companies" in data &&
            Array.isArray((data as { companies: unknown }).companies)
          ? (data as { companies: unknown[] }).companies
          : [];
      return rawArr
        .map(mapCompanyNode)
        .filter((n): n is CompanyTreeNode => n !== null);
    });
}

function ensureCache(): Promise<readonly CompanyTreeNode[]> {
  if (!cache) {
    const promise = fetchCompanies();
    cache = { promise, data: null, error: null };
    promise
      .then((data) => {
        if (cache) cache.data = data;
      })
      .catch((e: unknown) => {
        if (cache)
          cache.error = e instanceof Error ? e.message : String(e);
      });
  }
  return cache.promise;
}

function buildIdToCode(
  nodes: readonly CompanyTreeNode[],
): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (arr: readonly CompanyTreeNode[]) => {
    for (const n of arr) {
      out.set(n.id, n.code);
      if (n.children && n.children.length > 0) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function buildCodeToId(
  nodes: readonly CompanyTreeNode[],
): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (arr: readonly CompanyTreeNode[]) => {
    for (const n of arr) {
      out.set(n.code, n.id);
      if (n.children && n.children.length > 0) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

const EMPTY_MAP: ReadonlyMap<string, string> = new Map();

export function useCompanies(): UseCompaniesResult {
  const [companies, setCompanies] = useState<readonly CompanyTreeNode[] | null>(
    () => cache?.data ?? null,
  );
  const [error, setError] = useState<string | null>(() => cache?.error ?? null);
  const [loading, setLoading] = useState<boolean>(
    () => !(cache?.data || cache?.error),
  );

  useEffect(() => {
    let cancelled = false;
    // Subscribe to the cached promise — if cache is already resolved,
    // this returns immediately. If a concurrent caller is mid-fetch,
    // we share their result.
    ensureCache()
      .then((data) => {
        if (cancelled) return;
        setCompanies(data);
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
  }, []);

  // Architect Round-1 sub-19 closure: memoize per `companies` change.
  // Without this, every render rebuilds the full id↔code maps via tree
  // walks. At 13 cos negligible; at 60 cos × multi-consumer subscribe
  // pattern this compounds wasted work.
  const idToCode = useMemo<ReadonlyMap<string, string>>(
    () => (companies ? buildIdToCode(companies) : EMPTY_MAP),
    [companies],
  );
  const codeToId = useMemo<ReadonlyMap<string, string>>(
    () => (companies ? buildCodeToId(companies) : EMPTY_MAP),
    [companies],
  );

  const refresh = async (): Promise<void> => {
    cache = null;
    setLoading(true);
    setError(null);
    setCompanies(null);
    try {
      const data = await ensureCache();
      setCompanies(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return { companies, idToCode, codeToId, loading, error, refresh };
}

/**
 * Test-only: clear the module-level cache between test runs so
 * `vi.fn(fetch)` mocks aren't shared across files.
 *
 * **Convention (architect sub-19 💡 closure):** call from `beforeEach`
 * in EVERY test file that mocks `/api/companies` AT MODULE LEVEL.
 * Additionally, call again INSIDE any test that overrides `global.fetch`
 * mid-suite — beforeEach reset alone is insufficient because the first
 * `it()` would have already populated the cache from the success-path
 * mock; per-test fetch overrides need their own reset to make the new
 * mock visible. See `RelatedFunctionsMenu.test.tsx:182` and
 * `AlertsPanel.test.tsx:228,262` for examples.
 */
export function __resetCompaniesCacheForTests(): void {
  cache = null;
}
