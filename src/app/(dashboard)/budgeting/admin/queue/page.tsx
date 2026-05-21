/**
 * Phase 6 — Queue admin landing.
 *
 * Server component → fetches active jobs + recently failed ones; client
 * sub-component handles state-filter pills + manual refresh.
 */
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import { QueueAdmin } from "./QueueAdmin"

export const dynamic = "force-dynamic"

export default async function QueueAdminPage() {
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")
  return (
    <div className="space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Queue Admin</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          BullMQ job inspector. Filter by state to see live work
          (active), recent throughput (completed) or anything that hit
          the dead-letter set (failed).
        </p>
      </header>
      <QueueAdmin />
    </div>
  )
}
