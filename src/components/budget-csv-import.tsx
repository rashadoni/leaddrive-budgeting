"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, Download } from "lucide-react"

interface Props {
  planId: string
  integrationId?: string
  onImport: (data: { planId: string; rows: any[]; integrationId?: string; fileName?: string }) => void
  isImporting?: boolean
  lastResult?: {
    totalRows: number
    matchedRows: number
    unmatchedRows: number
    errors?: Array<{ row: number; error: string }>
  } | null
}

function splitCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim())
      current = ""
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

function parseCSV(text: string): any[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = splitCsvLine(lines[0])
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const values = splitCsvLine(lines[i])
    const row: any = {}
    headers.forEach((h, idx) => {
      row[h] = values[idx] || ""
    })
    rows.push(row)
  }
  return rows
}

export function BudgetCsvImport({ planId, integrationId, onImport, isImporting, lastResult }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<any[] | null>(null)
  const [fileName, setFileName] = useState("")

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const rows = parseCSV(text)
      setPreview(rows)
    }
    reader.readAsText(file)
  }

  const handleImport = () => {
    if (!preview) return
    onImport({ planId, rows: preview, integrationId, fileName })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4" />
          CSV Import
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Download template + Upload area */}
        <div className="flex gap-3">
          <a href={`/api/budgeting/csv-template?planId=${planId}`} download className="block">
            <Button size="sm" variant="outline" className="gap-1.5" type="button" asChild>
              <span><Download className="h-4 w-4" /> Download CSV template</span>
            </Button>
          </a>
          <p className="text-xs text-muted-foreground self-center">
            The template contains all categories and departments from the current plan. Fill in the <code>amount</code> column.
          </p>
        </div>

        <div className="border-2 border-dashed rounded-lg p-6 text-center">
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} className="hidden" />
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-2">
            Upload a CSV file with actual data
          </p>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            Choose file
          </Button>
          {fileName && <p className="text-xs text-muted-foreground mt-2">{fileName}</p>}
        </div>

        <div className="text-xs text-muted-foreground">
          Columns: <code>category, amount, department, date, description, lineType</code>
        </div>

        {preview && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Badge variant="outline">{preview.length} rows recognized</Badge>
              <Button size="sm" onClick={handleImport} disabled={isImporting}>
                {isImporting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                Upload {preview.length} rows
              </Button>
            </div>
            <div className="max-h-40 overflow-auto border rounded text-xs">
              <table className="w-full">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    {Object.keys(preview[0] || {}).map((h) => (
                      <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 10).map((row, i) => (
                    <tr key={i} className="border-t">
                      {Object.values(row).map((v: any, j) => (
                        <td key={j} className="px-2 py-1">{v}</td>
                      ))}
                    </tr>
                  ))}
                  {preview.length > 10 && (
                    <tr><td colSpan={999} className="px-2 py-1 text-muted-foreground">... {preview.length - 10} more rows</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {lastResult && (
          <div className={`p-3 rounded-lg text-sm ${lastResult.unmatchedRows > 0 ? "bg-yellow-50 border border-yellow-200" : "bg-green-50 border border-green-200"}`}>
            <div className="flex items-center gap-2 mb-1">
              {lastResult.unmatchedRows > 0 ? (
                <AlertCircle className="h-4 w-4 text-yellow-600" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              )}
              <span className="font-medium">
                {lastResult.matchedRows}/{lastResult.totalRows} rows uploaded
              </span>
            </div>
            {lastResult.errors && lastResult.errors.length > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                {lastResult.errors.slice(0, 5).map((e, i) => (
                  <div key={i}>Row {e.row}: {e.error}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
