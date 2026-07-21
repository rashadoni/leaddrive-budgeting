"use client"
/**
 * Universal Import — mapping review/edit table.
 *
 * Renders the AI's per-column `MappingProposal` next to each source column's
 * header + sample values, and lets the reviewer override the role via a
 * dropdown. Low-confidence columns are highlighted so the human looks before
 * committing. The edited columns are lifted to the parent (the wizard), which
 * diffs them into `userOverrides` for the apply call.
 *
 * Pure presentation + local edit — no fetch. Reuses ROLE_OPTIONS /
 * confidenceBand / ANOMALY_SEVERITY_BG from proposal-overrides.ts.
 */
import type {
  ColumnMappingProposal,
  MappingProposal,
  SourceColumn,
} from "@/lib/onboarding/ai-mapper/types"
import {
  ROLE_OPTIONS,
  confidenceBand,
  ANOMALY_SEVERITY_BG,
} from "@/features/onboarding/lib/proposal-overrides"

interface Props {
  proposal: MappingProposal
  sourceColumns: SourceColumn[]
  /** Current edited roles (one per source column), lifted to the parent. */
  edited: ColumnMappingProposal[]
  onChange: (edited: ColumnMappingProposal[]) => void
  /** Lock the selects while a preview/apply is in flight. */
  disabled?: boolean
}

const BAND_STYLE: Record<"high" | "med" | "low", string> = {
  high: "text-emerald-700 dark:text-emerald-400",
  med: "text-amber-700 dark:text-amber-400",
  low: "text-red-700 dark:text-red-400 font-semibold",
}

export function MappingReviewTable({ proposal, sourceColumns, edited, onChange, disabled }: Props) {
  const editedByIdx = new Map(edited.map((c) => [c.sourceIndex, c]))
  const origByIdx = new Map(proposal.columns.map((c) => [c.sourceIndex, c]))

  const setRole = (sourceIndex: number, role: ColumnMappingProposal["role"]) => {
    // Append when the AI proposal omitted this source column (LLM dropped it):
    // otherwise the reviewer's override would silently vanish (no entry to map).
    const exists = edited.some((c) => c.sourceIndex === sourceIndex)
    const original = origByIdx.get(sourceIndex)
    const next = exists
      ? edited.map((c) => (c.sourceIndex === sourceIndex ? { ...c, role } : c))
      : [
          ...edited,
          {
            ...original,
            sourceIndex,
            role,
            confidence: 1,
            reasoning: "Manual override",
          },
        ]
    onChange(next)
  }

  const setCurrencyCode = (sourceIndex: number, rawValue: string) => {
    const currencyCode = rawValue.trim().toUpperCase().slice(0, 3) || undefined
    const original = origByIdx.get(sourceIndex)
    const current = editedByIdx.get(sourceIndex)
    const replacement: ColumnMappingProposal = {
      ...original,
      ...current,
      sourceIndex,
      role: current?.role ?? original?.role ?? "skip",
      confidence: 1,
      reasoning: "Manual override",
      currencyCode,
    }
    const exists = edited.some((c) => c.sourceIndex === sourceIndex)
    const next = exists
      ? edited.map((c) => (c.sourceIndex === sourceIndex ? replacement : c))
      : [...edited, replacement]
    onChange(next)
  }

  const lowConfCount = proposal.columns.filter((c) => c.confidence < 0.6).length

  return (
    <div className="space-y-4">
      {/* AI summary */}
      <div className="border rounded p-3 bg-muted/20 text-sm">
        <div className="font-semibold mb-1">
          Предложение AI · уверенность {(proposal.overallConfidence * 100).toFixed(0)}%
          {proposal.overallConfidence < 0.7 && (
            <span className="ml-2 text-amber-700 dark:text-amber-400">⚠ проверьте вручную</span>
          )}
        </div>
        <div className="text-muted-foreground">{proposal.summary}</div>
        {lowConfCount > 0 && (
          <div className="text-xs text-red-700 dark:text-red-400 mt-1">
            {lowConfCount} колонк(и) с низкой уверенностью — подсвечены ниже, проверьте роль.
          </div>
        )}
      </div>

      {/* Anomalies */}
      {proposal.anomalies.length > 0 && (
        <div className="space-y-1">
          {proposal.anomalies.map((a, i) => (
            <div
              key={i}
              className={`text-xs rounded border px-2 py-1 ${ANOMALY_SEVERITY_BG[a.severity]}`}
            >
              <span className="font-semibold uppercase mr-1">{a.severity}</span>
              {a.row != null && <span className="font-mono mr-1">r{a.row}</span>}
              {a.description}
            </div>
          ))}
        </div>
      )}

      {/* Column mapping table */}
      <div className="border rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs">
            <tr>
              <th className="text-left p-2">Колонка</th>
              <th className="text-left p-2">Заголовок · примеры</th>
              <th className="text-left p-2">Роль (правьте)</th>
              <th className="text-right p-2">AI</th>
              <th className="text-left p-2">Обоснование</th>
            </tr>
          </thead>
          <tbody>
            {sourceColumns.map((col) => {
              const orig = origByIdx.get(col.index)
              const cur = editedByIdx.get(col.index)
              const role = cur?.role ?? orig?.role ?? "skip"
              const currencyCode = cur?.currencyCode ?? orig?.currencyCode ?? ""
              const conf = orig?.confidence ?? 0
              const band = confidenceBand(conf)
              const changed = orig && (
                role !== orig.role || currencyCode !== (orig.currencyCode ?? "")
              )
              const supportsHeaderCurrency =
                role.startsWith("amount:") || role.startsWith("sourceAmount:")
              return (
                <tr
                  key={col.index}
                  className={`border-t ${band === "low" ? "bg-red-50 dark:bg-red-500/10" : ""}`}
                >
                  <td className="p-2 font-mono text-xs text-muted-foreground">#{col.index}</td>
                  <td className="p-2">
                    <div className="font-medium">{col.headerText || <span className="text-muted-foreground italic">(нет заголовка)</span>}</div>
                    <div className="text-[11px] text-muted-foreground font-mono truncate max-w-[18rem]">
                      {col.samples.slice(0, 4).map((s) => String(s)).join(" · ") || "—"}
                    </div>
                  </td>
                  <td className="p-2">
                    <select
                      value={role}
                      disabled={disabled}
                      onChange={(e) => setRole(col.index, e.target.value as ColumnMappingProposal["role"])}
                      className={`w-full px-1.5 py-1 rounded border bg-background text-xs disabled:opacity-50 ${
                        changed ? "border-emerald-500/60" : "border-border"
                      }`}
                      aria-label={`Роль колонки ${col.index}`}
                    >
                      {ROLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {supportsHeaderCurrency && (
                      <input
                        value={currencyCode}
                        disabled={disabled}
                        maxLength={3}
                        pattern="[A-Za-z]{3}"
                        placeholder="ISO"
                        onChange={(e) => setCurrencyCode(col.index, e.target.value)}
                        className="mt-1 w-16 px-1.5 py-1 rounded border border-border bg-background text-xs font-mono uppercase disabled:opacity-50"
                        aria-label={`ISO currency ${col.index}`}
                      />
                    )}
                  </td>
                  <td className={`p-2 text-right font-mono text-xs ${BAND_STYLE[band]}`}>
                    {(conf * 100).toFixed(0)}%
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {changed ? <span className="text-emerald-700 dark:text-emerald-400">правка вручную</span> : orig?.reasoning}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
