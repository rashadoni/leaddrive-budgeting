/**
 * Recompute namespace resolvers — group B (financial-statement + composite).
 * Extracted from recompute-resolvers.ts (Phase 8 D1 2026-05-29): budgetLine,
 * fact, rollup, industryFactor, counterpartyHhi, balanceSheet (+ the fact:/
 * rollup: input prefixes and leaf helpers). The barrel assembles these into
 * the RESOLVERS registry and re-exports the two prefixes for targets.ts.
 */
import { tryEvaluateFormula, type FormulaFunction } from './formula-engine';
import type { Period } from './periods';
import {
  activePnlMonths,
  aggregatePnlLines,
  isForeignCurrencyLine,
  isValidExchangeRate,
} from './pnl-aggregation';
import {
  getIndustryEmissionFactor,
  type EmissionScope,
  type ConfidenceTier,
} from './industry-emission-factors';
import {
  SUB_AGGREGATION_MATCHERS,
  applyBudgetLineSubMatcher,
} from './recompute-sub-aggregation';
import type { BudgetLineSubAggregation } from './recompute-types';
import type { NamespaceResolver } from './recompute-resolver-types';

export const budgetLineResolver: NamespaceResolver = {
  name: 'budgetLine',
  // Match the bare namespace AND any `budgetLine.<sub>` requirement so
  // sub-aggregations land in the same DB read as the P&L roll-up.
  matches: (r) => r === 'budgetLine' || r.startsWith('budgetLine.'),
  async resolve(matched, ctx, state) {
    const lines = await ctx.ds.listBudgetLines({
      organizationId: ctx.organizationId,
      companyId: ctx.companyId,
      period: ctx.period,
    });

    // P&L aggregation lives in the shared pure `aggregatePnlLines` so the
    // period-fact deriver (terminal-PnL/budget decoupling) produces
    // bit-perfect-identical numbers. Behavior is unchanged from the former
    // inline loop. `baseCcy` is kept for the foreign-line-count guard below.
    const baseCcy = ctx.baseCurrency;
    const {
      revenue,
      cogs,
      opex,
      below_ebitda,
      imported_cogs,
      domestic_cogs,
      imported_opex,
      domestic_opex,
      da_total,
      missing_rate_count,
      total_cost,
      total_input_cost,
      imported_input_cost,
      domestic_input_cost,
      gross_profit,
      net_income,
    } = aggregatePnlLines(lines, baseCcy);
    // EBITDA: prefer the source's OWN EBITDA subtotal, captured as `pl_ebitda`
    // operational_facts (SUMMED over the period = flow semantics, like the P&L
    // leaves). 2026-05-31 audit: PLF-format AzerSheker has no SAP D&A codes
    // (da_total=0) AND its `expense` lineType lumps D&A + interest + tax, so
    // a naive net-income-based fallback collapses to NET — IND_EBITDA_MARGIN was showing
    // net margin (CPC 4.55% vs the source's 9.29%). When no captured pl_ebitda
    // exists, fall back to the EBIT + D&A-add-back derivation.
    let capturedEbitda: number | null = null;
    let ebitdaBasisMismatchReason: string | null = null;
    if (ctx.ds.listOperationalFacts) {
      const ebRows = await ctx.ds.listOperationalFacts({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        metric: 'pl_ebitda',
        start: ctx.period.start,
        end: ctx.period.end,
      });
      // Only trust the source's captured EBITDA subtotal when it is denominated
      // in the company's BASE currency. capture-plf-ebitda stores the value
      // verbatim from the workbook cell with a hardcoded `unit`, while `revenue`
      // (the IND_EBITDA_MARGIN denominator) is FX-normalized to base by
      // aggregatePnlLines. For a non-base-currency entity, dividing a raw-source-
      // currency EBITDA by FX-converted revenue yields a wrong margin. On a
      // currency mismatch, ignore the captured value and fall back to the
      // FX-normalized operating-result + D&A derivation (already in base ccy).
      // `unit` absent (legacy facts) → trust, preserving prior all-AZN behaviour.
      const allBaseCcy = ebRows.every((r) => (r.unit ?? baseCcy) === baseCcy);
      if (ebRows.length > 0 && allBaseCcy) {
        const pnlCoverage = activePnlMonths(lines, baseCcy);
        const factMonths = ebRows.map((r) => r.date.getUTCMonth());
        const uniqueFactMonths = [...new Set(factMonths)].sort((a, b) => a - b);
        const duplicateFactMonthCount = factMonths.length - uniqueFactMonths.length;
        const sameMonths =
          pnlCoverage.months.length === uniqueFactMonths.length &&
          pnlCoverage.months.every((month, i) => month === uniqueFactMonths[i]);
        const basisAligned =
          pnlCoverage.unattributedLineCount === 0 &&
          pnlCoverage.months.length > 0 &&
          duplicateFactMonthCount === 0 &&
          sameMonths;

        if (basisAligned) {
          capturedEbitda = ebRows.reduce((s, r) => s + r.value, 0);
        } else {
          // Fail closed: never divide a full-year/source subtotal by a partial
          // actual/YTD denominator. Keep the derived same-row EBITDA in context
          // for drill-down, while recomputeIndicator demotes formulas that use
          // it to unknown with this explicit reason.
          const reasonParts: string[] = [];
          if (pnlCoverage.unattributedLineCount > 0) {
            reasonParts.push(`${pnlCoverage.unattributedLineCount} P&L rows lack a month index`);
          }
          if (duplicateFactMonthCount > 0) {
            reasonParts.push(`${duplicateFactMonthCount} duplicate EBITDA month rows`);
          }
          if (!sameMonths) {
            reasonParts.push(
              `P&L months [${pnlCoverage.months.map((m) => m + 1).join(',')}] do not match EBITDA months [${uniqueFactMonths.map((m) => m + 1).join(',')}]`,
            );
          }
          ebitdaBasisMismatchReason =
            `Captured EBITDA was not used because its period basis is not demonstrably aligned with the P&L denominator: ${reasonParts.join('; ')}`;
        }
      }
    }
    // Derived EBITDA is an operating result. Below-EBITDA finance/tax rows
    // belong in net_income but must never reduce this fallback numerator.
    const derivedEbitda = revenue - cogs - opex + da_total;
    const ebitda = capturedEbitda ?? derivedEbitda;

    state.context.revenue = revenue;
    state.context.cogs = cogs;
    state.context.opex = opex;
    state.context.below_ebitda = below_ebitda;
    state.context.total_cost = total_cost;
    state.context.total_input_cost = total_input_cost;
    state.context.imported_input_cost = imported_input_cost;
    state.context.domestic_input_cost = domestic_input_cost;
    state.context.gross_profit = gross_profit;
    state.context.net_income = net_income;
    state.context.ebitda = ebitda;
    state.context.da_total = da_total;

    state.inputs.resolved.revenue = revenue;
    state.inputs.resolved.cogs = cogs;
    state.inputs.resolved.opex = opex;
    state.inputs.resolved.below_ebitda = below_ebitda;
    state.inputs.resolved.total_cost = total_cost;
    state.inputs.resolved.total_input_cost = total_input_cost;
    state.inputs.resolved.imported_input_cost = imported_input_cost;
    state.inputs.resolved.domestic_input_cost = domestic_input_cost;
    state.inputs.resolved.gross_profit = gross_profit;
    state.inputs.resolved.net_income = net_income;
    state.inputs.resolved.ebitda = ebitda;
    state.inputs.resolved.da_total = da_total;

    // Count foreign lines only when their source amount and conversion
    // evidence are both present. The FX-share guard must never mistake a
    // base amount merely tagged "USD" for evidenced source exposure.
    // This lets the zombie-row guard distinguish "this
    // company is genuinely 100% domestic" from "the importer didn't
    // populate currencyCode on any line, so imported_* defaulted to 0".
    // Without the count, FX_IMPORTED_INPUT cells everywhere read as
    // false-green ("0% imported — healthy!") on holdings whose xlsx
    // import dropped the currency column.
    const foreign_line_count = lines.filter(
      (l) =>
        isForeignCurrencyLine(l, baseCcy) &&
        isValidExchangeRate(l.exchangeRate) &&
        typeof l.originalAmount === 'number' &&
        Number.isFinite(l.originalAmount),
    ).length;

    state.inputs.aggregates.budget_line = {
      line_count: lines.length,
      foreign_line_count,
      revenue,
      cogs,
      opex,
      below_ebitda,
      imported_total_cost: imported_cogs + imported_opex,
      domestic_total_cost: domestic_cogs + domestic_opex,
      missing_rate_count,
      ...(ebitdaBasisMismatchReason
        ? { ebitda_basis_mismatch: { reason: ebitdaBasisMismatchReason } }
        : {}),
    };

    // --- Sub-aggregations (`budgetLine.<sub>`) ----------------------------
    // Each requested sub becomes a context var with the same name. We run
    // the matching pass over the same `lines` array — one DB read total.
    // Lines that were skipped above (foreign without a finite positive rate)
    // are also skipped here for consistency. `plannedAmount` is already
    // base/reporting currency and must never be multiplied on read.
    const validLines = lines
      .filter((l) =>
        !isForeignCurrencyLine(l, baseCcy) || isValidExchangeRate(l.exchangeRate),
      )
      .map((l) => ({
        line: l,
        amountBase: l.plannedAmount,
      }));
    const subs = matched
      .filter((m) => m.startsWith('budgetLine.'))
      .map((m) => m.slice('budgetLine.'.length));
    if (subs.length > 0) {
      const subAggregations: Record<string, BudgetLineSubAggregation> = {};
      for (const sub of subs) {
        const matcher = SUB_AGGREGATION_MATCHERS[sub];
        if (!matcher) {
          // Unknown sub key — surface as zero+empty rather than silent skip.
          // Indicator will fall to `unknown` because `<sub>` is missing
          // from context, with a clean reason from the formula engine.
          subAggregations[sub] = {
            value: 0,
            matched_count: 0,
            top_lines: [],
            matched_by: [],
          };
          continue;
        }
        const result = applyBudgetLineSubMatcher(matcher, validLines);
        if (result.matched_count > 0) {
          state.context[sub] = result.value;
          state.inputs.resolved[sub] = result.value;
        }
        subAggregations[sub] = result;
      }
      state.inputs.aggregates.budget_line.sub_aggregations = subAggregations;
    }
  },
};


