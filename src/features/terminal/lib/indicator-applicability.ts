/**
 * Pure applicability helpers for the Expert HeatMap.
 *
 * `IndicatorDefinition.industries` is the canonical activity-profile
 * contract: an empty/missing array means universal, while a non-empty array
 * explicitly scopes the indicator to those industries. Missing observations
 * are deliberately not part of this decision — an applicable KPI with no
 * value is a data-quality gap and must remain visible.
 */

export interface ApplicabilityCompany {
  id: string;
  industry?: string | null;
  parentCompanyId?: string | null;
  /** Matrix hierarchy marker: rollup-bearing KPIs belong to subgroup rows only. */
  isSubgroup?: boolean;
}

export interface ApplicabilityIndicator {
  id: string;
  industries?: readonly string[] | null;
  /** Resolver dependencies; a canonical `rollup:` token marks a parent-only KPI. */
  requiredInputs?: readonly string[] | null;
}

export interface ApplicabilityOverride {
  companyId: string;
  indicatorId: string;
  enabled: boolean;
}

export type ApplicabilityReason =
  | 'explicit_disabled'
  | 'entity_level_mismatch'
  | 'taxonomy_mismatch';

export type ApplicabilityDecision =
  | { applicable: true; reason: null }
  | { applicable: false; reason: ApplicabilityReason };

export type ApplicabilityDecisionResolver = (
  companyId: string,
  indicator: ApplicabilityIndicator,
) => ApplicabilityDecision;

export type ApplicabilityResolver = (
  companyId: string,
  indicator: ApplicabilityIndicator,
) => boolean;

const APPLICABLE: ApplicabilityDecision = { applicable: true, reason: null };
const TAXONOMY_MISMATCH: ApplicabilityDecision = {
  applicable: false,
  reason: 'taxonomy_mismatch',
};
const EXPLICITLY_DISABLED: ApplicabilityDecision = {
  applicable: false,
  reason: 'explicit_disabled',
};
const ENTITY_LEVEL_MISMATCH: ApplicabilityDecision = {
  applicable: false,
  reason: 'entity_level_mismatch',
};

function isRollupBearing(indicator: ApplicabilityIndicator): boolean {
  return (indicator.requiredInputs ?? []).some(
    (input) => typeof input === 'string' && input.startsWith('rollup:'),
  );
}

/**
 * Build a reusable per-pair resolver that preserves why a pair is excluded.
 *
 * Only an explicit disable on the exact company/indicator pair receives the
 * `explicit_disabled` reason. A parent whose descendants simply do not match
 * the indicator remains a taxonomy mismatch; this avoids claiming that an
 * administrator disabled a pair when no such assignment exists.
 */
export function createApplicabilityDecisionResolver(args: {
  companies: readonly ApplicabilityCompany[];
  applicabilityOverrides?: readonly ApplicabilityOverride[];
}): ApplicabilityDecisionResolver {
  const { companies, applicabilityOverrides = [] } = args;
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const childrenByParentId = new Map<string, ApplicabilityCompany[]>();
  for (const company of companies) {
    if (!company.parentCompanyId) continue;
    const siblings = childrenByParentId.get(company.parentCompanyId) ?? [];
    siblings.push(company);
    childrenByParentId.set(company.parentCompanyId, siblings);
  }
  const assignmentByPair = new Map(
    applicabilityOverrides.map((assignment) => [
      `${assignment.companyId}::${assignment.indicatorId}`,
      assignment.enabled,
    ]),
  );

  const resolve = (
    companyId: string,
    indicator: ApplicabilityIndicator,
    visiting: ReadonlySet<string>,
  ): ApplicabilityDecision => {
    const company = companyById.get(companyId);
    const rollupBearing = isRollupBearing(indicator);

    // Structural eligibility precedes tenant configuration. A `rollup:` KPI
    // consumes child observations and therefore has meaning only on a subgroup
    // row. An explicit CompanyIndicator enable may override activity taxonomy,
    // but it cannot turn an operational leaf into an aggregation entity.
    if (company && rollupBearing && company.isSubgroup !== true) {
      return ENTITY_LEVEL_MISMATCH;
    }

    const pairKey = `${companyId}::${indicator.id}`;
    if (assignmentByPair.has(pairKey)) {
      return assignmentByPair.get(pairKey) === true
        ? APPLICABLE
        : EXPLICITLY_DISABLED;
    }

    if (!company || visiting.has(companyId)) return TAXONOMY_MISMATCH;
    if (rollupBearing) return APPLICABLE;
    const industries = indicator.industries ?? [];
    const children = childrenByParentId.get(companyId) ?? [];
    if (children.length === 0) {
      if (!company.industry || industries.length === 0) return APPLICABLE;
      return industries.includes(company.industry)
        ? APPLICABLE
        : TAXONOMY_MISMATCH;
    }

    // Parent activity is its own declared industry plus descendant activity.
    // A null parent industry therefore derives from children instead of
    // turning every indicator into a visible fail-open column.
    if (
      company.industry &&
      (industries.length === 0 || industries.includes(company.industry))
    ) {
      return APPLICABLE;
    }
    const nextVisiting = new Set(visiting).add(companyId);
    return children.some(
      (child) => resolve(child.id, indicator, nextVisiting).applicable,
    )
      ? APPLICABLE
      : TAXONOMY_MISMATCH;
  };

  return (companyId, indicator) => resolve(companyId, indicator, new Set());
}

