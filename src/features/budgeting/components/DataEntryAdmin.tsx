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

// Phase 8 D1 (2026-05-29) — CompanyRow + form-field subcomponents extracted
// to siblings to bring this file under the 1000-LOC line.
import { type CompanyRow } from "./data-entry-types"
import {
  type FeedbackState,
  CompanySelect,
  MetricSelect,
  EsgIndicatorSelect,
  LabeledInput,
  FormControls,
  BulkImportSection,
} from "./data-entry-fields"
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

