"use client"

/**
 * Phase 7.G Turn LXXXXIX (Phase 7.E #2 v2 E.1d terminal-side, client half).
 *
 * Reads `?company=X&indicator=Y&period=Z&from=alert&alertId=Z` from URL,
 * resolves to IndicatorValue.id via NEW `GET /api/indicators/values/resolve`,
 * then dispatches `setActiveIndicatorValue(id)` + `setActivePanel(4)` to
 * auto-open VarianceExplainerPanel. Closes the deep-link from
 * `AlertEventsFeed.tsx` "? Why?" buttons (LXXXXVIII E.1d link half).
 *
 * Render output: optional "from-alert" toast/banner; otherwise null.
 *
 * Failure modes (graceful degradation):
 *   - 404 from resolve → silent no-op (user lands on default terminal,
 *     no broken link UX). Logged to console.warn for debugging.
 *   - Missing required params → silent no-op (user opened terminal directly).
 *   - Network error → silent no-op + console.warn.
 */

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTerminalStore } from "../store/terminalStore"
import { getLogger } from "@/lib/log"

// Phase 8 D4 continuation (2026-05-28) — structured logger replaces
// 2 console.warn calls in the deep-link resolver's graceful-degradation
// branches (non-OK response + network error).
const log = getLogger("terminal:deep-link")

const VARIANCE_EXPLAINER_PANEL_ID = 4

export function TerminalDeepLinkHandler(): React.ReactElement | null {
  const searchParams = useSearchParams()
  const setActiveIndicatorValue = useTerminalStore((s) => s.setActiveIndicatorValue)
  const setActivePanel = useTerminalStore((s) => s.setActivePanel)
  const [resolved, setResolved] = useState<{ from?: string; ok: boolean } | null>(null)

  useEffect(() => {
    const company = searchParams.get("company")
    const indicator = searchParams.get("indicator")
    const period = searchParams.get("period")
    const from = searchParams.get("from") ?? undefined

    // Required-param triplet — bail silently if any missing
    if (!company || !indicator || !period) return

    let cancelled = false
    const sp = new URLSearchParams({ company, indicator, period })
    fetch(`/api/indicators/values/resolve?${sp}`)
      .then((res) => {
        if (!res.ok) {
          // 404 / 400 / 500 — graceful no-op
          log.warn("resolve returned non-OK status", {
            status: res.status,
            company,
            indicator,
            period,
          })
          if (!cancelled) setResolved({ from, ok: false })
          return null
        }
        return res.json() as Promise<{ indicatorValueId: string }>
      })
      .then((body) => {
        if (cancelled || !body) return
        setActiveIndicatorValue(body.indicatorValueId)
        setActivePanel(VARIANCE_EXPLAINER_PANEL_ID)
        setResolved({ from, ok: true })
      })
      .catch((e) => {
        log.warn("resolve failed", {
          err: e instanceof Error ? e.message : String(e),
          company,
          indicator,
          period,
        })
        if (!cancelled) setResolved({ from, ok: false })
      })

    return () => {
      cancelled = true
    }
  }, [searchParams, setActiveIndicatorValue, setActivePanel])

  // From-alert banner: render only when resolved + arrived from alert
  if (resolved?.from === "alert" && resolved.ok) {
    return (
      <div
        role="status"
        className="bg-cyan-500/10 border-b border-cyan-500/30 px-4 py-1.5 text-xs font-mono text-cyan-300"
        data-testid="terminal-deeplink-banner"
      >
        ↗ Opened from alert — VarianceExplainer panel auto-loaded for selected cell
      </div>
    )
  }
  if (resolved?.from === "alert" && !resolved.ok) {
    return (
      <div
        role="status"
        className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-1.5 text-xs font-mono text-amber-300"
        data-testid="terminal-deeplink-banner-warn"
      >
        ⚠ Could not auto-open the cell from alert link — pick the company + indicator manually
      </div>
    )
  }
  return null
}