/** Build the legacy boolean resolver used by column disclosure and callers. */
export function createApplicabilityResolver(args: {
  companies: readonly ApplicabilityCompany[];
  applicabilityOverrides?: readonly ApplicabilityOverride[];
}): ApplicabilityResolver {
  const decide = createApplicabilityDecisionResolver(args);
  return (companyId, indicator) => decide(companyId, indicator).applicable;
}

/**
 * Resolve the exact companies represented by the current HeatMap scope.
 *
 * Keeping ids (not only the industry union) is required for explicit
 * CompanyIndicator assignments: one company may enable a cross-industry KPI
 * or disable an otherwise matching one without changing its siblings.
 */
export function collectScopeCompanyIds(
  companies: readonly ApplicabilityCompany[],
  visibleCompanyIds: ReadonlySet<string>,
  activeCompanyId?: string | null,
): readonly string[] {
  const scopeIds = new Set<string>();
  const visited = new Set<string>();
  const visit = (companyId: string): void => {
    if (visited.has(companyId)) return;
    visited.add(companyId);
    scopeIds.add(companyId);
    for (const company of companies) {
      if (company.parentCompanyId === companyId) visit(company.id);
    }
  };

  if (activeCompanyId) {
    if (companies.some((company) => company.id === activeCompanyId)) {
      visit(activeCompanyId);
    }
    return [...scopeIds];
  }

  for (const company of companies) {
    if (visibleCompanyIds.has(company.id)) visit(company.id);
  }
  return [...scopeIds];
}

/**
 * Resolve the industry union represented by the currently visible scope.
 *
 * A selected leaf uses its own industry. A selected subgroup/holding uses the
 * union of its own industry (when present) and every descendant industry. With
 * no active company the union comes from the visible rows plus their descendants
 * (so row search and activity filtering stay in sync). Unknown scope fails open
 * later in `partitionIndicatorsByScope`.
 */
export function collectScopeIndustries(
  companies: readonly ApplicabilityCompany[],
  visibleCompanyIds: ReadonlySet<string>,
  activeCompanyId?: string | null,
): readonly string[] {
  const industries = new Set<string>();
  const scopeIds = new Set(
    collectScopeCompanyIds(companies, visibleCompanyIds, activeCompanyId),
  );
  for (const company of companies) {
    if (scopeIds.has(company.id) && company.industry) {
      industries.add(company.industry);
    }
  }

  return [...industries];
}

/**
 * Split the catalogue into relevant and explicitly non-applicable indicators.
 *
 * Fail-open rules are intentional:
 * - no resolved scope companies => show everything;
 * - an explicit CompanyIndicator assignment wins for that company/pair;
 * - otherwise no company taxonomy or no indicator industries => applicable;
 * - otherwise a taxonomy mismatch is non-applicable.
 *
 * Persisted cells are deliberately not inputs to this decision. A coloured
 * value may have been produced by an older broad recompute (or a defective
 * scenario preview); treating that output as an applicability override makes
 * the error self-perpetuating.
 */
export function partitionIndicatorsByScope<
  TIndicator extends ApplicabilityIndicator,
>(args: {
  indicators: readonly TIndicator[];
  scopeCompanies: readonly ApplicabilityCompany[];
  applicabilityOverrides?: readonly ApplicabilityOverride[];
}): { relevant: TIndicator[]; hidden: TIndicator[] } {
  const {
    indicators,
    scopeCompanies,
    applicabilityOverrides = [],
  } = args;
  if (scopeCompanies.length === 0) {
    return { relevant: [...indicators], hidden: [] };
  }

  const isApplicable = createApplicabilityResolver({
    companies: scopeCompanies,
    applicabilityOverrides,
  });
  const relevant: TIndicator[] = [];
  const hidden: TIndicator[] = [];
  for (const indicator of indicators) {
    const isRelevant = scopeCompanies.some((company) =>
      isApplicable(company.id, indicator),
    );
    (isRelevant ? relevant : hidden).push(indicator);
  }

  return { relevant, hidden };
}
