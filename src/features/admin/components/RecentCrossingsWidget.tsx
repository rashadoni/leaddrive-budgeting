"use client"
/**
 * Phase 7.L — Admin Data Sources page widget.
 *
 * Inline panel under each source card showing recent feed-crossing
 * events: rule ID, observation date, # affected companies. Renders a
 * compact placeholder when no crossings exist (most demo orgs).
 */
import React, { useEffect, useState } from "react"
import { AlertTriangle, Clock } from "lucide-react"

interface CrossingSummary {
  ruleId: string
  triggerMetric: string
  triggerValueRounded: number
  triggerObservedAt: string
  latestGeneratedAt: string
  affectedCompanyCount: number
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10)
}

export function RecentCrossingsWidget({ sourceCode }: { sourceCode: string }) {
  const [rows, setRows] = useState<CrossingSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/admin/recent-crossings/${encodeURIComponent(sourceCode)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = (await r.json()) as { crossings: CrossingSummary[] }
        if (!cancelled) setRows(data.crossings ?? [])
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sourceCode])

  if (loading) {
    return (
      <div className="text-xs text-gray-500 italic">Загрузка событий…</div>
    )
  }
  if (error) {
    return <div className="text-xs text-red-600">Ошибка: {error}</div>
  }
  if (rows.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic">
        Нет недавних crossing-событий
      </div>
    )
  }
  return (
    <ul className="space-y-1">
      {rows.map((r, idx) => (
        <li
          key={`${r.ruleId}-${r.triggerObservedAt}-${idx}`}
          className="flex items-start gap-2 text-xs"
        >
          <AlertTriangle size={12} className="text-amber-500 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-gray-800 truncate">{r.ruleId}</div>
            <div className="text-gray-500">
              {fmtDate(r.triggerObservedAt)} · {r.triggerValueRounded}{" "}
              <span className="text-gray-400">·</span>{" "}
              <Clock size={9} className="inline" /> {r.affectedCompanyCount}{" "}
              {r.affectedCompanyCount === 1 ? "компания" : "компаний"}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
