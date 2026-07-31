// ImportTab — extracted from `src/app/(dashboard)/budgeting/page.tsx` Turn LXXXII
// (Phase 3.1 fifth slice). Phase 2.3 cleanup 2026-05-26 removed the
// legacy AAC-specific Excel import path; CSV-actuals is the only
// remaining mode here, and the banner above directs users to AI Auto
// Import for everything else.
"use client"

import Link from "next/link"
import { useState } from "react"
import { useTranslations } from "next-intl"
import { Brain, ArrowRight } from "lucide-react"
import { BudgetCsvImport } from "@/components/budget-csv-import"
import { BudgetImportHistory } from "@/components/budget-import-history"
import { useImportCsv, useImportHistory } from "@/lib/budgeting/hooks"

type ImportResult = {
  totalRows: number
  matchedRows: number
  unmatchedRows: number
  errors?: { row: number; error: string }[]
}

function IntegrationsTab({ planId }: { planId: string }) {
  const importCsv = useImportCsv()
  const { data: imports = [], isLoading: importsLoading } = useImportHistory(planId)
  const [lastResult, setLastResult] = useState<ImportResult | null>(null)

  const handleImport = async (data: Parameters<typeof importCsv.mutateAsync>[0]) => {
    const result = await importCsv.mutateAsync(data)
    setLastResult(result as ImportResult)
  }

  return (
    <div className="space-y-6">
      <BudgetCsvImport
        planId={planId}
        onImport={handleImport}
        isImporting={importCsv.isPending}
        lastResult={lastResult}
      />
      <BudgetImportHistory imports={imports} isLoading={importsLoading} />
    </div>
  )
}

export function ImportTab({
  planId,
}: {
  planId: string
  onImported?: (planId: string) => void
}) {
  const t = useTranslations("budgeting")
  return (
    <div className="space-y-4">
      <div
        className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex items-start gap-3"
        data-testid="ai-import-deprecation-banner"
      >
        <Brain className="size-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="font-semibold text-sm">
            {t("importBannerTitle")}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("importBannerBody")}
          </p>
          <Link
            href="/budgeting/admin/ai-import"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            {t("importBannerLink")}
            <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>
      <IntegrationsTab planId={planId} />
    </div>
  )
}
