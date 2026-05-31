/**
 * Phase 7.A.0 — IndicatorValue recompute pipeline.
 *
 * Flow: requiredInputs → namespace resolvers → post-processing → formula
 * engine → classifier → upsert. Built on `formula-engine.ts` and `periods.ts`
 * (both pure). Prisma access is fronted by the narrow `RecomputeDataSource`
 * interface so the runner is unit-testable without a database.
 *
 * --- Namespaces consumed from `IndicatorDefinition.requiredInputs` ---
 *   "booking" or "booking.<anything>"   Active-only Booking rows for
 *                                       company+period. Exposes context vars:
 *                                         rooms_sold, nights_sold,
 *                                         room_revenue (FX-converted to base),
 *                                         fx_revenue_share,
 *                                         source_country_hhi.
 *                                       Seed uses "booking.sourceCountry" as
 *                                       a distinct string for HOSP_SOURCE_HHI;
 *                                       both forms load the same bookings.
 *   "company.settings.<path>"           Pluck numeric top-level keys from
 *                                       Company.settings JSON; snake-case the
 *                                       name for context.
 *   "operationalFact:<metric>"          OperationalFact.value for that metric in
 *                                       period, exposed as <metric>. Multiple
 *                                       in-period facts: MEAN for additive/flow
 *                                       metrics, LATEST-by-date for snapshot/
 *                                       stock metrics (counts, %, per-ha,
 *                                       indices) — see SNAPSHOT_METRIC_RE in
 *                                       recompute-resolvers-a.ts.
 *
 * Post-processing derives `rooms_available = total_rooms × daysInPeriod` when
 * both are present (occupancy shape).
 *
 * --- Not implemented yet (indicator falls through to status="unknown") ---
 *   "currencyRate"  — Phase 7.E FX pack (CurrencyRateHistory resolver)
 *   "budgetLine"    — per-company BudgetLine aggregation (FK optional today)
 *
 * --- Error policy ---
 * Uses `tryEvaluateFormula` so one broken indicator's failure never aborts a
 * tenant batch. Failures land as:
 *   IndicatorValue {
 *     status: "unknown",
 *     value: 0,
 *     inputs: { resolved, aggregates, derived, error: { code, reason } }
 *   }
 *
 * --- Tenant scoping ---
 * Every data-source method takes `organizationId` explicitly. The Prisma
 * adapter always includes it in `where:` so a mis-labelled recompute call
 * (e.g. `organizationId=A` + `companyId` from org B) returns empty rows
 * instead of leaking cross-tenant data into the computed value.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import {
  tryEvaluateFormula,
  classifyValue,
  type FormulaContext,
  type FormulaFunction,
  type IndicatorStatus,
  type Thresholds,
} from './formula-engine';
import { parsePeriod, daysInPeriod, type Period } from './periods';
import { computeSparkline, bridgeRecomputeBuildContext } from './sparkline';
import type { ConfidenceTier } from './industry-emission-factors';


// --- Type surface (extracted to ./recompute-types.ts — Phase 8 D1 2026-05-29) ---
// The ValueSource / RecomputeDataSource / aggregate / inputs types moved to a
// sibling module to shrink this file. Imported for local use below and
// re-exported so existing `import { … } from '@/lib/risk/recompute'`
// consumers keep working unchanged.
// Local use below; the full type surface is re-exported via `export *` so
// external `import { … } from '@/lib/risk/recompute'` consumers are unaffected.
import type {
  ValueSource,
  RecomputeDataSource,
  RecomputeAggregates,
  RecomputeInputs,
} from './recompute-types';
export * from './recompute-types';

// Phase 8 D1 (2026-05-29) — toSnakeCase is still used by postProcess; the
// other pure helpers + the sub-aggregation matchers are now used only by the
// resolvers (in ./recompute-resolvers.ts), so they're no longer imported here.
import { toSnakeCase } from './recompute-helpers';

// --- Resolver subsystem (extracted to ./recompute-resolvers.ts — Phase 8 D1 2026-05-29) ---
// The 13 namespace resolvers + leaf helpers + the RESOLVERS registry + the
// resolver-infra interfaces moved to a sibling module (~1.2K LOC). The
// orchestration below (validateRequiredInputs / buildContext / postProcess /
// recomputeIndicator) imports them back; the fact:/rollup: prefixes are
// re-exported for external consumers (targets.ts).
import {
  RESOLVERS,
  FACT_INPUT_PREFIX,
  ROLLUP_INPUT_PREFIX,
} from './recompute-resolvers';
import type {
  BuildState,
  ResolverCtx,
  NamespaceResolver,
} from './recompute-resolvers';
export { FACT_INPUT_PREFIX, ROLLUP_INPUT_PREFIX };


// --- Prisma adapter (extracted to ./recompute-data-source.ts — Phase 8 D1 2026-05-29) ---
// createPrismaDataSource moved to a sibling module to shrink this file;
// re-exported so existing `import { … } from '@/lib/risk/recompute'`
// consumers (route handlers, recompute-trigger, tests) keep working.
export { createPrismaDataSource } from './recompute-data-source';


// --- Seed-load-time requiredInputs validator -------------------------------

/**
 * Phase 7.E phase 3 — strict validator for `requiredInputs` strings,
 * intended to run at seed-load time (e.g. inside `seed-indicators.ts`)
 * so a typo in a seed entry aborts the seed run with a clear error
 * message instead of silently producing a fact()→NaN at runtime.
 *
 * Per `feedback_verify_one_layer_up.md`: the resolver intentionally stays
 * lenient (skip-malformed) at runtime so a stray bad entry on one
 * indicator doesn't abort the recompute of unrelated indicators. The
 * strictness lives one layer up — at seed-author time — where a seed
 * author typo SHOULD halt the import.
 *
 * Returns `{ ok: true }` when every entry parses cleanly.
 * Returns `{ ok: false, reason }` on first malformed entry, with the
 * specific bad string + position included.
 *
 * Validates:
 *  - `fact:<CODE>@<PERIOD>` — both sides non-empty, exactly one `@`
 *    in the body (the body's lastIndexOf('@') splits — but if there's
 *    no `@` at all, that's a parse error).
 *  - `rollup:<CODE>` — code non-empty.
 *  - bare `fact` and `rollup` (no colon) are treated as no-op declarations
 *    (resolver skips them silently); validator accepts them too.
 *
 * Does NOT validate:
 *  - that the indicator CODE referenced actually exists (would require
 *    cross-seed lookup; out of scope for v1).
 *  - that the PERIOD string parses as a valid period (caller may use
 *    e.g. fiscal-year suffixes the period parser doesn't accept; defer).
 *  - non-fact/rollup namespaces (booking, company.settings, etc) — those
 *    have their own resolvers with their own implicit format.
 */
