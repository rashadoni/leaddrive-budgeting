"use client"
/**
 * Step 3 — what exactly. Three plain-language bundles by default; the named
 * categories behind a "Choose exactly" disclosure, which is the literal answer
 * to «удалить что именно».
 *
 * The default screen is not a nine-checkbox wall, and the wall is one click
 * away for the person who wants it.
 */
import { useTranslations } from "next-intl"
import { ChevronDown, ChevronRight, Lock } from "lucide-react"
import {
  ALWAYS_INCLUDED,
  BUNDLES,
  CATEGORY_PREVIEW_KEYS,
  PICKABLE_CATEGORIES,
  type BundleId,
} from "@/features/admin/lib/delete-data/bundles"
import type { ImportResetCategory } from "@/lib/server/import-reset-categories"

export function WhatPicker({
  bundle,
  onBundle,
  exact,
  onExact,
  includeManualActuals,
  onIncludeManualActuals,
  counts,
}: {
  bundle: BundleId
  onBundle: (b: BundleId) => void
  /** null = the disclosure is closed and the bundles are in charge. */
  exact: ImportResetCategory[] | null
  onExact: (c: ImportResetCategory[] | null) => void
  includeManualActuals: boolean
  onIncludeManualActuals: (on: boolean) => void
  /** Live counts from the last unrestricted preview, keyed by preview key. */
  counts: Record<string, number>
}) {
  const t = useTranslations("adminDataDelete")
  const open = exact !== null
  const countFor = (category: string) =>
    (CATEGORY_PREVIEW_KEYS[category] ?? [category]).reduce(
      (sum, key) => sum + (counts[key] ?? 0),
      0,
    )

  return (
    <div data-testid="what-picker" className="space-y-3">
      {!open && (
        <div className="space-y-2">
          {(Object.keys(BUNDLES) as BundleId[]).map((id) => (
            <label key={id} className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="radio"
                name="delete-bundle"
                className="mt-1"
                checked={bundle === id}
                onChange={() => onBundle(id)}
              />
              <span>
                <span className="font-medium">{t(`what.${id}`)}</span>
                {id !== "everything" && (
                  <span className="block text-xs text-muted-foreground">
                    {t(`what.${id}Hint`)}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => onExact(open ? null : [...BUNDLES[bundle]])}
        className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {t("what.exact")}
      </button>

      {open && (
        <div className="space-y-1.5 rounded border border-border bg-background p-3">
          <p className="mb-1 text-xs text-muted-foreground">{t("what.exactHint")}</p>
          {PICKABLE_CATEGORIES.map((category) => (
            <div key={category}>
              {/* A column of nine zeros reads as a failed load. Greying the
                  empty rows says "nothing here", which is what it means. */}
              <label
                className={`flex items-baseline justify-between gap-4 text-sm ${
                  countFor(category) === 0 ? "text-muted-foreground" : ""
                }`}
              >
                <span className="flex items-baseline gap-2">
                  <input
                    type="checkbox"
                    checked={exact.includes(category)}
                    onChange={(e) =>
                      onExact(
                        e.target.checked
                          ? [...exact, category]
                          : exact.filter((c) => c !== category),
                      )
                    }
                  />
                  {t(`category.${previewLabelKey(category)}`)}
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {countFor(category)}
                </span>
              </label>
              {category === "budgetActual" && exact.includes("budgetActual") && (
                <label className="ml-6 mt-1 flex items-baseline gap-2 text-xs text-red-800 dark:text-red-300">
                  <input
                    type="checkbox"
                    checked={includeManualActuals}
                    onChange={(e) => onIncludeManualActuals(e.target.checked)}
                  />
                  {t("what.manualActuals", { count: counts.budgetActualManual ?? 0 })}
                </label>
              )}
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-1.5 text-sm text-muted-foreground">
            <span className="flex items-baseline gap-2">
              <Lock className="h-3 w-3 self-center" aria-hidden="true" />
              {t(`category.${ALWAYS_INCLUDED}`)}
            </span>
            <span className="font-mono text-xs tabular-nums">
              {counts.indicatorValue ?? 0}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{t("what.indicatorsLocked")}</p>
          <p className="text-xs text-muted-foreground">{t("what.zeroHint")}</p>
        </div>
      )}

      <p className="rounded bg-muted/50 p-2 text-xs leading-relaxed text-muted-foreground">
        {t("what.recordsNote")}
      </p>
    </div>
  )
}

/** `budgetActual` is shown as its imported half — the manual half is opt-in. */
function previewLabelKey(category: string): string {
  return category === "budgetActual" ? "budgetActualImported" : category
}
