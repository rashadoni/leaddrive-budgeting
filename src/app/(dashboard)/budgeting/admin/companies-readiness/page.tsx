/**
 * Phase 7.M Step 5 (Option E) — per-company readiness dashboard.
 *
 * One screen, every entity, a clear "what's missing" punch-list. Built
 * so the finance lead can:
 *   • Screenshot it and forward to the client ("look, these are the
 *     gaps").
 *   • Sort by tier → see worst-first → prioritise.
 *   • Expand a row → see the seven data areas with earned-vs-missing.
 *   • Export CSV → paste into an email with a bullet list per
 *     subsidiary.
 *
 * Admin-only. Server component handles auth + the single batch DB read
 * via `getCompanyReadiness`; the table is a client component for the
 * sort + expand + CSV interactions.
 */
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { getCompanyReadiness } from "@/lib/server/get-company-readiness"
import { currentBakuYear } from "@/lib/risk/periods"
import { ReadinessTable, type ReadinessRow } from "./ReadinessTable"

export const metadata = {
  title: "Company readiness · Admin · BudgetPro",
}

export default async function CompaniesReadinessPage() {
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")
  const orgId = session?.user?.organizationId
  if (!orgId) redirect("/budgeting")

  // Companies + readiness in one batch.
  const companies = await prisma.company.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      status: { notIn: ["pending", "archived"] },
      level: 2,
      role: "operational",
    },
    select: {
      id: true,
      code: true,
      name: true,
      industry: true,
    },
    orderBy: { code: "asc" },
  })

  const period = currentBakuYear()
  const readinessMap = await getCompanyReadiness(prisma, orgId, period)

  const rows: ReadinessRow[] = companies.map((c: (typeof companies)[number]) => {
    const r = readinessMap.get(c.id)
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      industry: c.industry ?? "—",
      score: r?.score ?? 0,
      tier: r?.tier ?? "empty",
      areas:
        r?.areas?.map((a) => ({
          id: a.id,
          label: a.label,
          weight: a.weight,
          earned: a.earned,
          missing: a.missing,
        })) ?? [],
    }
  })

  const t = await getTranslations("adminCompaniesReadiness")
  return (
    <div
      className="container mx-auto py-8 px-4 max-w-6xl"
      data-testid="data-control-readiness"
    >
      <h1 className="text-2xl font-bold mb-1">{t("pageTitle")}</h1>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
        {t("pageDescription")}
      </p>
      <p
        className="mb-4 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        data-testid="data-control-readiness-period"
      >
        {t("periodDisclosure", { period })}
      </p>

      <ReadinessTable rows={rows} />
    </div>
  )
}
