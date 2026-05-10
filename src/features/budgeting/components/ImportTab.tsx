// ImportTab — extracted from `src/app/(dashboard)/budgeting/page.tsx` Turn LXXXII
// (Phase 3.1 fifth slice; precedent: VarianceTab/ComparisonTab/PLTab/PlansTab).
//
// Pure refactor — zero functional change. Wraps a CSV vs Excel mode toggle
// over IntegrationsTab (CSV) and BudgetExcelImport (Excel).
//
// Closure-leak risk: NONE. Both children are leaf imports; only state is
// the local mode toggle. No cross-tab dependencies.
"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { FileSpreadsheet } from "lucide-react"
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
