/**
 * Phase 7.L — Default crossing-rules pack.
 *
 * 5 rules covering the most common macro-shock triggers for FO Holding.
 * Each rule encodes a single (source, metric, predicate) combination.
 * Adding a new rule = append one object here.
 *
 * Per-org threshold overrides are out of scope for v1 — current rules
 * use hard-coded cutoffs calibrated against 2024-2026 historical
 * volatility. v2 will read overrides from
 * `Organization.settings.crossingThresholds`.
 */
import type { CrossingRule } from "./crossing-rules"
import { getSeries, pointAtLookback } from "./crossing-rules"

/**
 * FAO Food Price Index above 130. Calibrated against historical FFPI:
 * 2020 base = 100, 2022 wartime peak = 159, 2024 average ~120.
 * 130 = "high but plausible" — second-tier red flag for food/agro/retail.
 */
const FAO_ABOVE_130: CrossingRule = {
  id: "fao-above-130",
  name: "FAO Food Price Index above 130",
  description:
    "FAO Food Price Index crossed 130 (base 2014-2016=100). Food/agro/retail input costs in elevated zone.",
  severity: "warning",
  priority: 20,
  match: (ctx) => {
    const series = getSeries(ctx, "fao-food-prices", "FAO_FFPI_NOMINAL")
    const latest = series[0]
    if (!latest) return []
    if (latest.value <= 130) return []
    // Use prior reading as baseline (or 130 if no prior).
    const prior = series[1]
    const baselineValue = prior?.value ?? 130
    const deltaPct = ((latest.value / baselineValue) - 1) * 100
    return [
      {
        ruleId: "fao-above-130",
        ruleName: "FAO Food Price Index above 130",
        severity: "warning" as const,
        sourceCode: "fao-food-prices",
        metric: "FAO_FFPI_NOMINAL",
        triggerValue: latest.value,
        baselineValue,
        deltaPct,
        observedAt: latest.datetime,
        message: `FAO Food Price Index at ${latest.value.toFixed(1)} (base 2014-2016=100) — elevated zone, food/agro input costs above structural baseline.`,
        messageKey: "fao-above-130",
        messageParams: {
          value: latest.value.toFixed(1),
          baseline: baselineValue.toFixed(1),
          deltaPct: deltaPct.toFixed(1),
        },
      },
    ]
  },
}

/**
 * Brent crude above $100/bbl. Historical context:
 * 2020 low = $19, 2022 wartime peak = $128, 2024 average ~$80.
 * $100 = "energy + logistics cost pressure window".
 */
const BRENT_ABOVE_100: CrossingRule = {
  id: "brent-above-100",
  name: "Brent crude above $100/bbl",
  description:
    "Brent crude oil crossed $100/barrel. Logistics, industrial, hospitality input cost pressure.",
  severity: "warning",
  priority: 30,
  match: (ctx) => {
    const series = getSeries(ctx, "eia-energy", "BRENT_USD_BBL")
    const latest = series[0]
    if (!latest) return []
    if (latest.value <= 100) return []
    const prior = series[1]
    const baselineValue = prior?.value ?? 100
    const deltaPct = ((latest.value / baselineValue) - 1) * 100
    return [
      {
        ruleId: "brent-above-100",
        ruleName: "Brent crude above $100/bbl",
        severity: "warning" as const,
        sourceCode: "eia-energy",
        metric: "BRENT_USD_BBL",
        triggerValue: latest.value,
        baselineValue,
        deltaPct,
        observedAt: latest.datetime,
        message: `Brent crude at $${latest.value.toFixed(2)}/bbl — above $100 threshold, fuel + freight cost pressure on logistics/industrial sectors.`,
        messageKey: "brent-above-100",
        messageParams: {
          value: latest.value.toFixed(2),
          baseline: baselineValue.toFixed(2),
          deltaPct: deltaPct.toFixed(1),
        },
      },
    ]
  },
}

/**
 * Brent crude below $60/bbl. Inverse signal — supply glut / demand
 * collapse. Bad for AZ state budget (oil-exporter) → secondary risk
 * for ALL sectors via AZN devaluation pressure.
 */
