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

// ──────────────────────────────────────────────────────────────────────
// Phase 16.6 (2026-08-06) — where the imported-input share comes from.
// ──────────────────────────────────────────────────────────────────────

/**
 * Provenance of the imported-input share used for one company's FX shock.
 *
 *   measured   — `imported_input_cost` is in the data; the share is not used
 *                at all and the scenario is not modelling anything.
 *   assumption — the company's own `import_share` driver (a company override,
 *                or the plan-level default) supplied it.
 *   catalog    — nothing company-specific existed, so the scenario
 *                definition's own literal stood in. This is the state the
 *                board narrative has to disclose.
 *   none       — no measurement, no assumption, and the scenario carries no
 *                literal either: the FX shock has no cost base to act on.
 */
export type ImportShareSource = 'measured' | 'assumption' | 'catalog' | 'none'
/** Alias — the tiers are the same for every company driver, not just the share. */
export type DriverSource = ImportShareSource

export interface DriverResolution {
  /** The value to feed the shock field. Zero and inert when `measured`. */
  value: number
  source: DriverSource
  /**
   * Set when an assumption existed but was NOT usable, so the resolution fell
   * through to the next tier. Carries the offending value so the caller can
   * name it rather than say "invalid".
   */
  rejected?: { value: number; reason: string }
}

/**
 * A budget driver that a scenario lever can read per company.
 *
 * Phase 16.7 (2026-08-06) generalised this from the import-share-only path of
 * 16.6. Adding a driver is now a registry entry plus a loader key, not a new
 * branch through the simulator — which matters because the reason `import_share`
 * was hardcoded in the first place was that wiring one felt like a project.
 */
export interface CompanyDriverSpec {
  /** `BudgetAssumption.key` to look up. */
  key: string
  /** The `ScenarioShock` field the resolved value supplies. */
  feeds: 'assumedImportShare' | 'costRigidity'
  /** Inclusive range a usable value must fall in. */
  min: number
  max: number
  /** Human-readable statement of what the range means, used in the disclosure. */
  rangeNote: string
  /** Which lever must be present for this driver to matter at all. */
  requiresLever: 'fxShock' | 'revenueShock'
}

/**
 * The drivers a scenario reads. Deliberately short.
 *
 * `inflation`, `fx_usd`, `tax_rate` and the rest of the catalogue in
 * `assumptions-parse.ts` are NOT here, and that is not an oversight: no lever
 * in `ScenarioShock` consumes them. `resolveShockOverrides` holds opex and
 * `da_total` fixed and has no tax step at all, so a `tax_rate` driver would
 * have nowhere to go, and inventing a lever in order to consume a driver is
 * building a model nobody asked for. They stay stored, resolvable and unread
 * until a scenario genuinely needs them — which the roadmap says out loud
 * rather than implying coverage this does not have.
 */
export const COMPANY_DRIVERS: readonly CompanyDriverSpec[] = [
  {
    key: 'import_share',
    feeds: 'assumedImportShare',
    min: 0,
    max: 1,
    rangeNote: 'a share of cost must be a fraction between 0 and 1',
    requiresLever: 'fxShock',
  },
  {
    // Phase 16.7 — the second holding-wide literal with the same defect as the
    // first. `crisis-catalog.ts` ships `costRigidity: 0.8` on both drought
    // scenarios, so "seeds and irrigation are already spent" is asserted of
    // every company the shock touches — including a services arm, where a
    // volume drop genuinely does scale its costs down and 0.8 crushes a margin
    // that would not have moved.
    key: 'cost_rigidity',
    feeds: 'costRigidity',
    min: 0,
    max: 1,
    rangeNote: 'rigidity is a fraction of cost that stays sunk, between 0 and 1',
    requiresLever: 'revenueShock',
  },
] as const

/**
 * Decide one company's value for one driver.
 *
 * Precedence — measured beats stated beats assumed:
 *   1. A measurement in the company's own data, when the driver has one.
 *      `import_share` does: `imported_input_cost > 0` makes the fraction
 *      irrelevant, because `resolveShockOverrides` prefers the real cost and
 *      never multiplies by a share. `cost_rigidity` has no measurement.
 *   2. The company's own assumption (a company override, else the plan default).
 *   3. The scenario definition's literal.
 *
 * ── Why an out-of-range assumption is REFUSED rather than rescaled ────────
 * A driver typed as `70` under a `%` unit means 70%, and `cogs * 70` is a
 * seventy-fold cost shock — a number so wrong it would reorder the entire
 * worst-hit ranking while looking like a finding. Dividing by 100 to "fix" it
 * is a guess, and the import parser deliberately refuses the same guess
 * (`assumptions-parse.ts` reports ambiguous percent scale instead of
 * resolving it). Consistency between the two refusals is the point: a user who
 * is told "verify the scale" on import and then watches the scenario use the
 * number anyway learns to ignore both messages.
 */
