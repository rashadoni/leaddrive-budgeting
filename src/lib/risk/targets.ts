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
      if (
        def.industries.length === 0 ||
        def.industries.includes(company.industry)
      ) {
        out.push({ company, definition: def });
      }
    }
  }
  return out;
}
