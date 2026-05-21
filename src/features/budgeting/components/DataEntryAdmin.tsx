"use client"

/**
 * Phase 7.H F4.v2.3 — non-engineer data-entry surface.
 *
 * Two-tab admin page wired to `/api/operational-facts` and
 * `/api/indicator-disclosures`. Replaces the "engineer-only SQL"
 * gap surfaced in the F4 audit: 13 operational KPIs + 4 ESG-
 * disclosure indicators that previously had no UI path now have
 * one.
 *
 * Safety rails (Bloomberg "disclosure-first" mirror):
 *  - Metric selector restricted to the curated catalog
 *    (`OPERATIONAL_METRIC_RULES` / `ESG_DISCLOSURE_RULES`) — no
 *    free-form metric names land in the table.
 *  - Unit is preselected per metric so a "kg" can't ride into a
 *    "tonnes" column.
 *  - API returns `requiresConfirm: true` when a value crosses a
 *    soft bound or exceeds the anomaly band; the UI then shows a
 *    confirm dialog with the warning text. Second click re-sends
 *    with `forceConfirm: true` and persists. Hard-bound violations
 *    stay a 400 — no confirm path.
 *  - `sourceNote` (free-form, max 500 chars) is required for ESG
 *    disclosures so the auditor sees where the cell-jumping number
 *    came from. Optional for operational facts (less load-bearing).
 *  - All mutations write to `AuditEvent` via the API — manager+
 *    only on create/update, admin-only on delete.
 *
 * Visual: minimal — list view per tab + inline "Add entry" form.
 * Bigger inline-grid editor is a Phase v2.4 follow-up; v2.3 ships
 * the safest minimum (single entry per submit, explicit confirm,
 * clear validation feedback) to avoid clients accidentally
 * batch-bulk-overwriting data.
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

interface CompanyRow {
  id: string
  code: string
  name: string
  /**
   * Nested descendants returned by `/api/companies` (roots + 2 levels
   * of children). The data-entry dropdown must walk this tree so users
   * can pick operational leaves (AZSEKER-EDEN, AAC-MAIN, etc.), not
   * just the top-level holding parents (AZMADE, AZSEKER). 2026-05-16
   * parity with the fc9c7fb fix that closed the same bug on the
   * budgeting filter dropdown.
   */
  children?: CompanyRow[]
}

/**
 * Flatten a roots-with-nested-children tree into a single ordered list
 * of every company, parents first then descendants depth-first. Stable
 * order so the dropdown reads top-down (AZMADE → AAC → AAC-MAIN → ATL → …).
 */
export function flattenCompanies(roots: CompanyRow[]): CompanyRow[] {
  const out: CompanyRow[] = []
  const walk = (c: CompanyRow): void => {
    out.push({ id: c.id, code: c.code, name: c.name })
    for (const child of c.children ?? []) walk(child)
  }
  for (const r of roots) walk(r)
  return out
}

interface OperationalFactRow {
  id: string
  companyId: string
  metric: string
  date: string
  value: number
  unit: string
  source: string | null
}

interface DisclosureRow {
  id: string
  companyId: string
  indicatorCode: string
  period: string
  value: number
  unit: string
  sourceNote: string | null
  enteredBy: string
  enteredAt: string
}

type Tab = "operational" | "esg"

