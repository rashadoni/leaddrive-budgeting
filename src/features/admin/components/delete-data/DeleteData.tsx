"use client"
/**
 * The Delete data screen.
 *
 * One address, four tasks. Opening a task collapses the chooser to a
 * breadcrumb; switching tasks carries NOTHING over — reason, token and
 * preview are all re-entered, because they were answers to a different
 * question.
 */
import { useState } from "react"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import type { TaskId } from "@/features/admin/lib/delete-data/tier"
import { TaskChooser } from "./TaskChooser"
import { ClearYearsTask } from "./ClearYearsTask"
import { RemoveCompanyTask } from "./RemoveCompanyTask"
import { DeleteEverythingTask } from "./DeleteEverythingTask"
import { RestoreTask } from "./RestoreTask"
import type { AuditRow, CompanyRow } from "./types"

export function DeleteData({
  companies,
  groupLevel,
  events,
}: {
  companies: ReadonlyArray<CompanyRow>
  groupLevel: ReadonlyArray<CompanyRow>
  events: ReadonlyArray<AuditRow>
}) {
  const t = useTranslations("adminDataDelete")
  // `key` forces a fresh mount per task, so no state leaks across a switch.
  const [task, setTask] = useState<TaskId | null>(null)
  const [nonce, setNonce] = useState(0)

  function open(next: TaskId) {
    setTask(next)
    setNonce((n) => n + 1)
  }

  return (
    <div className="space-y-6">
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t("intro")}{" "}
        <Link
          href="/budgeting/admin/ai-import"
          className="font-medium underline underline-offset-2"
        >
          {t("introLink")}
        </Link>
      </p>

      {task === null ? (
        <TaskChooser onPick={open} />
      ) : (
        <div className="rounded-lg border border-border bg-card p-4 sm:p-5">
          <nav className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t("breadcrumb.root")}</span>
            <span aria-hidden="true">›</span>
            <span className="font-medium text-foreground">{t(`task.${task}.cta`)}</span>
            <button
              type="button"
              onClick={() => setTask(null)}
              className="ml-auto inline-flex items-center gap-1 underline-offset-2 hover:underline"
            >
              <ChevronLeft className="h-3 w-3" aria-hidden="true" />
              {t("breadcrumb.change")}
            </button>
          </nav>

          {task === "clearYears" && (
            <ClearYearsTask
              key={nonce}
              companies={companies}
              onDeleteAll={() => open("deleteAll")}
              onDone={() => setTask(null)}
            />
          )}
          {task === "removeCompany" && (
            <RemoveCompanyTask
              key={nonce}
              companies={companies}
              onDone={() => setTask(null)}
            />
          )}
          {task === "restore" && (
            <RestoreTask
              key={nonce}
              events={events}
              companies={[...companies, ...groupLevel]}
            />
          )}
          {task === "deleteAll" && (
            <DeleteEverythingTask
              key={nonce}
              companies={companies}
              groupLevel={groupLevel}
              onDone={() => setTask(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}
