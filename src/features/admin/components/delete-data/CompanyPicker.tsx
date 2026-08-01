"use client"
/**
 * Step 1 — which companies. A searchable checkbox list, not a dropdown whose
 * "whole holding" option meant a different set than the form next door.
 *
 * The group-level entity is deliberately absent: it exists only in Task D,
 * where it is shown as a read-only chip labelled "group level", so "the whole
 * group" has one meaning and it is visible.
 */
import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Search } from "lucide-react"
import type { CompanyRow } from "./types"

export function CompanyPicker({
  companies,
  selected,
  onChange,
  single = false,
  yearsByCompany,
}: {
  companies: ReadonlyArray<CompanyRow>
  selected: string[]
  onChange: (codes: string[]) => void
  /** Task B picks exactly one. */
  single?: boolean
  /** code → sorted list of years that hold data, for the muted hint. */
  yearsByCompany?: Record<string, number[]>
}) {
  const t = useTranslations("adminDataDelete")
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return companies
    return companies.filter(
      (c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
    )
  }, [companies, query])

  function toggle(code: string, on: boolean) {
    if (single) {
      onChange(on ? [code] : [])
      return
    }
    onChange(on ? [...selected, code] : selected.filter((c) => c !== code))
  }

  const allSelected = companies.length > 0 && selected.length === companies.length

  return (
    <div data-testid="company-picker" className="space-y-2">
      <label className="relative block">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("companies.search")}
          className="h-9 w-full rounded border border-border bg-background pl-8 pr-3 text-sm"
        />
      </label>

      <div className="max-h-72 space-y-1 overflow-auto rounded border border-border bg-background p-2">
        {!single && (
          <label className="mb-1 flex cursor-pointer items-center gap-2 border-b border-border pb-1.5 text-sm font-semibold">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => onChange(e.target.checked ? companies.map((c) => c.code) : [])}
            />
            {t("companies.selectAll", { count: companies.length })}
          </label>
        )}
        {filtered.map((c) => {
          const years = yearsByCompany?.[c.code] ?? []
          const hint =
            years.length === 0
              ? yearsByCompany
                ? t("companies.noData")
                : null
              : years.length === 1
                ? t("companies.dataOneYear", { year: years[0] })
                : t("companies.dataRange", {
                    from: years[0],
                    to: years[years.length - 1],
                  })
          return (
            <label
              key={c.code}
              className={`flex cursor-pointer items-baseline gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50 ${
                yearsByCompany && years.length === 0 ? "opacity-60" : ""
              }`}
            >
              <input
                type={single ? "radio" : "checkbox"}
                name={single ? "delete-company" : undefined}
                checked={selected.includes(c.code)}
                onChange={(e) => toggle(c.code, e.target.checked)}
              />
              <span className="font-medium">{c.name}</span>
              <span className="rounded bg-muted px-1.5 font-mono text-[11px] text-muted-foreground">
                {c.code}
              </span>
              {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
            </label>
          )
        })}
      </div>

      {!single && (
        <p className="text-xs text-muted-foreground">
          {t("companies.selected", { count: selected.length })}
        </p>
      )}
      {allSelected && !single && (
        <p
          data-testid="all-companies-note"
          className="rounded border border-amber-300 bg-amber-50 p-2 text-xs leading-relaxed text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
        >
          {t("companies.allSelectedNote")}
        </p>
      )}
    </div>
  )
}