// ─── Phase 7.E phase 3 — namespace-resolver canonical prefixes ───────────
// Sub-44 prereq-#1 architect closure (carried into prereq #2 commit). The
// `fact:` and `rollup:` prefix strings were hardcoded at 8+ sites across
// `recompute.ts` (resolver `matches`, body slices, validator) AND
// `targets.ts` (rollup-bearing predicate). A future rename or v2
// extension (e.g. `rollup:<CODE>:<AGG>` per the comment at the rollup
// resolver below) would require touching every site with no compile-
// time guard. Centralizing here gives:
//
//   1. Single source of truth — typo on import is a TS error.
//   2. Future v2 prefix extension migrates by editing one constant.
//   3. Cross-module discoverability — `targets.ts:isRollupIndicator`
//      and the validator both reach the SAME constant.
//
// Intentionally NOT exported as `const enum` — would inline the value
// at compile time, defeating the single-source goal during dev hot-
// reload. Plain `const` ensures every importer reads the same string
// at runtime.
export const FACT_INPUT_PREFIX = 'fact:';
export const ROLLUP_INPUT_PREFIX = 'rollup:';

/**
 * Phase 7.E phase 3 — `fact(code, period)` formula function.
 *
 * Reads the persisted spot value of `IndicatorValue` for the SAME company
 * at a different period, enabling cross-period composites like
 * year-over-year deltas, prior-quarter comparisons, etc.
 *
 * Pre-fetch model: every (code, period) pair the formula will touch must
 * be declared in `IndicatorDefinition.requiredInputs` as
 * `fact:CODE@PERIOD` — the resolver fans out the reads in parallel,
 * stuffs them into a Map, then exposes a synchronous `fact()` closure
 * for the formula engine. Required because expr-eval is sync; can't
 * await DB calls inside `expr.evaluate()`.
 *
 * Required-input format: `fact:<INDICATOR_CODE>@<PERIOD>`
 *   - `<INDICATOR_CODE>` mirrors `IndicatorDefinition.code` (e.g.
 *     `IND_NET_MARGIN`).
 *   - `<PERIOD>` is the period string the recompute pipeline uses
 *     elsewhere (`"2025"`, `"2026-Q2"`, `"2026-04"`). NOT the relative
 *     "prev_year" syntax — keep it explicit so seed authors can't mis-
 *     compute the period at indicator level (the same indicator at
 *     monthly granularity vs annual would resolve "prev_year" to
 *     different values and that's confusing).
 *
 * Lenient parsing: malformed `requiredInputs` entries (missing `@`,
 * empty code, empty period) are silently skipped. The formula will see
 * `fact()` return NaN for those keys → propagates to formula failure
 * → IV status='unknown'. We could throw at parse time but that aborts
 * the entire indicator over a typo; soft-fail is friendlier.
 *
 * Missing IV: returns null in the read map. The exposed `fact()` closure
 * maps null → NaN so the formula propagates the missing-input failure
 * naturally. The aggregate snapshot keeps null (drill-down sees the gap).
 *
 * Cost: Phase 7.G Turn XLI batched the resolver into a single
 * `getIndicatorValues` call (one `findMany` with OR clause) instead of
 * N concurrent `findFirst`s. Phase F scale (~1500 reads) → ~60 batched
 * queries (one per recompute target). Original v1 cost note preserved
 * in git history.
 */
