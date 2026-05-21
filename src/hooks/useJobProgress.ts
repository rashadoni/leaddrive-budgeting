/**
 * Phase 6 — useJobProgress hook.
 *
 * Subscribes to /api/queue/jobs/:jobId/progress via EventSource and
 * exposes a number (0..100) + status (idle | streaming | complete |
 * failed). Use in components that show import / recompute progress.
 *
 *   const { progress, status, error } = useJobProgress(jobId);
 *
 * No params or null jobId → idle, no connection opened. Cleanup runs
 * automatically on unmount or jobId change.
 */
"use client"
import { useEffect, useState } from "react"

export type JobStatus = "idle" | "streaming" | "complete" | "failed"

export interface UseJobProgressResult {
  progress: number
  status: JobStatus
  result: unknown
  error: string | null
}

export function useJobProgress(
  jobId: string | null,
): UseJobProgressResult {
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<JobStatus>("idle")
  const [result, setResult] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!jobId) {
      setStatus("idle")
      setProgress(0)
      setResult(null)
      setError(null)
      return
    }
    setStatus("streaming")
    setProgress(0)
    setResult(null)
    setError(null)
    const es = new EventSource(`/api/queue/jobs/${jobId}/progress`)
    es.addEventListener("progress", (e) => {
      const n = Number((e as MessageEvent).data)
      if (Number.isFinite(n)) setProgress(n)
    })
    es.addEventListener("complete", (e) => {
      try {
        setResult(JSON.parse((e as MessageEvent).data))
      } catch {
        setResult((e as MessageEvent).data)
      }
      setProgress(100)
      setStatus("complete")
      es.close()
    })
    es.addEventListener("failed", (e) => {
      setError(String((e as MessageEvent).data))
      setStatus("failed")
      es.close()
    })
    es.onerror = () => {
      // EventSource auto-reconnects on transient drops; only flip to
      // "failed" if it explicitly closes (readyState=CLOSED).
      if (es.readyState === EventSource.CLOSED) {
        setStatus((prev) => (prev === "complete" ? prev : "failed"))
      }
    }
    return () => {
      es.close()
    }
  }, [jobId])

  return { progress, status, result, error }
}
