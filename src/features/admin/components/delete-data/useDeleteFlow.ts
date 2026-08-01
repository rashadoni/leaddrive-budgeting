"use client"
/**
 * Preview → confirm → commit, as one small state machine.
 *
 * Two rules it exists to enforce:
 *   1. A preview goes STALE (120 s, or any edit to the scope) and the confirm
 *      strip is replaced by "Check again". A number you read four minutes ago
 *      is not a number you can confirm.
 *   2. The commit always carries `expectRows` — the number the operator read
 *      — so a change in between is a 409 with nothing written, not a surprise
 *      in the result panel.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import {
  buildCommitRequest,
  buildPreviewRequest,
  type TaskState,
} from "@/features/admin/lib/delete-data/payload"
import type { PeriodLockInfo, Preview, RunOutcome } from "./types"

export const PREVIEW_TTL_MS = 120_000

type ScopeInput = Parameters<typeof buildPreviewRequest>[0]

export interface DeleteFlow {
  preview: Preview | null
  locks: PeriodLockInfo[]
  checkedAt: number | null
  stale: boolean
  checking: boolean
  running: boolean
  outcome: RunOutcome | null
  error: string | null
  check: (scope: ScopeInput, options?: { yearIndex?: boolean }) => Promise<void>
  invalidate: () => void
  run: (state: TaskState) => Promise<void>
  reset: () => void
}

export function useDeleteFlow(): DeleteFlow {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [locks, setLocks] = useState<PeriodLockInfo[]>([])
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const [stale, setStale] = useState(false)
  const [checking, setChecking] = useState(false)
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<RunOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const invalidate = useCallback(() => {
    setStale(true)
  }, [])

  const reset = useCallback(() => {
    setPreview(null)
    setCheckedAt(null)
    setStale(false)
    setOutcome(null)
    setError(null)
  }, [])

  const check = useCallback<DeleteFlow["check"]>(async (scope, options) => {
    setChecking(true)
    setError(null)
    setOutcome(null)
    try {
      const res = await fetch("/api/admin/data-archive/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPreviewRequest(scope, options)),
      })
      const data = (await res.json()) as
        | { ok: true; preview: Preview; locks?: PeriodLockInfo[] }
        | { ok: false; error: string }
      if (!res.ok || !data.ok) {
        throw new Error("error" in data ? data.error : `HTTP ${res.status}`)
      }
      setPreview(data.preview)
      setLocks(data.locks ?? [])
      setCheckedAt(Date.now())
      setStale(false)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setStale(true), PREVIEW_TTL_MS)
    } catch (err) {
      setPreview(null)
      setCheckedAt(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setChecking(false)
    }
  }, [])

  const run = useCallback<DeleteFlow["run"]>(async (state) => {
    setRunning(true)
    setError(null)
    setOutcome(null)
    try {
      const res = await fetch("/api/admin/data-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildCommitRequest(state)),
      })
      const data = (await res.json()) as Record<string, unknown>

      if (res.status === 409) {
        setOutcome({
          kind: "drift",
          expected: Number(data.expectedRows ?? state.expectRows),
          actual: Number(data.actualRows ?? 0),
          preview: data.preview as Preview,
        })
        setPreview((data.preview as Preview) ?? null)
        setCheckedAt(Date.now())
        setStale(false)
        return
      }
      if (res.status === 423) {
        const lock = (data.lock ?? {}) as { period?: string; reason?: string }
        setOutcome({ kind: "locked", period: lock.period ?? "", reason: lock.reason })
        return
      }
      if (res.status === 429) {
        const retry = Number(res.headers.get("retry-after") ?? "60")
        setOutcome({
          kind: "rateLimited",
          retryAfterSeconds: Number.isFinite(retry) ? retry : 60,
        })
        return
      }

      const breakdown = (data.breakdown ?? {}) as Record<string, number>
      const companiesDeleted = (data.companiesDeleted ?? []) as string[]
      const companiesFailed = (data.companiesFailed ?? []) as string[]

      if (res.status === 207 || data.ok !== true) {
        // 207 means SOME data is already gone. It is never the green panel,
        // and the breakdown describes real deletions — the old form threw it
        // away and showed a bare error string.
        if (res.status === 207) {
          setOutcome({
            kind: "partial",
            rowsAffected: Number(data.rowsAffected ?? 0),
            breakdown,
            companiesDeleted,
            companiesFailed,
            orphanTailRemains: companiesFailed.length === 0,
          })
          return
        }
        setOutcome({
          kind: "failed",
          message: typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
        })
        return
      }

      setOutcome({
        kind: "done",
        rowsAffected: Number(data.rowsAffected ?? 0),
        breakdown,
        recomputed: Number(data.recomputed ?? 0),
        companiesDeleted,
      })
      setPreview(null)
      setCheckedAt(null)
    } catch (err) {
      setOutcome({
        kind: "failed",
        message: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setRunning(false)
    }
  }, [])

  return {
    preview,
    locks,
    checkedAt,
    stale,
    checking,
    running,
    outcome,
    error,
    check,
    invalidate,
    run,
    reset,
  }
}
