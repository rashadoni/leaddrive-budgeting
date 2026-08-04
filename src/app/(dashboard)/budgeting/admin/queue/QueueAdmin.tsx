"use client"
/**
 * Phase 6 — Queue admin client component.
 *
 * State filter pills + table. Manually refresh; auto-refresh deferred
 * until the SSE endpoint is generalised to broadcast all-job events.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"

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
  const t = useTranslations("adminQueue")
  const [state, setState] = useState<QueueState>("active")
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [backend, setBackend] = useState<"bullmq" | "inprocess" | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function refresh(s: QueueState): Promise<void> {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch(`/api/admin/queue?state=${s}&limit=100`)
      // 503 = BullMQ is on but Redis is unreachable. The route sends the
      // reason in the body; showing "HTTP 503" alone sends the operator to
      // the container logs for something we already know.
      if (res.status === 503) {
        const body = (await res.json().catch(() => null)) as {
          detail?: string
        } | null
        setBackend("bullmq")
        setJobs([])
        throw new Error(
          body?.detail ? `${t("unavailable")} — ${body.detail}` : t("unavailable"),
        )
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as {
        jobs: JobRow[]
        backend?: "bullmq" | "inprocess"
      }
      setBackend(data.backend ?? null)
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
            {t(`state.${s}`)}
          </button>
        ))}
        <button
          onClick={() => refresh(state)}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          data-testid="queue-refresh"
        >
          ↻ {t("refresh")}
        </button>
      </div>
      {err && (
        <div className="text-sm text-red-600 border border-red-300 bg-red-50 rounded p-2">
          ❌ {err}
        </div>
      )}
      {loading && (
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      )}
      {!loading && backend === "inprocess" && (
        <div
          className="text-sm border border-amber-300 bg-amber-50 text-amber-900 rounded p-4"
          data-testid="queue-backend-inprocess"
        >
          {t("inprocessNotice")}
        </div>
      )}
      {!loading && backend !== "inprocess" && jobs.length === 0 && (
        <div className="text-sm text-muted-foreground border border-border rounded p-4 text-center">
          {t.rich("emptyState", {
            stateName: t(`state.${state}`),
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </div>
      )}
      {!loading && jobs.length > 0 && (
        <div className="overflow-x-auto border border-border rounded">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="p-2">{t("col.queue")}</th>
                <th className="p-2">{t("col.jobId")}</th>
                <th className="p-2">{t("col.progress")}</th>
                <th className="p-2">{t("col.attempts")}</th>
                <th className="p-2">{t("col.started")}</th>
                <th className="p-2">{t("col.finished")}</th>
                <th className="p-2">{t("col.failedReason")}</th>
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
