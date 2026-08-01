/**
 * Admin "Delete data" page (Phase 11.76, 2026-07-31 — was "Data Archive").
 *
 * Server component: auth, the company list, and the recent-events trail. The
 * client shell (`DeleteData`) owns the four tasks.
 *
 * Two things this query got wrong before:
 *   • It filtered companies to `level > 1`, so the group-level entity — which
 *     a whole-group delete DOES clear — was invisible on the screen that
 *     cleared it.
 *   • It read only `data_archive` / `data_restore`, so every `data_reset`
 *     (the destructive one) was missing from the history table underneath.
 */
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { auth } from "@/lib/auth"
import { hasRole } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { DeleteData } from "@/features/admin/components/delete-data/DeleteData"
import type { AuditRow, CompanyRow } from "@/features/admin/components/delete-data/types"

/** The audit trail's model names, mapped to `adminDataArchive.entity.*`. */
const ENTITY_LABEL_KEYS = new Set([
  "Company",
  "BudgetLine",
  "BalanceSheetLine",
  "CashFlowEntry",
  "Counterparty",
])

function entityLabelKey(entityType: string): string {
  return ENTITY_LABEL_KEYS.has(entityType) ? entityType : "unknown"
}

export async function generateMetadata() {
  const t = await getTranslations("adminDataArchive")
  return { title: t("metaTitle") }
}

export default async function DataArchivePage() {
  const t = await getTranslations("adminDataArchive")
  const session = await auth()
  const role = session?.user?.role
  if (!hasRole(role, "admin")) redirect("/budgeting")
  const orgId = session?.user?.organizationId
  if (!orgId) redirect("/budgeting")

  const allCompanies = await prisma.company.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, code: true, name: true, level: true, parentCompanyId: true },
    orderBy: [{ level: "asc" }, { code: "asc" }],
  })
  const operational: CompanyRow[] = allCompanies.filter((c) => c.level > 1)
  const groupLevel: CompanyRow[] = allCompanies.filter((c) => c.level <= 1)

  const recentEvents = await prisma.auditEvent.findMany({
    where: {
      organizationId: orgId,
      action: { in: ["data_archive", "data_restore", "data_reset"] },
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

  const events: AuditRow[] = recentEvents.map((e: (typeof recentEvents)[number]) => {
    const m = (e.metadata ?? {}) as Record<string, unknown>
    return {
      id: e.id,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      createdAt: e.createdAt.toISOString(),
      actor: e.actor?.name ?? e.actor?.email ?? null,
      companyCode: typeof m.companyCode === "string" ? m.companyCode : undefined,
      year: typeof m.year === "number" ? m.year : undefined,
      years: Array.isArray(m.years) ? (m.years as number[]) : undefined,
      rowsAffected: typeof m.rowsAffected === "number" ? m.rowsAffected : undefined,
      reason: typeof m.reason === "string" ? m.reason : undefined,
      // The restore key. Only events written on or after 2026-07-31 carry it;
      // the Restore task offers a button for exactly those and explains why
      // the older ones get none.
      archivedAt: typeof m.archivedAt === "string" ? m.archivedAt : undefined,
      breakdown:
        m.breakdown && typeof m.breakdown === "object"
          ? (m.breakdown as Record<string, number>)
          : undefined,
    }
  })

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">{t("title")}</h1>
      <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
        {t("description")}
      </p>

      <DeleteData companies={operational} groupLevel={groupLevel} events={events} />

      <h2 className="mb-3 mt-10 text-lg font-semibold">{t("historyTitle")}</h2>
      {events.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">{t("historyEmpty")}</p>
      ) : (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-xs font-mono">
            <thead className="bg-muted">
              <tr>
                <th className="p-2 text-left">{t("col.when")}</th>
                <th className="p-2 text-left">{t("col.action")}</th>
                <th className="p-2 text-left">{t("col.what")}</th>
                <th className="p-2 text-left">{t("col.scope")}</th>
                <th className="p-2 text-right">{t("col.rows")}</th>
                <th className="p-2 text-left">{t("col.who")}</th>
                <th className="p-2 text-left">{t("col.reason")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const scope =
                  [e.companyCode, e.years?.join(", ") ?? e.year].filter(Boolean).join(" · ") ||
                  t("scopeAll")
                return (
                  <tr key={e.id} className="border-t hover:bg-muted/40">
                    <td className="whitespace-nowrap p-2">
                      {e.createdAt.slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="p-2">
                      {e.action === "data_reset" ? (
                        <span className="text-red-600">{t("actionDelete")}</span>
                      ) : e.action === "data_archive" ? (
                        <span className="text-amber-600">{t("actionArchive")}</span>
                      ) : (
                        <span className="text-emerald-600">{t("actionRestore")}</span>
                      )}
                    </td>
                    {/* `entityType` is a Prisma model name. Printing
                        "Company" raw under an Azerbaijani column headed «Nə»
                        is both untranslated and, for a delete of one year's
                        figures, not even semantically right. */}
                    <td className="p-2">{t(`entity.${entityLabelKey(e.entityType)}`)}</td>
                    <td className="p-2">{scope}</td>
                    <td className="p-2 text-right">
                      {e.rowsAffected != null ? e.rowsAffected.toLocaleString() : "—"}
                    </td>
                    <td className="max-w-[140px] truncate p-2">
                      {e.actor ?? t("systemActor")}
                    </td>
                    <td className="max-w-[200px] truncate p-2">{e.reason ?? "—"}</td>
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
