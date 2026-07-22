/**
 * Phase 7.N — post-import IFRS conformance check (admin page).
 *
 * Client feedback #2: "FS ifrs uyğun yığılmasınnı yoxlamaq. importdan sonra."
 * Pick a company → run the 5 IAS 1 structural checks against its imported
 * financial statements. Admin-only. Server component handles auth + the
 * company list; the interactive check runs client-side against the API.
 */
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { IfrsConformanceView, type CompanyOption } from "./IfrsConformanceView"

export const metadata = {
  title: "IFRS conformance · Admin · BudgetPro",
}

export default async function IfrsConformancePage() {
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

  const t = await getTranslations("adminIfrs")
  return (
    <div
      className="container mx-auto py-8 px-4 max-w-4xl"
      data-testid="data-control-ifrs"
    >
      <h1 className="text-2xl font-bold mb-1">{t("pageTitle")}</h1>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">{t("pageDescription")}</p>
      <IfrsConformanceView companies={options} />
    </div>
  )
}
