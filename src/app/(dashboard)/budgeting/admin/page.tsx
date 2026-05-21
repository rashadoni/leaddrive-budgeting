/**
 * Phase 7.M Tier 4 (2026-05-19) — Admin landing page.
 *
 * Central hub showing all admin tools as discoverable cards. Without
 * this page, /budgeting/admin returned 404 — sidebar entries were the
 * only way to reach individual admin pages.
 *
 * Cards grouped by workflow:
 *   • Data Ingestion — import workbook / AI Auto / data entry / sources
 *   • Data Quality — indicator health / drift / readiness / data archive
 *   • Operations — periods / approvals / api keys / ai usage / source registry
 *   • Configuration — chart of accounts / companies / users / onboarding
 */
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import Link from "next/link"
import {
  Upload,
  Brain,
  ClipboardEdit,
  FileSpreadsheet,
  Activity,
  AlertTriangle,
  Archive,
  CheckSquare,
  Lock,
  Sparkles,
  Key,
  BookOpen,
  Building2,
  Users,
  Stethoscope,
} from "lucide-react"

export const metadata = {
  title: "Admin · BudgetPro",
}

interface AdminTool {
  href: string
  title: string
  desc: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  recentlyAdded?: boolean
}

const GROUPS: Array<{ title: string; tools: AdminTool[] }> = [
  {
    title: "📥 Data Ingestion",
    tools: [
      {
        href: "/budgeting/admin/ai-import",
        title: "Импорт данных",
        desc: "Drag-drop любой xlsx — финансы (P&L/BS/CF), KPI, land, descriptions, структура компаний, бюджетные актуалы, sales forecast. AI определяет тип и роутит на правильный adapter. Один экран вместо 5 разных форм.",
        icon: Brain,
        badge: "🆕 Phase 7.M Tier 7",
        recentlyAdded: true,
      },
      {
        href: "/budgeting/admin/data-entry",
        title: "Data Entry",
        desc: "Ручной ввод KPI и ESG disclosures для non-engineer admin.",
        icon: ClipboardEdit,
      },
      {
        href: "/budgeting/admin/data-sources",
        title: "Data Sources Catalog",
        desc: "Client-facing каталог external feeds: business value, sample value, indicator dependencies.",
        icon: FileSpreadsheet,
      },
      {
        href: "/budgeting/admin/source-registry",
        title: "Source Registry",
        desc: "Drift-watchdog: список разрешённых xlsx источников для ingest.",
        icon: FileSpreadsheet,
      },
    ],
  },
  {
    title: "🩺 Data Quality",
    tools: [
      {
        href: "/budgeting/admin/indicator-health",
        title: "Indicator Health",
        desc: "Per-indicator green/amber/red/unknown breakdown с remediation guidance. Use перед client-демо.",
        icon: Activity,
        badge: "🆕 Phase 7.M",
        recentlyAdded: true,
      },
      {
        href: "/budgeting/admin/drift",
        title: "Drift Dashboard",
        desc: "Recent drift events + reference-feed freshness + stalled onboarding cases.",
        icon: AlertTriangle,
      },
      {
        href: "/budgeting/admin/companies-readiness",
        title: "Companies Readiness",
        desc: "Per-company 7-area scoring с tiers (complete/good/partial/thin/empty). CSV export.",
        icon: Stethoscope,
      },
      {
        href: "/budgeting/admin/data-archive",
        title: "Data Archive",
        desc: "Self-service archive + restore: BudgetLine / BalanceSheetLine / CashFlowEntry / Counterparty.",
        icon: Archive,
      },
      {
        href: "/budgeting/admin/intel-health",
        title: "Intel Health",
        desc: "External feed adapter status + recent crawls + news pipeline diagnostics.",
        icon: Activity,
      },
    ],
  },
  {
    title: "🔒 Operations",
    tools: [
      {
        href: "/budgeting/admin/periods",
        title: "Period Locks",
        desc: "CFO close action: блокирует mutations на закрытые периоды через 423.",
        icon: Lock,
      },
      {
        href: "/budgeting/admin/approval-requests",
        title: "Approvals",
        desc: "Pending approval requests для budget plan changes + reconciliation overrides.",
        icon: CheckSquare,
      },
      {
        href: "/budgeting/admin/ai-usage",
        title: "AI Usage",
        desc: "Daily/monthly LLM token spend + 30-day trend sparkline + per-org budget enforcement.",
        icon: Sparkles,
      },
      {
        href: "/budgeting/admin/api-keys",
        title: "API Keys",
        desc: "Per-org keys: EIA, SerpAPI (Google Trends). Encrypt-at-rest in Org.settings.",
        icon: Key,
      },
    ],
  },
  {
    title: "⚙ Configuration",
    tools: [
      {
        href: "/budgeting/admin/chart-of-accounts",
        title: "Chart of Accounts",
        desc: "CoA template editor — per-industry templates (10 sectors).",
        icon: BookOpen,
      },
      {
        href: "/budgeting/admin/companies",
        title: "Company Settings",
        desc: "Per-company settings (region, industry, hectaresPlanted, processingCapacityTonsYr, …).",
        icon: Building2,
      },
      {
        href: "/budgeting/admin/users",
        title: "User Access",
        desc: "User role + allowedSubGroupIds management. Phase 7.F sub-group RBAC.",
        icon: Users,
      },
    ],
  },
]

