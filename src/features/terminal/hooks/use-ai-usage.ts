/**
 * Phase 7.O C2 — per-user AI usage poller.
 *
 * Reads /api/me/ai-usage every 60s (cheap query — bounded by the user's
 * own audit-event count today). Surfaces `today.total` for the
 * CommandBar chip and `mtd.total` for the tooltip drill-down.
 *
 * 60s cadence is intentional: the chip is informational and the user
 * occasionally checks their AI spend; sub-minute precision adds no value
 * and burns DB cycles needlessly.
 */
import { useEffect, useState } from "react"

export interface AiUsageStats {
  tokensIn: number
  tokensOut: number
  calls: number
  total: number
}

export interface AiUsageHookState {
  today: AiUsageStats
  mtd: AiUsageStats
  loading: boolean
  error: string | null
}

const EMPTY_STATS: AiUsageStats = {
  tokensIn: 0,
  tokensOut: 0,
  calls: 0,
  total: 0,
}

const EMPTY_STATE: AiUsageHookState = {
  today: EMPTY_STATS,
  mtd: EMPTY_STATS,
  loading: true,
  error: null,
}

const POLL_MS = 60 * 1000

export function useAiUsage(): AiUsageHookState {
  const [state, setState] = useState<AiUsageHookState>(EMPTY_STATE)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch("/api/me/ai-usage", { cache: "no-store" })
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            if (!cancelled) setState({ ...EMPTY_STATE, loading: false })
            return
          }
          throw new Error(`HTTP ${res.status}`)
        }
        const body = await res.json()
        if (cancelled) return
        setState({
          today: body.today ?? EMPTY_STATS,
          mtd: body.mtd ?? EMPTY_STATS,
          loading: false,
          error: null,
        })
      } catch (e) {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: e instanceof Error ? e.message : String(e),
          }))
        }
      }
    }

    load()
    const id = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return state
}

/**
 * Format a token count for the chip. Mimics Bloomberg-style compact
 * notation: 1234 → "1.2K", 12345 → "12.3K", 1234567 → "1.2M".
 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0"
  if (n < 1000) return String(Math.round(n))
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
}