export type RequiredInputValidation =
  | { ok: true }
  | { ok: false; reason: string };

export function validateRequiredInputs(
  requiredInputs: readonly string[],
): RequiredInputValidation {
  for (let i = 0; i < requiredInputs.length; i++) {
    const r = requiredInputs[i];
    if (r.startsWith(FACT_INPUT_PREFIX)) {
      const body = r.slice(FACT_INPUT_PREFIX.length);
      if (body.length === 0) {
        return {
          ok: false,
          reason: `requiredInputs[${i}] = "${r}" — empty body after "fact:". Expected "fact:<INDICATOR_CODE>@<PERIOD>".`,
        };
      }
      const at = body.lastIndexOf('@');
      if (at < 0) {
        return {
          ok: false,
          reason: `requiredInputs[${i}] = "${r}" — missing "@" separator. Expected "fact:<INDICATOR_CODE>@<PERIOD>".`,
        };
      }
      const code = body.slice(0, at).trim();
      const period = body.slice(at + 1).trim();
      if (!code) {
        return {
          ok: false,
          reason: `requiredInputs[${i}] = "${r}" — empty INDICATOR_CODE before "@".`,
        };
      }
      if (!period) {
        return {
          ok: false,
          reason: `requiredInputs[${i}] = "${r}" — empty PERIOD after "@".`,
        };
      }
    } else if (r.startsWith(ROLLUP_INPUT_PREFIX)) {
      const code = r.slice(ROLLUP_INPUT_PREFIX.length).trim();
      if (!code) {
        return {
          ok: false,
          reason: `requiredInputs[${i}] = "${r}" — empty INDICATOR_CODE after "rollup:". Expected "rollup:<INDICATOR_CODE>".`,
        };
      }
    } else if (r.startsWith('industryFactor:')) {
      // Phase 7.H F4.v2.2 — sector intensity factor. Validates the
      // scope token is one of the three known names; typos like
      // `industryFactor:scope1` (no underscore) get caught at seed-
      // load time instead of producing silent NaN at evaluation.
      const scope = r.slice('industryFactor:'.length).trim();
      if (!scope) {
        return {
          ok: false,
          reason: `requiredInputs[${i}] = "${r}" — empty scope after "industryFactor:". Expected "industryFactor:scope_1" | "scope_2" | "scope_3".`,
        };
      }
      if (
        scope !== 'scope_1' &&
        scope !== 'scope_2' &&
        scope !== 'scope_3'
      ) {
        return {
          ok: false,
          reason: `requiredInputs[${i}] = "${r}" — unknown scope "${scope}". Expected one of: scope_1, scope_2, scope_3.`,
        };
      }
    }
    // Other namespaces (booking, company.settings, operationalFact,
    // currencyRate, budgetLine, bare "fact"/"rollup") are not validated
    // here — they have their own resolvers + tests covering shape.
  }
  return { ok: true };
}

