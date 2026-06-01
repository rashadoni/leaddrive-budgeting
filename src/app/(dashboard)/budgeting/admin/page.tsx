/**
 * Phase 7.M Tier 4 (2026-05-19) — Admin landing page.
 *
 * Central hub showing all admin tools as discoverable cards. Card titles +
 * descriptions are fully localized (EN/RU/AZ) via `adminLanding.tools.*` so
 * the page never mixes languages with the UI chrome.
 *
 * Cards grouped by workflow:
 *   • Data Ingestion — import / data entry / sources / registry
 *   • Data Quality — health / drift / readiness / archive / compliance / IFRS
 *   • Operations — periods / approvals / api keys / ai usage
 *   • Configuration — chart of accounts / companies / users
 */
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import Link from "next/link"
import {
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
  Shield,
  ListChecks,
  Scale,
} from "lucide-react"

export const metadata = {
  title: "Admin · BudgetPro",
}

interface AdminTool {
  href: string
  /** i18n key under `adminLanding.tools.<key>` for title + desc. */
  key: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  recentlyAdded?: boolean
}

const GROUPS: Array<{ title: string; tools: AdminTool[] }> = [
  {
    title: "📥 Data Ingestion",
    tools: [
      { href: "/budgeting/admin/ai-import", key: "aiImport", icon: Brain, badge: "Phase 7.M", recentlyAdded: true },
      { href: "/budgeting/admin/data-entry", key: "dataEntry", icon: ClipboardEdit },
      { href: "/budgeting/admin/data-sources", key: "dataSources", icon: FileSpreadsheet },
      { href: "/budgeting/admin/source-registry", key: "sourceRegistry", icon: FileSpreadsheet },
    ],
  },
  {
    title: "🩺 Data Quality",
    tools: [
      { href: "/budgeting/admin/indicator-health", key: "indicatorHealth", icon: Activity, badge: "Phase 7.M", recentlyAdded: true },
      { href: "/budgeting/admin/drift", key: "driftDashboard", icon: AlertTriangle },
      { href: "/budgeting/admin/companies-readiness", key: "companiesReadiness", icon: Stethoscope },
      { href: "/budgeting/admin/ifrs-conformance", key: "ifrsConformance", icon: Scale, badge: "Phase 7.N", recentlyAdded: true },
      { href: "/budgeting/admin/data-archive", key: "dataArchive", icon: Archive },
      { href: "/budgeting/admin/intel-health", key: "intelHealth", icon: Activity },
      { href: "/budgeting/admin/compliance", key: "complianceHub", icon: Shield },
      { href: "/budgeting/admin/indicator-backlog", key: "indicatorBacklog", icon: ListChecks },
    ],
  },
  {
    title: "🔒 Operations",
    tools: [
      { href: "/budgeting/admin/periods", key: "periodLocks", icon: Lock },
      { href: "/budgeting/admin/approval-requests", key: "approvals", icon: CheckSquare },
      { href: "/budgeting/admin/ai-usage", key: "aiUsage", icon: Sparkles },
      { href: "/budgeting/admin/api-keys", key: "apiKeys", icon: Key },
    ],
  },
  {
    title: "⚙ Configuration",
    tools: [
      { href: "/budgeting/admin/chart-of-accounts", key: "chartOfAccounts", icon: BookOpen },
      { href: "/budgeting/admin/companies", key: "companySettings", icon: Building2 },
      { href: "/budgeting/admin/users", key: "userAccess", icon: Users },
    ],
  },
]

// Map each English GROUPS title to its translation key.
const GROUP_TITLE_KEY: Record<string, string> = {
  "📥 Data Ingestion": "groupDataIngestion",
  "🩺 Data Quality": "groupDataQuality",
  "🔒 Operations": "groupOperations",
  "⚙ Configuration": "groupConfiguration",
}

export default async function AdminLandingPage() {
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")
  const t = await getTranslations("adminLanding")

  const totalTools = GROUPS.reduce((s, g) => s + g.tools.length, 0)
  const newTools = GROUPS.reduce((s, g) => s + g.tools.filter((tool) => tool.recentlyAdded).length, 0)

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("statsLine", { total: totalTools, groups: GROUPS.length, new: newTools })}
        </p>
      </div>

      <div className="space-y-8">
        {GROUPS.map((group) => (
          <section key={group.title}>
            <h2 className="text-lg font-semibold mb-3 text-muted-foreground">
              {GROUP_TITLE_KEY[group.title] ? t(GROUP_TITLE_KEY[group.title] as never) : group.title}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {group.tools.map((tool) => {
                const Icon = tool.icon
                return (
                  <Link
                    key={tool.href}
                    href={tool.href}
                    className="rounded-lg border bg-card shadow-sm p-4 transition-all hover:border-emerald-500/50 hover:shadow-md group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="rounded-md bg-muted p-2 group-hover:bg-emerald-500/10 transition-colors">
                        <Icon className="w-4 h-4 text-foreground/80 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-sm">{t(`tools.${tool.key}.title` as never)}</h3>
                          {tool.badge && (
                            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                              {tool.badge}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-snug">
                          {t(`tools.${tool.key}.desc` as never)}
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

      <div className="mt-10 p-4 border rounded-lg bg-muted/30">
        <h3 className="text-sm font-semibold mb-2">🎬 {t("workflowTitle")}</h3>
        <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside leading-relaxed">
          <li>{t("workflow.s1")}</li>
          <li>{t("workflow.s2")}</li>
          <li>{t("workflow.s3")}</li>
          <li>{t("workflow.s4")}</li>
          <li>{t("workflow.s5")}</li>
          <li>{t("workflow.s6")}</li>
        </ol>
      </div>
    </div>
  )
}
