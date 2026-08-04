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
import { BackgroundJobs } from "./BackgroundJobs"

export const dynamic = "force-dynamic"

export default async function QueueAdminPage() {
  const t = await getTranslations("adminQueue")
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")
  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">{t("subtitle")}</p>
      </header>
      {/* The inventory goes first: with BullMQ off it is the whole answer to
          "is the background work happening?", and the queue table below is
          empty by construction. */}
      <BackgroundJobs />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("queueSection")}</h2>
        <QueueAdmin />
      </section>
    </div>
  )
}