export const factResolver: NamespaceResolver = {
  name: 'fact',
  matches: (r) => r === 'fact' || r.startsWith(FACT_INPUT_PREFIX),
  async resolve(matched, ctx, state) {
    interface ParsedFactKey {
      raw: string;
      code: string;
      period: string;
      key: string; // canonical `${code}@${period}`
    }
    const parsed: ParsedFactKey[] = [];
    for (const raw of matched) {
      // Strip `fact:` prefix; bare `fact` (no colon) is a no-op declaration —
      // the seed author wanted the function in scope without pre-fetching
      // any specific (code, period). The function still resolves but every
      // call returns NaN (no entries pre-fetched).
      if (raw === 'fact') continue;
      const body = raw.slice(FACT_INPUT_PREFIX.length);
      const at = body.lastIndexOf('@');
      if (at < 0) continue; // malformed: no @; skip
      const code = body.slice(0, at).trim();
      const period = body.slice(at + 1).trim();
      if (!code || !period) continue; // malformed: empty side
      parsed.push({ raw, code, period, key: `${code}@${period}` });
    }
    // De-dupe by canonical key — multiple requiredInputs entries that resolve
    // to the same (code, period) trigger one Prisma read, not N.
    const seen = new Set<string>();
    const unique: ParsedFactKey[] = [];
    for (const p of parsed) {
      if (seen.has(p.key)) continue;
      seen.add(p.key);
      unique.push(p);
    }

    // Phase 7.G Turn XLI (Phase C): batched read replaces the per-pair
    // Promise.all that was sending N concurrent findFirst queries. At
    // Phase F scale (60 cos × 9 indicators × 2-3 fact reads each) this
    // collapses ~1500 queries to ~60. Empty `unique` short-circuits to
    // `{}` without hitting the DB.
    const reads: Record<string, number | null> =
      unique.length > 0
        ? await ctx.ds.getIndicatorValues({
            organizationId: ctx.organizationId,
            companyId: ctx.companyId,
            pairs: unique.map((p) => ({
              indicatorCode: p.code,
              period: p.period,
            })),
          })
        : {};

    let hitCount = 0;
    for (const v of Object.values(reads)) if (v !== null) hitCount++;

    state.inputs.aggregates.fact = {
      read_count: unique.length,
      hit_count: hitCount,
      reads,
    };

    // Re-entry guard (sub-41 architect Round-1 closure): resolvers are
    // invoked once per buildContext today, but a future refactor that
    // segments the call (e.g. partial recompute) would silently overwrite
    // the closure's `reads` snapshot. Throw loudly so the regression
    // surfaces at the regression site, not as a stale-cache mystery
    // downstream.
    if (state.functions.fact) {
      throw new Error(
        'factResolver re-entry: state.functions.fact already set. ' +
        'buildContext must invoke each resolver at most once per call.',
      );
    }
    // Synchronous closure exposed to the formula engine. Captures `reads`
    // by reference, but the resolver has finished populating it before
    // the engine runs (resolvers are awaited; eval comes after).
    state.functions.fact = (code: FormulaFunctionArgLike, period: FormulaFunctionArgLike) => {
      const key = `${String(code)}@${String(period)}`;
      const value = reads[key];
      if (value == null) return Number.NaN;
      return value;
    };
  },
};

