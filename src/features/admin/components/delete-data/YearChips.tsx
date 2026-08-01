"use client"
/**
 * Step 2 — which years. Chips carrying real counts, plus a separate,
 * mutually-exclusive "All years" chip.
 *
 * The old panel had a number box where blank meant every year. One backspace
 * turned "clear 2026" into "clear everything", with no change of wording,
 * colour or confirmation. There is no field here that can be blanked into a
 * wider scope.
 */
import { useTranslations } from "next-intl"
import Link from "next/link"
import { Lock } from "lucide-react"
import type { PeriodLockInfo } from "./types"

export function YearChips({
  index,
  selected,
  allYears,
  locks,
  onSelect,
  onAllYears,
}: {
  index: Array<{ year: number; rows: number }>
  selected: number[]
  allYears: boolean
  locks: PeriodLockInfo[]
  onSelect: (years: number[]) => void
  onAllYears: (on: boolean) => void
}) {
  const t = useTranslations("adminDataDelete")
  const lockOf = (year: number) =>
    locks.find((l) => l.period === String(year) || l.period.startsWith(`${year}-`))
  const totalRows = index.reduce((s, y) => s + y.rows, 0)
  // Matches the server: an all-years delete covers every locked period by
  // definition, so it is refused while ANY lock exists.
  const anyLock = locks.length > 0

  function toggle(year: number, on: boolean) {
    onAllYears(false)
    onSelect(on ? [...selected, year].sort((a, b) => a - b) : selected.filter((y) => y !== year))
  }

  return (
    <div data-testid="year-chips" className="space-y-2">
      {/* An empty index is not "0 rows to delete" — it is "this data carries
          no year", which is real on a company holding only operational facts.
          Printing the bare "All years · 0 rows" chip under a heading asking
          which years reads as a broken screen. */}
      <p className="text-xs text-muted-foreground">
        {index.length === 0 ? t("years.noIndex") : t("years.question")}
      </p>
      <div className="flex flex-wrap gap-2">
        {index.map(({ year, rows }) => {
          const lock = lockOf(year)
          const on = selected.includes(year) && !allYears
          return (
            <button
              key={year}
              type="button"
              disabled={Boolean(lock)}
              title={
                lock
                  ? t("years.lockedTooltip", {
                      year,
                      who: lock.lockedBy,
                      date: lock.lockedAt.slice(0, 10),
                      reason: lock.reason ?? "—",
                    })
                  : undefined
              }
              onClick={() => toggle(year, !on)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                lock
                  ? "cursor-not-allowed border-border bg-muted/40 text-muted-foreground line-through"
                  : on
                    ? "border-red-600 bg-red-600 text-white"
                    : "border-border bg-background hover:bg-muted"
              }`}
            >
              {lock && <Lock className="h-3 w-3" aria-hidden="true" />}
              {lock ? t("years.locked", { year }) : t("years.chip", { year, rows })}
            </button>
          )
        })}

        <button
          type="button"
          disabled={anyLock}
          onClick={() => {
            onSelect([])
            onAllYears(true)
          }}
          className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm transition ${
            anyLock
              ? "cursor-not-allowed border-border bg-muted/40 text-muted-foreground"
              : allYears
                ? "border-red-700 bg-red-700 text-white"
                : "border-dashed border-border bg-background hover:bg-muted"
          }`}
        >
          {index.length === 0
            ? t("years.allChipNoIndex")
            : t("years.allChip", { rows: totalRows })}
        </button>
      </div>

      {allYears && (
        <p className="text-xs italic text-muted-foreground">{t("years.allChipNote")}</p>
      )}
      {anyLock && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t("years.allYearsLocked")}{" "}
          <Link
            href="/budgeting/admin/periods"
            className="underline underline-offset-2"
          >
            {t("years.lockLink")}
          </Link>
        </p>
      )}
    </div>
  )
}
