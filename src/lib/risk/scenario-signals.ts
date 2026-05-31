/**
 * Phase 3 — live price/weather signal detector.
 *
 * Reads a feed snapshot and flags notable conditions, each mapped to the
 * crisis scenario it suggests. Pure (no DB / Date). Thresholds are heuristics
 * (surfaced as such in the UI). News-derived triggers are OUT (Phase 3b —
 * raw news = 0 rows).
 */
import type { FeedSnapshot } from './scenario-feed-context'

export interface Signal {
  id: string
  /** Phase 3b — 'market' (price/weather feed) vs 'news' (curated headlines). */
  kind: 'market' | 'news'
  severity: 'high' | 'medium'
  label: string
  detail: string
  /** Scenario code the strip pre-selects on click. */
  suggestedScenarioCode: string
  asOf: string
  stale: boolean
}

/** Minimal translator the detectors use to localize signal labels/details.
 *  Structurally satisfied by next-intl's scoped `t` (the route injects
 *  `getTranslations('terminal.signals')`). */
export type SignalTranslator = (key: string, values?: Record<string, string | number>) => string

/** Fallback when no translator is injected (unit tests / non-localized callers):
 *  returns the key verbatim. Production (the signals route) always passes a real
 *  next-intl translator, so end users never see raw keys. */
const IDENTITY: SignalTranslator = (k) => k

export function detectSignals(snapshot: FeedSnapshot, t: SignalTranslator = IDENTITY): Signal[] {
  const out: Signal[] = []
  const get = (k: string) => {
    const d = snapshot[k]
    return d && typeof d.value === 'number' && Number.isFinite(d.value) ? d : null
  }

  // NOTE (2026-06-01): the FX-depreciation signal was removed. It fired on an
  // IRP-MODELED 12M forward (FX_FORWARD_USD_AZN_12M) computed from hardcoded
  // spot + policy rates — not a real market quote. The manat is a managed peg
  // with no liquid forward market, so an interest-rate-parity premium is not a
  // devaluation expectation. Showing it as "market is pricing devaluation" was
  // misleading. Removed with the cbar-fx-forward adapter. The remaining signals
  // below are all driven by real fetched feeds (Brent/EIA, weather, FAO sugar).

  // 1) Oil elevated — energy/fertilizer cost pressure.
  const brent = get('BRENT_USD_BBL')
  if (brent && brent.value > 95) {
    out.push({
      id: 'oil-elevated',
        kind: 'market',
      severity: 'medium',
      label: t('oilElevated.label'),
      detail: t('oilElevated.detail', { brent: String(brent.value) }),
      suggestedScenarioCode: 'BRENT_TO_140',
      asOf: brent.asOf,
      stale: brent.stale,
    })
  }

  // 3) Drought — low 14d rainfall forecast across agro regions.
  const rain = get('RAINFALL_14D_MIN')
  if (rain && rain.value < 15) {
    out.push({
      id: 'drought',
        kind: 'market',
      severity: 'high',
      label: t('drought.label'),
      detail: t('drought.detail', { rain: String(rain.value) }),
      suggestedScenarioCode: 'DROUGHT_2026',
      asOf: rain.asOf,
      stale: rain.stale,
    })
  }

  // 4) Sugar under pressure — FAO sugar index low.
  const sugar = get('FAO_SUGAR_INDEX')
  if (sugar && sugar.value < 90) {
    out.push({
      id: 'sugar-pressure',
      kind: 'market',
      severity: 'medium',
      label: t('sugarPressure.label'),
      detail: t('sugarPressure.detail', { sugar: String(sugar.value) }),
      suggestedScenarioCode: 'SUGAR_PRICE_TO_70',
      asOf: sugar.asOf,
      stale: sugar.stale,
    })
  }

  return out
}

// ─── Phase 3b — news-derived signals ───────────────────────────────────────

export interface NewsItem {
  title: string
  sourceLabel: string
  sentimentScore: number | null
  industryTags: string[]
  companyTags: string[]
  /** ISO date (YYYY-MM-DD). */
  publishedAt: string
}

/** Only materially-negative news triggers a crisis suggestion. */
const NEWS_SENTIMENT_THRESHOLD = -0.3

interface NewsRule {
  code: string
  /** Require ≥1 of these industryTags (omit to skip the tag gate). */
  tags?: string[]
  /** Require a keyword match in the headline. */
  kw: RegExp
}

// Order matters — first matching rule wins for a given item. Conservative:
// a signal needs negative sentiment AND a keyword (AND a tag where set), so a
// generic negative headline with no commodity/FX/weather angle never fires.
const NEWS_RULES: NewsRule[] = [
  { code: 'DROUGHT_2026', tags: ['agro_crops', 'food_processing'], kw: /weather|drought|harvest|flood|frost|adverse|погод|засух|урожай|ущерб|наводнен/i },
  { code: 'AZN_DEVAL_15', kw: /devalu|manat|девальв|обесцен|курс\s*(манат|azn)/i },
  { code: 'SUGAR_PRICE_TO_70', kw: /sugar|сахар/i },
  { code: 'BRENT_TO_140', kw: /\boil\b|brent|crude|нефть|энерг|fuel|топлив/i },
]

/**
 * Map recent negative news to the crisis scenario it implies (keyword + tag
 * heuristic, deterministic — no per-request LLM). Dedupes to one signal per
 * scenario, keeping the most-negative headline. Pure.
 */
export function detectNewsSignals(items: NewsItem[], t: SignalTranslator = IDENTITY): Signal[] {
  const best = new Map<string, NewsItem>()
  for (const item of items) {
    const s = item.sentimentScore
    if (typeof s !== 'number' || !Number.isFinite(s) || s > NEWS_SENTIMENT_THRESHOLD) continue
    const title = item.title ?? ''
    for (const rule of NEWS_RULES) {
      if (rule.tags && !rule.tags.some((t) => item.industryTags?.includes(t))) continue
      if (!rule.kw.test(title)) continue
      const cur = best.get(rule.code)
      if (!cur || s < (cur.sentimentScore ?? 0)) best.set(rule.code, item)
      break
    }
  }
  return [...best.entries()].map(([code, item]) => ({
    id: `news-${code}`,
    kind: 'news' as const,
    severity: (item.sentimentScore ?? 0) <= -0.5 ? 'high' : 'medium',
    label: item.title.length > 90 ? `${item.title.slice(0, 87)}…` : item.title,
    detail: t('newsDetail', { source: item.sourceLabel, score: (item.sentimentScore ?? 0).toFixed(2) }),
    suggestedScenarioCode: code,
    asOf: item.publishedAt,
    stale: false,
  }))
}
