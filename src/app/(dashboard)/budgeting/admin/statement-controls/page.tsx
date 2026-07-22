/**
 * Phase 10 / B1 shadow slice — shadow statement controls (admin page).
 *
 * Pick a company (+ optional period) → run the six canonical statement
 * controls against the imported statements in SHADOW mode. Every result is
 * "provisional" (arithmetic evaluated, not certifiable) or "blocked"
 * (evidence missing) — never pass/fail: the pinned policy is provisional and
 * no statement row carries lineage. Admin-only page; the server component
 * handles auth + the company list, the interactive run happens client-side
 * against GET /api/companies/[id]/statement-controls.
 */
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import StatementControlsView, { type CompanyOption } from "./StatementControlsView"

export const metadata = {
  title: "Statement controls · Admin · BudgetPro",
}

export default async function StatementControlsPage() {
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")
  const orgId = session?.user?.organizationId
  if (!orgId) redirect("/budgeting")

  const companies = await prisma.company.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      status: { notIn: ["pending", "archived"] },
    },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  })

  const options: CompanyOption[] = companies.map((c: (typeof companies)[number]) => ({
    id: c.id,
    code: c.code,
    name: c.name,
  }))

  const t = await getTranslations("adminStatementControls")
  return (
    <div
      className="container mx-auto py-8 px-4 max-w-4xl"
      data-testid="data-control-statement-controls"
    >
      <h1 className="text-2xl font-bold mb-1">{t("pageTitle")}</h1>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{t("pageDescription")}</p>
      <StatementControlsView companies={options} />
    </div>
  )
}
