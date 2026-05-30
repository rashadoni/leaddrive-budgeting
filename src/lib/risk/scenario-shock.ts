/**
 * Phase 1 "Crisis Brief" — economic-shock schema + B2 P&L recompute.
 *
 * Spec §B: margin formulas read DERIVED scalars (gross_profit, ebitda,
 * net_income) — not primitives — so overriding `cogs` alone is inert. This
 * module reads a company's baseline resolved scalars and recomputes the
 * dependent P&L chain CONSISTENTLY from a small set of economic shocks, then
 * returns a flat `scenarioOverrides` map for buildContext.
 *
 * Pure module — no DB, no Prisma. NO side effects.
 */

export interface ScenarioShock {
  /** Δ sales VOLUME, fraction (−0.30 = −30%): scales revenue AND variable cogs. */
  revenueShock?: number
  /** Δ selling PRICE, fraction (−0.20): scales revenue only → margin compresses. */
  priceShock?: number
  /** Δ input cost, fraction (+0.25): scales cogs only → margin compresses. */
  inputCostShock?: number
  /** AZN devaluation fraction (0.20 = −20%): raises cost on the FX-exposed input share. */
  fxShock?: number
  /** 0..1 — used for fxShock WHEN imported_input_cost==0 (current data). */
  assumedImportShare?: number
  /** Δ yield_per_ha, fraction (−0.30). */
  yieldShock?: number
  /**
   * 0..1 — how much of cogs is SUNK/fixed under a volume (revenueShock) drop.
   * 0 (default) = fully variable: a volume drop scales cogs proportionally
   * (margins flat) — models losing a customer (just produce less).
   * 1 = fully sunk: a volume drop leaves cogs unchanged (margins crushed) —
   * models a drought, where seeds/fertilizer/labor/irrigation are already
   * spent but the harvest fails. Only modulates the revenueShock→cogs link.
   */
  costRigidity?: number
  /**
   * Phase 2 — absolute target anchored to a LIVE feed metric. The engine layer
   * resolves it into the `drives` fraction from the current feed level
   * (`frac = value / currentLevel − 1`) BEFORE the P&L recompute. Optional;
   * when present it overrides the plain `drives` fraction. See
   * `scenario-feed-context.ts`.
   */
  target?: ShockTarget
}

export interface ShockTarget {
  /** Live-feed metric key (e.g. "AZN_USD", "FAO_SUGAR_INDEX", "BRENT_USD_BBL"). */
  metric: string
  /** Absolute target level the scenario drives toward. */
  value: number
  /** Which B2 lever the fractional change feeds. */
  drives: 'fxShock' | 'priceShock' | 'inputCostShock'
}

/**
 * The resolved financial scalars the recompute pipeline exposes per company
 * (the subset we read/override). Missing fields tolerated — every consumer
 * guards with Number.isFinite.
 */
export interface ResolvedScalars {
  revenue: number
  cogs: number
  opex: number
  gross_profit: number
  ebitda: number
  net_income: number
  da_total: number
  total_input_cost: number
  imported_input_cost: number
  yield_per_ha?: number
}

type NumericShockKey =
  | 'revenueShock' | 'priceShock' | 'inputCostShock' | 'fxShock' | 'assumedImportShare' | 'yieldShock' | 'costRigidity'
const SHOCK_KEYS: NumericShockKey[] = [
  'revenueShock', 'priceShock', 'inputCostShock', 'fxShock', 'assumedImportShare', 'yieldShock', 'costRigidity',
]

/** Type-guard: does this overrides blob carry a shock with ≥1 non-zero effect?
 *  `assumedImportShare` alone is NOT an effect — it only modulates fxShock.
 *  A well-formed Phase-2 `target` also makes it simulatable (the fraction is
 *  derived from the feed at run time). */
function isValidTarget(t: unknown): t is ShockTarget {
  if (!t || typeof t !== 'object') return false
  const o = t as Record<string, unknown>
  return (
    typeof o.metric === 'string' &&
    typeof o.value === 'number' &&
    Number.isFinite(o.value) &&
    (o.drives === 'fxShock' || o.drives === 'priceShock' || o.drives === 'inputCostShock')
  )
}

