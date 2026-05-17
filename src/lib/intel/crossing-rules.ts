/**
 * Phase 7.L — External-feed crossing rules engine (pure).
 *
 * Stateless rule library that scans recent `IntelDataPoint` rows and
 * emits `CrossingMatch[]` when an external metric breaches a defined
 * threshold (e.g. FAO > 130, AZN/USD shift > 2% in 7 days). Mirrors
 * `src/lib/risk/alert-rules.ts` for consistency — same shape, same
 * `evaluate(rules, ctx, config?)` contract.
 *
 * No I/O, no LLM, no Prisma. Caller provides a `CrossingContext` with
 * recent data points (typically last 7-30 days per source); engine
 * returns the union of every triggered rule.
 *
 * Default rule pack lives in `crossing-rules-default-pack.ts`. Per-org
 * threshold overrides — see `crossing-thresholds-config.ts`.
 */

export type CrossingSeverity = "critical" | "warning" | "info"

/**
 * One observation of an external metric, with enough information to
 * compute deltas + match thresholds. Subset of `IntelDataPoint` — we
 * keep this lean so unit tests can construct fixtures without going
 * through Prisma. Caller maps DB rows to this shape.
 */
export interface CrossingDataPoint {
  sourceCode: string
  metric: string
  /** UTC timestamp the point represents (NOT fetchedAt). */
  datetime: Date
  value: number
}

export interface CrossingContext {
  organizationId: string
  /** Recent points, ordered newest-first or arbitrary — engine sorts
   *  per-(source, metric) when computing time deltas. */
  points: readonly CrossingDataPoint[]
  /** Optional pre-built index `(sourceCode + "|" + metric)` → sorted
   *  points (newest first). Engine builds this lazily on first read
   *  via `getSeries`. Callers may pre-build for batch evaluations. */
  seriesByMetric?: ReadonlyMap<string, readonly CrossingDataPoint[]>
}

export interface CrossingMatch {
  ruleId: string
  ruleName: string
  severity: CrossingSeverity
  /** Originating source (e.g. "fao-food-prices") — passed through to
   *  downstream consumers + persisted on FeedImpactForecast.triggerSourceCode. */
  sourceCode: string
  /** Metric code (e.g. "FAO_FFPI_NOMINAL"). */
  metric: string
  /** Latest observed value that breached the threshold. */
  triggerValue: number
  /** Baseline used for comparison (prior-period value, threshold cutoff,
   *  or rolling baseline depending on rule semantics). */
  baselineValue: number
  /** Signed delta percent: (trigger / baseline - 1) × 100. */
  deltaPct: number
  /** UTC timestamp of the trigger point. */
  observedAt: Date
  /** English message — same byte-for-byte contract as alert-rules.ts. */
  message: string
  /** i18n key under `terminal.crossings.messages.<ruleId>`. */
  messageKey: string
  /** Placeholder params for `messageKey`. */
  messageParams: Record<string, string | number>
}

export interface CrossingRule {
  id: string
  name: string
  description: string
  severity: CrossingSeverity
  /** In-severity tiebreaker. Lower = more urgent within the same band. */
  priority: number
  /** Returns zero or more matches. Pure function — engine treats output
   *  as immutable. Empty array = rule did not trigger. */
  match: (ctx: CrossingContext) => CrossingMatch[]
}

/**
 * Helper used by rule implementations: pull the newest-first sorted
 * series for a given (sourceCode, metric) from the context, building
 * the per-call index lazily. Mutates `ctx.seriesByMetric` if absent.
 */
export function getSeries(
  ctx: CrossingContext,
  sourceCode: string,
  metric: string,
): readonly CrossingDataPoint[] {
  const key = `${sourceCode}|${metric}`
  if (ctx.seriesByMetric) {
    return ctx.seriesByMetric.get(key) ?? []
  }
  // Build full index once, then mutate the context.
  const map = new Map<string, CrossingDataPoint[]>()
  for (const p of ctx.points) {
    const k = `${p.sourceCode}|${p.metric}`
    const list = map.get(k)
    if (list) list.push(p)
    else map.set(k, [p])
  }
  for (const list of map.values()) {
    list.sort((a, b) => b.datetime.getTime() - a.datetime.getTime())
  }
  // TypeScript: we're mutating via a mutable cast. The context type
  // says `seriesByMetric` is readonly to discourage external mutation;
  // engine-internal caching is fine.
  ;(ctx as { seriesByMetric: ReadonlyMap<string, readonly CrossingDataPoint[]> }).seriesByMetric = map
  return map.get(key) ?? []
}

/**
 * Find the data point that sits closest to `daysAgo` UTC days before
 * `latest.datetime`. Used by rules that compare "now vs N days ago"
 * (e.g. 7-day shift). Returns null if the series has no point old
 * enough to satisfy the lookback (avoids false positives from sparse
 * data).
 */
export function pointAtLookback(
  series: readonly CrossingDataPoint[],
  latest: CrossingDataPoint,
  daysAgo: number,
  toleranceDays = 2,
): CrossingDataPoint | null {
  if (series.length < 2) return null
  const targetMs = latest.datetime.getTime() - daysAgo * 24 * 60 * 60_000
  const toleranceMs = toleranceDays * 24 * 60 * 60_000
  let best: CrossingDataPoint | null = null
  let bestDiff = Infinity
  for (const p of series) {
    if (p === latest) continue
    if (p.datetime.getTime() > latest.datetime.getTime()) continue
    const diff = Math.abs(p.datetime.getTime() - targetMs)
    if (diff <= toleranceMs && diff < bestDiff) {
      best = p
      bestDiff = diff
    }
  }
  return best
}

/**
 * Evaluate every rule against the context. Returns the flat union
 * sorted by severity (critical → warning → info), then `priority`
 * (lower first), then `ruleName` for determinism.
 */
export function evaluateCrossingRules(
  rules: readonly CrossingRule[],
  ctx: CrossingContext,
): CrossingMatch[] {
  const out: CrossingMatch[] = []
  const meta = new Map<string, { priority: number }>()
  for (const r of rules) meta.set(r.id, { priority: r.priority })
  for (const rule of rules) {
    const matches = rule.match(ctx)
    out.push(...matches)
  }
  return out.sort((a, b) => {
    const severityRank = (s: CrossingSeverity): number =>
      s === "critical" ? 0 : s === "warning" ? 1 : 2
    const sd = severityRank(a.severity) - severityRank(b.severity)
    if (sd !== 0) return sd
    const pa = meta.get(a.ruleId)?.priority ?? 100
    const pb = meta.get(b.ruleId)?.priority ?? 100
    if (pa !== pb) return pa - pb
    return a.ruleName.localeCompare(b.ruleName)
  })
}