/**
 * Sub-44 cont'd architect 💡 closure — seed-author-time validation that
 * a rollup-bearing indicator is sector-agnostic (`industries.length === 0`).
 *
 * Why: parent-co rollup targets in `recompute-trigger.ts:230` are built
 * via `parentCompanies.flatMap(p => rollupDefs.map(d => ...))` — bypassing
 * `matchCompaniesToIndicators` industry-filter because parent cos lack
 * the `industry: string` invariant. If a future seed declared
 * `requiredInputs: ['rollup:...']` with non-empty `industries:
 * ['hospitality']`, the parent pass would silently fire on ALL parent
 * cos regardless of their (non-existent) industry, violating the
 * indicator's own sector restriction.
 *
 * Strict layer-up belongs HERE — at seed-author time. The trigger has
 * a runtime defensive filter that drops + warns for the same case
 * (belt-and-braces if seed validation slipped past).
 *
 * Returns `{ ok: true }` when every entry passes.
 * Returns `{ ok: false, reason }` on the FIRST seed that fails (first-
 * failure-loud, mirrors `validateRequiredInputs` semantic).
 */
export type RollupSeedValidation =
  | { ok: true }
  | { ok: false; reason: string };

export function validateRollupSeed(seed: {
  code: string;
  industries: readonly string[];
  requiredInputs?: readonly string[] | null;
}): RollupSeedValidation {
  const inputs = seed.requiredInputs ?? [];
  const isRollup = inputs.some(
    (s) => typeof s === 'string' && s.startsWith(ROLLUP_INPUT_PREFIX),
  );
  if (!isRollup) return { ok: true };
  if (seed.industries.length > 0) {
    return {
      ok: false,
      reason:
        `Indicator '${seed.code}' is rollup-bearing (requiredInputs has '${ROLLUP_INPUT_PREFIX}...') ` +
        `but declares non-empty industries [${seed.industries.join(',')}]. ` +
        `Rollup-bearing indicators MUST be sector-agnostic (industries: []) ` +
        `because parent-co recompute targets bypass the industry-match ` +
        `filter. Either drop the industries restriction OR change the ` +
        `formula to use a per-sector composition (fact() with explicit ` +
        `period/code rather than rollup()).`,
    };
  }
  return { ok: true };
}

/**
 * Cross-namespace derivations that need multiple resolvers' output. Today
 * there's one (`rooms_available`); when this reaches ~5+, lift to a
 * `PostProcessor[]` registry with the same shape as `NamespaceResolver`.
 */
async function postProcess(
  ctx: ResolverCtx,
  state: BuildState,
): Promise<void> {
  // rooms_available = total_rooms × daysInPeriod. Derives whenever
  // total_rooms was plucked from company.settings — computing an unused
  // context var is cheap and removes the guard's semantic coupling to
  // other resolvers' output.
  if (typeof state.context.total_rooms === 'number') {
    const days = daysInPeriod(ctx.period);
    const rooms_available = state.context.total_rooms * days;
    state.context.rooms_available = rooms_available;
    state.inputs.resolved.rooms_available = rooms_available;
    state.inputs.derived.rooms_available = {
      total_rooms: state.context.total_rooms,
      days,
    };
  }
}

// --- Context builder ---------------------------------------------------------

