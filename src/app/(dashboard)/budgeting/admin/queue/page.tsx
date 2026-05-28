/**
 * Phase 6 — Queue admin landing.
 *
 * Server component → fetches active jobs + recently failed ones; client
 * sub-component handles state-filter pills + manual refresh.
 */
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import { QueueAdmin } from "./QueueAdmin"

export const dynamic = "force-dynamic"

export default async function QueueAdminPage() {
  const t = await getTranslations("adminQueue")
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")
  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">{t("subtitle")}</p>
      </header>
      <QueueAdmin />
    </div>
  )
}