export function DataEntryAdmin() {
  const t = useTranslations("budgeting.dataEntry")
  const [tab, setTab] = useState<Tab>("operational")
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [loadingCompanies, setLoadingCompanies] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch("/api/companies")
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((json: { companies?: CompanyRow[] } | CompanyRow[]) => {
        if (cancelled) return
        // The /api/companies route returns either a flat array or
        // { companies: [...] } depending on the route's shape; tolerate both.
        const roots = Array.isArray(json) ? json : (json.companies ?? [])
        // Flatten roots + nested children so the dropdown surfaces every
        // company (parent + descendants). Without this the dropdown only
        // shows level-0 roots (AZMADE / AZSEKER), and the operational
        // entities where data actually lands (AZSEKER-EDEN / AAC-MAIN /
        // etc.) are unreachable.
        setCompanies(flattenCompanies(roots))
      })
      .catch(() => {
        if (!cancelled) setCompanies([])
      })
      .finally(() => {
        if (!cancelled) setLoadingCompanies(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          {t("subtitle")}
        </p>
      </header>

      <nav className="mb-4 flex gap-1 border-b border-border">
        <TabButton
          active={tab === "operational"}
          onClick={() => setTab("operational")}
          label={t("tabs.operational")}
          count={OPERATIONAL_METRIC_RULES.length}
        />
        <TabButton
          active={tab === "esg"}
          onClick={() => setTab("esg")}
          label={t("tabs.esg")}
          count={ESG_DISCLOSURE_RULES.length}
        />
      </nav>

      {loadingCompanies ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : tab === "operational" ? (
        <OperationalFactsTab companies={companies} t={t} />
      ) : (
        <EsgDisclosuresTab companies={companies} t={t} />
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={`data-entry-tab-${active ? "active" : "inactive"}`}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-all duration-150 cursor-pointer motion-safe:active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:rounded-sm ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
      }`}
    >
      {label}
      <span className="ml-2 text-xs text-muted-foreground">({count})</span>
    </button>
  )
}

// ---------------------------------------------------------------- Operational

function OperationalFactsTab({
  companies,
  t,
}: {
  companies: CompanyRow[]
  t: ReturnType<typeof useTranslations>
}) {
  const [companyId, setCompanyId] = useState<string>("")
  const [metric, setMetric] = useState<string>(
    OPERATIONAL_METRIC_RULES[0]?.metric ?? "",
  )
  const [date, setDate] = useState<string>(
    () => new Date().toISOString().slice(0, 10),
  )
  const [value, setValue] = useState<string>("")
  const [sourceNote, setSourceNote] = useState<string>("")
  const [rows, setRows] = useState<OperationalFactRow[]>([])
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<FeedbackState>({ kind: "idle" })

  const rule = OPERATIONAL_METRIC_RULES.find((r) => r.metric === metric)

  const refresh = useCallback(async () => {
    if (!companyId) {
      setRows([])
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({ companyId })
      const r = await fetch(`/api/operational-facts?${params}`)
      const j = (await r.json()) as { rows?: OperationalFactRow[] }
      setRows(j.rows ?? [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const submit = async (forceConfirm: boolean) => {
    if (!companyId || !rule) return
    setFeedback({ kind: "saving" })
    try {
      const res = await fetch("/api/operational-facts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId,
          metric: rule.metric,
          date: new Date(date).toISOString(),
          value: Number(value),
          unit: rule.unit,
          sourceNote: sourceNote || undefined,
          forceConfirm,
        }),
      })
      const json = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        const errs =
          Array.isArray(json.errors) && json.errors.length > 0
            ? (json.errors as string[]).join("; ")
            : ((json.error as string) ?? `HTTP ${res.status}`)
        setFeedback({ kind: "error", message: errs })
        return
      }
      if (json.requiresConfirm === true) {
        const warnings = Array.isArray(json.warnings)
          ? (json.warnings as string[])
          : []
        const anomalyWarning =
          typeof json.anomalyWarning === "string"
            ? (json.anomalyWarning as string)
            : null
        setFeedback({
          kind: "confirm",
          warnings,
          anomalyWarning,
        })
        return
      }
      setFeedback({
        kind: "saved",
        message: t("saved"),
      })
      setValue("")
      setSourceNote("")
      await refresh()
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (companies.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("noCompanies")}</p>
    )
  }

  return (
    <div className="space-y-6">
      <BulkImportSection
        companies={companies}
        onImported={() => void refresh()}
        t={t}
      />

      <section className="bg-card border border-border rounded-md p-4">
        <h2 className="text-sm font-semibold mb-3">{t("operational.formTitle")}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <CompanySelect
            companies={companies}
            value={companyId}
            onChange={setCompanyId}
            label={t("company")}
          />
          <MetricSelect
            rules={OPERATIONAL_METRIC_RULES}
            value={metric}
            onChange={setMetric}
            label={t("operational.metric")}
            t={t}
          />
          <LabeledInput
            label={t("date")}
            type="date"
            value={date}
            onChange={setDate}
          />
          <LabeledInput
            label={`${t("value")} (${rule?.unit ?? "-"})`}
            type="number"
            value={value}
            onChange={setValue}
            hint={rule?.hintRu ?? rule?.hintEn}
          />
          <LabeledInput
            label={t("sourceNote")}
            value={sourceNote}
            onChange={setSourceNote}
            placeholder={t("sourceNotePlaceholder")}
            spanFull
          />
        </div>
        <FormControls
          feedback={feedback}
          disabled={!companyId || !value}
          onSave={() => submit(false)}
          onConfirm={() => submit(true)}
          onCancel={() => setFeedback({ kind: "idle" })}
          t={t}
        />
      </section>

      <section className="bg-card border border-border rounded-md p-4">
        <h2 className="text-sm font-semibold mb-3">
          {t("operational.recentTitle")}{" "}
          <span className="text-xs text-muted-foreground">
            ({rows.length})
          </span>
        </h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRows")}</p>
        ) : (
          <table
            data-testid="operational-facts-table"
            className="w-full text-xs tabular-nums"
          >
            <thead className="text-muted-foreground uppercase text-[10px]">
              <tr>
                <th className="text-left font-normal py-1.5">{t("operational.metric")}</th>
                <th className="text-left font-normal py-1.5">{t("date")}</th>
                <th className="text-right font-normal py-1.5">{t("value")}</th>
                <th className="text-left font-normal py-1.5">{t("unit")}</th>
                <th className="text-left font-normal py-1.5">{t("source")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/40">
                  <td className="py-1 font-mono">{r.metric}</td>
                  <td className="py-1">{r.date.slice(0, 10)}</td>
                  <td className="py-1 text-right">{r.value.toLocaleString()}</td>
                  <td className="py-1 text-muted-foreground">{r.unit}</td>
                  <td
                    className="py-1 text-muted-foreground truncate max-w-[200px]"
                    title={r.source ?? undefined}
                  >
                    {r.source ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- ESG

function EsgDisclosuresTab({
  companies,
  t,
}: {
  companies: CompanyRow[]
  t: ReturnType<typeof useTranslations>
}) {
  const [companyId, setCompanyId] = useState<string>("")
  const [indicatorCode, setIndicatorCode] = useState<string>(
    ESG_DISCLOSURE_RULES[0]?.indicatorCode ?? "",
  )
  const [period, setPeriod] = useState<string>(
    () => String(new Date().getUTCFullYear()),
  )
  const [value, setValue] = useState<string>("")
  const [sourceNote, setSourceNote] = useState<string>("")
  const [rows, setRows] = useState<DisclosureRow[]>([])
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<FeedbackState>({ kind: "idle" })

  const rule = ESG_DISCLOSURE_RULES.find(
    (r) => r.indicatorCode === indicatorCode,
  )

  const refresh = useCallback(async () => {
    if (!companyId) {
      setRows([])
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams({ companyId })
      const r = await fetch(`/api/indicator-disclosures?${params}`)
      const j = (await r.json()) as { rows?: DisclosureRow[] }
      setRows(j.rows ?? [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const submit = async (forceConfirm: boolean) => {
    if (!companyId || !rule) return
    setFeedback({ kind: "saving" })
    try {
      const res = await fetch("/api/indicator-disclosures", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId,
          indicatorCode: rule.indicatorCode,
          period,
          value: Number(value),
          unit: rule.unit,
          sourceNote: sourceNote || undefined,
          forceConfirm,
        }),
      })
      const json = (await res.json()) as Record<string, unknown>
      if (!res.ok) {
        const errs =
          Array.isArray(json.errors) && json.errors.length > 0
            ? (json.errors as string[]).join("; ")
            : ((json.error as string) ?? `HTTP ${res.status}`)
        setFeedback({ kind: "error", message: errs })
        return
      }
      if (json.requiresConfirm === true) {
        const warnings = Array.isArray(json.warnings)
          ? (json.warnings as string[])
          : []
        const anomalyWarning =
          typeof json.anomalyWarning === "string"
            ? (json.anomalyWarning as string)
            : null
        setFeedback({ kind: "confirm", warnings, anomalyWarning })
        return
      }
      setFeedback({ kind: "saved", message: t("savedDisclosure") })
      setValue("")
      setSourceNote("")
      await refresh()
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (companies.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("noCompanies")}</p>
    )
  }

  return (
    <div className="space-y-6">
      <section className="bg-card border border-border rounded-md p-4">
        <h2 className="text-sm font-semibold mb-3">{t("esg.formTitle")}</h2>
        <p className="text-xs text-muted-foreground mb-3 max-w-3xl">
          {t("esg.formSubtitle")}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <CompanySelect
            companies={companies}
            value={companyId}
            onChange={setCompanyId}
            label={t("company")}
          />
          <EsgIndicatorSelect
            rules={ESG_DISCLOSURE_RULES}
            value={indicatorCode}
            onChange={setIndicatorCode}
            label={t("esg.indicator")}
            t={t}
          />
          <LabeledInput
            label={t("period")}
            value={period}
            onChange={setPeriod}
            placeholder="YYYY | YYYY-Q1 | YYYY-MM"
          />
          <LabeledInput
            label={`${t("value")} (${rule?.unit ?? "-"})`}
            type="number"
            value={value}
            onChange={setValue}
            hint={rule?.hintRu ?? rule?.hintEn}
          />
          <LabeledInput
            label={t("sourceNote")}
            value={sourceNote}
            onChange={setSourceNote}
            placeholder={t("esg.sourceNotePlaceholder")}
            spanFull
          />
        </div>
        <FormControls
          feedback={feedback}
          disabled={!companyId || !value}
          onSave={() => submit(false)}
          onConfirm={() => submit(true)}
          onCancel={() => setFeedback({ kind: "idle" })}
          t={t}
        />
      </section>

      <section className="bg-card border border-border rounded-md p-4">
        <h2 className="text-sm font-semibold mb-3">
          {t("esg.recentTitle")}{" "}
          <span className="text-xs text-muted-foreground">
            ({rows.length})
          </span>
        </h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRows")}</p>
        ) : (
          <table
            data-testid="esg-disclosures-table"
            className="w-full text-xs tabular-nums"
          >
            <thead className="text-muted-foreground uppercase text-[10px]">
              <tr>
                <th className="text-left font-normal py-1.5">{t("esg.indicator")}</th>
                <th className="text-left font-normal py-1.5">{t("period")}</th>
                <th className="text-right font-normal py-1.5">{t("value")}</th>
                <th className="text-left font-normal py-1.5">{t("unit")}</th>
                <th className="text-left font-normal py-1.5">{t("sourceNote")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border/40">
                  <td className="py-1 font-mono">{r.indicatorCode}</td>
                  <td className="py-1">{r.period}</td>
                  <td className="py-1 text-right">{r.value.toLocaleString()}</td>
                  <td className="py-1 text-muted-foreground">{r.unit}</td>
                  <td
                    className="py-1 text-muted-foreground truncate max-w-[300px]"
                    title={r.sourceNote ?? undefined}
                  >
                    {r.sourceNote ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- Helpers

type FeedbackState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; message: string }
  | { kind: "error"; message: string }
  | { kind: "confirm"; warnings: string[]; anomalyWarning: string | null }

function CompanySelect({
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

function MetricSelect({
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

function EsgIndicatorSelect({
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

function LabeledInput({
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

function FormControls({
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
function BulkImportSection({
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
