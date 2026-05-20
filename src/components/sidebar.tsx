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
  Lock,
  CheckSquare,
  BookOpen,
  Users,
  ClipboardEdit,
  AlertTriangle,
  Building2,
  Sparkles,
} from "lucide-react"
import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"

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
const navItems: NavItem[] = [
  { href: "/budgeting", icon: Calculator, labelKey: "budgeting" },
  { href: "/budgeting/terminal", icon: Activity, label: "Risk Terminal" },
  // Phase 7.G E.2 v2 (Turn XLVII) — Board Deck v2 sidebar entry.
  // Was orphaned from any nav previously (only reachable via
  // CommandBar `BRF GO`); customer feedback noted nobody knew the
  // verb. Icon: Presentation (lucide) — matches "deck for the board".
  { href: "/budgeting/board-deck", icon: Presentation, label: "Board Deck" },
  { href: "/budgeting/onboarding", icon: Upload, label: "Onboarding" },
  { href: "/budgeting/audit", icon: ScrollText, label: "Audit Log", minRole: "manager" },
  // Phase 7.M Tier 4 (2026-05-19) — Admin landing page with grouped tool
  // catalog. Sidebar still expands to individual admin sub-entries below
  // (Period Locks, Approvals, Indicator Health, etc.) — this top-level
  // link is the discovery surface ("где все админ-тулзы?").
  { href: "/budgeting/admin", icon: Settings, label: "Admin Tools", minRole: "admin" },
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
    group: "Settings",
    items: [
      { value: "integrations", icon: FileSpreadsheet, label: "Import" },
      { value: "config", icon: Settings2, label: "Configuration" },
    ],
  },
  // Phase 7.G Turn LXXXXII (closes LXXXXI architect ⚠️ class-issue):
  // 3 admin pages were unreachable from any UI nav until this turn.
  // Each entry uses `href` instead of `value` (full path, not ?tab=X).
  // `minRole: "admin"` hides for non-admin (matches API enforcement).
  {
    group: "Admin",
    minRole: "admin" as Role,
    items: [
      { href: "/budgeting/admin/periods", icon: Lock, label: "Period Locks", isPage: true },
      { href: "/budgeting/admin/approval-requests", icon: CheckSquare, label: "Approvals", isPage: true },
      { href: "/budgeting/admin/chart-of-accounts", icon: BookOpen, label: "Chart of Accounts", isPage: true },
      { href: "/budgeting/admin/users", icon: Users, label: "User Access", isPage: true },
      // Phase 7.H F4.v2.3 — non-engineer entry surface for operational
      // KPIs + ESG disclosures.
      { href: "/budgeting/admin/data-entry", icon: ClipboardEdit, label: "Data Entry", isPage: true },
      // Phase D.3 — drift dashboard. Recent drift events, reference-feed
      // freshness, stalled onboarding cases. Admin-only.
      { href: "/budgeting/admin/drift", icon: AlertTriangle, label: "Drift Dashboard", isPage: true },
      // Phase 7.K 2026-05-18 — client-facing data-source catalog. Renders
      // sources-catalog.ts as cards explaining what each external feed is,
      // its business value, sample live value + indicator dependencies.
      // Used during client demos when asked "where does this number come
      // from?". Sits between Drift (freshness state) and Source Registry
      // (onboarding-import source allowlist) since both are catalog-like.
      { href: "/budgeting/admin/data-sources", icon: FileSpreadsheet, label: "Data Sources", isPage: true },
      // Phase L4 — drift-watchdog source registry editor (replaces manual
      // JSON edit of data/onboarding-source-registry.json).
      { href: "/budgeting/admin/source-registry", icon: FileSpreadsheet, label: "Source Registry", isPage: true },
      // Phase 7.I Track E — per-company settings editor (industry-shape
      // form: region/cropType/hectares for agro, totalRooms for hotels,
      // etc.). Replaces direct SQL on `Company.settings` JSON. 2026-05-16
      // — page + API + tests already shipped; this is the missing sidebar
      // entry that made the route unreachable from UI nav.
      { href: "/budgeting/admin/companies", icon: Building2, label: "Company Settings", isPage: true },
      // Phase 7.B v2 Day 6 — AI token usage dashboard. Daily / monthly
      // burn against the org budget + 30-day trend sparkline. Admin
      // visibility for LLM spend.
      { href: "/budgeting/admin/ai-usage", icon: Sparkles, label: "AI Usage", isPage: true },
      // Phase 7.M Tier 3 (2026-05-19) — bit-perfect AzerSheker workbook
      // import with 5-phase reconciliation (P&L / BS / KPI / CF /
      // recompute). Reuses the same parsers via xlsx upload + auth.
      { href: "/budgeting/admin/import-workbook", icon: Upload, label: "Import Workbook", isPage: true },
      // Phase 7.M Tier 4 (2026-05-19) — AI Auto Import. Drag-drop any
      // xlsx → AI classifies each sheet → bit-perfect import. Universal
      // entry point that doesn't require pre-knowing the file shape.
      { href: "/budgeting/admin/ai-import", icon: Brain, label: "AI Auto Import", isPage: true },
      // Phase 7.M Tier 4 (2026-05-19) — Indicator Health dashboard.
      // Shows per-indicator green/amber/red/unknown breakdown with
      // remediation guidance for unknowns. Use before client demo to
      // know which gaps to fill.
      { href: "/budgeting/admin/indicator-health", icon: Activity, label: "Indicator Health", isPage: true },
      // Phase C.3 "Onboarding Status" lives at top-level navItems (it's
      // a high-traffic page); not duplicated under Admin sub-nav.
    ],
  },
]