export async function buildContext(
  ds: RecomputeDataSource,
  args: {
    organizationId: string;
    companyId: string;
    period: Period;
    requiredInputs: string[];
    /** Optional override; defaults to "AZN" — FO Holding base. */
    baseCurrency?: string;
    /**
     * Phase 7.E ad-hoc scenario preview — flat key/value overrides
     * applied to `state.context` AFTER all resolvers run. Keys must
     * match the variable names resolvers produce (e.g. `fx_usd`,
     * `fx_eur`, `news_sentiment_30d`, `revenue`, etc).
     *
     * Use case: "what if AZN/USD jumps to 2.0?" — caller passes
     * `{ fx_usd: 2.0 }` and downstream formulas see the override
     * instead of the persisted rate. Pure preview — no DB writes.
     *
     * Override values bypass resolver-level transforms; pass the
     * final per-variable value the formula should see.
     */
    scenarioOverrides?: Record<string, number>;
    /**
     * Phase 7.H F4.v2.2 — sector intensity factor lookup key. Threaded
     * from the recompute trigger (which already knows
     * `company.industry`); resolvers requiring `industryFactor:<scope>`
     * read it via ctx. Optional + null tolerant so test fixtures and
     * legacy callers compile without churn — when null, the resolver
     * surfaces NaN into the formula (status='unknown').
     */
    industry?: string | null;
    /**
     * 2026-05-31 — `IndicatorDefinition.aggregation` ("snapshot"|"flow"),
     * threaded into `ResolverCtx` so the operationalFact resolver picks
     * latest-by-date vs mean for this indicator's metric inputs. Defaults to
     * "flow" (mean) for callers/fixtures that omit it.
     */
    aggregation?: "snapshot" | "flow";
  },
): Promise<{
  context: FormulaContext;
  inputs: RecomputeInputs;
  functions: Record<string, FormulaFunction>;
}> {
  const state: BuildState = {
    context: {},
    inputs: { resolved: {}, aggregates: {}, derived: {} },
    functions: {},
  };
  const ctx: ResolverCtx = {
    ds,
    organizationId: args.organizationId,
    companyId: args.companyId,
    period: args.period,
    baseCurrency: args.baseCurrency ?? 'AZN',
    industry: args.industry ?? null,
    aggregation: args.aggregation === 'snapshot' ? 'snapshot' : 'flow',
  };

  // RESOLVERS is iterated once per recompute; each resolver sees all its
  // matching inputs in one batch, so multiple inputs in the same namespace
  // (e.g. "booking" + "booking.sourceCountry") trigger one DS read, not N.
  for (const resolver of RESOLVERS) {
    const matched = args.requiredInputs.filter((r) => resolver.matches(r));
    if (matched.length === 0) continue;
    await resolver.resolve(matched, ctx, state);
  }

  // Phase 7.E ad-hoc scenario preview — apply overrides AFTER resolvers
  // so resolver-side computations are never bypassed (e.g. revenue
  // aggregation still runs to populate aggregates for drill-down) but
  // the formula sees the overridden value. Inputs.resolved is also
  // overwritten so the audit trail shows the preview value, not the
  // baseline.
  if (args.scenarioOverrides) {
    for (const [key, value] of Object.entries(args.scenarioOverrides)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      state.context[key] = value;
      state.inputs.resolved[key] = value;
    }
  }

  await postProcess(ctx, state);

  return {
    context: state.context,
    inputs: state.inputs,
    functions: state.functions,
  };
}

// --- Runner ------------------------------------------------------------------

export interface IndicatorDefinitionLike {
  id: string;
  code?: string;
  formula: string;
  thresholds: unknown; // Prisma Json — cast at classify time
  requiredInputs: string[];
  /** "snapshot" | "flow" — controls operationalFact in-period aggregation
   *  (latest vs mean). Optional; absent → "flow". See ResolverCtx.aggregation. */
  aggregation?: string;
  /** Matches `IndicatorDefinition.unit`. When this is `"%"` the pipeline
   *  applies a plausibility cap on the computed value — ratios outside
   *  ±200% almost always indicate upstream data misclassification (e.g. a
   *  revenue line tagged as cost). Flag them as `status='unknown'` with a
   *  structured `error.code='out_of_range'` + a human-readable reason so
   *  finance users see "verify data" rather than a misleading red alert.
   *  Optional so tests / callers without the unit can skip the cap. */
  unit?: string;
  /**
   * Phase 7.E perMonth chain phase 2 — optional formula variant evaluated
   * at each of the 12 trailing months when `withSparkline=true`. When
   * absent or null, the sparkline pipeline falls back to `formula` (see
   * `sparkline.ts:103-105`). Most indicators leave this null; the override
   * exists for cases where the annual formula doesn't cleanly evaluate at
   * monthly granularity (e.g. AAC_OCC's daily-aggregate variant).
   * Optional so tests / callers without sparkline support stay green.
   */
  sparklineFormula?: string | null;
  /**
   * Phase 7.H F4.v2.1 — provenance default for IVs produced from this
   * definition. Mirrors the Prisma column `defaultValueSource`. Optional
   * so legacy callers / fixtures that don't set the field still recompute;
   * `recomputeIndicator` falls back to `'computed'` (the financial /
   * operational default) when absent.
   */
  defaultValueSource?: ValueSource;
}

/**
 * Plausibility cap for ratio-type indicators (`unit='%'`). Values outside
 * ±`RATIO_PLAUSIBILITY_CAP_PCT` are almost always upstream misclassification.
 */
export const RATIO_PLAUSIBILITY_CAP_PCT = 200;

export interface OutOfRangeClampResult {
  clamped: boolean;
  reason?: string;
}