/**
 * Phase 7.E phase 3 — `rollup(code)` formula function.
 *
 * Sums the persisted spot value of `IndicatorValue` for `<code>` across
 * the current company's DIRECT children at the same period. Use case:
 * holding-level composites where the parent's metric is the sum of its
 * sub-companies (e.g. holding-wide revenue = sum of per-sub-co revenue).
 *
 * Required-input format: `rollup:<INDICATOR_CODE>`
 *   - Period is implicit (= current recompute period). Cross-period
 *     rollup composites can be expressed as `fact(rollup_code, period)`
 *     IF the rollup IV is itself persisted (separate seed entry). v1 of
 *     phase 3 doesn't auto-persist rollup outputs.
 *
 * Empty children: returns 0 (empty sum). Formula author can guard with
 * a ternary if 0 would be misleading: `rollup("X") > 0 ? rollup("X") : NaN`.
 *
 * Aggregation: today only sum. Avg / min / max / hhi can be added by
 * extending the format to `rollup:<CODE>:<AGG>` in v2; not done now to
 * keep the v1 surface minimal.
 *
 * Missing child IV: skipped from the sum (treated as 0 contribution).
 * Symmetric with `fact()`'s null-as-NaN-propagation, but the nature of
 * sum-aggregation is to ignore missing terms — explicit NaN propagation
 * here would reject the entire rollup over one missing child, which is
 * a worse default for holding-level reporting.
 *
 * Cost: 1 children-list query + 1 IV read per (child × code) pair.
 * Symmetric with `fact()` — at Phase F scale O(children × codes) reads
 * per recompute. Same v2 batched-IN optimization applies.
 */
