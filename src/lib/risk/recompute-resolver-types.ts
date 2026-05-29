/**
 * Recompute resolver-infrastructure interfaces — extracted from
 * recompute-resolvers.ts (Phase 8 D1 2026-05-29) into their own module so the
 * two resolver-group files and the barrel can share them without an import
 * cycle (resolver groups import these; the barrel imports both groups + these).
 */
import type { FormulaContext, FormulaFunction } from './formula-engine';
import type { Period } from './periods';
import type { RecomputeDataSource, RecomputeInputs } from './recompute-types';

/** Mutable state threaded through resolvers + post-processors. */
export interface BuildState {
  context: FormulaContext;
  inputs: RecomputeInputs;
  /**
   * Phase 7.E phase 3 — formula-engine functions injected by resolvers.
   * Today populated by `factResolver` + `rollupResolver`; the engine sees
   * them via the `functions` arg of `tryEvaluateFormula`. Each function
   * closes over a per-recompute snapshot map (no DB access at eval time
   * — required because expr-eval is synchronous).
   */
  functions: Record<string, FormulaFunction>;
}

export interface ResolverCtx {
  ds: RecomputeDataSource;
  organizationId: string;
  companyId: string;
  period: Period;
  /** Company-base currency code (or "AZN" fallback). Used by the budgetLine
   *  resolver to NOT treat lines tagged with the company's base currency as
   *  foreign — see CXLVIII regression note in the resolver body. */
  baseCurrency: string;
  /**
   * Phase 7.H F4.v2.2 — company industry code (e.g. "agro_crops",
   * "real_estate"). Threaded from the recompute trigger so the
   * `industryFactorResolver` can pick the right sector intensity
   * factor without an extra DB read. `null` when the company has no
   * industry set (defensive — Company.industry is required at the
   * schema level today but legacy fixtures may omit it).
   */
  industry: string | null;
}

export interface NamespaceResolver {
  name: string;
  /** True if this resolver handles the raw requiredInput string. */
  matches(requiredInput: string): boolean;
  /** Populate context + aggregates for the matched inputs. Called once per
   *  namespace per recompute — guaranteed by the single RESOLVERS loop in
   *  `buildContext`, which passes each resolver its full matched batch. */
  resolve(
    matchedInputs: string[],
    ctx: ResolverCtx,
    state: BuildState,
  ): Promise<void>;
}
