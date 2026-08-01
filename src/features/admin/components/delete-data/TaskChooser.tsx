"use client"
/**
 * "What do you want to do?" — the whole point of the redesign.
 *
 * The old screens asked the operator to express a SCOPE (entity kind, company,
 * year, period) before saying what they were trying to achieve. A finance user
 * does not arrive with a scope; they arrive with a sentence: "2025 is wrong",
 * "this company was sold", "start clean". Four cards, four sentences.
 *
 * "Delete everything" sits below a divider, on its own, because it is the only
 * one of the four that cannot be undone from this page.
 */
import { useTranslations } from "next-intl"
import { CalendarX2, Building2, Undo2, Flame } from "lucide-react"
import type { TaskId } from "@/features/admin/lib/delete-data/tier"

const SAFE_TASKS: Array<{ id: TaskId; icon: typeof CalendarX2 }> = [
  { id: "clearYears", icon: CalendarX2 },
  { id: "removeCompany", icon: Building2 },
  { id: "restore", icon: Undo2 },
]

export function TaskChooser({ onPick }: { onPick: (task: TaskId) => void }) {
  const t = useTranslations("adminDataDelete")
  return (
    <div data-testid="task-chooser">
      <h2 className="mb-3 text-base font-semibold">{t("chooser.question")}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {SAFE_TASKS.map(({ id, icon: Icon }) => (
          <TaskCard
            key={id}
            icon={Icon}
            title={t(`task.${id}.title`)}
            body={t(`task.${id}.body`)}
            cta={t(`task.${id}.cta`)}
            onPick={() => onPick(id)}
          />
        ))}
      </div>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-red-300 dark:bg-red-500/40" />
        <span className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
          {t("dangerDivider")}
        </span>
        <span className="h-px flex-1 bg-red-300 dark:bg-red-500/40" />
      </div>

      <TaskCard
        danger
        icon={Flame}
        title={t("task.deleteAll.title")}
        body={t("task.deleteAll.body")}
        cta={t("task.deleteAll.cta")}
        onPick={() => onPick("deleteAll")}
      />
    </div>
  )
}

function TaskCard({
  icon: Icon,
  title,
  body,
  cta,
  onPick,
  danger,
}: {
  icon: typeof CalendarX2
  title: string
  body: string
  cta: string
  onPick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex h-full flex-col items-start gap-1.5 rounded-lg border p-4 text-left transition ${
        danger
          ? "border-red-300 bg-red-50/60 hover:border-red-500 dark:border-red-500/40 dark:bg-red-500/10"
          : "border-border bg-card hover:border-foreground/30 hover:bg-muted/40"
      }`}
    >
      <span
        className={`flex items-center gap-2 text-sm font-semibold ${
          danger ? "text-red-800 dark:text-red-300" : ""
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {title}
      </span>
      <span className="text-xs leading-relaxed text-muted-foreground">{body}</span>
      <span
        className={`mt-2 text-xs font-semibold underline underline-offset-2 ${
          danger ? "text-red-700 dark:text-red-400" : ""
        }`}
      >
        {cta} →
      </span>
    </button>
  )
}
