// ImportTab — extracted from `src/app/(dashboard)/budgeting/page.tsx` Turn LXXXII
// (Phase 3.1 fifth slice; precedent: VarianceTab/ComparisonTab/PLTab/PlansTab).
//
// Pure refactor — zero functional change. Wraps a CSV vs Excel mode toggle
// over IntegrationsTab (CSV) and BudgetExcelImport (Excel).
//
// Closure-leak risk: NONE. Both children are leaf imports; only state is
// the local mode toggle. No cross-tab dependencies.
"use client"

import Link from "next/link"
import { useState } from "react"
import { useTranslations } from "next-intl"
import { FileSpreadsheet, Brain, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BudgetCsvImport } from "@/components/budget-csv-import"
import { BudgetImportHistory } from "@/components/budget-import-history"
import { BudgetExcelImport } from "@/components/budget-excel-import"
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
  onImported,
}: {
  planId: string
  onImported: (planId: string) => void
}) {
  const t = useTranslations("budgeting")
  const [importMode, setImportMode] = useState<"csv" | "excel">("csv")
  return (
    <div className="space-y-4">
      {/* Phase 7.M Tier 7 Phase 5 — consolidation banner. Old CSV/Excel
          forms still functional but secondary; AI Import is the new
          single entry point recognising 14 dataTypes including
          BUDGET_ACTUALS (replaces this CSV form). */}
      <div
        className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex items-start gap-3"
        data-testid="ai-import-deprecation-banner"
      >
        <Brain className="size-5 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="font-semibold text-sm">
            Используйте единый «Импорт данных» для xlsx/CSV актуалов
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            AI Import теперь распознаёт BUDGET_ACTUALS shape (category | amount |
            date | department | description | lineType | companyCode) — один
            экран на все импорты. Эта форма остаётся как backup, но скоро будет
            убрана.
          </p>
          <Link
            href="/budgeting/admin/ai-import"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            Перейти к Импорту данных
            <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={importMode === "csv" ? "default" : "outline"}
          onClick={() => setImportMode("csv")}
        >
          <FileSpreadsheet className="h-4 w-4 mr-1" /> {t("wsImportTabCsv")}
        </Button>
        <Button
          size="sm"
          variant={importMode === "excel" ? "default" : "outline"}
          onClick={() => setImportMode("excel")}
        >
          <FileSpreadsheet className="h-4 w-4 mr-1" /> {t("wsImportTabExcel")}
        </Button>
      </div>
      {importMode === "csv" ? (
        <IntegrationsTab planId={planId} />
      ) : (
        <BudgetExcelImport onImported={onImported} />
      )}
    </div>
  )
}
