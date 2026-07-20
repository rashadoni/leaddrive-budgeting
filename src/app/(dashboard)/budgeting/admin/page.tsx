/**
 * Phase 7.M Tier 4 (2026-05-19) — Admin landing page.
 *
 * Central hub for the settings/configuration admin tools as discoverable
 * cards. Card titles + descriptions are fully localized (EN/RU/AZ) via
 * `adminLanding.tools.*` so the page never mixes languages with the UI chrome.
 *
 * 2026-07-20 "admin = settings only": this hub renders ONLY `ADMIN_GROUPS`
 *   • Configuration — chart of accounts / companies / users / api keys / ai
 *     usage / period locks
 *   • Data sources — data-sources catalog / source registry
 * The financial / monitoring / operational tools moved to the two
 * always-visible, admin-gated sidebar sections (`SIDEBAR_ADMIN_GROUPS`).
 */
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import Link from "next/link"
import { ADMIN_GROUPS, ADMIN_TOOLS } from "@/lib/nav/admin-tools"

export const metadata = {
  title: "Admin · BudgetPro",
}

export default async function AdminLandingPage() {
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")
  const t = await getTranslations("adminLanding")

  const totalTools = ADMIN_TOOLS.length
  const newTools = ADMIN_TOOLS.filter((tool) => tool.badge).length

  return (
    <div className="container mx-auto py-8 px-4 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("statsLine", { total: totalTools, groups: ADMIN_GROUPS.length, new: newTools })}
        </p>
      </div>

      <div className="space-y-8">
        {ADMIN_GROUPS.map((group) => (
          <section key={group.key}>
            <h2 className="text-lg font-semibold mb-3 text-muted-foreground">
              {t(group.key as never)}
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
        <h3 className="text-sm font-semibold mb-2">📋 {t("workflowTitle")}</h3>
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
