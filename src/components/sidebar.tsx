"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { useSession } from "next-auth/react"
import { hasRole, type Role } from "@/lib/api-auth"
import {
  Calculator,
  Settings,
  ChevronLeft,
  ChevronRight,
  BarChart2,
  TrendingUp,
  TrendingDown,
  DollarSign,
  List,
  Banknote,
  Target,
  LayoutGrid,
  Brain,
  FileSpreadsheet,
  CalendarRange,
  Settings2,
  BarChart3,
  Activity,
  Upload,
  ScrollText,
  Presentation,
  BookText,
  Bell,
  ChevronDown,
} from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { ADMIN_GROUPS } from "@/lib/nav/admin-tools"

type NavItem = {
  href: string
  icon: React.ComponentType<{ className?: string }>
  labelKey?: string
  label?: string
  /**
   * Minimum role required to see this entry. Items without `minRole`
   * are visible to every authenticated user. Phase 7.F audit log is
   * gated to manager+ both server-side (`requireRole` on the page +
   * API) and client-side here — viewer-tier users shouldn't see a link
   * they'll get a 403 on.
   */
  minRole?: Role
}

// Risk Terminal entries (Phase 7) sit alongside the legacy /budgeting page
// so the sidebar shows holding-level work without burying it under tabs.
// 2026-05-27 — every top-level item now uses `labelKey` so the sidebar
// fully honours the user's locale. Previously a mix of hardcoded EN
// ("Risk Terminal", "Board Deck", "Admin Tools", "Audit Log",
// "Onboarding"), hardcoded RU ("Руководство"), and labelKey-driven
// items rendered an inconsistent half-translated sidebar — user
// flagged it on 2026-05-27. Brand names (Risk Terminal / Board Deck)
// stay English across all locales by convention (they're product
// names, not generic UI labels).
// 2026-06-21 menu restructure: Risk Terminal first (the holding risk view is the
// product centrepiece), the legacy Budgeting planner expands to its OWN tabs
// only (admin links moved OUT — see the Admin row, which expands to the 5
// ADMIN_GROUPS). `alerts` was an orphaned route (page existed, no nav entry).
const navItems: NavItem[] = [
  { href: "/budgeting/terminal", icon: Activity, labelKey: "riskTerminal" },
  { href: "/budgeting", icon: Calculator, labelKey: "budgeting" },
  { href: "/budgeting/board-deck", icon: Presentation, labelKey: "boardDeck" },
  { href: "/budgeting/onboarding", icon: Upload, labelKey: "onboarding" },
  { href: "/budgeting/admin/ai-import", icon: Brain, labelKey: "aiImport", minRole: "admin" },
  { href: "/budgeting/alerts", icon: Bell, labelKey: "alerts" },
  { href: "/budgeting/audit", icon: ScrollText, labelKey: "auditLog", minRole: "manager" },
  { href: "/budgeting/admin", icon: Settings, labelKey: "adminTools", minRole: "admin" },
  { href: "/guide", icon: BookText, labelKey: "guide" },
  { href: "/settings", icon: Settings, labelKey: "settings" },
]

// Budget sub-navigation groups
const budgetSubNav = [
  {
    group: "Finance",
    items: [
      { value: "pnl-report", icon: BarChart2, label: "P&L" },
      { value: "sales-budget", icon: TrendingUp, label: "Sales" },
      { value: "cogs", icon: DollarSign, label: "COGS" },
      { value: "balance-sheet", icon: List, label: "Balance Sheet" },
      { value: "cash-flow", icon: Banknote, label: "Cash Flow" },
      { value: "assumptions", icon: Target, label: "Assumptions" },
    ],
  },
  {
    group: "Planning",
    items: [
      { value: "workspace", icon: LayoutGrid, label: "Workspace" },
      { value: "pl", icon: BarChart2, label: "P&L (Plan)" },
      { value: "forecast", icon: Brain, label: "Forecast" },
      { value: "comparison", icon: ChevronRight, label: "Comparison" },
      { value: "plans", icon: FileSpreadsheet, label: "Plans" },
    ],
  },
  {
    group: "Forecasts",
    items: [
      { value: "sales-forecast", icon: TrendingUp, label: "Sales" },
      { value: "expense-forecast", icon: TrendingDown, label: "Expenses" },
      { value: "rolling", icon: CalendarRange, label: "Rolling" },
    ],
  },
  {
    group: "Analytics",
    items: [
      { value: "report-builder", icon: BarChart3, label: "Report Builder", isPage: true },
    ],
  },
  {
    // 2026-06-21 restructure: the planner "Settings" group is just the
    // Configuration tab now. The old "Import" item (→ a planner tab) was a 4th
    // scattered import entry-point — import lives under Onboarding + Admin →
    // AI Import only. The whole Admin group moved out of here into the Admin
    // top-level row (which expands to the 5 ADMIN_GROUPS — single source).
    group: "Settings",
    items: [
      { value: "config", icon: Settings2, label: "Configuration" },
    ],
  },
]