export const rollupResolver: NamespaceResolver = {
  name: 'rollup',
  matches: (r) => r === 'rollup' || r.startsWith(ROLLUP_INPUT_PREFIX),
  async resolve(matched, ctx, state) {
    const codes: string[] = [];
    for (const raw of matched) {
      if (raw === 'rollup') continue;
      const code = raw.slice(ROLLUP_INPUT_PREFIX.length).trim();
      if (!code) continue;
      codes.push(code);
    }
    const uniqueCodes = Array.from(new Set(codes));

    const childIds = await ctx.ds.listChildCompanyIds({
      organizationId: ctx.organizationId,
      parentId: ctx.companyId,
    });

    const sums: Record<string, { sum: number; matched_count: number }> = {};
    // Pre-seed every requested code with a zero entry so the snapshot
    // always lists them — even when childIds is empty or no IV reads
    // happen. Saves consumers from a "code missing from sums map vs sum
    // is zero" ambiguity.
    for (const code of uniqueCodes) sums[code] = { sum: 0, matched_count: 0 };

    if (uniqueCodes.length > 0 && childIds.length > 0) {
      const periodStr = ctx.period.raw;
      // Fan out: every (code × child) pair fetched in parallel.
      const tasks: Array<{ code: string; promise: Promise<number | null> }> = [];
      for (const code of uniqueCodes) {
        for (const childId of childIds) {
          tasks.push({
            code,
            promise: ctx.ds.getIndicatorValue({
              organizationId: ctx.organizationId,
              companyId: childId,
              indicatorCode: code,
              period: periodStr,
            }),
          });
        }
      }
      const results = await Promise.all(tasks.map((t) => t.promise));
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const v = results[i];
        if (v == null) continue;
        sums[t.code].sum += v;
        sums[t.code].matched_count += 1;
      }
    }

    state.inputs.aggregates.rollup = {
      children_count: childIds.length,
      sums,
    };

    // Re-entry guard (sub-41 architect Round-1 closure) — symmetric with
    // factResolver above.
    if (state.functions.rollup) {
      throw new Error(
        'rollupResolver re-entry: state.functions.rollup already set. ' +
        'buildContext must invoke each resolver at most once per call.',
      );
    }
    state.functions.rollup = (code: FormulaFunctionArgLike) => {
      const entry = sums[String(code)];
      if (!entry) return Number.NaN;
      return entry.sum;
    };
  },
};