/**
 * Returns `{ clamped: true, reason }` when `value` falls outside the cap
 * for the given `unit`. The reason is written in finance-user-readable
 * English — terminal UI is expected to surface it verbatim in the HeatMap
 * cell tooltip (and eventually in a drill-down side panel / CSV export).
 */
export function applyOutOfRangeClamp(
  value: number,
  unit: string | undefined,
  indicatorLabel: string,
): OutOfRangeClampResult {
  if (unit !== '%') return { clamped: false };
  if (Math.abs(value) <= RATIO_PLAUSIBILITY_CAP_PCT) return { clamped: false };
  return {
    clamped: true,
    reason: `Value ${value.toFixed(1)}% is outside the ±${RATIO_PLAUSIBILITY_CAP_PCT}% plausibility range for ${indicatorLabel} — likely a data-classification issue (e.g. a revenue line mis-tagged as cost). Verify the source rows before treating this as a genuine red alert.`,
  };
}

export interface RecomputeResult {
  ok: boolean;
  status: IndicatorStatus;
  value: number;
}

/**
 * Phase 7.H F4.v2.2.1 — derive a single confidence tier for the IV from
 * the per-scope catalog readings the `industryFactorResolver` left in
 * `inputs.aggregates.industry_factor`.
 *
 * Rule: take the WORST tier across non-null scopes. A composite that
 * uses Scope 1 (B) + Scope 2 (B) + Scope 3 (C) lands at C — the whole
 * is only as trustworthy as the weakest scope. Scope-3 is uniformly C
 * across the catalog (spend-based proxy), so most composite IVs end
 * up C; pure-Scope-1 IVs end up B (and A for `logistics` which has a
 * directly-measurable fleet fuel scope_1).
 *
 * Returns `null` when no scopes were resolved (formula doesn't use
 * industryFactor) — the IV is either disclosed (handled upstream) or
 * `computed`/`modeled_generic`/`macro` where confidence-tier isn't
 * meaningful.
 */
function worstConfidenceFromAggregate(
  agg: RecomputeAggregates['industry_factor'],
): ConfidenceTier | null {
  if (!agg || !agg.scopes) return null;
  // Tier ordering: A (best) > B > C > D (worst). Return the highest
  // ordinal — i.e. the most conservative.
  const order: Record<ConfidenceTier, number> = { A: 0, B: 1, C: 2, D: 3 };
  let worst: ConfidenceTier | null = null;
  for (const scope of Object.values(agg.scopes)) {
    if (!scope) continue;
    const c = scope.confidence;
    if (worst === null || order[c] > order[worst]) worst = c;
  }
  return worst;
}

