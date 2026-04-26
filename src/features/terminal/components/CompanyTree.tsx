"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTerminalStore } from '../store/terminalStore';

const PANEL_ID = 1;

export type CompanyNode = {
  id: string;
  code: string;
  name: string;
  industry?: string | null;
  country?: string | null;
  level?: number;
  parentCompanyId?: string | null;
  children?: CompanyNode[];
};

type Props = {
  companies: CompanyNode[];
  loading?: boolean;
  onSelect?: (code: string) => void;
};

export function CompanyTree({ companies, loading, onSelect }: Props) {
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode);
  const storeSetCompany = useTerminalStore((s) => s.setCompany);
  const search = useTerminalStore((s) => s.searchByPanel[PANEL_ID] ?? '');
  const setSearch = useTerminalStore((s) => s.setSearchForPanel);
  const clearSearch = useTerminalStore((s) => s.clearSearchForPanel);
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

  const filteredRoots = useMemo(() => {
    const q = search.trim().toUpperCase();
    const allRoots = companies.filter((c) => !c.parentCompanyId);
    if (q === '') return allRoots;
    return allRoots
      .map((root) => {
        const matchedChildren = (root.children ?? []).filter((child) =>
          matchesQuery(child, q),
        );
        if (matchesQuery(root, q)) return root; // include all children
        if (matchedChildren.length > 0) return { ...root, children: matchedChildren };
        return null;
      })
      .filter((r): r is CompanyNode => r !== null);
  }, [companies, search]);

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
        Loading…
      </div>
    );
  }

  return (
    <div className="font-mono text-xs text-gray-300 w-full flex flex-col gap-1">
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
          placeholder="filter companies…"
          className="bg-[#0A0E27] border border-gray-800 rounded px-1.5 py-0.5 text-[10px] text-gray-200 placeholder-gray-700 focus:border-[#00D4AA] focus:outline-none flex-1"
          spellCheck={false}
          aria-label="Filter company tree"
        />
      </div>
      {loading ? (
        <span className="text-gray-700 px-1 py-2">Loading…</span>
      ) : isEmpty ? (
        <span className="text-gray-700 px-1 py-2">
          No companies. Import via /budgeting/onboarding.
        </span>
      ) : filteredRoots.length === 0 ? (
        <span className="text-gray-600 px-1 py-2">No match for "{search}"</span>
      ) : (
        <ul
          role="tree"
          aria-label="Companies"
          className="self-start space-y-0.5 w-full"
        >
          {filteredRoots.map((root) => {
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
              <span className="text-gray-500 uppercase tracking-wider w-20 truncate">
                {root.code}
              </span>
              <span className="flex-1 truncate">{root.name}</span>
              {hasChildren && (
                <span className="text-gray-600 tabular-nums" aria-label={`${children.length} companies`}>
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
                      tabIndex={0}
                      onClick={() => select(child.code)}
                      onKeyDown={(e) => onRowKeyDown(e, child.code)}
                      className={`flex items-center gap-1.5 px-1 py-0.5 cursor-pointer hover:bg-gray-800/40 focus:outline-none focus:ring-1 focus:ring-[#00D4AA]/40 ${
                        childActive ? 'bg-[#00D4AA]/10 text-[#00D4AA]' : ''
                      }`}
                    >
                      <span className="text-gray-500 uppercase tracking-wider w-20 truncate">
                        {child.code}
                      </span>
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
      })}
        </ul>
      )}
    </div>
  );
}
