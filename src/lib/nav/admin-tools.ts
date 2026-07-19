/**
 * Single source of truth for the admin tool catalogue (2026-06-21 menu
 * restructure).
 *
 * Previously the admin tools were declared TWICE — a flat 14-item list in
 * `sidebar.tsx` and a 4-group grid in `admin/page.tsx` — with DIFFERENT sets
 * (6 tools, incl. data-archive, were only on the landing → invisible in the
 * sidebar). The two lists drifted every time a tool was added (the reset
 * feature landed in the form but not the sidebar). This module is now the ONLY
 * place groups + tools are defined; both surfaces render from it, so they can
 * never diverge again.
 *
 * Labels come from i18n: group title = `adminLanding.groups.<group.key>`,
 * tool title/desc = `adminLanding.tools.<tool.key>.{title,desc}`.
 */
import {
  Brain,
  FileSpreadsheet,
  ClipboardEdit,
  Activity,
  AlertTriangle,
  Stethoscope,
  ListChecks,
  Archive,
  Lock,
  CheckSquare,
  Layers,
  Shield,
  ShieldCheck,
  Scale,
  BookOpen,
  Building2,
  Users,
  Key,
  Sparkles,
} from "lucide-react"

export interface AdminTool {
  href: string
  /** i18n key under `adminLanding.tools.<key>` (title + desc). */
  key: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string
  recentlyAdded?: boolean
}

export interface AdminGroup {
  /** i18n key under `adminLanding.groups.<key>`. */
  key: string
  tools: AdminTool[]
}

/**
 * Five workflow groups, every admin route homed (incl. the former orphans
 * `data-archive`, `reporting-pack`, `ifrs-conformance`, `api-keys`,
 * `intel-health`, `companies-readiness` that the sidebar never showed, plus
 * `queue`). `data-archive` moved out of "Data quality" (a monitor bucket) into
 * "Data lifecycle" — a reset is a destructive lifecycle action, not a quality
 * gauge.
 */
export const ADMIN_GROUPS: AdminGroup[] = [
  {
    key: "groupDataIngestion",
    tools: [
      { href: "/budgeting/admin/ai-import", key: "aiImport", icon: Brain, badge: "Phase 7.M" },
      { href: "/budgeting/admin/reporting-pack", key: "reportingPack", icon: FileSpreadsheet },
      { href: "/budgeting/admin/data-entry", key: "dataEntry", icon: ClipboardEdit },
      { href: "/budgeting/admin/data-sources", key: "dataSources", icon: FileSpreadsheet },
      { href: "/budgeting/admin/source-registry", key: "sourceRegistry", icon: FileSpreadsheet },
    ],
  },
  {
    key: "groupDataQuality",
    tools: [
      { href: "/budgeting/admin/indicator-health", key: "indicatorHealth", icon: Activity, badge: "Phase 7.M" },
      { href: "/budgeting/admin/drift", key: "driftDashboard", icon: AlertTriangle },
      { href: "/budgeting/admin/intel-health", key: "intelHealth", icon: Activity },
      { href: "/budgeting/admin/companies-readiness", key: "companiesReadiness", icon: Stethoscope },
      { href: "/budgeting/admin/indicator-backlog", key: "indicatorBacklog", icon: ListChecks },
    ],
  },
  {
    key: "groupDataLifecycle",
    tools: [
      { href: "/budgeting/admin/data-archive", key: "dataArchive", icon: Archive },
      { href: "/budgeting/admin/periods", key: "periodLocks", icon: Lock },
      { href: "/budgeting/admin/approval-requests", key: "approvals", icon: CheckSquare },
      { href: "/budgeting/admin/queue", key: "queue", icon: Layers },
    ],
  },
  {
    key: "groupCompliance",
    tools: [
      { href: "/budgeting/admin/compliance", key: "complianceHub", icon: Shield },
      { href: "/budgeting/admin/ifrs-conformance", key: "ifrsConformance", icon: Scale, badge: "Phase 7.N" },
      { href: "/budgeting/admin/statement-controls", key: "statementControls", icon: ShieldCheck, badge: "B1 Shadow", recentlyAdded: true },
    ],
  },
  {
    key: "groupConfiguration",
    tools: [
      { href: "/budgeting/admin/chart-of-accounts", key: "chartOfAccounts", icon: BookOpen },
      { href: "/budgeting/admin/companies", key: "companySettings", icon: Building2 },
      { href: "/budgeting/admin/users", key: "userAccess", icon: Users },
      { href: "/budgeting/admin/api-keys", key: "apiKeys", icon: Key },
      { href: "/budgeting/admin/ai-usage", key: "aiUsage", icon: Sparkles },
    ],
  },
]

/** Flat list — handy for "is this href an admin tool" checks. */
export const ADMIN_TOOLS: AdminTool[] = ADMIN_GROUPS.flatMap((g) => g.tools)
