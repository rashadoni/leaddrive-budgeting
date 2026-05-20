/**
 * Phase 7.M Step 4d (2026-05-18) — admin self-service archive page.
 *
 * Server component (auth + initial company list) wraps the client form.
 * The form drives `POST /api/admin/data-archive` and the recent-archives
 * table reads `AuditEvent` rows where `action ∈ {data_archive, data_restore}`.
 *
 * Why server-component shell: the company list never changes during
 * a session, so we pre-load it server-side and avoid an extra fetch on
 * mount. Auth + redirect happens before the client hydrates.
 *
 * Admin-only — viewer/editor land on the dashboard via redirect.
 */
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { DataArchiveForm } from "./DataArchiveForm"

export const metadata = {
  title: "Archive · Admin · BudgetPro",
}

export default async function DataArchivePage() {
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")
  const orgId = session?.user?.organizationId
  if (!orgId) redirect("/budgeting")

  // Pre-load company list (codes only) so the form's company picker
  // doesn't need a separate fetch round-trip.
  const companies = await prisma.company.findMany({
    where: {
      organizationId: orgId,
      isActive: true,
      level: { gt: 1 },
    },
    select: { code: true, name: true },
    orderBy: { code: "asc" },
  })

  // Recent archive trail — last 20 archive/restore events. Read-only
  // tabular view below the form so the operator sees their own and
  // colleagues' recent actions.
  const recentEvents = await prisma.auditEvent.findMany({
    where: {
      organizationId: orgId,
      action: { in: ["data_archive", "data_restore"] },
    },
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      metadata: true,
      createdAt: true,
      actor: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  })

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <h1 className="text-2xl font-bold mb-2">Архив данных</h1>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
        Архивирование скрывает данные из HeatMap, recompute и отчётов,
        но физически их не удаляет. Восстановление возможно в течение
        90 дней. Все действия записываются в audit trail для IFRS-аудита.
      </p>

      <DataArchiveForm companies={companies} />

      <h2 className="text-lg font-semibold mt-10 mb-3">
        История архивации (последние 20)
      </h2>
      {recentEvents.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          Пока ни одного действия архивации не зарегистрировано.
        </p>
      ) : (
        <div className="border rounded overflow-hidden">
          <table className="w-full text-xs font-mono">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2">Когда</th>
                <th className="text-left p-2">Действие</th>
                <th className="text-left p-2">Что</th>
                <th className="text-left p-2">Скоуп</th>
                <th className="text-right p-2">Строк</th>
                <th className="text-left p-2">Кто</th>
                <th className="text-left p-2">Причина</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.map((e: (typeof recentEvents)[number]) => {
                const m = (e.metadata ?? {}) as Record<string, unknown>
                const scope = [
                  m.companyCode,
                  m.year,
                  m.period,
                ]
                  .filter(Boolean)
                  .join(" · ") || "all"
                return (
                  <tr
                    key={e.id}
                    className="border-t hover:bg-muted/40"
                  >
                    <td className="p-2 whitespace-nowrap">
                      {e.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="p-2">
                      {e.action === "data_archive" ? (
                        <span className="text-amber-600">archive</span>
                      ) : (
                        <span className="text-emerald-600">restore</span>
                      )}
                    </td>
                    <td className="p-2">{String(m.entityKind ?? e.entityType)}</td>
                    <td className="p-2">{scope}</td>
                    <td className="p-2 text-right">
                      {typeof m.rowsAffected === "number"
                        ? m.rowsAffected.toLocaleString()
                        : "—"}
                    </td>
                    <td className="p-2 truncate max-w-[140px]">
                      {e.actor?.name ?? e.actor?.email ?? "system"}
                    </td>
                    <td className="p-2 truncate max-w-[200px]">
                      {typeof m.reason === "string" ? m.reason : "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
