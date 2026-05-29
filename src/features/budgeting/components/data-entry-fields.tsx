"use client"
/**
 * Data-entry admin form-field subcomponents — extracted from DataEntryAdmin.tsx
 * (Phase 8 D1 2026-05-29). All props-only (defined outside the tab components,
 * so they never captured tab state): the company / metric / ESG-indicator
 * selects, the labeled input, the form-controls bar, the feedback-state type,
 * and the bulk-import section. The two tab components import them back.
 */
import Link from "next/link"
import { useState, useEffect, useCallback } from "react"
import { useTranslations } from "next-intl"
import { Brain, ArrowRight } from "lucide-react"
import {
  OPERATIONAL_METRIC_RULES,
  ESG_DISCLOSURE_RULES,
  type MetricValidationRule,
  type EsgDisclosureRule,
} from "@/lib/risk/metric-validation-rules"
import { Button } from "@/components/ui/button"
import { type CompanyRow } from "./data-entry-types"

export type FeedbackState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string }
  | { kind: "confirm"; warnings: string[]; anomalyWarning: string | null }

export function CompanySelect({
  companies,
  value,
  onChange,
  label,
}: {
  companies: CompanyRow[]
  value: string
  onChange: (v: string) => void
  label: string
}) {
  return (
    <label className="text-xs flex flex-col gap-1">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background border border-border rounded px-2 py-1 text-sm"
      >
        <option value="">—</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} · {c.name}
          </option>
        ))}
      </select>
    </label>
  )
}

// Sector emoji prefix — visual chunking so the dropdown reads like a
// Bloomberg ticker board instead of a wall of technical strings.
const SECTOR_EMOJI: Record<MetricValidationRule["sector"], string> = {
  agro: "🌾",
  real_estate: "🏢",
  entertainment: "🎟️",
  education: "🎓",
  poultry: "🐔",
  food_processing: "🏭",
  hospitality: "🏨",
  esg: "🌱",
}

export function MetricSelect({
  rules,
  value,
  onChange,
  label,
  t,
}: {
  rules: readonly MetricValidationRule[]
  value: string
  onChange: (v: string) => void
  label: string
  t: ReturnType<typeof useTranslations>
}) {
  // Selected rule drives the helper-line beneath the select — shows
  // unit + typical-range hint so the operator knows what they're
  // entering before they tab into the value field.
  const selected = rules.find((r) => r.metric === value)
  return (
    <label className="text-xs flex flex-col gap-1">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background border border-border rounded px-2 py-1 text-sm"
      >
        {rules.map((r) => (
          <option key={r.metric} value={r.metric}>
            {SECTOR_EMOJI[r.sector] ?? ""} {r.labelRu} ({r.unit}) · [
            {t(`operational.sector.${r.sector}` as never)}]
          </option>
        ))}
      </select>
      {selected && (
        <span className="text-[10px] text-muted-foreground/80 leading-snug">
          {selected.unit} ·{" "}
          {selected.warnMin != null || selected.warnMax != null
            ? `типичный диапазон ${selected.warnMin ?? "—"}…${selected.warnMax ?? "—"}`
            : `диапазон ${selected.min}…${selected.max}`}
          {selected.hintRu ? ` · ${selected.hintRu}` : ""}
        </span>
      )}
    </label>
  )
}

export function EsgIndicatorSelect({
  rules,
  value,
  onChange,
  label,
  t,
}: {
  rules: readonly EsgDisclosureRule[]
  value: string
  onChange: (v: string) => void
  label: string
  t: ReturnType<typeof useTranslations>
}) {
  void t
  // Selected rule → unit + hint helper line beneath the select.
  const selected = rules.find((r) => r.indicatorCode === value)
  return (
    <label className="text-xs flex flex-col gap-1">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-background border border-border rounded px-2 py-1 text-sm"
      >
        {rules.map((r) => (
          // Human-readable label FIRST so it's visible before any
          // truncation; technical indicatorCode follows as muted suffix.
          // Was "IND_CARBON_SCOPE_1 · Выбросы Scope 1 (прям…" — bad UX.
          // Now: "🌱 Выбросы Scope 1 (прямые) · IND_CARBON_SCOPE_1".
          <option key={r.indicatorCode} value={r.indicatorCode}>
            🌱 {r.labelRu} ({r.unit}) · {r.indicatorCode}
          </option>
        ))}
      </select>
      {selected && (
        <span className="text-[10px] text-muted-foreground/80 leading-snug">
          {selected.unit} ·{" "}
          {selected.warnMin != null || selected.warnMax != null
            ? `типичный диапазон ${selected.warnMin ?? "—"}…${selected.warnMax ?? "—"}`
            : `диапазон ${selected.min}…${selected.max}`}
          {selected.hintRu ? ` · ${selected.hintRu}` : ""}
        </span>
      )}
    </label>
  )
}

