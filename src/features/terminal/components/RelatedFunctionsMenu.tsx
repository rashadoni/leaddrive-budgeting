"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
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
 * Phase 7.G Turn LIX — closes the 106-turn-stale "Variance" → "Compare"
 * deviation: a real `?tab=variance` route now ships in
 * `src/app/(dashboard)/budgeting/page.tsx:VarianceTab` (single-plan
 * plan-vs-actual % delta with materiality filter + sortable table).
 * Menu now lists BOTH `compare` (multi-plan side-by-side) and `variance`
 * (single-plan plan-vs-actual) since they serve different mental modes.
 *
 * Round-9 i18n closure — labels + section header + aria + title now
 * read through `useTranslations('terminal')` so RU/AZ users see the
 * primary-nav menu in their locale (was English-only).
 */

interface CompanyLite {
  id: string;
  code: string;
}

/** Static catalog: each entry pairs a query-tab/route with the i18n key
 *  that resolves its display label. The labelKey path is relative to
 *  the `relatedFunctions.*` namespace.
 *
 *  Phase 7.G Turn Q — Turn-40-sub5 architect 💡 closure (intentional-
 *  split documentation): the `audit` entry uses `isPage: true` to route
 *  via full-page nav to `/budgeting/audit`, while the `AUD GO` command-
 *  bar verb dispatches a `terminal:open-audit` modal event (stay-in-
 *  terminal). This is deliberate UX, not a bug:
 *    - **menu entry → page nav**: gives the user a full-screen surface
 *      with audit history, filters, search — context for "I'm investigating
 *      something specific";
 *    - **AUD GO verb → modal**: quick-glance of latest events without
 *      losing the terminal panel state — for "what just changed?".
 *  Different mental modes warrant different surfaces. Don't unify. */
const FUNCTIONS = [
  { tab: "pnl-report", labelKey: "pnl" },
  { tab: "comparison", labelKey: "compare" },
  { tab: "variance", labelKey: "variance" },
  { tab: "forecast", labelKey: "forecast" },
  { tab: "audit", labelKey: "audit", isPage: true },
] as const;

export function RelatedFunctionsMenu() {
  const t = useTranslations("terminal");
  const activeCompanyCode = useTerminalStore((s) => s.activeCompanyCode);
  const [open, setOpen] = useState(false);
  // Sub-19 architect 🔄 closure: was inline `/api/companies` fetch +
  // hand-rolled tree-walking. Swapped to shared `useCompanies()` hook
  // — single fetch shared across PanelGrid, AlertsPanel,
  // RelatedFunctionsMenu (and future consumers).
  //
  // Phase 7.G Turn Q — Turn-40-sub5 architect 💡 closure (companyMap
  // accepted-stale-window): `codeToId` is snapshot-on-mount via the
  // shared `useCompanies()` hook. Mid-session company add/rename is NOT
  // reflected here until next mount. **Accepted trade-off:** companies
  // are administratively-managed entities (added once during onboarding,
  // rarely renamed); the staleness window is the user's session lifetime
  // which typically << company-add cadence. Fully closed when SSE Phase
  // B1 lands (will subscribe to a `companies:changed` channel that
  // invalidates the shared cache); until then, mid-session admin who
  // adds a company can refresh-page to see it in this menu.
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
        aria-label={t("relatedFunctions.ariaLabel")}
        title={
          activeCompanyCode
            ? t("relatedFunctions.titleForCompany", { code: activeCompanyCode })
            : t("relatedFunctions.titleOrgWide")
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
            {activeCompanyCode
              ? t("relatedFunctions.forCompany", { code: activeCompanyCode })
              : t("relatedFunctions.orgWide")}
          </div>
          {FUNCTIONS.map((fn) => (
            <a
              key={fn.tab}
              href={buildHref(fn.tab, "isPage" in fn && fn.isPage === true)}
              role="menuitem"
              className="block px-3 py-1 text-xs text-gray-300 hover:bg-gray-800 hover:text-[#FFB800] transition-colors"
              onClick={() => setOpen(false)}
            >
              {t(`relatedFunctions.${fn.labelKey}` as never)}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
