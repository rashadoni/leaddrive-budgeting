"use client";

import Link from 'next/link';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useTerminalStore } from '../store/terminalStore';
import { useMatrix } from '../hooks/use-matrix';
import {
  computeCompositeByCompany,
  deriveParentComposites,
  type CompositeScore,
} from '@/lib/risk/composite-score';
import {
  computeCompanyTrustStatus,
  type TrustStatus,
} from '@/lib/risk/trust-status';
import { Archive } from 'lucide-react';

const PANEL_ID = 1;

// Sub-19 architect ⚠️ closure: canonical type lives in the hook
// (`useCompanies` returns `CompanyTreeNode[]`). Import + re-export
// here as `CompanyNode` to preserve existing public API of this file
// (other modules import `CompanyNode` from here) without duplicating
// the shape — drift is now compile-checked at the import boundary.
import type { CompanyTreeNode } from "../hooks/use-companies";
import { buildRiskTagsByCompanyId } from "../hooks/use-companies";
export type CompanyNode = CompanyTreeNode;
import { INDUSTRIES } from "@/lib/industries/data";
// Phase 8 D1 (2026-05-29) — Panel-1 presentational subcomponents extracted to a sibling.
import {
  WatchlistTabs,
  ReadinessChip,
  CompositeMini,
  RowFreshness,
  AllRow,
  TrustBadge,
  RiskTagChips,
  PendingPill,
  StarToggle,
} from "./company-tree/subcomponents";


type Props = {
  companies: CompanyNode[];
  loading?: boolean;
  onSelect?: (code: string) => void;
};