/**
 * Local alias matching `formula-engine.ts`'s `FormulaFunctionArg` (number |
 * string). Re-stated here so the resolver bodies don't need the full type
 * import at use sites — readability over micro-DRY. The real type is the
 * one above (imported as FormulaFunction signature); callers cast at call
 * site since expr-eval passes arguments dynamically.
 */
type FormulaFunctionArgLike = number | string;

/**
 * Phase 7.H F4.v2.2 — `industryFactor(scope)` formula function.
 *
 * Looks up the kg CO₂e per AZN coefficient for the current company's
 * industry × scope. Powers the v2.2 ESG formulas:
 *   `revenue * industryFactor("scope_1") / 1000  // → tonnes CO₂e`
 *
 * Required-input format: `industryFactor:<scope>` where scope ∈
 * `{scope_1, scope_2, scope_3}`. Bare `industryFactor` (no colon)
 * declares the function in scope without committing to a specific
 * scope — useful when a seed builds the scope arg dynamically.
 *
 * Returns:
 *  - factor (kg/AZN) when company.industry has a catalog row
 *  - NaN when industry is null OR not catalogued — this propagates
 *    via `tryEvaluateFormula` to `status='unknown'`, which is the
 *    fail-loud semantic. Silently returning 0 would render a green
 *    «zero emissions» cell for an un-catalogued company.
 *
 * Also stamps `state.inputs.aggregates.industry_factor` with the
 * resolved (industry, scope) → factor map so the drilldown UI can
 * surface "Source: industry intensity for [industry], confidence B"
 * alongside the value.
 */
