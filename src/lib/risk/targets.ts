/**
 * Phase 7.A.0 — pure (company, indicator) matching used by the recompute
 * trigger route. Extracted from the route so it can be unit-tested without
 * Prisma / auth / NextRequest.
 *
 * Concrete row shapes are declared here so generic-inference quirks don't
 * silently drop fields at call sites. Prisma result types are structurally
 * compatible with these interfaces.
 */

/**
 * Phase 7.E foundation — cost-centre role taxonomy:
 *  - operational — line-of-business; full indicator-pack scoring.
 *  - admin       — pure cost-centre (e.g. holding HQ, ATL-MRKZ);
 *                  exempt from operational-threshold scoring.
 *  - holding     — top-level holding entity; aggregated views only.
 * Phase 7.E hardening (Turn 10): single source of truth is the Prisma
 * `enum CompanyRole` declared in schema.prisma — re-exported here so
 * non-Prisma callers don't need to know about the generated client.
 */
export type { CompanyRole } from "@prisma/client";
import type { CompanyRole } from "@prisma/client";
import { ROLLUP_INPUT_PREFIX } from "./recompute";

export interface CompanyForMatch {
  id: string;
  code: string;
  industry: string | null;
  level: number | null;
  isActive: boolean;
  /**
   * Required after Phase 7.E migration (`NOT NULL DEFAULT 'operational'`).
   * Every Prisma `select` that participates in this filter must include
   * `role: true` — passing a row without it is a programmer error caught
   * at compile time rather than silently treated as "operational".
   */
  role: CompanyRole;
}

export interface OperationalCompany extends CompanyForMatch {
  industry: string;
}

export interface IndicatorForMatch {
  id: string;
  code: string;
  organizationId: string | null;
  industries: string[];
  isActive: boolean;
}

export interface MatchResult<
  C extends OperationalCompany,
  I extends IndicatorForMatch,
> {
  company: C;
  definition: I;
}

/**
 * Decide whether one indicator applies to one company activity profile.
 *
 * The catalogue contract is intentionally fail-open for missing taxonomy:
 * a company without a known industry or a definition without industry tags
 * cannot be proved non-applicable. Once both sides have explicit taxonomy, a
 * mismatch is non-applicable. A persisted result is output of the computation,
 * not evidence that the computation was allowed for that activity profile.
 */
export function isIndicatorApplicableToCompany(
  company: { industry?: string | null },
  definition: { industries?: readonly string[] | null },
): boolean {
  if (!company.industry) return true;
  const industries = definition.industries ?? [];
  if (industries.length === 0) return true;
  return industries.includes(company.industry);
}

/**
 * Keep only operational (level 2) companies with an industry set AND
 * `role==='operational'`. Sub-groups (level 1) have no industry; admin
 * cost-centres (role='admin') would false-red on operational thresholds
 * since they have no revenue base; holding entities only appear in
 * aggregated views. Generic so Prisma select results keep their extra
 * fields at call sites.
 *
 * Phase 7.E hardening (Turn 10): the legacy `role == null` branch was
 * removed after the column went `NOT NULL DEFAULT 'operational'` and the
 * enum migration backfilled every row. Callers that select fewer columns
 * now get a compile error instead of silent "treated as operational".
 */
export function filterOperationalCompanies<C extends CompanyForMatch>(
  companies: C[],
): Array<C & { industry: string }> {
  return companies.filter(
    (c): c is C & { industry: string } =>
      c.isActive &&
      c.level === 2 &&
      typeof c.industry === 'string' &&
      c.role === 'operational',
  );
}

/**
 * When the same `code` exists both as a global seed (organizationId=null) and
 * as an org-specific override, keep the org-specific one. Global wins only
 * when there is no override. When multiple globals share a code (data bug in
 * the seed), the first one encountered wins — surfaces rather than hides.
 * Generic so Prisma rows keep their extra fields (formula, thresholds, etc.).
 */
export function preferOrgScopedDefinitions<I extends IndicatorForMatch>(
  defs: I[],
): I[] {
  const byCode = new Map<string, I>();
  for (const d of defs) {
    const cur = byCode.get(d.code);
    if (!cur || (cur.organizationId === null && d.organizationId !== null)) {
      byCode.set(d.code, d);
    }
  }
  return [...byCode.values()];
}

/**
 * Build the cartesian product of operational companies × indicator
 * definitions, keeping only pairs where the indicator's `industries` array
 * either matches the company's industry or is empty (sector-agnostic).
 */
export function matchCompaniesToIndicators<
  C extends OperationalCompany,
  I extends IndicatorForMatch,
>(companies: C[], definitions: I[]): Array<MatchResult<C, I>> {
  const out: Array<MatchResult<C, I>> = [];
  for (const company of companies) {
    for (const def of definitions) {
      if (isIndicatorApplicableToCompany(company, def)) {
        out.push({ company, definition: def });
      }
    }
  }
  return out;
}

// ─── Phase 7.E phase 3 follow-up — rollup() parent-co recompute support ───
// Sub-42 prerequisite #1 closure. Without these, the seed
// `IND_HOLDING_REVENUE` (formula: rollup("IND_REVENUE_TOTAL")) is
// structurally inert: parent companies (level=1) never enter the
// operational filter above, so their rollup IV is never created.

/**
 * Predicate marking indicators whose formula consumes the rollup()
 * resolver. The contract is "any entry in `requiredInputs` starts with
 * the canonical `rollup:` prefix" — symmetric to the engine's resolver
 * dispatch in `recompute.ts` (sub-41 phase 3) which scans for the same
 * prefix to decide whether to fetch direct children's IVs.
 *
 * Used by `runRecomputeForCompanies` to opt-in parent companies for
 * these specific indicators only — keeping the legacy operational-only
 * filter for everything else.
 *
 * Lenient on shape: a malformed entry (non-string) is silently skipped
 * rather than crashing the whole recompute pass — strictness already
 * lives one layer up at `validateRequiredInputs` (recompute.ts) which
 * runs at seed-author time per `feedback_verify_one_layer_up.md`.
 */
export function isRollupIndicator(
  def: { requiredInputs?: string[] | null },
): boolean {
  const inputs = def.requiredInputs ?? [];
  return inputs.some(
    (s) => typeof s === 'string' && s.startsWith(ROLLUP_INPUT_PREFIX),
  );
}

/**
 * Filter to parent (sub-group root) companies that should receive
 * rollup-bearing indicator IVs.
 *
 * Selection rule: `level === 1 && isActive`. Industry is intentionally
 * NOT required — parent cos aggregate across sectors and typically have
 * `industry: null`. `role === 'admin'` cost-centres are excluded; their
 * "rollup" would double-count via sibling op-cos in the same sub-group
 * since admin cos shouldn't carry operational data anyway.
 *
 * `role === 'holding'` entities ARE kept — they're the canonical
 * top-of-tree aggregator and exactly what rollup() targets. `role ===
 * 'operational'` parent cos (rare, mostly imported data) also kept for
 * forward-compat with mixed-mode org structures.
 *
 * Generic so Prisma rows keep extra fields (id, code, etc.) at call
 * sites. Mirrors `filterOperationalCompanies` shape for consistency.
 */
export function filterRollupParentCompanies<C extends CompanyForMatch>(
  companies: C[],
): C[] {
  return companies.filter(
    (c) => c.isActive && c.level === 1 && c.role !== 'admin',
  );
}