export function CompanyTree({ companies, loading, onSelect }: Props) {
  const t = useTranslations('terminal');
  const locale = useLocale() as 'en' | 'ru' | 'az';
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode);

  /** Locale-aware code → industry name map. */
  const INDUSTRY_LABEL = useMemo(
    () =>
      new Map(
        INDUSTRIES.map((i) => {
          const label =
            locale === 'en'
              ? i.nameEn
              : locale === 'az'
                ? (i.nameAz ?? i.nameEn)
                : (i.nameRu ?? i.nameEn)
          return [i.code, label]
        }),
      ),
    [locale],
  );

  // Truth-infra C.3 — admin "Show pending" toggle. Default off → matrix
  // excludes onboarding-pending companies (the cleanest operating view).
  // When toggled on, useMatrix refetches with `?includePending=true` and
  // the tree renders newly-visible companies with a small "pending" pill.
  const [showPending, setShowPending] = useState(false);

  // Sub-27 cont'd Round-5 — composite score per company on tree node.
  // Same shared module-cache hook HeatMap uses; one source of truth for
  // matrix data across panels. Lookup by company.code (CompanyNode shape)
  // → company.id via the matrix; fallback null for unmatched (e.g. before
  // matrix lands).
  const { matrix } = useMatrix(undefined, showPending);

  // Truth-infra C.3 — pendingCodes derived from matrix.companies. Only
  // populated when showPending is on (otherwise matrix excludes pending
  // entirely). Used to render the "pending" pill next to TrustBadge.
  const pendingCodes = useMemo(() => {
    if (!matrix || !showPending) return new Set<string>();
    return new Set(
      matrix.companies
        .filter((co) => co.status === 'pending')
        .map((co) => co.code),
    );
  }, [matrix, showPending]);
  const compositeByCode = useMemo(() => {
    if (!matrix) return new Map<string, CompositeScore>();
    // Phase 7.N wiring: derive id → riskTags map from the tree prop
    // so the composite-score helper can apply per-tag penalty
    // (subsidy_dependency -5, non_transparent_structure -8,
    // data_absence -12; clamped to ≥0). Shared with HeatMap (Panel 2)
    // via `buildRiskTagsByCompanyId` so both panels apply identical
    // penalties — see the helper's doc-comment for the divergence this
    // closes.
    const riskTagsByCompanyId = buildRiskTagsByCompanyId(companies);
    const byId = computeCompositeByCompany(matrix.cells, undefined, riskTagsByCompanyId);
    // Derive parent/holding composites from children — REVENUE-WEIGHTED so a
    // 0-revenue shell (e.g. a JV "awaiting data") can't inflate a holding.
    // Shared helper → byte-identical to the HeatMap row headers (Panel 2);
    // `matrix.companies` carries `parentCompanyId` + `revenue`. (Replaces the
    // old unweighted children-average that gave AZSEKER 48 vs the heatmap's
    // "—"; now both show the same revenue-weighted ~45.)
    const fullById = deriveParentComposites(matrix.companies, byId);
    const out = new Map<string, CompositeScore>();
    for (const co of matrix.companies) {
      const score = fullById.get(co.id);
      if (score) out.set(co.code, score);
    }
    return out;
  }, [matrix, companies]);
  // Phase 8 A4 — per-company data-freshness, keyed by code: MAX(computedAt)
  // across the entity's matrix cells, then sub-groups inherit MAX(own,
  // descendants) via the same parent-walk as compositeByCode. ISO strings
  // sort lexicographically === chronologically (same comparison the matrix
  // route uses for the org-wide aggregate). Drives the RowFreshness chip.
  const freshnessByCode = useMemo<Map<string, string>>(() => {
    if (!matrix) return new Map<string, string>();
    const byId = new Map<string, string>();
    for (const c of matrix.cells) {
      const ts = c.computedAt;
      if (!ts) continue;
      const prev = byId.get(c.companyId);
      if (!prev || ts > prev) byId.set(c.companyId, ts);
    }
    const out = new Map<string, string>();
    for (const co of matrix.companies) {
      const ts = byId.get(co.id);
      if (ts) out.set(co.code, ts);
    }
    type MatrixCo = (typeof matrix.companies)[number] & { parentCompanyId?: string | null };
    const cosWithParent = matrix.companies as ReadonlyArray<MatrixCo>;
    const childrenByParentId = new Map<string, MatrixCo[]>();
    for (const co of cosWithParent) {
      const pid = co.parentCompanyId ?? null;
      if (pid === null) continue;
      const list = childrenByParentId.get(pid);
      if (list) list.push(co);
      else childrenByParentId.set(pid, [co]);
    }
    let progressed = true;
    let safety = 5;
    while (progressed && safety-- > 0) {
      progressed = false;
      for (const [parentId, kids] of childrenByParentId) {
        const parentCo = cosWithParent.find((c) => c.id === parentId);
        if (!parentCo) continue;
        let maxTs = out.get(parentCo.code) ?? null;
        for (const k of kids) {
          const kt = out.get(k.code);
          if (kt && (!maxTs || kt > maxTs)) maxTs = kt;
        }
        if (maxTs && maxTs !== out.get(parentCo.code)) {
          out.set(parentCo.code, maxTs);
          progressed = true;
        }
      }
    }
    return out;
  }, [matrix]);
  // Phase 7.M Step 5 (2026-05-19) — per-company readiness map keyed by
  // code. Direct from `co.readiness` for ops cos; parents inherit the
  // WORST tier of their direct children (a holding with one empty
  // subsidiary should read "thin", not the average). Tier propagation
  // mirrors the trust-status worst-child pattern.
  const readinessByCode = useMemo<
    Map<
      string,
      { score: number; tier: 'complete' | 'good' | 'partial' | 'thin' | 'empty' }
    >
  >(() => {
    if (!matrix) return new Map();
    const direct = new Map<
      string,
      { score: number; tier: 'complete' | 'good' | 'partial' | 'thin' | 'empty' }
    >();
    type MatrixCo = (typeof matrix.companies)[number] & {
      parentCompanyId?: string | null;
    };
    const cos = matrix.companies as ReadonlyArray<MatrixCo>;
    for (const co of cos) {
      if (co.readiness) {
        direct.set(co.code, { score: co.readiness.score, tier: co.readiness.tier });
      }
    }
    // Parent worst-of-children pass.
    const childrenByParentId = new Map<string, MatrixCo[]>();
    for (const co of cos) {
      const pid = co.parentCompanyId ?? null;
      if (pid === null) continue;
      const list = childrenByParentId.get(pid);
      if (list) list.push(co);
      else childrenByParentId.set(pid, [co]);
    }
    const tierRank = {
      empty: 0,
      thin: 1,
      partial: 2,
      good: 3,
      complete: 4,
    } as const;
    let safety = 5;
    let progressed = true;
    while (progressed && safety-- > 0) {
      progressed = false;
      for (const [parentId, kids] of childrenByParentId) {
        const parentCo = cos.find((c) => c.id === parentId);
        if (!parentCo) continue;
        if (direct.has(parentCo.code)) continue;
        const kidEntries = kids
          .map((k) => direct.get(k.code))
          .filter((e): e is { score: number; tier: 'complete' | 'good' | 'partial' | 'thin' | 'empty' } => !!e);
        if (kidEntries.length === 0) continue;
        // Worst-of-children: lowest tierRank wins.
        let worst = kidEntries[0];
        for (const e of kidEntries) {
          if (tierRank[e.tier] < tierRank[worst.tier]) worst = e;
        }
        const avgScore = Math.round(
          kidEntries.reduce((a, b) => a + b.score, 0) / kidEntries.length,
        );
        direct.set(parentCo.code, { score: avgScore, tier: worst.tier });
        progressed = true;
      }
    }
    return direct;
  }, [matrix]);
  // Financial-truth-infra Phase B.1 — per-company trust status badge.
  // Walks the cell list once per matrix change, returns a Map keyed by
  // company.code so row render is O(1) lookup. For sub-groups whose own
  // row has no IVs (rollup-only), we union their descendants' cells so
  // the parent badge reflects the worst child state.
  const trustByCode = useMemo<Map<string, TrustStatus>>(() => {
    if (!matrix) return new Map();
    const direct = new Map<string, TrustStatus>();
    for (const co of matrix.companies) {
      direct.set(co.code, computeCompanyTrustStatus(co.id, matrix.cells));
    }
    // Walk children → propagate worst child status up to parent. Trust
    // ordering: suspicious < partial < pending < verified (lowest wins).
    type WithParent = (typeof matrix.companies)[number] & { parentCompanyId?: string | null };
    const cosWithParent = matrix.companies as ReadonlyArray<WithParent>;
    const childrenByParentId = new Map<string, WithParent[]>();
    for (const c of cosWithParent) {
      if (!c.parentCompanyId) continue;
      const list = childrenByParentId.get(c.parentCompanyId);
      if (list) list.push(c);
      else childrenByParentId.set(c.parentCompanyId, [c]);
    }
    const order: TrustStatus[] = ['suspicious', 'partial', 'pending', 'verified'];
    const worstOf = (a: TrustStatus, b: TrustStatus): TrustStatus =>
      order.indexOf(a) < order.indexOf(b) ? a : b;
    let progressed = true;
    let safety = 5;
    while (progressed && safety-- > 0) {
      progressed = false;
      for (const [parentId, kids] of childrenByParentId) {
        const parent = cosWithParent.find((c) => c.id === parentId);
        if (!parent) continue;
        const existing = direct.get(parent.code) ?? 'pending';
        let agg: TrustStatus | null = null;
        for (const k of kids) {
          const ks = direct.get(k.code);
          if (!ks) continue;
          agg = agg === null ? ks : worstOf(agg, ks);
        }
        if (!agg) continue;
        // Parent inherits the worst of (its own resolved status, worst
        // descendant) — a single child marked `suspicious` should bubble
        // up to the holding row so a user scanning the tree sees the red
        // dot at the root, not just on the deeply-nested entity.
        const merged = worstOf(existing, agg);
        if (merged !== existing) {
          direct.set(parent.code, merged);
          progressed = true;
        }
      }
    }
    return direct;
  }, [matrix]);
  // User-driven row clicks → selectCompany (tracks LRU recent).
  const storeSetCompany = useTerminalStore((s) => s.selectCompany);
  // Phase 7.I — "ALL" synthetic row clears the active company so HeatMap
  // shows every company again. Default state on first mount.
  const clearCompany = useTerminalStore((s) => s.clearCompany);
  const search = useTerminalStore((s) => s.searchByPanel[PANEL_ID] ?? '');
  const setSearch = useTerminalStore((s) => s.setSearchForPanel);
  const clearSearch = useTerminalStore((s) => s.clearSearchForPanel);
  // Phase B4 — watchlist tab + starred + recent + alerted slices.
  const watchlistTab = useTerminalStore((s) => s.watchlistTab);
  const setWatchlistTab = useTerminalStore((s) => s.setWatchlistTab);
  const starredCompanyCodes = useTerminalStore((s) => s.starredCompanyCodes);
  const toggleStarredCompany = useTerminalStore((s) => s.toggleStarredCompany);
  const recentCompanyCodes = useTerminalStore((s) => s.recentCompanyCodes);
  const alertedCompanyCodes = useTerminalStore((s) => s.alertedCompanyCodes);
  const select = onSelect ?? storeSetCompany;
  const searchInputRef = useRef<HTMLInputElement>(null);
  // `mounted` flips to true after first client commit; until then we
  // render the same minimal placeholder the server emitted so React's
  // hydration diff has nothing to complain about. Prevents the Phase
  // 7.D class of bug where the SSR-cached component shape differs from
  // the post-edit client bundle.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // `/`-search bridge: CommandBar dispatches a focus event when the active
  // panel is 1; we focus our search input.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ panelId: number }>).detail;
      if (detail?.panelId === PANEL_ID) {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('terminal:focus-search', handler as EventListener);
    return () =>
      window.removeEventListener('terminal:focus-search', handler as EventListener);
  }, []);

  // Filter is applied to the tree-as-flat: a sub-group matches if its own
  // code/name does, OR any of its operational children match. When the
  // sub-group itself doesn't match but a child does, only the matching
  // children render (parent shown as a header for context).
  const matchesQuery = (c: CompanyNode, q: string): boolean => {
    if (q === '') return true;
    return (
      c.code.toUpperCase().includes(q) ||
      c.name.toUpperCase().includes(q) ||
      (c.industry ?? '').toUpperCase().includes(q)
    );
  };

  /**
   * Phase B4 — apply the active watchlist tab as a code-set filter on
   * top of the existing search filter. 'all' = pass-through. 'starred'
   * / 'alerted' / 'recent' produce a Set<code>; companies (and their
   * children) outside that set are dropped. Sub-group rows whose own
   * code is NOT in the set but whose children include matches stay
   * rendered as a header for context (same shape as search filtering).
   */
  // Use the source set/array directly — wrapping in `new Set(...)` would
  // re-allocate on every render-trigger and defeat the source's reference
  // equality (architect Round-1 ⚠️ closure). For 'recent' the array is
  // small (≤RECENT_LIMIT=10) so a per-call `.includes()` is fine; for
  // 'starred'/'alerted' the source is already a Set with O(1) `.has()`.
  const watchlistCodeFilter = useMemo<
    ReadonlySet<string> | readonly string[] | null
  >(() => {
    if (watchlistTab === 'all') return null;
    if (watchlistTab === 'starred') return starredCompanyCodes;
    if (watchlistTab === 'alerted') return alertedCompanyCodes ?? new Set();
    if (watchlistTab === 'recent') return recentCompanyCodes;
    // 'sector' tab does NOT narrow the company list — it regroups
    // filteredRoots into industry sections (rendered below).
    if (watchlistTab === 'sector') return null;
    return null;
  }, [watchlistTab, starredCompanyCodes, alertedCompanyCodes, recentCompanyCodes]);

  const filteredRoots = useMemo<CompanyNode[]>(() => {
    const passesWatchlist = (c: CompanyNode): boolean => {
      const filter = watchlistCodeFilter;
      if (!filter) return true;
      // Discriminate on shape — Set has .has, array uses .includes.
      // TypeScript's `Array.isArray` doesn't narrow `readonly string[]`
      // out of the union here, so we hint via `as`.
      if (Array.isArray(filter)) {
        return (filter as readonly string[]).includes(c.code);
      }
      return (filter as ReadonlySet<string>).has(c.code);
    };
    const q = search.trim().toUpperCase();
    const allRoots = companies.filter((c) => !c.parentCompanyId);
    const result: CompanyNode[] = [];
    for (const root of allRoots) {
      const allChildren = root.children ?? [];
      const childrenAfterWatchlist = allChildren.filter(passesWatchlist);
      const childrenAfterSearch = childrenAfterWatchlist.filter((c) =>
        matchesQuery(c, q),
      );

      const rootPassesWatchlist = passesWatchlist(root);
      const rootMatchesSearch = matchesQuery(root, q);

      if (rootPassesWatchlist && rootMatchesSearch) {
        // Root visible: render with watchlist-passing children
        // (regardless of search) so a starred sub-group still shows
        // its operationals when 'starred' tab is active. If a search
        // query is set, narrow children to search-matching too.
        result.push({
          ...root,
          children: q === '' ? childrenAfterWatchlist : childrenAfterSearch,
        });
      } else if (childrenAfterSearch.length > 0) {
        // Root itself doesn't pass — but a child does. Keep the root as
        // a header for context with only the matching children.
        result.push({ ...root, children: childrenAfterSearch });
      }
    }
    return result;
  }, [companies, search, watchlistCodeFilter]);

  /**
   * Phase B4 v2 — sector grouping for the SECTOR tab. Groups
   * filteredRoots (level=1 sub-groups + level=2 ops cos with no
   * parent) by `industry` field; companies with no industry land in
   * "Other". Sorted by industry name alphabetically; "Other" pinned
   * last so the user sees explicit industries first. Used both for
   * the `sectorCount` badge and the alternative render branch.
   */
  const sectorGroups = useMemo<Array<{ industry: string; roots: CompanyNode[] }>>(() => {
    const map = new Map<string, CompanyNode[]>();
    for (const root of filteredRoots) {
      const key = (root.industry?.trim() || 'Other');
      const list = map.get(key);
      if (list) list.push(root);
      else map.set(key, [root]);
    }
    const sorted = Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return a.localeCompare(b);
    });
    return sorted.map(([industry, roots]) => ({ industry, roots }));
  }, [filteredRoots]);

  /**
   * Phase 7.K 2026-05-18 — pin real sub-groups before macro placeholders.
   *
   * `filteredRoots` arrives in DB-insertion order which interleaves the
   * 10 DEMO-* macro placeholders (created later) with the 2 real
   * sub-groups (AZSEKER + AZMADE). The user-facing tree should lead
   * with real operating companies; placeholders are context-only and
   * belong at the bottom of the list.
   *
   * Priority bands:
   *   0 — AZSEKER (largest sub-group, food/agro pilot)
   *   1 — AZMADE (industrial sub-group)
   *   2 — any other real top-level (ATL standalone, etc.) — alphabetic
   *   3 — DEMO-* macro placeholders — alphabetic
   *
   * Watchlist filter passed-roots are sorted in place by priority then
   * by original DB position within the same priority band.
   */
  const sortedFilteredRoots = useMemo<CompanyNode[]>(() => {
    const priority = (c: CompanyNode): number => {
      if (c.code === 'AZSEKER') return 0;
      if (c.code === 'AZMADE') return 1;
      if (c.code.startsWith('DEMO-')) return 3;
      return 2;
    };
    return [...filteredRoots].sort((a, b) => {
      const pa = priority(a);
      const pb = priority(b);
      if (pa !== pb) return pa - pb;
      return a.code.localeCompare(b.code);
    });
  }, [filteredRoots]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  const onRowKeyDown = (e: React.KeyboardEvent, code: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(code);
    }
  };

  const dataResetHref = (code: string) =>
    `/budgeting/admin/ai-import?forEntity=${encodeURIComponent(code)}&year=${new Date().getFullYear()}#import-cleanup`;

  // The all-roots check (vs filteredRoots) keeps "no matches" from
  // appearing as the same empty-state message as "no companies onboarded".
  const allRoots = companies.filter((c) => !c.parentCompanyId);
  const isEmpty = !loading && !allRoots.length;

  // Pre-mount: render a deterministic placeholder so server HTML matches
  // first client render. Avoids the SSR/CSR drift class of bug after a
  // hot-reload of this file.
  if (!mounted) {
    return (
      <div className="font-mono text-xs text-gray-700 w-full">
        {t('companyTree.loading')}
      </div>
    );
  }

  return (
    <div className="font-mono text-xs text-gray-300 w-full h-full flex flex-col gap-1">
      {/* Phase B4 — watchlist tabs. Sits above the search input so the
          tab choice scopes the search results, not the other way round.
          'Alerted' badge shows count when alertedCompanyCodes is non-empty. */}
      <WatchlistTabs
        active={watchlistTab}
        onSelect={setWatchlistTab}
        starredCount={starredCompanyCodes.size}
        recentCount={recentCompanyCodes.length}
        alertedCount={alertedCompanyCodes ? alertedCompanyCodes.size : null}
        sectorCount={sectorGroups.length}
      />
      {/* Search input renders unconditionally (even on empty state) so
          the `/`-search keyboard shortcut always lands on a visible
          target — UX consistency over hiding-when-useless. */}
      <div className="flex items-center gap-1 sticky top-0 bg-[#0A0E27] py-1 z-10">
        <span className="text-gray-600">/</span>
        <input
          ref={searchInputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(PANEL_ID, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              clearSearch(PANEL_ID);
              searchInputRef.current?.blur();
              e.stopPropagation();
            }
          }}
          placeholder={t('companyTree.filterPlaceholder')}
          className="bg-[#0A0E27] border border-gray-800 rounded px-1.5 py-0.5 text-[10px] text-gray-200 placeholder-gray-700 focus:border-[#00D4AA] focus:outline-none flex-1"
          spellCheck={false}
          aria-label={t('companyTree.filterAriaLabel')}
        />
        {/* Truth-infra C.3 — admin "Show pending" toggle. Defaults to off
            (matrix excludes pending companies). Press to include pending
            entities (rendered with "pending" pill). */}
        <button
          type="button"
          onClick={() => setShowPending((v) => !v)}
          className={`text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
            showPending
              ? 'border-amber-700 bg-amber-950/40 text-amber-300'
              : 'border-gray-800 text-gray-600 hover:text-gray-400'
          }`}
          data-testid="company-tree-show-pending-toggle"
          aria-pressed={showPending}
          aria-label={t('companyTree.showPendingAriaLabel')}
          title={t('companyTree.showPendingTitle')}
        >
          {showPending ? t('companyTree.pendingShown') : t('companyTree.pendingHidden')}
        </button>
      </div>
      {watchlistTab === 'alerted' && alertedCompanyCodes === null ? (
        // Architect Round-1 closure (sub-4 💡): distinguished loading
        // state for ALERTED tab during the 1-2 sec window before HeatMap
        // matrix publishes alertedCompanyCodes (was: empty Set → looked
        // like "no matches").
        <span className="text-gray-600 px-1 py-2">{t('companyTree.loadingAlerts')}</span>
      ) : loading ? (
        <span className="text-gray-700 px-1 py-2">{t('companyTree.loading')}</span>
      ) : isEmpty ? (
        <span className="text-gray-700 px-1 py-2">
          {t('companyTree.noCompanies')}
        </span>
      ) : filteredRoots.length === 0 ? (
        <span className="text-gray-600 px-1 py-2">{t('companyTree.noMatchPrefix')} "{search}"</span>
      ) : watchlistTab === 'sector' ? (
        // Phase B4 v2 — SECTOR view groups roots by industry. Each
        // group gets a sticky-uppercase header; rows under it use the
        // same row-render logic as flat mode (extracted below).
        <ul
          role="tree"
          aria-label={t('companyTree.sectorTreeAriaLabel')}
          className="self-start space-y-0.5 w-full"
          data-testid="company-tree-sector-mode"
        >
          <AllRow active={activeCompanyCode === null} onSelect={clearCompany} />
          {sectorGroups.map(({ industry, roots }) => (
            <li key={industry} role="presentation">
              <div
                className="text-[9px] uppercase tracking-widest text-gray-500 px-1 py-1 mt-1 first:mt-0 border-b border-gray-800/40"
                data-testid={`sector-header-${industry}`}
              >
                {INDUSTRY_LABEL.get(industry) ?? industry}{" "}
                <span className="text-gray-600">({roots.length})</span>
              </div>
              <ul role="group" className="space-y-0.5">
                {roots.map((root) => renderRoot(root))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <ul
          role="tree"
          aria-label={t('companyTree.treeAriaLabel')}
          className="self-start space-y-0.5 w-full"
        >
          <AllRow active={activeCompanyCode === null} onSelect={clearCompany} />
          {sortedFilteredRoots.map((root) => renderRoot(root))}
        </ul>
      )}
    </div>
  );

  // Local helper — extracted so the SECTOR-grouped branch and the flat
  // tree branch share one row-render path. Closes over the component's
  // `collapsed`/`toggle`/`select`/`activeCompanyCode`/StarToggle state.
  function renderRoot(root: CompanyNode): React.ReactNode {
    const children = root.children ?? [];
    const isCollapsed = !!collapsed[root.id];
    const hasChildren = children.length > 0;
    const isActive = root.code === activeCompanyCode;
    // Phase 7.K 2026-05-18 — visual dim for macro-placeholder rows so
    // client demos can distinguish them at a glance from real
    // operational entities. Pure CSS opacity; row stays interactive.
    const isPlaceholder = root.code.startsWith('DEMO-');
    return (
      <li
        key={root.id}
        role="treeitem"
        aria-selected={isActive}
        aria-expanded={hasChildren ? !isCollapsed : undefined}
        className={isPlaceholder ? 'opacity-50' : undefined}
      >
        <div
          data-testid="company-tree-row"
          data-company-code={root.code}
          tabIndex={0}
          onClick={() => select(root.code)}
          onKeyDown={(e) => onRowKeyDown(e, root.code)}
          className={`group flex items-center gap-1.5 px-1 py-0.5 cursor-pointer hover:bg-gray-800/40 focus:outline-none focus:ring-1 focus:ring-[#00D4AA]/40 ${
            isActive ? 'bg-[#00D4AA]/10 text-[#00D4AA]' : ''
          }`}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-label={isCollapsed ? 'Expand' : 'Collapse'}
              onClick={(e) => {
                e.stopPropagation();
                toggle(root.id);
              }}
              className="text-gray-600 w-3 text-center hover:text-gray-300 focus:outline-none"
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className="w-3 text-center" aria-hidden="true">
              {' '}
            </span>
          )}
          <StarToggle
            code={root.code}
            starred={starredCompanyCodes.has(root.code)}
            onToggle={toggleStarredCompany}
          />
          <TrustBadge status={trustByCode.get(root.code) ?? 'pending'} />
          {pendingCodes.has(root.code) && <PendingPill label={t("companyTree.pendingPill")} ariaLabel={t("companyTree.pendingPillAriaLabel")} />}
          <span
            className="text-gray-500 uppercase tracking-wider w-20 truncate"
            title={root.code}
          >
            {root.code}
          </span>
          <ReadinessChip data={readinessByCode.get(root.code) ?? null} />
          <CompositeMini score={compositeByCode.get(root.code)?.score ?? null} />
          <RowFreshness iso={freshnessByCode.get(root.code) ?? null} />
          <span
            className="flex-1 truncate"
            // Phase 3.3 hover pattern — reveals fully-qualified
            // identifier when the company name truncates.
            title={`${root.code} — ${root.name}`}
          >
            {root.name}
          </span>
          <RiskTagChips tags={root.riskTags} />
          <Link
            href={dataResetHref(root.code)}
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex items-center gap-1 rounded border border-gray-700 bg-gray-900/80 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-gray-400 transition hover:border-amber-500/60 hover:text-amber-300 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-amber-400/50 ${
              isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            title={t('companyTree.dataResetTitle', { company: root.code })}
            aria-label={t('companyTree.dataResetTitle', { company: root.code })}
          >
            <Archive className="h-3 w-3" aria-hidden="true" />
            {t('companyTree.dataResetLabel')}
          </Link>
          {hasChildren && (
            <span
              className="text-gray-600 tabular-nums"
              aria-label={`${children.length} companies`}
            >
              {children.length}
            </span>
          )}
        </div>
        {hasChildren && !isCollapsed && (
          <ul
            role="group"
            className="ml-4 border-l border-gray-800/60 pl-2 mt-0.5 space-y-0.5"
          >
            {children.map((child) => {
              const childActive = child.code === activeCompanyCode;
              return (
                <li
                  key={child.id}
                  role="treeitem"
                  aria-selected={childActive}
                  data-testid="company-tree-row"
                  data-company-code={child.code}
                  tabIndex={0}
                  onClick={() => select(child.code)}
                  onKeyDown={(e) => onRowKeyDown(e, child.code)}
                  className={`group flex items-center gap-1.5 px-1 py-0.5 cursor-pointer hover:bg-gray-800/40 focus:outline-none focus:ring-1 focus:ring-[#00D4AA]/40 ${
                    childActive ? 'bg-[#00D4AA]/10 text-[#00D4AA]' : ''
                  }`}
                >
                  <StarToggle
                    code={child.code}
                    starred={starredCompanyCodes.has(child.code)}
                    onToggle={toggleStarredCompany}
                  />
                  <TrustBadge status={trustByCode.get(child.code) ?? 'pending'} />
                  {pendingCodes.has(child.code) && <PendingPill label={t("companyTree.pendingPill")} ariaLabel={t("companyTree.pendingPillAriaLabel")} />}
                  <span
                    className="text-gray-500 uppercase tracking-wider w-20 truncate"
                    title={child.code}
                  >
                    {/* CLI follow-up — strip parent code prefix in nested
                        children. The hierarchy is conveyed by indentation;
                        the redundant `AZSEKER-` prefix wastes label width. */}
                    {child.code.startsWith(root.code + '-')
                      ? child.code.slice(root.code.length + 1)
                      : child.code}
                  </span>
                  <ReadinessChip data={readinessByCode.get(child.code) ?? null} />
                  <CompositeMini score={compositeByCode.get(child.code)?.score ?? null} />
                  <RowFreshness iso={freshnessByCode.get(child.code) ?? null} />
                  <span
                    className="flex-1 truncate"
                    title={`${child.code} — ${child.name}`}
                  >
                    {child.name}
                  </span>
                  <RiskTagChips tags={child.riskTags} />
                  <Link
                    href={dataResetHref(child.code)}
                    onClick={(e) => e.stopPropagation()}
                    className={`inline-flex items-center gap-1 rounded border border-gray-700 bg-gray-900/80 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-gray-400 transition hover:border-amber-500/60 hover:text-amber-300 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-amber-400/50 ${
                      childActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    title={t('companyTree.dataResetTitle', { company: child.code })}
                    aria-label={t('companyTree.dataResetTitle', { company: child.code })}
                  >
                    <Archive className="h-3 w-3" aria-hidden="true" />
                    {t('companyTree.dataResetLabel')}
                  </Link>
                  {child.dataPendingBanner && (
                    <span
                      className="text-amber-400/80 text-[10px] italic px-1.5 py-0.5 rounded bg-amber-900/20 border border-amber-700/30"
                      title={child.dataPendingBanner}
                    >
                      ⏳ awaiting data
                    </span>
                  )}
                  {child.industry && (
                    <span className="text-gray-600 text-[10px]">
                      {INDUSTRY_LABEL.get(child.industry) ?? child.industry}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  }
}
