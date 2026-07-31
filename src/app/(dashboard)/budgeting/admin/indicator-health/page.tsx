/**
 * Phase 7.M Tier 4 (2026-05-19) — Indicator Health admin page.
 *
 * Shows admins the full picture of indicator computation status:
 *   • Overall green/amber/red/unknown counts
 *   • Unknown breakdown by error category
 *   • Per-indicator gap list with remediation guidance
 *
 * Server component fetches from /api/admin/indicator-health.
 */
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import { IndicatorHealthView } from "./IndicatorHealthView"

export async function generateMetadata() {
  const t = await getTranslations("adminIndicatorHealth")
  return { title: t("metaTitle") }
}

export default async function IndicatorHealthPage() {
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")
  const t = await getTranslations("adminIndicatorHealth")

  return (
    <div
      className="container mx-auto py-8 px-4 max-w-5xl"
      data-testid="data-control-indicator-health"
    >
      <h1 className="text-2xl font-bold mb-2">{t("pageTitle")}</h1>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{t("pageDescription")}</p>
      <IndicatorHealthView />
    </div>
  )
}
