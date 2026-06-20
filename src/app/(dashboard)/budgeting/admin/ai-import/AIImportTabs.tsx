"use client"
/**
 * Phase 7.M Tier 5 (2026-05-20) — Tabs wrapper that lets the admin
 * choose between single-file (legacy 2-step) and multi-file (new
 * orchestrator) AI import workflows.
 *
 * Defaults to single-file for back-compat. Multi-file mode is
 * positioned as the newer batch-load surface.
 */
import { useState } from "react"
import { useTranslations } from "next-intl"
import { AIImportForm } from "./AIImportForm"
import { MultiFileForm } from "./MultiFileForm"
import { UniversalImportForm } from "./UniversalImportForm"

export function AIImportTabs() {
  const t = useTranslations("adminAiImport")
  const [mode, setMode] = useState<"single" | "multi" | "universal">("single")
  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label={t("tabs.ariaLabel")}
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
          {t("tabs.single")}
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
          {t("tabs.multi")}
          <span className="ml-1 inline-block text-[10px] uppercase tracking-wide text-emerald-600 font-semibold">
            {t("tabs.newBadge")}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "universal"}
          onClick={() => setMode("universal")}
          className={`px-3 py-1.5 text-sm rounded font-medium transition ${
            mode === "universal"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900"
          }`}
          data-testid="tab-universal"
        >
          Любой файл (AI)
          <span className="ml-1 inline-block text-[10px] uppercase tracking-wide text-emerald-600 font-semibold">
            review
          </span>
        </button>
      </div>

      <div role="tabpanel">
        {mode === "single" ? (
          <AIImportForm />
        ) : mode === "multi" ? (
          <MultiFileForm />
        ) : (
          <UniversalImportForm />
        )}
      </div>
    </div>
  )
}
