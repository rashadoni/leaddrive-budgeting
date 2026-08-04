"use client"
/**
 * Phase 11.76 (2026-07-31) — this panel no longer deletes anything.
 *
 * It used to be titled "Import cleanup before re-load" and carried a company
 * dropdown, a bare year box and FOUR rival buttons — «Tam arxiv», «Reset
 * preview», «Sıfırla və yenidən import et», «Təhlükəsiz rollback» — none of
 * which said what would actually disappear.
 *
 * Its premise was also false. An import batch clean-slates exactly what it
 * writes (`import-batch.ts:217-260`: every planId × company × plan year the
 * file covers), so a reset is NOT a step before re-uploading. Presenting one
 * as routine housekeeping put the single most destructive action in the
 * product directly in the path of a routine one.
 *
 * What is left is three lines saying so, and a link to the page that does
 * deletion properly. The `import-cleanup` id and the `ai-import-guide-reset`
 * testid stay: `src/content/help/ai-import-guide-scenario.test.ts` pins both
 * as text in this file, and the guided tour hovers them.
 */

import Link from "next/link"
import { useTranslations } from "next-intl"
import { Info, Trash2 } from "lucide-react"

export function ImportDataResetPanel() {
  const t = useTranslations("adminAiImport.cleanup")
  return (
    <section
      id="import-cleanup"
      data-testid="ai-import-guide-reset"
      className="rounded-lg border border-border bg-muted/30 p-4 text-sm"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t("title")}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("body")}</p>
        </div>
        {/* 2026-08-04 — the CTA had no test id of its own; only the <section>
            wrapper carried one, so anything targeting `ai-import-guide-reset`
            clicked the panel's empty centre and never navigated. Found while
            recording the import guide: the click reported success and the URL
            never changed. */}
        <Link
          data-testid="ai-import-guide-reset-cta"
          href="/budgeting/admin/data-archive"
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          {t("link")}
        </Link>
      </div>
    </section>
  )
}
