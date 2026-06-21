"use client"
/**
 * Reporting-pack import client form.
 *
 * Two-step: Preview (no DB writes) → Apply (clean-slate per entity in a tx).
 * Drives POST /api/import/reporting-pack.
 */
import { useState, useRef, type DragEvent, type ChangeEvent } from "react"
import { useTranslations } from "next-intl"

interface EntityReport {
  sheetName: string
  dataType: string
  planKind: string
  buCode: string
  entityCode: string | null
  skipped: boolean
  lineCount: number
  total: number
  rowsWritten?: number
  warnings: string[]
}

interface ImportResult {
  ok: true
  mode: "preview" | "applied"
  year: number
  reports: EntityReport[]
  totalLineCount: number
  totalRowsWritten: number
  affectedEntities: string[]
  warnings: string[]
}

const DT_LABEL: Record<string, string> = {
  PLF: "P&L",
  BS: "Balance Sheet",
  CF: "Cash Flow",
}

const fmt = (n: number) =>
  Math.round(n).toLocaleString("ru-RU")

export function ReportingPackForm() {
  const t = useTranslations("adminReportingPack.form")
  const [file, setFile] = useState<File | null>(null)
  const [year, setYear] = useState("2026")
  const [isDragging, setIsDragging] = useState(false)
  const [busy, setBusy] = useState<null | "preview" | "apply">(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const pick = (f: File | undefined | null) => {
    if (!f) return
    setFile(f)
    setResult(null)
    setError(null)
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    pick(e.dataTransfer.files[0])
  }
  const onSelect = (e: ChangeEvent<HTMLInputElement>) => pick(e.target.files?.[0])

  const run = async (apply: boolean) => {
    if (!file) return
    if (apply) {
      const ok = window.confirm(t("applyConfirm", { year }))
      if (!ok) return
    }
    setBusy(apply ? "apply" : "preview")
    setError(null)
    if (!apply) setResult(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("year", year)
      fd.append("apply", apply ? "1" : "0")
      const res = await fetch("/api/import/reporting-pack", { method: "POST", body: fd })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      setResult(body as ImportResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const applied = result?.mode === "applied"

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          isDragging ? "border-emerald-500/60 bg-emerald-500/5" : "border-border hover:border-muted-foreground/40"
        }`}
      >
        <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={onSelect} />
        {file ? (
          <div>
            <div className="text-sm font-mono">{file.name}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {(file.size / 1024).toFixed(0)} KB · {t("clickToReplace")}
            </div>
          </div>
        ) : (
          <div>
            <div className="text-base font-medium mb-1">{t("dropHere")}</div>
            <div className="text-xs text-muted-foreground">{t("orClickXlsx")}</div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-muted-foreground">{t("yearLabel")}</label>
        <input
          value={year}
          onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, ""))}
          className="w-24 px-2 py-1 rounded border border-border bg-background text-sm font-mono"
          inputMode="numeric"
        />
        <button
          type="button"
          onClick={() => run(false)}
          disabled={!file || busy !== null}
          className="px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-40 transition-colors"
        >
          {busy === "preview" ? t("previewBusy") : t("previewBtn")}
        </button>
      </div>

      {error && (
        <div className="border border-red-500/40 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 rounded p-3 text-sm">
          ❌ {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className={`border rounded p-4 ${applied ? "bg-emerald-50 dark:bg-emerald-500/10" : "bg-muted/20"}`}>
            <div className="text-lg font-bold">
              {applied ? `✅ ${t("importedTitle")}` : `👁 ${t("previewTitle")}`} · {result.year}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {t("rowsToLoad")}: {result.totalLineCount}
              {applied && ` · ${t("written")}: ${result.totalRowsWritten}`}
              {applied && ` · ${t("entities")}: ${result.affectedEntities.join(", ") || "—"}`}
            </div>
          </div>

          <div className="border rounded overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs">
                <tr>
                  <th className="text-left p-2">{t("thSheet")}</th>
                  <th className="text-left p-2">{t("thEntity")}</th>
                  <th className="text-left p-2">{t("thType")}</th>
                  <th className="text-left p-2">{t("thPlan")}</th>
                  <th className="text-right p-2">{t("thRows")}</th>
                  <th className="text-right p-2">{t("thSum")}</th>
                  {applied && <th className="text-right p-2">{t("thWritten")}</th>}
                  <th className="text-left p-2">{t("thStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {result.reports.map((r, i) => (
                  <tr key={`${r.sheetName}-${r.buCode}-${i}`} className={`border-t ${r.skipped ? "opacity-60" : ""}`}>
                    <td className="p-2 font-mono text-xs">{r.sheetName}</td>
                    <td className="p-2 font-mono text-xs">
                      {r.entityCode ?? <span className="text-muted-foreground">{r.buCode} →—</span>}
                    </td>
                    <td className="p-2 text-xs">{DT_LABEL[r.dataType] ?? r.dataType}</td>
                    <td className="p-2 text-xs">{r.planKind}</td>
                    <td className="p-2 text-right font-mono text-xs">{r.lineCount}</td>
                    <td className="p-2 text-right font-mono text-xs">{fmt(r.total)}</td>
                    {applied && (
                      <td className="p-2 text-right font-mono text-xs">{r.rowsWritten ?? 0}</td>
                    )}
                    <td className="p-2 text-xs">
                      {r.skipped ? (
                        <span className="text-muted-foreground">{t("skipped")}</span>
                      ) : (
                        <span className="text-emerald-700 dark:text-emerald-400">{t("willWrite")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.warnings.length > 0 && (
            <details className="border rounded p-3 text-xs">
              <summary className="cursor-pointer font-medium">
                {t("warnings", { count: result.warnings.length })}
              </summary>
              <ul className="mt-2 space-y-1 list-disc pl-4 text-muted-foreground">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}

          {/* Apply step — only after a clean preview */}
          {!applied && (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setResult(null)
                  setFile(null)
                }}
                className="flex-1 px-4 py-2 rounded border border-border text-sm hover:bg-muted/50 transition-colors"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => run(true)}
                disabled={busy !== null || result.totalLineCount === 0}
                className="flex-1 px-4 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-40 transition-colors"
              >
                {busy === "apply" ? t("applyBusy") : t("applyBtn")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
