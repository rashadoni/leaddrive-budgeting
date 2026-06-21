/**
 * Reporting-pack import admin page (FO Holding monthly "Reporting YYYY.xlsx").
 *
 * Upload the monthly reporting pack → preview (no DB writes) → apply.
 * Drives POST /api/import/reporting-pack, which reads the detail sheets
 * (Actual PLF / BS Actual / CF Actual + Budget PLF), splits each by the BU
 * column into the operating entities, and writes through the audited
 * production handlers per entity in one transaction.
 */
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import { ReportingPackForm } from "./ReportingPackForm"

export const metadata = {
  title: "Reporting Pack Import · Admin · BudgetPro",
}

export default async function ReportingPackPage() {
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")
  if (!session?.user?.organizationId) redirect("/budgeting")
  const t = await getTranslations("adminReportingPack")

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium mb-2">
          Reporting Pack
        </div>
        <h1 className="text-2xl font-bold mb-2">{t("title")}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("intro")}
        </p>
      </div>
      <p className="text-xs text-muted-foreground mb-6 leading-relaxed">
        {t("applyNote")}
      </p>

      <ReportingPackForm />
    </div>
  )
}
