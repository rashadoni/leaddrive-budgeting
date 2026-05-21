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
import { AIImportTabs } from "./AIImportTabs"

export const metadata = {
  title: "Импорт данных · Admin · BudgetPro",
}

export default async function AIImportPage() {
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")
  const orgId = session?.user?.organizationId
  if (!orgId) redirect("/budgeting")

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium mb-2">
          ЕДИНАЯ ТОЧКА ВХОДА
        </div>
        <h1 className="text-2xl font-bold mb-2">Импорт данных</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Загрузите любой xlsx — AI автоматически определит тип данных
          (P&amp;L, Balance Sheet, Cash Flow, операционные KPI, CAPEX,
          продажи, земля, описания компаний, структура холдинга, бюджетные
          актуалы, sales forecast) и маршрутизирует на правильный adapter.
          Никаких отдельных форм под каждый тип данных — один экран на всё.
        </p>
      </div>
      <p className="text-xs text-muted-foreground mb-6 leading-relaxed">
        Stack: AI Classifier (Anthropic) → Adapter Router → 5-Phase Import →
        Mandatory Reconciliation. Никаких изменений в БД без 🟢 GREEN
        verdict reconciliation report.
      </p>

      <AIImportTabs />
    </div>
  )
}