export function resolveCompanyDriver(
  spec: CompanyDriverSpec,
  input: {
    /** True when the company's own data measures this directly, making the driver inert. */
    measured?: boolean
    /** Value of the company's resolved assumption, or null. */
    assumption: number | null
    /** The scenario definition's own literal for this lever, if it carries one. */
    catalogDefault: number | undefined
  },
): DriverResolution {
  const { measured, assumption, catalogDefault } = input

  if (measured) return { value: 0, source: 'measured' }

  let rejected: DriverResolution['rejected']
  if (assumption != null && Number.isFinite(assumption)) {
    if (assumption >= spec.min && assumption <= spec.max) {
      return { value: assumption, source: 'assumption' }
    }
    // Direction-specific, because the two failures are different mistakes and
    // the reader can only act on the one they made. Above the maximum is nearly
    // always a percentage typed unscaled, and saying so is the difference
    // between a message someone fixes and one they ignore.
    rejected = {
      value: assumption,
      reason:
        assumption < spec.min
          ? `${spec.rangeNote}, and ${assumption} is below ${spec.min}`
          : `${spec.rangeNote}, and ${assumption} is above ${spec.max} — a figure like 70 means 70%, ` +
            'and the scale was not guessed',
    }
  }

  if (catalogDefault != null && Number.isFinite(catalogDefault)) {
    return { value: catalogDefault, source: 'catalog', ...(rejected ? { rejected } : {}) }
  }
  return { value: 0, source: 'none', ...(rejected ? { rejected } : {}) }
}

export interface ImportShareResolution {
  /** The fraction to feed `assumedImportShare`. Zero and inert when `measured`. */
  share: number
  source: ImportShareSource
  /** Set when an `import_share` assumption existed but was not usable as a fraction. */
  rejected?: { value: number; reason: string }
}

/**
 * Imported-input share specifically — a thin wrapper over
 * `resolveCompanyDriver` that keeps 16.6's contract and its tests as the
 * regression net for the generalisation.
 */
export function resolveImportShare(input: {
  /** `imported_input_cost` from this company's baseline scalars. */
  importedInputCost: number
  assumption: number | null
  catalogDefault: number | undefined
}): ImportShareResolution {
  const spec = COMPANY_DRIVERS.find((d) => d.key === 'import_share')!
  const r = resolveCompanyDriver(spec, {
    measured: Number.isFinite(input.importedInputCost) && input.importedInputCost > 0,
    assumption: input.assumption,
    catalogDefault: input.catalogDefault,
  })
  return { share: r.value, source: r.source, ...(r.rejected ? { rejected: r.rejected } : {}) }
}

/**
 * Per-company provenance for ONE driver across one simulation — the evidence
 * behind the board narrative's caveat.
 *
 * Named `ImportShareReport` because 16.6 shipped it under that name in the API
 * response; 16.7 generalised the contents (see `driverKey`) without renaming
 * the field a client already reads.
 */
export interface ImportShareReport {
  /** Which driver this report is about. Absent on 16.6-era payloads. */
  driverKey?: string
  /** Companies whose `imported_input_cost` is real data — nothing was assumed. */
  measured: string[]
  /** Companies that stated an `import_share` driver, with the value used. */
  fromAssumption: Array<{ companyCode: string; share: number }>
  /** Companies still standing on the scenario definition's literal. */
  fromCatalogDefault: string[]
  /** Companies with no measurement, no assumption and no literal to fall back on. */
  unresolved: string[]
  /** Assumptions that existed but were not usable as a fraction — reported, never rescaled. */
  rejected: Array<{ companyCode: string; value: number; reason: string }>
  /** The scenario definition's own literal, for the narrative to cite. */
  catalogDefault: number | null
}

const pct = (v: number): number => Math.round(v * 100)

