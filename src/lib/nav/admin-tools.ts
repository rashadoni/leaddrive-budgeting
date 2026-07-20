/**
 * Single source of truth for the admin tool catalogue (2026-07-20 nav
 * reorganisation — "admin = settings only").
 *
 * Previously the admin tools were declared TWICE — a flat list in
 * `sidebar.tsx` and a group grid in `admin/page.tsx` — and drifted every time
 * a tool was added. This module is now the ONLY place groups + tools are
 * defined.
 *
 * 2026-07-20 split into two purposes so the reorg can't reintroduce drift:
 *   • `ADMIN_GROUPS` — settings/configuration ONLY. Rendered by the collapsible
 *     "Admin Tools" sidebar row AND the `/budgeting/admin` landing hub. This is
 *     the surface the "Админ‑инструменты" label points at, so it stays lean.
 *   • `SIDEBAR_ADMIN_GROUPS` (`DATA_CONTROL_GROUP` + `DATA_OPS_GROUP`) — the
 *     financial / monitoring / operational tools, surfaced as always-visible,
 *     admin-gated sections in the main sidebar. Every item keeps its existing
 *     `/budgeting/admin/*` href, icon and i18n key — only its nav LOCATION
 *     changed.
 *
 * Labels come from i18n: group title = `adminLanding.<group.key>`,
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
 * Settings / configuration ONLY. This is the entire contents of the
 * "Админ‑инструменты" surface — the collapsible Admin Tools sidebar row and the
 * `/budgeting/admin` landing hub both render exactly these groups. Everything
 * operational / monitoring lives in `SIDEBAR_ADMIN_GROUPS` below.
 *
 * `periodLocks` is homed here as a governance/close configuration control.
 */
export const ADMIN_GROUPS: AdminGroup[] = [
  {
    key: "groupConfiguration",
    tools: [
      { href: "/budgeting/admin/chart-of-accounts", key: "chartOfAccounts", icon: BookOpen },
      { href: "/budgeting/admin/companies", key: "companySettings", icon: Building2 },
      { href: "/budgeting/admin/users", key: "userAccess", icon: Users },
      { href: "/budgeting/admin/api-keys", key: "apiKeys", icon: Key },
      { href: "/budgeting/admin/ai-usage", key: "aiUsage", icon: Sparkles },
      { href: "/budgeting/admin/periods", key: "periodLocks", icon: Lock },
    ],
  },
  {
    key: "groupDataSources",
    tools: [
      { href: "/budgeting/admin/data-sources", key: "dataSources", icon: FileSpreadsheet },
      { href: "/budgeting/admin/source-registry", key: "sourceRegistry", icon: FileSpreadsheet },
    ],
  },
]

/**
 * Group A — "Data control": statement/IFRS/compliance controls plus the
 * data-readiness monitors. Surfaced as an always-visible, admin-gated section
 * in the main sidebar (no longer buried under the Admin row).
 */
export const DATA_CONTROL_GROUP: AdminGroup = {
  key: "groupDataControl",
  tools: [
    { href: "/budgeting/admin/statement-controls", key: "statementControls", icon: ShieldCheck, badge: "B1 Shadow", recentlyAdded: true },
    { href: "/budgeting/admin/ifrs-conformance", key: "ifrsConformance", icon: Scale, badge: "Phase 7.N" },
    { href: "/budgeting/admin/compliance", key: "complianceHub", icon: Shield },
    { href: "/budgeting/admin/indicator-health", key: "indicatorHealth", icon: Activity, badge: "Phase 7.M" },
    { href: "/budgeting/admin/drift", key: "driftDashboard", icon: AlertTriangle },
    { href: "/budgeting/admin/intel-health", key: "intelHealth", icon: Activity },
    { href: "/budgeting/admin/companies-readiness", key: "companiesReadiness", icon: Stethoscope },
    { href: "/budgeting/admin/indicator-backlog", key: "indicatorBacklog", icon: ListChecks },
  ],
}

/**
 * Group B — "Data & operations": ingestion + lifecycle + operational queue.
 * `aiImport` is listed here for completeness but the sidebar keeps it as the
 * prominent top-level "AI Import" shortcut (see `topLevelAdminToolHrefs`), so
 * it isn't rendered twice.
 */
export const DATA_OPS_GROUP: AdminGroup = {
  key: "groupDataOps",
  tools: [
    { href: "/budgeting/admin/ai-import", key: "aiImport", icon: Brain, badge: "Phase 7.M" },
    { href: "/budgeting/admin/data-entry", key: "dataEntry", icon: ClipboardEdit },
    { href: "/budgeting/admin/reporting-pack", key: "reportingPack", icon: FileSpreadsheet },
    { href: "/budgeting/admin/data-archive", key: "dataArchive", icon: Archive },
    { href: "/budgeting/admin/approval-requests", key: "approvals", icon: CheckSquare },
    { href: "/budgeting/admin/queue", key: "queue", icon: Layers },
  ],
}

/**
 * The two admin-gated groups surfaced as always-visible sections in the main
 * sidebar (order = render order). Rendered only for admin users.
 */
export const SIDEBAR_ADMIN_GROUPS: AdminGroup[] = [DATA_CONTROL_GROUP, DATA_OPS_GROUP]

/**
 * Flat list of the settings groups — powers the `/budgeting/admin` landing
 * hub's tool/badge counts (that page renders `ADMIN_GROUPS` only).
 */
export const ADMIN_TOOLS: AdminTool[] = ADMIN_GROUPS.flatMap((g) => g.tools)