export async function recomputeIndicator(
  ds: RecomputeDataSource,
  args: {
    organizationId: string;
    companyId: string;
    definition: IndicatorDefinitionLike;
    period: string;
    /**
     * Phase 7.E perMonth chain phase 2 — when true, also compute and
     * persist a 12-slot trailing-month sparkline alongside the spot value.
     *
     * Cost: +12 buildContext calls per indicator (~13× the no-sparkline
     * cost). Acceptable for single-IV / single-co interactive recomputes
     * (UI drill-down → ~91ms). Avoid on bulk-import + holding-wide refresh
     * paths — those hit `MAX_TARGETS_PER_REQUEST` ceilings or per-pair
     * fan-out into the thousands. Default `false` preserves the prior
     * pipeline behavior; the offline `scripts/compute-sparklines.ts`
     * worker remains the canonical refresher for bulk paths.
     */
    withSparkline?: boolean;
    /**
     * CXLVIII — the operating company's base currency, threaded into the
     * budgetLine resolver so BudgetLines tagged with `currencyCode ==
     * baseCurrency` are NOT treated as foreign (would otherwise be skipped
     * if no `exchangeRate` is set). Undefined falls back to 'AZN' in
     * buildContext (FO Holding default; safe for the single-tenant case).
     */
    baseCurrency?: string;
    /** Phase 7.E ad-hoc scenario preview — see `buildContext` doc. */
    scenarioOverrides?: Record<string, number>;
    /**
     * Phase 7.H F4.v2.2 — sector industry code (e.g. "agro_crops"),
     * threaded into `industryFactorResolver`. Optional + null tolerant
     * — when missing, ESG formulas that depend on `industryFactor`
     * surface NaN → `status='unknown'` rather than silently returning
     * a misleading zero.
     */
    industry?: string | null;
  },
): Promise<RecomputeResult> {
  const period = parsePeriod(args.period);

  // Phase 7.H F4.v2.3 — disclosure-first override. If the user has
  // manually entered a value for this (co, indicator, period) triple
  // via the data-entry admin, use it verbatim and skip formula
  // evaluation entirely. The stamped `valueSource: 'disclosed'`
  // overrides whatever the seed's `defaultValueSource` was — a
  // disclosed ESG cell wins over its modeled-generic formula. Only
  // honored when the definition has a `code` (anchor for the
  // disclosure lookup); legacy fixtures without `code` skip this path
  // and fall through to the formula branch.
  let disclosed: { value: number; unit: string } | null = null;
  if (args.definition.code) {
    disclosed = await ds.getIndicatorDisclosure({
      organizationId: args.organizationId,
      companyId: args.companyId,
      indicatorCode: args.definition.code,
      period: args.period,
    });
  }

  const { context, inputs, functions } = await buildContext(ds, {
    organizationId: args.organizationId,
    companyId: args.companyId,
    period,
    requiredInputs: args.definition.requiredInputs,
    baseCurrency: args.baseCurrency,
    scenarioOverrides: args.scenarioOverrides,
    industry: args.industry,
    aggregation: args.definition.aggregation === 'snapshot' ? 'snapshot' : 'flow',
  });

  // Skip formula evaluation when a disclosure overrides the value —
  // there's no point burning expr-eval cycles on a number we already
  // know. But we DO still need the resolved-inputs snapshot for
  // drilldown UI, so buildContext runs above either way.
  const result = disclosed
    ? { ok: true as const, value: disclosed.value }
    : tryEvaluateFormula(args.definition.formula, context, functions);

  let status: IndicatorStatus;
  let value: number;
  // Shallow-copy the builder's result so the sub-objects (resolved,
  // aggregates, derived) stay by-reference but the top-level error key
  // mutation here doesn't alias anything buildContext or its resolvers
  // may hold onto in the future (e.g. per-org caching).
  const finalInputs: RecomputeInputs = { ...inputs };
  if (disclosed) {
    // Annotate the audit snapshot so a drilldown viewer sees this was
    // a manual disclosure, not a formula evaluation. The
    // `disclosed.unit` lands here for after-the-fact verification.
    finalInputs.resolved = {
      ...(finalInputs.resolved ?? {}),
      disclosed_value: disclosed.value,
    };
  }

  if (result.ok) {
    value = result.value;
    const thresholds = args.definition.thresholds as Thresholds;
    status = classifyValue(value, thresholds);

    // Phase 7.L 2026-05-18 — zombie-row guard. When a formula evaluates
    // to a numeric 0 because all of its inputs were structurally empty
    // (no children to roll up, no budget lines to read), `classifyValue`
    // happily paints that 0 green/amber because raw 0 falls within
    // some threshold band. The result is HeatMap cells that look like
    // a measurement ("0% imported inputs — healthy!") when in fact
    // there's nothing being measured.
    //
    // The audit on 2026-05-18 surfaced three concrete instances:
    //   • IND_HOLDING_REVENUE on every leaf company (rollup of 0
    //     children → 0 → amber). 250 zombie rows.
    //   • IND_CARBON_SCOPE_1/2/3 on the DEMO-* sector stubs that
    //     have 0 budget lines (0 revenue × factor = 0 → green).
    //   • FX_IMPORTED_INPUT on every entity (no foreign-currency
    //     lines tagged in budget_lines → 0% imported → green).
    //
    // The guard demotes those cells to `unknown` so finance users
    // know data is missing, not "good".
    //
    // The check fires whenever the relevant aggregate signals emptiness,
    // regardless of computed value. Originally narrowed to value===0
    // but a max(0, ...) / min(100, ...) cap formula can produce 0 or
    // 100 from empty inputs (e.g. IND_ESG_COMPOSITE saturates to 100
    // when revenue=0). The guard is safe to widen because each branch
    // already checks an empty-input signal — a legitimate measurement
    // on populated inputs can't trigger it.
    {
      const formulaText = String(args.definition.formula ?? '');
      const rollupAgg = finalInputs.aggregates?.rollup as
        | { children_count?: number }
        | undefined;
      const budgetLineAgg = finalInputs.aggregates?.budget_line as
        | { line_count?: number; foreign_line_count?: number }
        | undefined;
      const bookingAgg = finalInputs.aggregates?.booking as
        | { booking_count?: number; rooms_sold?: number }
        | undefined;
      const usesRollup = formulaText.includes('rollup(');
      const usesBudget =
        /\b(revenue|cogs|opex|gross_profit|net_income|total_cost|imported_input_cost|domestic_input_cost|total_input_cost)\b/.test(
          formulaText,
        );
      // Phase 7.M Step 4 follow-up (2026-05-19) — detect the FX-shaped
      // formula. When the company has budget lines but NO foreign-tagged
      // lines, the numerator is structurally 0 (importer dropped the
      // currency column). Demote so HeatMap doesn't paint false-green.
      const usesImportedInput = /\bimported_input_cost\b/.test(formulaText);
      // Phase 7.M Step 4 follow-up — hospitality / booking-based
      // formulas (HOSP_*). When the company has no booking rows at
      // all, `rooms_sold` / `room_revenue` / `source_*` aggregates
      // resolve to 0 and any HOSP_* formula evaluates to a meaningless
      // 0 or HHI-saturated value. Demote so DEMO-HOSP and other
      // hospitality stubs without booking data don't look "healthy".
      const usesBooking =
        /\b(rooms_sold|nights_sold|room_revenue|booking_count|source_country_hhi|fx_revenue_share|rooms_available)\b/.test(
          formulaText,
        );
      const rollupEmpty =
        usesRollup && (rollupAgg?.children_count ?? 0) === 0;
      const budgetEmpty =
        usesBudget && (budgetLineAgg?.line_count ?? 0) === 0;
      // Phase 7.M Tier 4 (2026-05-19) — fxExposureSource opt-in. When
      // Company.settings.fxExposureSource === "all_domestic", the entity
      // explicitly declares zero FX exposure (e.g. AzerSheker confirmed
      // all-AZN workbook). The guard skips → formula computes 0/X * 100
      // = 0% → status='green'. Default behaviour (no setting / "tagged_lines")
      // preserves the conservative "unknown" — better safe than wrong.
      // Resolver writes settings keys in snake_case (toSnakeCase helper).
      const companySettingsAgg = finalInputs.aggregates?.company_settings as
        | { fx_exposure_source?: string }
        | undefined;
      const fxAllDomestic =
        companySettingsAgg?.fx_exposure_source === 'all_domestic';
      const fxUntagged =
        usesImportedInput &&
        !fxAllDomestic &&
        (budgetLineAgg?.line_count ?? 0) > 0 &&
        (budgetLineAgg?.foreign_line_count ?? 0) === 0;
      const bookingEmpty =
        usesBooking && (bookingAgg?.booking_count ?? 0) === 0;
      if (rollupEmpty || budgetEmpty || fxUntagged || bookingEmpty) {
        status = 'unknown';
        finalInputs.error = {
          code: rollupEmpty
            ? 'rollup_no_children'
            : budgetEmpty
              ? 'no_budget_lines'
              : fxUntagged
                ? 'no_foreign_currency_lines'
                : 'no_bookings',
          reason: rollupEmpty
            ? 'Rollup indicator on entity with no children to aggregate'
            : budgetEmpty
              ? 'Formula references budget-line aggregates but the entity has no budget lines for this period'
              : fxUntagged
                ? 'FX-share formula references imported_input_cost but no foreign-currency lines are tagged (xlsx importer dropped the currency column?)'
                : 'Hospitality formula references booking aggregates but the entity has no booking rows for this period',
        };
      }
    }

    // Plausibility cap for ratio-type indicators. Override to `unknown` so
    // a misclassified revenue row doesn't show up as a red alert on the
    // HeatMap. Raw `value` is preserved so finance users can see what was
    // computed before the clamp — the error carries the reason.
    const clamp = applyOutOfRangeClamp(
      value,
      args.definition.unit,
      args.definition.code ?? args.definition.id,
    );
    if (clamp.clamped) {
      status = 'unknown';
      finalInputs.error = {
        code: 'out_of_range',
        reason: clamp.reason ?? 'Value outside plausibility range',
      };
    }
  } else {
    value = 0;
    status = 'unknown';
    // Phase 7.M Tier 6 (2026-05-21) — when formula fails with
    // `non_finite` (typically 0/0 because budget_lines are absent for
    // this period), prefer the more-specific aggregate-empty code so
    // IndicatorHealth Dashboard categorises it correctly (Ingest gap /
    // Data not entered) rather than as a generic non-finite math error.
    //
    // Scope: only `non_finite`. `parse` / `eval` reflect formula bugs
    // and must keep their original codes so devs can spot them in the
    // dashboard.
    if (result.code === 'non_finite') {
      const formulaText = String(args.definition.formula ?? '');
      const rollupAgg = finalInputs.aggregates?.rollup as
        | { children_count?: number }
        | undefined;
      const budgetLineAgg = finalInputs.aggregates?.budget_line as
        | { line_count?: number; foreign_line_count?: number }
        | undefined;
      const bookingAgg = finalInputs.aggregates?.booking as
        | { booking_count?: number }
        | undefined;
      const usesRollup = formulaText.includes('rollup(');
      const usesBudget =
        /\b(revenue|cogs|opex|gross_profit|net_income|total_cost|imported_input_cost|domestic_input_cost|total_input_cost)\b/.test(
          formulaText,
        );
      const usesImportedInput = /\bimported_input_cost\b/.test(formulaText);
      const usesBooking =
        /\b(rooms_sold|nights_sold|room_revenue|booking_count|source_country_hhi|fx_revenue_share|rooms_available)\b/.test(
          formulaText,
        );
      const companySettingsAgg = finalInputs.aggregates?.company_settings as
        | { fx_exposure_source?: string }
        | undefined;
      const fxAllDomestic =
        companySettingsAgg?.fx_exposure_source === 'all_domestic';
      const rollupEmpty =
        usesRollup && (rollupAgg?.children_count ?? 0) === 0;
      const budgetEmpty =
        usesBudget && (budgetLineAgg?.line_count ?? 0) === 0;
      const fxUntagged =
        usesImportedInput &&
        !fxAllDomestic &&
        (budgetLineAgg?.line_count ?? 0) > 0 &&
        (budgetLineAgg?.foreign_line_count ?? 0) === 0;
      const bookingEmpty =
        usesBooking && (bookingAgg?.booking_count ?? 0) === 0;
      if (rollupEmpty) {
        finalInputs.error = {
          code: 'rollup_no_children',
          reason:
            'Rollup indicator on entity with no children to aggregate (formula returned non-finite)',
        };
      } else if (budgetEmpty) {
        finalInputs.error = {
          code: 'no_budget_lines',
          reason: `Formula references budget-line aggregates but the entity has no budget lines for period ${args.period}`,
        };
      } else if (fxUntagged) {
        finalInputs.error = {
          code: 'no_foreign_currency_lines',
          reason:
            'FX-share formula references imported_input_cost but no foreign-currency lines are tagged (xlsx importer dropped the currency column?)',
        };
      } else if (bookingEmpty) {
        finalInputs.error = {
          code: 'no_bookings',
          reason: `Hospitality formula references booking aggregates but the entity has no booking rows for period ${args.period}`,
        };
      } else {
        finalInputs.error = { code: result.code, reason: result.reason };
      }
    } else {
      finalInputs.error = { code: result.code, reason: result.reason };
    }
  }

  // Phase 7.E phase 2 — opt-in sparkline. Computed BEFORE upsert so a
  // sparkline failure (resolver-level throw) abandons the whole recompute
  // (caller's per-pair try/catch surfaces it). `null` slots inside the
  // returned array are normal — they signal a single-period evaluation
  // that failed (missing data / formula error) and must be preserved as
  // gaps in the rendered chart, NOT collapsed to zero.
  let sparkline: (number | null)[] | undefined;
  if (args.withSparkline) {
    sparkline = await computeSparkline(ds, {
      organizationId: args.organizationId,
      companyId: args.companyId,
      definition: {
        id: args.definition.id,
        formula: args.definition.formula,
        sparklineFormula: args.definition.sparklineFormula ?? null,
        requiredInputs: args.definition.requiredInputs,
        aggregation: args.definition.aggregation, // 2026-05-31 — snapshot/flow into per-month sparkline
      },
      anchorPeriod: args.period,
      // Sub-43 closure — extracted period:string→Period bridge.
      buildContext: bridgeRecomputeBuildContext(ds, buildContext),
    });
  }

  await ds.upsertIndicatorValue({
    organizationId: args.organizationId,
    companyId: args.companyId,
    indicatorId: args.definition.id,
    period: args.period,
    value,
    status,
    inputs: finalInputs,
    sparkline,
    // Phase 7.H F4.v2.1 — fall back to `computed` when the caller omits
    // the field (legacy / pre-v2.1 IndicatorDefinitionLike fixtures).
    // The matrix API + IndicatorDetail UI rely on this stamp to render
    // the provenance badge.
    //
    // Phase 7.H F4.v2.3 — a disclosed override beats the seed default.
    // When the user manually entered the value, the badge MUST show
    // "РАСКРЫТО" (teal) rather than "ОБЩАЯ ОЦЕНКА" (gray) — the whole
    // point of the data-entry flow is to upgrade provenance.
    valueSource: disclosed
      ? 'disclosed'
      : (args.definition.defaultValueSource ?? 'computed'),
    // Phase 7.H F4.v2.2.1 — model-confidence tier (A|B|C|D). Disclosed
    // cells are ground truth → no tier. Industry-modeled cells inherit
    // the WORST tier across the scopes used (a Scope 1+2+3 composite is
    // only as trustworthy as its weakest scope). When industry_factor
    // aggregate is absent (formula doesn't use industryFactor()), null.
    confidence: disclosed
      ? null
      : worstConfidenceFromAggregate(finalInputs.aggregates?.industry_factor),
  });

  return { ok: result.ok, status, value };
}
