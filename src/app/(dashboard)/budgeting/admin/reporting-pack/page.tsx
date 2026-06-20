/**
 * Reporting-pack import admin page (FO Holding monthly "Reporting YYYY.xlsx").
 *
 * Upload the monthly reporting pack → preview (no DB writes) → apply.
 * Drives POST /api/import/reporting-pack, which reads the detail sheets
 * (Actual PLF / BS Actual / CF Actual + Budget PLF), splits each by the BU
 * column into the operating entities, and writes through the audited
 * production handlers per entity in one transaction.
 */
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import { ReportingPackForm } from "./ReportingPackForm"

export const metadata = {
  title: "Reporting Pack Import · Admin · BudgetPro",
}

export default async function ReportingPackPage() {
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")
  if (!session?.user?.organizationId) redirect("/budgeting")

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-medium mb-2">
          Reporting Pack
        </div>
        <h1 className="text-2xl font-bold mb-2">Импорт месячного пакета отчётности</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Загрузите «Reporting&nbsp;YYYY.xlsx». Импортёр читает детальные листы
          (Actual&nbsp;PLF / BS&nbsp;Actual / CF&nbsp;Actual → факт; Budget&nbsp;PLF →
          бюджет), делит каждый по колонке&nbsp;BU на сущности
          (AZSF / EDEN / CPC / ProMalt; EJE/AJE/Consolidated пропускаются) и
          пишет через проверенный конвейер по сущности в одной транзакции.
        </p>
      </div>
      <p className="text-xs text-muted-foreground mb-6 leading-relaxed">
        Сначала «Превью» — без единой записи в БД. Затем «Применить» —
        clean-slate по сущности (существующие данные года заменяются),
        с пересчётом индикаторов. CF — только факт (бюджетный CF не
        импортируется: у таблицы нет измерения plan-kind).
      </p>

      <ReportingPackForm />
    </div>
  )
}