// Hook: fetch per-org tab availability map. Sidebar uses this to hide
// budget sub-nav entries pointing at empty data domains (Bug #6 demo
// polish — customer demo Friday 2026-05-01). Endpoint is `GET /api/
// budgeting/availability` which returns a flat `{ [tabValue]: boolean }`.
// Tabs missing from the map (e.g. fetch in flight) default to TRUE so we
// don't blink-hide-blink while loading.
function useTabAvailability(): Record<string, boolean> {
  const [map, setMap] = useState<Record<string, boolean>>({})
  useEffect(() => {
    let cancelled = false
    fetch("/api/budgeting/availability")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled && body && typeof body === "object") setMap(body)
      })
      .catch(() => {
        // Silent fail — sidebar shows all tabs (existing behavior) on error.
      })
    return () => {
      cancelled = true
    }
  }, [])
  return map
}

export function Sidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const t = useTranslations("nav")
  const [collapsed, setCollapsed] = useState(false)
  const { data: session } = useSession()
  const availability = useTabAvailability()
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
  // legacy page. Without collapsing the 20-item sub-list would push
  // Risk Terminal / Board Deck / Onboarding / Audit Log / Settings
  // below the viewport fold. Click the chevron next to Budgeting to
  // toggle.
  const isBudgetingSection = pathname.startsWith("/budgeting")
  // Auto-open on legacy /budgeting (sub-tabs ARE the page's main UI),
  // auto-closed on /budgeting/terminal | /onboarding | /board-deck |
  // /admin/* (the page itself is the destination — sub-nav is a quick
  // jump-back to the legacy planner). User toggle persists for the
  // session.
  const [budgetExpanded, setBudgetExpanded] = useState(isBudgetingLegacy)
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
              </div>

              {/* Budget sub-navigation — togglable across the whole
                  /budgeting section (legacy /budgeting page + nested
                  routes like /terminal, /onboarding, /board-deck,
                  /admin/*). User can collapse to avoid pushing other
                  top-level items below the viewport fold. */}
              {item.href === "/budgeting" && isBudgetingSection && budgetExpanded && !collapsed && (
                <div className="mt-1 ml-2 space-y-3 border-l border-white/10 pl-2">
                  {budgetSubNav
                    // Phase 7.G Turn LXXXXII: filter groups by minRole
                    // (Admin group is admin-only — matches API enforcement).
                    .filter((group) => !group.minRole || hasRole(userRole, group.minRole))
                    .map((group) => ({
                      ...group,
                      // Bug #6: filter sub-items to those whose backing data
                      // exists for this org. `availability` may be empty
                      // (loading) — in that case treat unknown as visible
                      // so we don't blink-hide on first paint. The flag
                      // explicitly being `false` is what hides the entry.
                      // Admin entries (no `value`, only `href`) bypass
                      // availability check — they are always visible to admin.
                      items: group.items.filter((sub) =>
                        "value" in sub ? availability[sub.value] !== false : true
                      ),
                    }))
                    // Drop entire group if all its items are hidden.
                    .filter((group) => group.items.length > 0)
                    .map((group) => (
                      <div key={group.group}>
                        <p className="px-2 py-1 text-[9px] font-semibold text-white/40 uppercase tracking-wider">
                          {group.group}
                        </p>
                        {group.items.map((sub) => {
                          // Three URL shapes:
                          //   (a) `value` only        → /budgeting?tab=<value>
                          //   (b) `value` + isPage    → /budgeting/reports
                          //   (c) `href` (LXXXXII)    → use href verbatim (admin pages)
                          const href = "href" in sub
                            ? sub.href
                            : (sub as { isPage?: boolean; value: string }).isPage
                              ? "/budgeting/reports"
                              : `/budgeting?tab=${(sub as { value: string }).value}`
                          const isSubActive = "href" in sub
                            ? pathname === sub.href || pathname.startsWith(sub.href + "/")
                            : (sub as { isPage?: boolean; value: string }).isPage
                              ? pathname === "/budgeting/reports"
                              : activeTab === (sub as { value: string }).value
                          const key = "href" in sub ? sub.href : (sub as { value: string }).value
                          return (
                            <Link
                              key={key}
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
            </div>
          )
        })}
      </nav>

    </aside>
  )
}
