"use client";

import { useEffect, useRef, useState } from "react";
import { useTerminalStore } from "../store/terminalStore";
import { useCompanies } from "../hooks/use-companies";

/**
 * Bloomberg-style "Related Functions Menu" — context-aware dropdown next
 * to the `CO: <code>` breadcrumb in CommandBar. Surfaces the actions
 * relevant to the currently-active company. When no company is active,
 * links navigate to org-wide views (no `?company=` URL param).
 *
 * Phase A4 of the approved Bloomberg-uplift plan. Mounted by CommandBar.
 *
 * Implementation: fetches `/api/companies` once on mount to build a
 * code→id lookup table. The budgeting page's `?company=<id>` param
 * (Turn 30 work) requires the company id, but Risk Terminal store only
 * holds code; this component bridges the two without forcing a store
 * shape change. Fetch is cached for the component's lifetime.
 *
 * NOTE on the plan label "Variance" → "Compare" deviation: the approved
 * plan listed "P&L / Variance / Forecast / Audit"; no `?tab=variance`
 * route exists in the budgeting page (`src/components/sidebar.tsx:77`).
 * The closest existing surface is `?tab=comparison` (Plans-vs-Actuals
 * variance view), so the menu uses that. A real variance tab is a
 * Phase B item.
 */

interface CompanyLite {
  id: string;
  code: string;
}

const FUNCTIONS = [
  { tab: "pnl-report", label: "P&L" },
  { tab: "comparison", label: "Compare" },
  { tab: "forecast", label: "Forecast" },
  { tab: "audit", label: "Audit", isPage: true },
] as const;

export function RelatedFunctionsMenu() {
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode);
  const [open, setOpen] = useState(false);
  // Sub-19 architect 🔄 closure: was inline `/api/companies` fetch +
  // hand-rolled tree-walking. Swapped to shared `useCompanies()` hook
  // — single fetch shared across PanelGrid, AlertsPanel,
  // RelatedFunctionsMenu (and future consumers).
  const { codeToId } = useCompanies();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on Escape OR document mousedown outside the menu wrapper.
  // `onMouseLeave` alone (the original A4 implementation) was fragile —
  // user scrolling inside the dropdown OR clicking elsewhere on the
  // toolbar without crossing the boundary left the menu stuck open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    const onDocMouseDown = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDocMouseDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocMouseDown);
    };
  }, [open]);

  const activeCompanyId = activeCompanyCode
    ? codeToId.get(activeCompanyCode) ?? null
    : null;

  const buildHref = (tab: string, isPage: boolean) => {
    const params = activeCompanyId ? `?company=${activeCompanyId}` : "";
    if (isPage) return `/budgeting/${tab}${params}`;
    return `/budgeting?tab=${tab}${activeCompanyId ? `&company=${activeCompanyId}` : ""}`;
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center text-gray-400 hover:text-[#FFB800] transition-colors text-xs"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Related functions"
        title={
          activeCompanyCode
            ? `Open ${activeCompanyCode} in P&L / Compare / Forecast / Audit`
            : "Open holding-wide P&L / Compare / Forecast / Audit"
        }
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-44 bg-[#050814] border border-gray-800 rounded shadow-xl py-1 z-40"
        >
          <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-gray-600 border-b border-gray-800/60 mb-1">
            {activeCompanyCode ? `For ${activeCompanyCode}` : "Org-wide"}
          </div>
          {FUNCTIONS.map((fn) => (
            <a
              key={fn.tab}
              href={buildHref(fn.tab, "isPage" in fn && fn.isPage === true)}
              role="menuitem"
              className="block px-3 py-1 text-xs text-gray-300 hover:bg-gray-800 hover:text-[#FFB800] transition-colors"
              onClick={() => setOpen(false)}
            >
              {fn.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