export function Sidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const t = useTranslations("nav")
  // adminLanding namespace — the Admin sub-nav renders the shared ADMIN_GROUPS
  // using the SAME labels as the admin landing hub (single source).
  const t2 = useTranslations("adminLanding")
  const [collapsed, setCollapsed] = useState(false)
  const { data: session } = useSession()
  // Cast: next-auth's `Session.user` type is augmented in this project to
  // include `role` (see `src/lib/api-auth.ts`); the cast keeps the
  // sidebar from depending on the augmentation file directly.
  const userRole = (session?.user as { role?: string } | undefined)?.role

  // Filter navItems by `minRole`. Items without `minRole` are visible
  // to every authenticated user (matches pre-Phase-7.F convention).
  // Server-side defense in depth: `/budgeting/audit/page.tsx` ALSO
  // calls `requireRole('manager')` and redirects on fail — sidebar
  // gating is purely UX (don't show a link the user will 403 on).
  const visibleNavItems = navItems.filter(
    (item) => !item.minRole || hasRole(userRole, item.minRole),
  )

  // Legacy /budgeting tab-based page only — controls when the parent
  // "Budgeting" nav row gets the active-highlight (so opening Risk
  // Terminal doesn't double-light Budgeting too).
  const isBudgetingLegacy =
    pathname === "/budgeting" || pathname === "/budgeting/reports"
  // Section-wide test — when ANY /budgeting/* route is active, the
  // Budgeting sub-nav is OFFERED but collapsed by default outside the
  // legacy page. This includes /budgeting/admin/*: admin tools are their own
  // expandable row, but finance tabs like Cash Flow must remain discoverable
  // from import/admin workflows.
  const isBudgetingSection = pathname.startsWith("/budgeting")
  const isAdminSection = pathname.startsWith("/budgeting/admin")
  const isDirectAdminShortcut =
    pathname === "/budgeting/admin/ai-import" ||
    pathname.startsWith("/budgeting/admin/ai-import/")
  // Auto-open on legacy /budgeting (sub-tabs ARE the page's main UI),
  // auto-closed on /budgeting/terminal | /onboarding | /board-deck (the page
  // itself is the destination). User toggle persists for the session.
  const [budgetExpanded, setBudgetExpanded] = useState(isBudgetingLegacy)
  const [adminExpanded, setAdminExpanded] = useState(isAdminSection)
  const activeTab = searchParams.get("tab") || "workspace"

  return (
    <aside
      className={cn(
        "flex flex-col bg-sidebar-bg backdrop-blur-xl transition-all duration-200 shrink-0 overflow-hidden",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo + Collapse toggle */}
      <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white shrink-0">
            B
          </div>
          {!collapsed && (
            <span className="text-base font-semibold tracking-tight">BudgetPro</span>
          )}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded-lg p-1.5 text-white/50 hover:bg-white/10 hover:text-white transition-colors"
        >
          <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1 sidebar-scroll overflow-y-auto">
        {visibleNavItems.map((item) => {
          // Exact-match for /budgeting (so Risk Terminal at /budgeting/terminal
          // doesn't also light up the legacy Calculator entry); prefix match
          // for everything else.
          const isActive =
            item.href === "/budgeting"
              ? isBudgetingLegacy
              : item.href === "/budgeting/admin"
                ? isAdminSection && !isDirectAdminShortcut
              : pathname === item.href || pathname.startsWith(item.href + "/")
          // Budget row has an inline chevron toggle when we're anywhere
          // in /budgeting/* — clicking it expands/collapses the sub-nav
          // without navigating. The Link still navigates to /budgeting.
          const isBudgetingRow = item.href === "/budgeting"
          return (
            <div key={item.href}>
              <div className="flex items-center">
                <Link
                  href={item.href}
                  className={cn(
                    "flex flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-active text-white font-medium"
                      : "text-[hsl(var(--sidebar-text))] hover:bg-sidebar-hover hover:text-white"
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {!collapsed && <span>{item.label ?? (item.labelKey ? t(item.labelKey) : item.href)}</span>}
                </Link>
                {isBudgetingRow && isBudgetingSection && !collapsed && (
                  <button
                    type="button"
                    onClick={() => setBudgetExpanded((v) => !v)}
                    aria-expanded={budgetExpanded}
                    aria-label="Toggle budgeting sub-menu"
                    className="ml-1 mr-1 rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                  >
                    <ChevronLeft
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        budgetExpanded ? "-rotate-90" : "rotate-180"
                      )}
                    />
                  </button>
                )}
                {item.href === "/budgeting/admin" && isAdminSection && !collapsed && (
                  <button
                    type="button"
                    onClick={() => setAdminExpanded((v) => !v)}
                    aria-expanded={adminExpanded}
                    aria-label="Toggle admin sub-menu"
                    className="ml-1 mr-1 rounded-md p-1.5 text-white/50 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
                  >
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        adminExpanded ? "rotate-180" : ""
                      )}
                    />
                  </button>
                )}
              </div>

              {/* Budget sub-navigation — togglable across the whole
                  /budgeting section (legacy /budgeting page + nested
                  routes like /terminal, /onboarding, /board-deck,
                  /admin/*). User can collapse to avoid pushing other
                  top-level items below the viewport fold. Keep structural
                  finance tabs visible even when the underlying table is empty;
                  the page-level empty states explain what is missing. */}
              {item.href === "/budgeting" && isBudgetingSection && budgetExpanded && !collapsed && (
                <div className="mt-1 ml-2 space-y-3 border-l border-white/10 pl-2">
                  {budgetSubNav
                    .map((group) => (
                      <div key={group.group}>
                        <p className="px-2 py-1 text-[9px] font-semibold text-white/40 uppercase tracking-wider">
                          {group.group}
                        </p>
                        {group.items.map((sub) => {
                          // Planner tabs only now (admin moved to its own row):
                          //   value        → /budgeting?tab=<value>
                          //   value+isPage → /budgeting/reports (Report Builder)
                          const isPage = "isPage" in sub && sub.isPage
                          const href = isPage
                            ? "/budgeting/reports"
                            : `/budgeting?tab=${sub.value}`
                          const isSubActive = isPage
                            ? pathname === "/budgeting/reports"
                            : activeTab === sub.value
                          return (
                            <Link
                              key={sub.value}
                              href={href}
                              className={cn(
                                "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                                isSubActive
                                  ? "bg-white/15 text-white font-medium"
                                  : "text-white/60 hover:bg-white/10 hover:text-white"
                              )}
                            >
                              <sub.icon className="h-3.5 w-3.5 shrink-0" />
                              {sub.label}
                            </Link>
                          )
                        })}
                      </div>
                    ))}
                </div>
              )}

              {/* Admin sub-navigation — the 5 ADMIN_GROUPS (single source of
                  truth shared with the admin landing hub). Renders only inside
                  /budgeting/admin/*, togglable, role-gated at the row level. */}
              {item.href === "/budgeting/admin" && isAdminSection && adminExpanded && !collapsed && (
                <div className="mt-1 ml-2 space-y-3 border-l border-white/10 pl-2">
                  {ADMIN_GROUPS.map((adminGroup) => (
                    <div key={adminGroup.key}>
                      <p className="px-2 py-1 text-[9px] font-semibold text-white/40 uppercase tracking-wider">
                        {t2(adminGroup.key as never)}
                      </p>
                      {adminGroup.tools.map((tool) => {
                        const isToolActive =
                          pathname === tool.href || pathname.startsWith(tool.href + "/")
                        return (
                          <Link
                            key={tool.href}
                            href={tool.href}
                            className={cn(
                              "flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                              isToolActive
                                ? "bg-white/15 text-white font-medium"
                                : "text-white/60 hover:bg-white/10 hover:text-white"
                            )}
                          >
                            <tool.icon className="h-3.5 w-3.5 shrink-0" />
                            {t2(`tools.${tool.key}.title` as never)}
                          </Link>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

    </aside>
  )
}
