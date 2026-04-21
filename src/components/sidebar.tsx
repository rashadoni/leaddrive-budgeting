"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
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
} from "lucide-react"
import { useState, useCallback } from "react"
import { cn } from "@/lib/utils"

const navItems = [
  { href: "/budgeting", icon: Calculator, labelKey: "budgeting" },
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
]

export function Sidebar() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const t = useTranslations("nav")
  const [collapsed, setCollapsed] = useState(false)

  const isBudgeting = pathname === "/budgeting" || pathname.startsWith("/budgeting/")
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
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/")
          return (
            <div key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  isActive
                    ? "bg-sidebar-active text-white font-medium"
                    : "text-[hsl(var(--sidebar-text))] hover:bg-sidebar-hover hover:text-white"
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {!collapsed && <span>{t(item.labelKey)}</span>}
              </Link>

              {/* Budget sub-navigation */}
              {item.href === "/budgeting" && isBudgeting && !collapsed && (
                <div className="mt-1 ml-2 space-y-3 border-l border-white/10 pl-2">
                  {budgetSubNav.map((group) => (
                    <div key={group.group}>
                      <p className="px-2 py-1 text-[9px] font-semibold text-white/40 uppercase tracking-wider">
                        {group.group}
                      </p>
                      {group.items.map((sub) => {
                        const href = (sub as any).isPage ? "/budgeting/reports" : `/budgeting?tab=${sub.value}`
                        const isSubActive = (sub as any).isPage
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
            </div>
          )
        })}
      </nav>

    </aside>
  )
}