export default async function AdminLandingPage() {
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")

  const totalTools = GROUPS.reduce((s, g) => s + g.tools.length, 0)
  const newTools = GROUPS.reduce(
    (s, g) => s + g.tools.filter((t) => t.recentlyAdded).length,
    0,
  )

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Admin Tools</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {totalTools} инструментов в {GROUPS.length} группах ·{" "}
          <span className="text-emerald-300 font-medium">
            {newTools} новых в Phase 7.M
          </span>
          . Используйте перед client-демо: проверьте Indicator Health
          → закройте red gaps → запустите импорт через AI Auto Import.
        </p>
      </div>

      <div className="space-y-8">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h2 className="text-lg font-semibold mb-3 text-muted-foreground">
              {group.title}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {group.tools.map((tool) => {
                const Icon = tool.icon
                return (
                  <Link
                    key={tool.href}
                    href={tool.href}
                    className="border rounded-lg p-4 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-colors group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="rounded bg-muted p-2 group-hover:bg-emerald-500/10 transition-colors">
                        <Icon className="w-4 h-4 text-foreground/80" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-medium text-sm">{tool.title}</h3>
                          {tool.badge && (
                            <span className="text-[9px] px-1 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
                              {tool.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-snug">
                          {tool.desc}
                        </p>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-10 p-4 border rounded bg-muted/20">
        <h3 className="text-sm font-semibold mb-2">
          🎬 Pre-demo workflow recommendation
        </h3>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>
            <Link
              href="/budgeting/admin/indicator-health"
              className="text-emerald-300 underline"
            >
              Indicator Health
            </Link>{" "}
            — проверить % computed + identify red/unknown gaps.
          </li>
          <li>
            <Link
              href="/budgeting/admin/drift"
              className="text-emerald-300 underline"
            >
              Drift Dashboard
            </Link>{" "}
            — убедиться все external feeds FRESH.
          </li>
          <li>
            При необходимости заполнить gaps через{" "}
            <Link
              href="/budgeting/admin/data-entry"
              className="text-emerald-300 underline"
            >
              Data Entry
            </Link>
            .
          </li>
          <li>
            Если есть новый xlsx от клиента —{" "}
            <Link
              href="/budgeting/admin/ai-import"
              className="text-emerald-300 underline"
            >
              AI Auto Import
            </Link>{" "}
            (универсально для любого workbook'a).
          </li>
          <li>
            Запустить <code className="px-1 py-0.5 bg-muted rounded">npm run smoke-test</code>{" "}
            из CLI для финальной проверки.
          </li>
        </ol>
      </div>
    </div>
  )
}
