"use client"
/**
 * Phase 6 — Queue admin client component.
 *
 * State filter pills + table. Manually refresh; auto-refresh deferred
 * until the SSE endpoint is generalised to broadcast all-job events.
 */
import { useEffect, useState } from "react"

type QueueState = "waiting" | "active" | "completed" | "failed" | "delayed"

interface JobRow {
  queue: string
  jobId: string
  state: QueueState
  progress: number
  attemptsMade: number
  failedReason: string | null
  timestamp: number
  processedOn: number | null
  finishedOn: number | null
  organizationId: string | null
}

const STATES: QueueState[] = [
  "active",
  "waiting",
  "completed",
  "failed",
  "delayed",
]

export function QueueAdmin() {
  const [state, setState] = useState<QueueState>("active")
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function refresh(s: QueueState): Promise<void> {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/queue?state=${s}&limit=100`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { jobs: JobRow[] }
      setJobs(data.jobs)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh(state)
  }, [state])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2" role="tablist">
        {STATES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={state === s}
            onClick={() => setState(s)}
            className={`px-3 py-1 rounded-full text-sm border ${
              state === s
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:bg-muted"
            }`}
            data-testid={`queue-state-${s}`}
          >
            {s}
          </button>
        ))}
        <button
          onClick={() => refresh(state)}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          data-testid="queue-refresh"
        >
          ↻ refresh
        </button>
      </div>
      {err && (
        <div className="text-sm text-red-600 border border-red-300 bg-red-50 rounded p-2">
          ❌ {err}
        </div>
      )}
      {loading && (
        <div className="text-sm text-muted-foreground">Loading…</div>
      )}
      {!loading && jobs.length === 0 && (
        <div className="text-sm text-muted-foreground border border-border rounded p-4 text-center">
          No jobs in <strong>{state}</strong> state.
        </div>
      )}
      {!loading && jobs.length > 0 && (
        <div className="overflow-x-auto border border-border rounded">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="p-2">Queue</th>
                <th className="p-2">Job ID</th>
                <th className="p-2">Progress</th>
                <th className="p-2">Attempts</th>
                <th className="p-2">Started</th>
                <th className="p-2">Finished</th>
                <th className="p-2">Failed reason</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr
                  key={`${j.queue}:${j.jobId}`}
                  className="border-t border-border"
                  data-testid={`queue-row-${j.jobId}`}
                >
                  <td className="p-2 font-mono">{j.queue}</td>
                  <td className="p-2 font-mono">{j.jobId.slice(0, 12)}</td>
                  <td className="p-2">{j.progress}%</td>
                  <td className="p-2">{j.attemptsMade}</td>
                  <td className="p-2 text-muted-foreground">
                    {j.processedOn
                      ? new Date(j.processedOn).toLocaleTimeString()
                      : "—"}
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {j.finishedOn
                      ? new Date(j.finishedOn).toLocaleTimeString()
                      : "—"}
                  </td>
                  <td className="p-2 text-red-700">
                    {j.failedReason ? j.failedReason.slice(0, 80) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