/**
 * How many company codes the note names before it summarises the rest.
 *
 * The note goes into an LLM prompt on every FX narrative, and a holding of ~60
 * companies would otherwise list all of them each time. The cap is NOT silent:
 * the elided count is stated, because a reader who cannot see "and 47 others"
 * would take the listed dozen for the whole picture.
 */
const MAX_NAMED_COMPANIES = 12

function nameList(codes: string[]): string {
  if (codes.length <= MAX_NAMED_COMPANIES) return codes.join(', ')
  const shown = codes.slice(0, MAX_NAMED_COMPANIES)
  return `${shown.join(', ')} and ${codes.length - MAX_NAMED_COMPANIES} others`
}

/**
 * The FX modelling caveat, stated at the precision the data now supports.
 *
 * Until 16.6 this was one sentence asserting a single literal for the whole
 * holding: "Assumes 30% imported-input share (current data has no tagged
 * imported costs)." That was true of the model and misleading about the
 * finding — it read as one modelling choice rather than as sixty companies
 * sharing one coefficient.
 *
 * The rule here is that the sentence must never claim more grounding than
 * exists. Companies that STATED a share are named as stated; companies still
 * on the literal are counted, not hidden; and a rejected assumption is
 * surfaced with its value, because "we ignored the number you typed" is
 * something the reader has to be told.
 *
 * Returns `null` when there is nothing to disclose — every company measured.
 */
const DRIVER_LABEL: Record<string, string> = {
  import_share: 'Imported-input share',
  cost_rigidity: 'Sunk-cost share',
}

export function buildImportShareNote(report: ImportShareReport | null): string | null {
  if (!report) return null
  const { fromAssumption, fromCatalogDefault, unresolved, rejected, catalogDefault } = report
  const label = DRIVER_LABEL[report.driverKey ?? 'import_share'] ?? report.driverKey ?? 'Driver'

  const parts: string[] = []

  if (fromAssumption.length > 0) {
    const shares = fromAssumption.map((f) => `${f.companyCode} ${pct(f.share)}%`)
    parts.push(
      `${label} stated for ${fromAssumption.length} ` +
        `${fromAssumption.length === 1 ? 'company' : 'companies'} (${nameList(shares)}).`,
    )
  }

  if (fromCatalogDefault.length > 0) {
    const share = catalogDefault == null ? null : pct(catalogDefault)
    parts.push(
      `${fromCatalogDefault.length} ${fromCatalogDefault.length === 1 ? 'company has' : 'companies have'} ` +
        `no stated share, so the scenario's ${share == null ? 'own' : `${share}%`} default was used for ` +
        `${fromCatalogDefault.length === 1 ? 'it' : 'them'} — that figure is a modelling choice, not this business's data.`,
    )
  }

  if (unresolved.length > 0) {
    parts.push(
      `${unresolved.length} ${unresolved.length === 1 ? 'company' : 'companies'} had no measured value, ` +
        'no stated share and no default, so the shock did not reach ' +
        `${unresolved.length === 1 ? 'its' : 'their'} cost base at all.`,
    )
  }

  // Rejections are listed individually rather than counted: each names a number
  // a person typed and the model then declined to use, which is not something a
  // summary count can convey. Capped like the rest, with the remainder stated.
  for (const r of rejected.slice(0, MAX_NAMED_COMPANIES)) {
    parts.push(
      `${r.companyCode}'s stated share of ${r.value} was not used — ${r.reason}; ` +
        'the value was left as written rather than rescaled.',
    )
  }
  if (rejected.length > MAX_NAMED_COMPANIES) {
    parts.push(`${rejected.length - MAX_NAMED_COMPANIES} further stated shares were unusable in the same way.`)
  }

  if (parts.length === 0) return null
  return parts.join(' ')
}

/**
 * One caveat covering every driver the simulation had to assume.
 *
 * Joined rather than nested so the narrative prompt receives prose, and
 * ordered by the registry so the same scenario produces the same sentence
 * every run.
 */
export function buildDriverNote(
  reports: readonly (ImportShareReport | null)[] | null | undefined,
): string | null {
  // Tolerant of a missing list on purpose. This builds a CAVEAT; a simulation
  // that produced real numbers must not fail its whole response because the
  // sentence describing its assumptions could not be assembled. The absent
  // case is silence, which is also what an all-measured run returns.
  if (!Array.isArray(reports)) return null
  const parts = reports.map(buildImportShareNote).filter((p): p is string => Boolean(p))
  return parts.length === 0 ? null : parts.join(' ')
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