const BRENT_BELOW_60: CrossingRule = {
  id: "brent-below-60",
  name: "Brent crude below $60/bbl",
  description:
    "Brent crude oil crashed below $60/barrel. AZ state revenue + AZN currency under pressure.",
  severity: "warning",
  priority: 25,
  match: (ctx) => {
    const series = getSeries(ctx, "eia-energy", "BRENT_USD_BBL")
    const latest = series[0]
    if (!latest) return []
    if (latest.value >= 60) return []
    const prior = series[1]
    const baselineValue = prior?.value ?? 60
    const deltaPct = ((latest.value / baselineValue) - 1) * 100
    return [
      {
        ruleId: "brent-below-60",
        ruleName: "Brent crude below $60/bbl",
        severity: "warning" as const,
        sourceCode: "eia-energy",
        metric: "BRENT_USD_BBL",
        triggerValue: latest.value,
        baselineValue,
        deltaPct,
        observedAt: latest.datetime,
        message: `Brent crude at $${latest.value.toFixed(2)}/bbl — below $60 threshold, AZ state revenue + AZN parity under pressure.`,
        messageKey: "brent-below-60",
        messageParams: {
          value: latest.value.toFixed(2),
          baseline: baselineValue.toFixed(2),
          deltaPct: deltaPct.toFixed(1),
        },
      },
    ]
  },
}

/**
 * AZN/USD shift > 2% over 7 days. AZN is officially pegged to USD at
 * 1.70 (CBAR managed float since 2017). A >2% shift in either direction
 * is RARE and signals significant central bank action or stress.
 */
const AZN_USD_7D_SHIFT: CrossingRule = {
  id: "azn-usd-7d-shift-2pct",
  name: "AZN/USD 7-day shift > 2%",
  description:
    "Azerbaijani Manat moved >2% against USD over 7 days. All USD-import companies face FX shock.",
  severity: "critical",
  priority: 10,
  match: (ctx) => {
    const series = getSeries(ctx, "cbar-official-fx", "AZN_USD")
    const latest = series[0]
    if (!latest) return []
    const prior = pointAtLookback(series, latest, 7, 2)
    if (!prior) return []
    const deltaPct = ((latest.value / prior.value) - 1) * 100
    if (Math.abs(deltaPct) <= 2) return []
    return [
      {
        ruleId: "azn-usd-7d-shift-2pct",
        ruleName: "AZN/USD 7-day shift > 2%",
        severity: "critical" as const,
        sourceCode: "cbar-official-fx",
        metric: "AZN_USD",
        triggerValue: latest.value,
        baselineValue: prior.value,
        deltaPct,
        observedAt: latest.datetime,
        message: `AZN/USD moved from ${prior.value.toFixed(4)} to ${latest.value.toFixed(4)} (${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(2)}%) over 7 days — all USD-import companies face FX shock.`,
        messageKey: "azn-usd-7d-shift-2pct",
        messageParams: {
          from: prior.value.toFixed(4),
          to: latest.value.toFixed(4),
          deltaPct: deltaPct.toFixed(2),
        },
      },
    ]
  },
}

/**
 * AZ Food CPI YoY above 7%. AZ food inflation historically 4-8% YoY;
 * >7% = sustained price pressure that retailers + restaurants pass
 * through. Triggers for retail/beverage/hospitality sectors.
 */
const AZ_CPI_FOOD_ABOVE_107: CrossingRule = {
  id: "az-cpi-food-yoy-above-7pct",
  name: "AZ Food CPI YoY above 7%",
  description:
    "Azerbaijani food consumer price inflation crossed 7% YoY. Retail margin compression + consumer affordability risk.",
  severity: "warning",
  priority: 40,
  match: (ctx) => {
    const series = getSeries(ctx, "az-stat-cpi", "AZ_CPI_FOOD")
    const latest = series[0]
    if (!latest) return []
    // AZ_CPI_FOOD is published as YoY% (e.g. 105.5 = +5.5% YoY).
    if (latest.value <= 107) return []
    const prior = series[1]
    const baselineValue = prior?.value ?? 107
    const deltaPct = ((latest.value / baselineValue) - 1) * 100
    return [
      {
        ruleId: "az-cpi-food-yoy-above-7pct",
        ruleName: "AZ Food CPI YoY above 7%",
        severity: "warning" as const,
        sourceCode: "az-stat-cpi",
        metric: "AZ_CPI_FOOD",
        triggerValue: latest.value,
        baselineValue,
        deltaPct,
        observedAt: latest.datetime,
        message: `AZ food CPI at ${latest.value.toFixed(1)}% YoY — above 7% sustained-inflation threshold, retail margin compression + consumer affordability risk.`,
        messageKey: "az-cpi-food-yoy-above-7pct",
        messageParams: {
          value: latest.value.toFixed(1),
          baseline: baselineValue.toFixed(1),
          deltaPct: deltaPct.toFixed(1),
        },
      },
    ]
  },
}

export const DEFAULT_CROSSING_RULES: readonly CrossingRule[] = [
  AZN_USD_7D_SHIFT,
  FAO_ABOVE_130,
  BRENT_ABOVE_100,
  BRENT_BELOW_60,
  AZ_CPI_FOOD_ABOVE_107,
]