export function hasShock(overrides: unknown): overrides is { shock: ScenarioShock } {
  if (!overrides || typeof overrides !== 'object') return false
  const shock = (overrides as { shock?: unknown }).shock
  if (!shock || typeof shock !== 'object') return false
  const s = shock as Record<string, unknown>
  const levers: (keyof ScenarioShock)[] = ['revenueShock', 'priceShock', 'inputCostShock', 'fxShock', 'yieldShock']
  const hasLever = levers.some((k) => typeof s[k] === 'number' && Number.isFinite(s[k] as number) && (s[k] as number) !== 0)
  return hasLever || isValidTarget(s.target)
}

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/**
 * B2 recompute. Reads baseline scalars, applies the shocks, recomputes the
 * dependent chain, and returns ONLY the finite, meaningful overrides. See
 * spec §B.2 for the model. Conservative: opex + da_total held fixed.
 */
export function resolveShockOverrides(
  shock: ScenarioShock,
  base: ResolvedScalars,
): Record<string, number> {
  const revenue = num(base.revenue, NaN)
  const cogs = num(base.cogs, NaN)
  const opex = num(base.opex, NaN)
  const daTotal = num(base.da_total, NaN)
  const importedCost = num(base.imported_input_cost)
  const yieldPerHa = base.yield_per_ha

  const revenueShock = num(shock.revenueShock)
  const rigidity = Math.min(1, Math.max(0, num(shock.costRigidity)))
  const volumeF = 1 + revenueShock
  const priceF = 1 + num(shock.priceShock)
  const fx = num(shock.fxShock)
  const importShare = num(shock.assumedImportShare)
  const inputCostShock = num(shock.inputCostShock)

  const new_revenue = revenue * volumeF * priceF
  // cogs follows volume only for its VARIABLE portion (1 − rigidity); the sunk
  // portion stays put. Drought (rigidity≈0.8): cogs barely falls as yield
  // collapses → margins crushed. Lost customer (rigidity 0): cogs scales fully.
  const cogsVolumeF = 1 + revenueShock * (1 - rigidity)
  const importBase = importedCost > 0 ? importedCost : cogs * importShare
  const cost_increase = importBase * fx + cogs * inputCostShock
  const new_cogs = cogs * cogsVolumeF + cost_increase
  const new_gross_profit = new_revenue - new_cogs
  const new_ebitda = new_gross_profit - opex
  const new_net_income = new_ebitda - daTotal

  const out: Record<string, number> = {}
  const put = (k: string, v: number) => {
    if (Number.isFinite(v)) out[k] = v
  }

  // Only emit overrides when the baseline scalar(s) the value depends on are finite.
  if (Number.isFinite(revenue)) put('revenue', new_revenue)
  if (Number.isFinite(cogs)) {
    put('cogs', new_cogs)
    put('total_input_cost', new_cogs)
  }
  if (Number.isFinite(revenue) && Number.isFinite(cogs)) put('gross_profit', new_gross_profit)
  if (Number.isFinite(revenue) && Number.isFinite(cogs) && Number.isFinite(opex)) put('ebitda', new_ebitda)
  if (Number.isFinite(revenue) && Number.isFinite(cogs) && Number.isFinite(opex) && Number.isFinite(daTotal)) {
    put('net_income', new_net_income)
  }
  // FX scenario: surface the (assumed) imported cost so FX_IMPORTED_INPUT moves.
  if (fx !== 0 && importBase > 0) put('imported_input_cost', importBase * (1 + fx))
  if (typeof yieldPerHa === 'number' && Number.isFinite(yieldPerHa) && shock.yieldShock) {
    put('yield_per_ha', yieldPerHa * (1 + num(shock.yieldShock)))
  }
  return out
}

/** Parse a raw `Scenario.overrides` blob into a typed ScenarioShock (or null). */
export function readShock(overrides: unknown): ScenarioShock | null {
  if (!hasShock(overrides)) return null
  const s = (overrides as { shock: Record<string, unknown> }).shock
  const out: ScenarioShock = {}
  for (const k of SHOCK_KEYS) if (typeof s[k] === 'number' && Number.isFinite(s[k] as number)) out[k] = s[k] as number
  if (isValidTarget(s.target)) {
    out.target = { metric: s.target.metric, value: s.target.value, drives: s.target.drives }
  }
  return out
}
