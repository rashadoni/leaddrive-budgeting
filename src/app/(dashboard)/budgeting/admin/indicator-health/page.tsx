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
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import { IndicatorHealthView } from "./IndicatorHealthView"

export const metadata = {
  title: "Indicator Health · Admin · BudgetPro",
}

export default async function IndicatorHealthPage() {
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")

  return (
    <div className="container mx-auto py-8 px-4 max-w-5xl">
      <h1 className="text-2xl font-bold mb-2">Indicator Health Dashboard</h1>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
        Overview всех indicator value cells в БД. Показывает почему
        каждый unknown и как его исправить (wire feed, добавить данные, и
        т.д.). Используйте для подготовки к client-демо: 🟡/⚪ items
        нужно либо заполнить либо честно объяснить клиенту.
      </p>
      <IndicatorHealthView />
    </div>
  )
}