export const industryFactorResolver: NamespaceResolver = {
  name: 'industryFactor',
  matches: (r) => r === 'industryFactor' || r.startsWith('industryFactor:'),
  async resolve(matched, ctx, state) {
    // Pre-resolve every scope mentioned in requiredInputs so the
    // synchronous formula function below doesn't need to do an
    // additional lookup per call. The catalog is in-memory + cheap so
    // this is essentially free, but keeps the function pure-sync
    // (expr-eval requires sync functions).
    const resolved: Record<
      string,
      { factor: number; confidence: ConfidenceTier; note: string } | null
    > = {};
    for (const raw of matched) {
      if (raw === 'industryFactor') continue;
      const scope = raw.slice('industryFactor:'.length) as EmissionScope;
      const lookup = getIndustryEmissionFactor(ctx.industry, scope);
      resolved[scope] = lookup;
    }

    state.inputs.aggregates.industry_factor = {
      industry: ctx.industry ?? null,
      scopes: Object.fromEntries(
        Object.entries(resolved).map(([scope, v]) => [
          scope,
          v ? { factor: v.factor, confidence: v.confidence } : null,
        ]),
      ),
    };

    if (state.functions.industryFactor) {
      throw new Error(
        'industryFactorResolver re-entry: state.functions.industryFactor already set. ' +
          'buildContext must invoke each resolver at most once per call.',
      );
    }
    state.functions.industryFactor = (scope: FormulaFunctionArgLike) => {
      const key = String(scope) as EmissionScope;
      const r = resolved[key];
      if (!r) {
        // Allow late lookup for callers that didn't pre-declare the
        // exact scope in requiredInputs (e.g. defensive seed author
        // who only listed `industryFactor`). Falls back to the live
        // catalog read for the company's industry; NaN when missing.
        const live = getIndustryEmissionFactor(ctx.industry, key);
        return live ? live.factor : Number.NaN;
      }
      return r.factor;
    };
  },
};

