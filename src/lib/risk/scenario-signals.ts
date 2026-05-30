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
  severity: 'high' | 'medium'
  label: string
  detail: string
  /** Scenario code the strip pre-selects on click. */
  suggestedScenarioCode: string
  asOf: string
  stale: boolean
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`

export function detectSignals(snapshot: FeedSnapshot): Signal[] {
  const out: Signal[] = []
  const get = (k: string) => {
    const d = snapshot[k]
    return d && typeof d.value === 'number' && Number.isFinite(d.value) ? d : null
  }

  // 1) FX depreciation — 12M forward prices the manat weaker than spot.
  const spot = get('AZN_USD')
  const fwd = get('FX_FORWARD_USD_AZN_12M')
  if (spot && fwd && spot.value > 0) {
    const premium = fwd.value / spot.value - 1
    if (premium > 0.015) {
      out.push({
        id: 'fx-depreciation',
        severity: 'high',
        label: 'Рынок закладывает девальвацию маната',
        detail: `Форвард USD/AZN 12М ${fwd.value} vs спот ${spot.value} (${pct(premium)})`,
        suggestedScenarioCode: 'AZN_DEVAL_15',
        asOf: fwd.asOf,
        stale: fwd.stale || spot.stale,
      })
    }
  }

  // 2) Oil elevated — energy/fertilizer cost pressure.
  const brent = get('BRENT_USD_BBL')
  if (brent && brent.value > 95) {
    out.push({
      id: 'oil-elevated',
      severity: 'medium',
      label: 'Brent на повышенном уровне',
      detail: `Brent $${brent.value}/баррель (> $95) — давление на энергию/удобрения`,
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
      severity: 'high',
      label: 'Низкий прогноз осадков в агрорегионах',
      detail: `Мин. осадки 14д ${rain.value} мм (< 15 мм) — риск засухи`,
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
      severity: 'medium',
      label: 'Цена сахара под давлением',
      detail: `FAO индекс сахара ${sugar.value} (< 90)`,
      suggestedScenarioCode: 'SUGAR_PRICE_TO_70',
      asOf: sugar.asOf,
      stale: sugar.stale,
    })
  }

  return out
}
