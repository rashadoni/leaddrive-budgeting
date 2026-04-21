"use client"

import { useState, useRef } from "react"
import { useSession } from "next-auth/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2, Trash2, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, Undo2 } from "lucide-react"

interface ImportIssue {
  sheet: string
  row?: number
  reason: string
  rawValue?: string
}

interface ImportResult {
  planId: string
  planName: string
  results: Record<string, number>
  sheetsFound: string[]
  issues?: ImportIssue[]
  issueCount?: number
  issuesTruncated?: boolean
}

const RESULT_LABELS: Record<string, string> = {
  planCreated: "Plan",
  chartOfAccounts: "Chart of Accounts",
  costTypes: "Cost Types",
  departments: "Departments",
  productLines: "Product Lines",
  budgetLines: "P&L Budget Lines",
  salesBudgetLines: "Sales Budget",
  salesForecasts: "Sales Forecast",
  balanceSheetLines: "Balance Sheet",
  cogsLines: "COGS Lines",
  costComponents: "Cost Components",
  assumptions: "Assumptions",
  cashFlowEntries: "Cash Flow",
  expenseForecasts: "Expense Forecast",
}

export function BudgetExcelImport({ onImported }: { onImported?: (planId: string) => void }) {
  const { data: session } = useSession()
  const orgId = (session?.user as any)?.organizationId
  const queryClient = useQueryClient()

  const [file, setFile] = useState<File | null>(null)
  const [year, setYear] = useState("2026")
  const [result, setResult] = useState<ImportResult | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [issuesOpen, setIssuesOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  // Load existing plans to show delete option
  const { data: plans = [] } = useQuery({
    queryKey: ["budgeting", "plans", orgId],
    queryFn: async () => {
      const res = await fetch("/api/budgeting/plans", { headers: { ...headers, "Content-Type": "application/json" } })
      if (!res.ok) return []
      const json = await res.json()
      return (json.data ?? json) as any[]
    },
    enabled: !!orgId,
  })

  // Load soft-deleted plans so we can offer Restore during the 30-day undo window.
  const { data: deletedPlans = [] } = useQuery({
    queryKey: ["budgeting", "plans-deleted", orgId],
    queryFn: async () => {
      const res = await fetch("/api/budgeting/plans?onlyDeleted=true", { headers: { ...headers, "Content-Type": "application/json" } })
      if (!res.ok) return []
      const json = await res.json()
      return (json.data ?? json) as any[]
    },
    enabled: !!orgId,
  })

  const restoreMutation = useMutation({
    mutationFn: async (planId: string) => {
      const res = await fetch(`/api/budgeting/plans/${planId}/restore`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Restore failed")
      }
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })

  const purgeMutation = useMutation({
    mutationFn: async (planId: string) => {
      const res = await fetch(`/api/budgeting/plans/${planId}/purge`, {
        method: "DELETE",
        headers: { ...headers, "Content-Type": "application/json" },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Permanent delete failed")
      }
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
  const [purgeConfirm, setPurgeConfirm] = useState<string | null>(null)

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected")

      const formData = new FormData()
      formData.append("file", file)
      formData.append("year", year)

      const res = await fetch("/api/budgeting/import-excel", {
        method: "POST",
        headers: { "x-organization-id": orgId || "" },
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Import failed")
      }

      return res.json()
    },
    onSuccess: (data) => {
      setResult(data)
      queryClient.invalidateQueries()
      if (data.planId && onImported) onImported(data.planId)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (planId: string) => {
      const res = await fetch(`/api/budgeting/plans?planId=${planId}&deleteAll=true`, {
        method: "DELETE",
        headers: { ...headers, "Content-Type": "application/json" },
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Delete failed")
      }
      return res.json()
    },
    onSuccess: () => {
      setDeleteConfirm(null)
      setResult(null)
      queryClient.invalidateQueries()
    },
  })

  const importedPlans = plans.filter((p: any) => p.name?.includes("(Imported)"))

  // How many days until the soft-deleted plan gets purged
  const daysRemaining = (deletedAt: string | null) => {
    if (!deletedAt) return 30
    const age = (Date.now() - new Date(deletedAt).getTime()) / (1000 * 60 * 60 * 24)
    return Math.max(0, Math.ceil(30 - age))
  }

  return (
    <div className="space-y-4">
      {/* Recently deleted plans — restore option (30-day undo window) */}
      {deletedPlans.length > 0 && (
        <Card className="border-sky-200 dark:border-sky-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Undo2 className="h-4 w-4 text-sky-600" />
              Recently Deleted — Restore Within 30 Days
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {deletedPlans.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">{p.year}</span>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    Deleted {new Date(p.deletedAt).toLocaleDateString()} · {daysRemaining(p.deletedAt)} day{daysRemaining(p.deletedAt) === 1 ? "" : "s"} until permanent removal
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    disabled={restoreMutation.isPending}
                    onClick={() => restoreMutation.mutate(p.id)}
                  >
                    {restoreMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : (<><Undo2 className="h-3.5 w-3.5 mr-1" />Restore</>)}
                  </Button>
                  {purgeConfirm === p.id ? (
                    <>
                      <span className="text-[10px] text-destructive">Forever?</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs"
                        disabled={purgeMutation.isPending}
                        onClick={() => { purgeMutation.mutate(p.id); setPurgeConfirm(null) }}
                      >
                        {purgeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPurgeConfirm(null)}>Cancel</Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => setPurgeConfirm(p.id)}
                      title="Remove permanently (skip 30-day retention)"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {restoreMutation.isError && (
              <div className="flex items-center gap-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
                <AlertCircle className="h-3.5 w-3.5" />
                {(restoreMutation.error as Error).message}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Existing imported plans — delete option */}
      {importedPlans.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-amber-600" />
              Existing Imported Plans
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {importedPlans.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
                <div>
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">{p.year}</span>
                </div>
                {deleteConfirm === p.id ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-destructive">Delete all data?</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(p.id)}
                    >
                      {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes, Delete"}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDeleteConfirm(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => setDeleteConfirm(p.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Delete & Re-import
                  </Button>
                )}
              </div>
            ))}
            {deleteMutation.isError && (
              <div className="flex items-center gap-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
                <AlertCircle className="h-3.5 w-3.5" />
                {(deleteMutation.error as Error).message}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Upload area */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Import Budget from Excel
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Upload your budget Excel file (AAC format). The system will automatically import:
            P&L, Balance Sheet, Sales, COGS, Cash Flow, Assumptions, Chart of Accounts, Cost Types, Departments, and Forecasts.
          </p>

          <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) { setFile(f); setResult(null) }
              }}
            />

            {!file ? (
              <div className="space-y-3">
                <Upload className="h-10 w-10 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">
                  Drag & drop an Excel file, or click to select
                </p>
                <Button variant="outline" onClick={() => fileRef.current?.click()}>
                  Select File
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <FileSpreadsheet className="h-10 w-10 text-emerald-600 mx-auto" />
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
                <Button variant="ghost" size="sm" onClick={() => { setFile(null); setResult(null) }}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" /> Change file
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium">Budget Year:</label>
              <Input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="w-24"
              />
            </div>

            <Button
              onClick={() => importMutation.mutate()}
              disabled={!file || importMutation.isPending}
              className="ml-auto"
            >
              {importMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Importing...</>
              ) : (
                <><Upload className="h-4 w-4 mr-2" />Import Budget</>
              )}
            </Button>
          </div>

          {importMutation.isError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              {(importMutation.error as Error).message}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card className="border-emerald-200 dark:border-emerald-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <CheckCircle className="h-5 w-5" />
              Import Successful — {result.planName}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-2">
              {Object.entries(result.results)
                .filter(([, v]) => v > 0)
                .map(([key, count]) => (
                  <div key={key} className="p-2 rounded bg-muted text-center">
                    <div className="text-lg font-bold">{count}</div>
                    <div className="text-[10px] text-muted-foreground">{RESULT_LABELS[key] || key}</div>
                  </div>
                ))}
            </div>

            <div className="flex flex-wrap gap-1 pt-2">
              <span className="text-[10px] text-muted-foreground mr-1">Sheets parsed:</span>
              {result.sheetsFound?.map((s: string) => (
                <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>
              ))}
            </div>

            {/* Skipped/warning rows — collapsible */}
            {result.issues && result.issues.length > 0 && (
              <div className="pt-3 border-t border-amber-200 dark:border-amber-800">
                <button
                  type="button"
                  onClick={() => setIssuesOpen(v => !v)}
                  className="w-full flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline"
                >
                  {issuesOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>
                    {result.issueCount ?? result.issues.length} row{(result.issueCount ?? result.issues.length) === 1 ? "" : "s"} skipped or flagged
                    {result.issuesTruncated ? ` (showing first ${result.issues.length})` : ""}
                  </span>
                </button>
                {issuesOpen && (
                  <div className="mt-2 max-h-80 overflow-y-auto rounded border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
                    <table className="w-full text-[11px]">
                      <thead className="bg-amber-100/50 dark:bg-amber-900/30 sticky top-0">
                        <tr>
                          <th className="px-2 py-1 text-left font-semibold w-16">Sheet</th>
                          <th className="px-2 py-1 text-left font-semibold w-12">Row</th>
                          <th className="px-2 py-1 text-left font-semibold">Reason</th>
                          <th className="px-2 py-1 text-left font-semibold">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.issues.map((iss, i) => (
                          <tr key={i} className="border-t border-amber-200/50 dark:border-amber-800/50 hover:bg-amber-100/40 dark:hover:bg-amber-900/20">
                            <td className="px-2 py-1 font-mono text-amber-800 dark:text-amber-300">{iss.sheet}</td>
                            <td className="px-2 py-1 font-mono text-muted-foreground">{iss.row ?? ""}</td>
                            <td className="px-2 py-1">{iss.reason}</td>
                            <td className="px-2 py-1 font-mono text-muted-foreground truncate max-w-xs" title={iss.rawValue}>{iss.rawValue ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