// Phase 7.J — counterparty HHI resolver. Reads the Counterparty
// register for a company/role/period and computes
// HHI = Σ(sharePct/100)² for use in CUSTOMER_HHI / SUPPLIER_HHI
// indicators. The requiredInputs key shape is
// `counterparty:<role>` (no period — period derives from
// IndicatorValue.period; default 2026).
export const counterpartyHhiResolver: NamespaceResolver = {
  name: 'counterparty.hhi',
  matches: (r) => r.startsWith('counterparty:'),
  async resolve(matched, ctx, state) {
    // Stub adapters don't implement listCounterparties — quietly skip
    // so the formula evaluates to NaN → IV status='unknown' (the right
    // honest answer when the register isn't wired yet).
    if (!ctx.ds.listCounterparties) return;
    // Counterparty register is annual; key off the year only.
    const period = String(ctx.period.year);
    for (const raw of matched) {
      const role = raw.slice('counterparty:'.length);
      if (role !== 'customer' && role !== 'supplier') continue;
      const rows = await ctx.ds.listCounterparties({
        organizationId: ctx.organizationId,
        companyId: ctx.companyId,
        role,
        period,
      });
      if (rows.length === 0) continue;
      const hhi = rows.reduce((s, r) => s + (r.sharePct / 100) ** 2, 0);
      const rounded = Math.round(hhi * 10000) / 10000;
      // Two context keys: the colon-namespaced one (matches the
      // resolver match prefix) + a flat alias so seeds can reference
      // `counterparty_hhi_customer` without colon-handling.
      state.context[`counterparty_hhi:${role}`] = rounded;
      state.context[`counterparty_hhi_${role}`] = rounded;
      state.inputs.resolved[`counterparty_hhi_${role}`] = rounded;

      // 2026-05-27 — also expose the max share (top counterparty's %
      // of revenue/spend) and the top-3 cumulative share for direct
      // indicators that complement HHI. Single concentration metrics
      // are easier to communicate to non-analyst CFOs than HHI.
      const sortedShares = rows
        .map((r) => r.sharePct)
        .sort((a, b) => b - a);
      const topShare = sortedShares[0] ?? 0;
      const top3Share = sortedShares.slice(0, 3).reduce((s, x) => s + x, 0);
      state.context[`top_counterparty_share_${role}`] = topShare;
      state.context[`top3_counterparty_share_${role}`] = top3Share;
      state.inputs.resolved[`top_counterparty_share_${role}`] = topShare;
      state.inputs.resolved[`top3_counterparty_share_${role}`] = top3Share;
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Phase 7.O (2026-05-24) — Balance-sheet line resolver.
//
// Handles the `balanceSheetLine.*` namespace. Currently supports one
// sub-aggregation: `inventory` — sums current-asset rows whose name or
// code matches inventory heuristics.
//
// Used by:
//   • PHARMA_INVENTORY_DAYS  (requiredInputs: ["balanceSheetLine.inventory"])
//   • FP_INVENTORY_TURNS     (requiredInputs: ["balanceSheetLine.inventory"])
//   • RETAIL_INVENTORY_TURNS (requiredInputs: ["balanceSheetLine.inventory"])
//
// Cost: 1 DB query per recompute (when the resolver fires). Degrades
// gracefully when listBalanceSheetLines is absent from the data source
// (legacy fixtures) or when companyId is not set on the BS rows
// (pre-Phase-7.O imports).
// ─────────────────────────────────────────────────────────────────────────────

/** Inventory detection for BalanceSheetLine rows.
 *
 * Inventory lives under current assets (subType='current', BS.01.02.*).
 * Within current assets we distinguish inventory from receivables / cash / prepayments
 * via name keywords covering English + Russian + Azerbaijani finance vocabulary.
 *
 * No code-pattern matching — CoA numbering varies by company and CoA version.
 * Names are the only reliable discriminator across schemas.
 */
// Exported (additive — no logic change) so the manual financial-entry route
// (`/api/budgeting/financial-variable`) can reuse the SAME inventory-name
// heuristic to detect an existing inventory line under a different CoA before a
// manual write, preventing a silent double-count. Single source of truth.
export function bsIsInventoryLine(_accountCode: string, accountName: string): boolean {
  const name = accountName.toLowerCase();
  return (
    name.includes('inventory') ||
    name.includes('ehtiyat') ||   // AZ: reserve / stock
    name.includes('xammal') ||    // AZ: raw material
    name.includes('yarım') ||     // AZ: work-in-progress (yarımfabrikat)
    name.includes('hazır mal') || // AZ: finished goods
    name.includes('hazır məhsul') || // AZ: finished product
    name.includes('mallar') ||    // AZ: goods
    name.includes('запас') ||     // RU: stock / inventory
    name.includes('материал') ||  // RU: material
    name.includes('незаверш') ||  // RU: work-in-progress (незавершенное)
    name.includes('готовая') ||   // RU: finished goods (готовая продукция)
    name.includes('stock') ||
    name.includes('raw material') ||
    name.includes('товар')        // RU: goods / merchandise
  );
}

export const balanceSheetLineResolver: NamespaceResolver = {
  name: 'balanceSheetLine',
  matches: (r) => r === 'balanceSheetLine' || r.startsWith('balanceSheetLine.'),
  async resolve(matched, ctx, state) {
    // Degrade gracefully when the data source doesn't implement
    // listBalanceSheetLines (legacy fixtures, pre-Phase-7.O envs).
    if (!ctx.ds.listBalanceSheetLines) return;

    const subs = matched
      .filter((r) => r.startsWith('balanceSheetLine.'))
      .map((r) => r.slice('balanceSheetLine.'.length));
    if (subs.length === 0) return;

    const rows = await ctx.ds.listBalanceSheetLines({
      organizationId: ctx.organizationId,
      companyId: ctx.companyId,
      period: ctx.period,
    });

    if (rows.length === 0) return;

    if (subs.includes('inventory')) {
      // Sum current-asset rows that match inventory heuristics.
      // lineType='asset' + subType='current' narrows to current assets;
      // bsIsInventoryLine then filters to inventory-specific rows.
      const inventorySum = rows
        .filter(
          (r) =>
            r.lineType === 'asset' &&
            r.subType === 'current' &&
            bsIsInventoryLine(r.accountCode, r.accountName),
        )
        .reduce((sum, r) => sum + r.amount, 0);

      if (inventorySum > 0) {
        state.context['inventory'] = inventorySum;
        state.inputs.resolved['inventory'] = inventorySum;
      }
    }
  },
};
