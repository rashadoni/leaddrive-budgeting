"use client"
/**
 * Phase 7.M Tier 5 (2026-05-20) — Tabs wrapper that lets the admin
 * choose between single-file (legacy 2-step) and multi-file (new
 * orchestrator) AI import workflows.
 *
 * Defaults to single-file for back-compat. Multi-file mode is
 * positioned as "новый — для пакетной загрузки".
 */
import { useState } from "react"
import { AIImportForm } from "./AIImportForm"
import { MultiFileForm } from "./MultiFileForm"

export function AIImportTabs() {
  const [mode, setMode] = useState<"single" | "multi">("single")
  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="AI Import mode"
        className="inline-flex rounded border border-slate-200 bg-slate-50 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "single"}
          onClick={() => setMode("single")}
          className={`px-3 py-1.5 text-sm rounded font-medium transition ${
            mode === "single"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
          data-testid="tab-single"
        >
          1 файл
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "multi"}
          onClick={() => setMode("multi")}
          className={`px-3 py-1.5 text-sm rounded font-medium transition ${
            mode === "multi"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
          data-testid="tab-multi"
        >
          Несколько файлов
          <span className="ml-1 inline-block text-[10px] uppercase tracking-wide text-emerald-600 font-semibold">
            новое
          </span>
        </button>
      </div>

      <div role="tabpanel">
        {mode === "single" ? <AIImportForm /> : <MultiFileForm />}
      </div>
    </div>
  )
}
