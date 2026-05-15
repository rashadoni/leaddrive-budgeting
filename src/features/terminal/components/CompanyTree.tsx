"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bell, Star } from 'lucide-react';
import { useTerminalStore } from '../store/terminalStore';
import { useMatrix } from '../hooks/use-matrix';
import {
  computeCompositeByCompany,
  scoreToBand,
  type CompositeScore,
} from '@/lib/risk/composite-score';
import { statusShape } from '@/lib/risk/heatmap-matrix';

const PANEL_ID = 1;

// Sub-19 architect ⚠️ closure: canonical type lives in the hook
// (`useCompanies` returns `CompanyTreeNode[]`). Import + re-export
// here as `CompanyNode` to preserve existing public API of this file
// (other modules import `CompanyNode` from here) without duplicating
// the shape — drift is now compile-checked at the import boundary.
import type { CompanyTreeNode } from "../hooks/use-companies";
export type CompanyNode = CompanyTreeNode;

type Props = {
  companies: CompanyNode[];
  loading?: boolean;
  onSelect?: (code: string) => void;
};

export function CompanyTree({ companies, loading, onSelect }: Props) {
  const t = useTranslations('terminal');
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode);

  // Sub-27 cont'd Round-5 — composite score per company on tree node.
  // Same shared module-cache hook HeatMap uses; one source of truth for
  // matrix data across panels. Lookup by company.code (CompanyNode shape)
  // → company.id via the matrix; fallback null for unmatched (e.g. before
  // matrix lands).
  const { matrix } = useMatrix();
  const compositeByCode = useMemo(() => {
    if (!matrix) return new Map<string, CompositeScore>();
    const byId = computeCompositeByCompany(matrix.cells);
    const out = new Map<string, CompositeScore>();
    for (const co of matrix.companies) {
      const score = byId.get(co.id);
      if (score) out.set(co.code, score);
    }
    // CLI follow-up — derive parent composite from children average.
    // `computeCompositeByCompany` skips rollup-only cells (sub-groups
    // typically only have IND_HOLDING_REVENUE, which is a rollup), so
    // every level=1 node renders as "—" with raw scoring. Walk the
    // hierarchy via parentCompanyId (matrix payload now surfaces it) and
    // assign each parent the avg of its children's scores. We iterate
    // bottom-up by level descending so a holding umbrella inherits from
    // sub-groups that themselves just inherited from ops cos.
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
    // Process parents whose children all already have computed scores
    // first; iterate until no progress made (handles >2-level hierarchies).
    let progressed = true;
    let safety = 5; // depth cap (FO Holding has 3 levels max today)
    while (progressed && safety-- > 0) {
      progressed = false;
      for (const [parentId, kids] of childrenByParentId) {
        const parentCo = cosWithParent.find((c) => c.id === parentId);
        if (!parentCo) continue;
        const existing = out.get(parentCo.code);
        if (existing && existing.score !== null) continue; // already scored
        const kidScores = kids
          .map((k) => out.get(k.code))
          .filter((s): s is CompositeScore => !!s && s.score !== null);
        if (kidScores.length === 0) continue;
        const avg = Math.round(
          kidScores.reduce((acc, s) => acc + (s.score ?? 0), 0) / kidScores.length,
        );
        out.set(parentCo.code, {
          score: avg,
          band: scoreToBand(avg),
          contributingCount: kidScores.reduce((acc, s) => acc + s.contributingCount, 0),
          totalCount: kidScores.reduce((acc, s) => acc + s.totalCount, 0),
        });
        progressed = true;
      }
    }
    return out;
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

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (id: string) =>
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

  const onRowKeyDown = (e: React.KeyboardEvent, code: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      select(code);
    }
  };

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
                {industry} <span className="text-gray-600">({roots.length})</span>
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
          {filteredRoots.map((root) => renderRoot(root))}
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
    return (
      <li
        key={root.id}
        role="treeitem"
        aria-expanded={hasChildren ? !isCollapsed : undefined}
      >
        <div
          data-testid="company-tree-row"
          data-company-code={root.code}
          tabIndex={0}
          onClick={() => select(root.code)}
          onKeyDown={(e) => onRowKeyDown(e, root.code)}
          className={`flex items-center gap-1.5 px-1 py-0.5 cursor-pointer hover:bg-gray-800/40 focus:outline-none focus:ring-1 focus:ring-[#00D4AA]/40 ${
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
          <span className="text-gray-500 uppercase tracking-wider w-20 truncate">
            {root.code}
          </span>
          <CompositeMini score={compositeByCode.get(root.code)?.score ?? null} />
          <span className="flex-1 truncate">{root.name}</span>
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
                  data-testid="company-tree-row"
                  data-company-code={child.code}
                  tabIndex={0}
                  onClick={() => select(child.code)}
                  onKeyDown={(e) => onRowKeyDown(e, child.code)}
                  className={`flex items-center gap-1.5 px-1 py-0.5 cursor-pointer hover:bg-gray-800/40 focus:outline-none focus:ring-1 focus:ring-[#00D4AA]/40 ${
                    childActive ? 'bg-[#00D4AA]/10 text-[#00D4AA]' : ''
                  }`}
                >
                  <StarToggle
                    code={child.code}
                    starred={starredCompanyCodes.has(child.code)}
                    onToggle={toggleStarredCompany}
                  />
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
                  <CompositeMini score={compositeByCode.get(child.code)?.score ?? null} />
                  <span className="flex-1 truncate">{child.name}</span>
                  {child.industry && (
                    <span className="text-gray-600 text-[10px] uppercase">
                      {child.industry}
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

/**
 * Phase B4 — watchlist tab strip. 5 tabs: ALL / STARRED / ALERTED /
 * RECENT / SECTOR. Counter badges show populated counts where
 * available; ALERTED is null until HeatMap publishes (first matrix
 * fetch hasn't landed yet). Phase B4 v2 added SECTOR — regroups the
 * full tree by industry instead of narrowing it (architect Round-1
 * sub-4 plan deviation closure).
 */
type WatchlistTabKey = 'all' | 'starred' | 'alerted' | 'recent' | 'sector';

function WatchlistTabs(props: {
  active: WatchlistTabKey;
  onSelect: (tab: WatchlistTabKey) => void;
  starredCount: number;
  recentCount: number;
  alertedCount: number | null;
  sectorCount: number;
}) {
  // Phase 7.G Turn N — consolidated tab labels onto same hook used for aria-labels (was prop-drilled).
  const tt = useTranslations('terminal');
  // Architect Round-1 closure (sub-4 💡): emojis swapped to lucide
  // icons for cross-platform parity (Linux/Windows often miss color
  // emoji fonts, rendering ★🔔 as monochrome boxes).
  const tabs: Array<{
    key: WatchlistTabKey;
    label: string;
    icon?: React.ReactNode;
    badge: number | null;
  }> = [
    { key: 'all', label: tt('companyTree.tabAll'), badge: null },
    {
      key: 'starred',
      label: '',
      icon: <Star size={11} />,
      badge: props.starredCount || null,
    },
    {
      key: 'alerted',
      label: '',
      icon: <Bell size={11} />,
      badge: props.alertedCount,
    },
    { key: 'recent', label: tt('companyTree.tabRecent'), badge: props.recentCount || null },
    { key: 'sector', label: tt('companyTree.tabSector'), badge: props.sectorCount || null },
  ];
  return (
    <div
      role="tablist"
      aria-label={tt('companyTree.tabsAriaLabel')}
      className="flex items-center gap-1 px-1 pt-1 text-[10px] font-mono shrink-0"
    >
      {tabs.map((t) => {
        const isActive = props.active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={
              t.key === 'starred'
                ? tt('companyTree.starredAriaLabel')
                : t.key === 'alerted'
                  ? tt('companyTree.alertedAriaLabel')
                  : undefined
            }
            onClick={() => props.onSelect(t.key)}
            className={`px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1 ${
              isActive
                ? 'border-[#00D4AA]/60 bg-[#00D4AA]/10 text-[#00D4AA]'
                : 'border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700'
            }`}
          >
            {t.icon}
            {t.label && <span>{t.label}</span>}
            {t.badge !== null && t.badge > 0 && (
              <span className="text-[9px] tabular-nums opacity-75">
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Star toggle button — sits at the start of each company row, BOTH at
 * sub-group (level=1 container) AND operational (level=2 leaf) rows.
 *
 * Sub-group starring is intentional unit-pin semantic (architect
 * Round-1 jsdoc closure): starring AAC pins the sub-group itself for
 * the STARRED tab filter. It does NOT auto-pin children. If a customer
 * wants to track all of AAC, they can star both the AAC sub-group AND
 * AAC-MAIN (or any specific operational under it). The STARRED filter
 * passes a row through if its OWN code is in the starred set; sub-
 * group children appear when their parent passes (header) OR when
 * their own code is starred.
 *
 * Click stops propagation so the row's click-to-select doesn't fire.
 * Filled star = starred; outlined = not.
 */
/**
 * Sub-27 cont'd Round-5 — tiny composite-score chip for tree rows.
 * Mirrors the HeatMap row-header CompositeBadge but smaller (suited to
 * tree-row density). Suppresses zero-state visual when no score (rollup
 * rows + sub-groups without scoreable cells render the badge dimmed).
 */
function CompositeMini({ score }: { score: number | null }) {
  if (score === null) {
    return null;
  }
  const tone =
    score >= 67 ? '#00D4AA' : score >= 34 ? '#FFB020' : '#FF4757';
  // Tier-3 sub-29 M7 — color-blind safe redundant signal. Round-15
  // architect 💡 closure — DRY: route band → statusShape() so glyph
  // mapping stays single-source-of-truth in heatmap-matrix.ts.
  const band = score >= 67 ? 'green' : score >= 34 ? 'amber' : 'red';
  const shape = statusShape(band);
  return (
    <span
      className="font-mono tabular-nums text-[9px] px-1 py-0 rounded shrink-0 font-bold"
      style={{
        color: tone,
        backgroundColor: `${tone}1A`,
        border: `1px solid ${tone}33`,
      }}
      title={`Composite Risk ${score}/100`}
      aria-label={`Composite risk score ${score} of 100`}
    >
      <span aria-hidden="true" className="mr-0.5 opacity-70">
        {shape}
      </span>
      {/* CLI Bloomberg-sweep: "R" prefix disambiguates badge as RISK score
          (0–100), not a count or revenue thousand. Bloomberg convention:
          always tag scale + unit. */}
      <span className="opacity-60 mr-px">R</span>{score}
    </span>
  );
}

/**
 * Phase 7.I — synthetic "ALL" row that resets HeatMap to show every
 * company. Highlighted when activeCompanyCode is null (default).
 *
 * Rendered above the actual root list so it's the first row a user sees,
 * matching the user's mental model: "ALL is the default; pick a company
 * to drill in." Clicking any actual company row sets activeCompanyCode,
 * which un-highlights this row and filters HeatMap to that single company.
 */
function AllRow({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  const t = useTranslations('terminal');
  return (
    <li role="treeitem" aria-selected={active}>
      <div
        data-testid="company-tree-all-row"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        }}
        title={t('companyTree.allRowDescription')}
        aria-label={t('companyTree.allRowAriaLabel')}
        className={`flex items-center gap-1.5 px-1 py-0.5 cursor-pointer hover:bg-gray-800/40 focus:outline-none focus:ring-1 focus:ring-[#00D4AA]/40 border-b border-gray-800/60 mb-1 ${
          active ? 'bg-[#00D4AA]/10 text-[#00D4AA]' : 'text-gray-400'
        }`}
      >
        <span className="w-3 text-center text-gray-600" aria-hidden="true">
          ◉
        </span>
        <span className="w-3 text-center" aria-hidden="true">
          {' '}
        </span>
        <span className="uppercase tracking-wider w-20 truncate font-semibold">
          {t('companyTree.allRowLabel')}
        </span>
        <span className="flex-1 truncate text-[10px] text-gray-600">
          {t('companyTree.allRowDescription')}
        </span>
      </div>
    </li>
  );
}

function StarToggle(props: {
  code: string;
  starred: boolean;
  onToggle: (code: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        props.onToggle(props.code);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          props.onToggle(props.code);
        }
      }}
      aria-pressed={props.starred}
      aria-label={props.starred ? `Unstar ${props.code}` : `Star ${props.code}`}
      title={props.starred ? 'Starred' : 'Star this company'}
      className={`w-3 text-center text-[11px] focus:outline-none transition-colors ${
        props.starred
          ? 'text-[#FFB020] hover:text-[#FFA502]'
          : 'text-gray-700 hover:text-gray-400'
      }`}
    >
      <Star
        size={11}
        fill={props.starred ? 'currentColor' : 'none'}
        strokeWidth={props.starred ? 0 : 1.5}
        aria-hidden="true"
      />
    </button>
  );
}
