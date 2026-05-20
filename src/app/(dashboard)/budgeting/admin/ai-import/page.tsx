/**
 * Phase 7.M Tier 4 (2026-05-19) — AI Auto Import admin page.
 *
 * Two-step UX:
 *   1. Upload xlsx → AI classifies every sheet → preview shown
 *   2. User confirms → POSTs to /api/admin/import-workbook for the
 *      battle-tested 5-phase bit-perfect import with reconciliation
 */
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import { AIImportForm } from "./AIImportForm"

export const metadata = {
  title: "AI Auto Import · Admin · BudgetPro",
}

export default async function AIImportPage() {
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")
  const orgId = session?.user?.organizationId
  if (!orgId) redirect("/budgeting")

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <h1 className="text-2xl font-bold mb-2">AI Auto Import</h1>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
        Загрузите любой xlsx — ИИ автоматически определит, что в каждом
        листе (P&amp;L / Balance Sheet / Cash Flow / KPI / CAPEX / Sales /
        Land Registry / Strategic descriptions) и к какой компании он
        относится. Затем подтвердите план — система запустит bit-perfect
        импорт с обязательной сверкой.
      </p>
      <p className="text-xs text-muted-foreground mb-6 leading-relaxed">
        Stack: AI Classifier (Anthropic) → Adapter Router → 5-Phase Import →
        Mandatory Reconciliation. Никаких изменений в БД без 🟢 GREEN
        verdict reconciliation report.
      </p>

      <AIImportForm />
    </div>
  )
}