export function LabeledInput({
  label,
  value,
  onChange,
  type,
  placeholder,
  hint,
  spanFull,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  hint?: string | null
  spanFull?: boolean
}) {
  return (
    <label
      className={`text-xs flex flex-col gap-1 ${spanFull ? "md:col-span-2 lg:col-span-3" : ""}`}
    >
      <span className="text-muted-foreground">{label}</span>
      <input
        type={type ?? "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-background border border-border rounded px-2 py-1 text-sm"
      />
      {hint && (
        <span className="text-[10px] text-muted-foreground/70">{hint}</span>
      )}
    </label>
  )
}

export function FormControls({
  feedback,
  disabled,
  onSave,
  onConfirm,
  onCancel,
  t,
}: {
  feedback: FeedbackState
  disabled: boolean
  onSave: () => void
  onConfirm: () => void
  onCancel: () => void
  t: ReturnType<typeof useTranslations>
}) {
  return (
    <div className="mt-4 flex flex-col gap-2">
      {feedback.kind === "confirm" && (
        <div
          role="alert"
          className="border border-amber-500/60 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded p-2 text-xs"
          data-testid="data-entry-confirm"
        >
          <div className="font-semibold mb-1">{t("confirmTitle")}</div>
          <ul className="list-disc pl-4 space-y-0.5">
            {feedback.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
            {feedback.anomalyWarning && <li>{feedback.anomalyWarning}</li>}
          </ul>
        </div>
      )}
      {feedback.kind === "error" && (
        <div
          role="alert"
          className="border border-red-500/60 bg-red-500/10 text-red-600 dark:text-red-400 rounded p-2 text-xs"
          data-testid="data-entry-error"
        >
          {feedback.message}
        </div>
      )}
      {feedback.kind === "saved" && (
        <div
          className="border border-emerald-500/60 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded p-2 text-xs"
          data-testid="data-entry-saved"
        >
          {feedback.message}
        </div>
      )}
      <div className="flex gap-2">
        {feedback.kind === "confirm" ? (
          <>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={onConfirm}
              data-testid="data-entry-confirm-save"
              className="bg-amber-500 text-amber-50 hover:bg-amber-500/90"
            >
              {t("confirmSave")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
            >
              {t("cancel")}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={onSave}
            disabled={disabled || feedback.kind === "saving"}
            data-testid="data-entry-save"
          >
            {feedback.kind === "saving" ? t("saving") : t("save")}
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Phase 7.H F4.v2.3.1 — bulk Excel import.
 *
 * Single-row entry doesn't scale (13 metrics × 12 months × N companies
 * = 1000+ rows). This section gives the user a "download template →
 * fill in Excel → upload → preview → confirm → apply" flow. Mirrors
 * the AI-Mapper onboarding pattern (preview-then-commit), but for
 * structured pre-known shape rather than free-form xlsx.
 */
export function BulkImportSection({
  onImported,
  t,
}: {
  companies: CompanyRow[]
  onImported: () => void
  t: ReturnType<typeof useTranslations>
}) {
  const [stage, setStage] = useState<
    | { kind: "idle" }
    | { kind: "previewing" }
    | { kind: "preview"; rowCount: number; errorCount: number; warningCount: number; warnings: Array<{ rowNumber: number; message: string }>; errors: Array<{ rowNumber: number; reason: string }>; file: File }
    | { kind: "applying" }
    | { kind: "applied"; appliedCount: number; rejectedCount: number; rejected: Array<{ rowNumber: number; reason: string }> }
    | { kind: "error"; message: string }
  >({ kind: "idle" })

  const handleFile = async (file: File) => {
    setStage({ kind: "previewing" })
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("dryRun", "true")
      const res = await fetch("/api/operational-facts/import", {
        method: "POST",
        body: form,
      })
      const json = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        setStage({
          kind: "error",
          message: (json.error as string) ?? `HTTP ${res.status}`,
        })
        return
      }
      setStage({
        kind: "preview",
        rowCount: Number(json.rowCount ?? 0),
        errorCount: Number(json.errorCount ?? 0),
        warningCount: Number(json.warningCount ?? 0),
        warnings: Array.isArray(json.warnings)
          ? (json.warnings as Array<{ rowNumber: number; message: string }>)
          : [],
        errors: Array.isArray(json.errors)
          ? (json.errors as Array<{ rowNumber: number; reason: string }>)
          : [],
        file,
      })
    } catch (err) {
      setStage({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const confirmApply = async () => {
    if (stage.kind !== "preview") return
    setStage({ kind: "applying" })
    try {
      const form = new FormData()
      form.append("file", stage.file)
      form.append("dryRun", "false")
      if (stage.warningCount > 0) form.append("forceWarnings", "true")
      const res = await fetch("/api/operational-facts/import", {
        method: "POST",
        body: form,
      })
      const json = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        setStage({
          kind: "error",
          message: (json.error as string) ?? `HTTP ${res.status}`,
        })
        return
      }
      setStage({
        kind: "applied",
        appliedCount: Number(json.appliedCount ?? 0),
        rejectedCount: Number(json.rejectedCount ?? 0),
        rejected: Array.isArray(json.rejected)
          ? (json.rejected as Array<{ rowNumber: number; reason: string }>)
          : [],
      })
      onImported()
    } catch (err) {
      setStage({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <section className="bg-card border border-border rounded-md p-4" data-testid="bulk-import-section">
      {/* Phase 7.M Tier 7 Phase 5 — consolidation banner. AI Import now
          recognises OPS_FACTS shape and routes to runKpiBatch, same as
          this form's POST /api/operational-facts/import endpoint. Form
          remains as backup for non-AI workflows. */}
      <div
        className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3 flex items-start gap-2"
        data-testid="ai-import-deprecation-banner"
      >
        <Brain className="size-4 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 space-y-1">
          <div className="font-semibold text-xs">
            Используйте единый «Импорт данных» для xlsx KPI
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            AI Import распознаёт OPS_FACTS shape (companyCode | metric | date |
            value | unit) — один экран на все импорты данных.
          </p>
          <Link
            href="/budgeting/admin/ai-import"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Перейти к Импорту данных
            <ArrowRight className="size-3" />
          </Link>
        </div>
      </div>
      <header className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold">
            {t("operational.bulkImport.title")}
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            {t("operational.bulkImport.subtitle")}
          </p>
        </div>
        <a
          href="/api/operational-facts/import/template"
          className="text-xs px-3 py-1.5 border border-border rounded text-foreground hover:bg-accent shrink-0"
          download
          data-testid="bulk-import-template"
        >
          {t("operational.bulkImport.downloadTemplate")}
        </a>
      </header>

      <label className="block">
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
            e.target.value = ""
          }}
          disabled={stage.kind === "previewing" || stage.kind === "applying"}
          data-testid="bulk-import-file"
          className="text-xs"
        />
      </label>

      {stage.kind === "previewing" && (
        <p className="text-xs text-muted-foreground mt-2">
          {t("operational.bulkImport.previewing")}
        </p>
      )}

      {stage.kind === "preview" && (
        <div className="mt-3 space-y-2" data-testid="bulk-import-preview">
          <div className="text-xs">
            <span className="font-semibold text-foreground">
              {t("operational.bulkImport.previewSummary", {
                rows: stage.rowCount,
                errors: stage.errorCount,
                warnings: stage.warningCount,
              })}
            </span>
          </div>
          {stage.errorCount > 0 && (
            <div
              className="border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 rounded p-2 text-xs space-y-1 max-h-40 overflow-y-auto"
              role="alert"
            >
              <div className="font-semibold">
                {t("operational.bulkImport.errorsHeading")}
              </div>
              <ul className="list-disc pl-4">
                {stage.errors.slice(0, 10).map((e, i) => (
                  <li key={i}>
                    {t("operational.bulkImport.row", { n: e.rowNumber })}:{" "}
                    {e.reason}
                  </li>
                ))}
                {stage.errors.length > 10 && (
                  <li>+{stage.errors.length - 10} more</li>
                )}
              </ul>
            </div>
          )}
          {stage.warningCount > 0 && (
            <div className="border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded p-2 text-xs space-y-1 max-h-32 overflow-y-auto">
              <div className="font-semibold">
                {t("operational.bulkImport.warningsHeading")}
              </div>
              <ul className="list-disc pl-4">
                {stage.warnings.slice(0, 10).map((w, i) => (
                  <li key={i}>
                    {t("operational.bulkImport.row", { n: w.rowNumber })}:{" "}
                    {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStage({ kind: "idle" })}
            >
              {t("cancel")}
            </Button>
            {stage.errorCount === 0 && (
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={confirmApply}
                data-testid="bulk-import-apply"
              >
                {stage.warningCount > 0
                  ? t("operational.bulkImport.confirmApplyWithWarnings", {
                      rows: stage.rowCount,
                    })
                  : t("operational.bulkImport.confirmApply", {
                      rows: stage.rowCount,
                    })}
              </Button>
            )}
          </div>
        </div>
      )}

      {stage.kind === "applying" && (
        <p className="text-xs text-muted-foreground mt-2">
          {t("operational.bulkImport.applying")}
        </p>
      )}

      {stage.kind === "applied" && (
        <div
          className="mt-3 border border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded p-2 text-xs"
          data-testid="bulk-import-applied"
        >
          {t("operational.bulkImport.appliedSummary", {
            applied: stage.appliedCount,
            rejected: stage.rejectedCount,
          })}
          {stage.rejectedCount > 0 && (
            <ul className="mt-1 list-disc pl-4 max-h-32 overflow-y-auto">
              {stage.rejected.slice(0, 10).map((r, i) => (
                <li key={i}>
                  {t("operational.bulkImport.row", { n: r.rowNumber })}: {r.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {stage.kind === "error" && (
        <div
          className="mt-3 border border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400 rounded p-2 text-xs"
          role="alert"
          data-testid="bulk-import-error"
        >
          {stage.message}
        </div>
      )}
    </section>
  )
}
