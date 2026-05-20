/**
 * Phase 7.M Tier2 Bonus (2026-05-19) — admin page for workbook import.
 *
 * Server component handles auth + pre-fetch of the 4 AzerSheker entity
 * codes for the entity-filter dropdown. The form itself is client-side
 * because we need drag-drop, fetch progress, and verdict rendering.
 */
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { ImportWorkbookForm } from "./ImportWorkbookForm"

export const metadata = {
  title: "Import workbook · Admin · BudgetPro",
}

export default async function ImportWorkbookPage() {
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")
  const orgId = session?.user?.organizationId
  if (!orgId) redirect("/budgeting")

  const entities = await prisma.company.findMany({
    where: {
      organizationId: orgId,
      code: {
        in: ["AZSEKER-AZSF", "AZSEKER-CPC", "AZSEKER-EDEN", "AZSEKER-MALT"],
      },
    },
    select: { code: true, name: true },
    orderBy: { code: "asc" },
  })

  return (
    <div className="container mx-auto py-8 px-4 max-w-3xl">
      <h1 className="text-2xl font-bold mb-2">Import workbook</h1>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
        Загрузите xlsx с AzerSheker financial workbook. Импорт идёт в 5 фаз:
        P&amp;L → BS → KPI+Sales → CF → Recompute. Каждая фаза имеет
        reconciliation report — система гарантирует bit-perfect совпадение
        с файлом или показывает где разошлось.
      </p>
      <p className="text-xs text-muted-foreground mb-6">
        Альтернатива из CLI: <code className="px-1.5 py-0.5 bg-muted rounded">npx tsx scripts/import-azseker-workbook-batch.ts --purge</code>
      </p>

      <ImportWorkbookForm entities={entities} />
    </div>
  )
}
