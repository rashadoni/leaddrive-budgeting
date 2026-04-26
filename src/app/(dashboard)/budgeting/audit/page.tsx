import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import { AuditFeed } from "@/features/audit/components/AuditFeed"

export const metadata = {
  title: "Audit Log",
}

/**
 * Phase 7.F (Turn 13) — server-side defense-in-depth for the audit log.
 *
 * The sidebar already filters this entry out for viewer-tier users, but
 * a viewer who manually types `/budgeting/audit` in the URL bar must
 * also be redirected — sidebar gating is purely cosmetic. Redirect to
 * the dashboard root rather than 403'ing so the user lands on a usable
 * page instead of an error.
 */
export default async function AuditPage() {
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "manager")) {
    redirect("/budgeting")
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <p className="text-sm text-muted-foreground">
          High-business-impact writes on the holding tree — budget imports,
          AI-mapper applies, role changes, indicator overrides. Retained 365 days.
        </p>
      </header>
      <AuditFeed />
    </div>
  )
}
