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
}

export interface ApplicabilityIndicator {
  id: string;
  industries?: readonly string[] | null;
}

export interface ApplicabilityCell {
  companyId: string;
  indicatorId: string;
  status?: string | null;
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
  const visited = new Set<string>();
  const visitDescendants = (parentId: string): void => {
    if (visited.has(parentId)) return;
    visited.add(parentId);
    for (const company of companies) {
      if (company.parentCompanyId !== parentId) continue;
      if (company.industry) industries.add(company.industry);
      visitDescendants(company.id);
    }
  };

  if (!activeCompanyId) {
    for (const company of companies) {
      if (!visibleCompanyIds.has(company.id)) continue;
      if (company.industry) industries.add(company.industry);
      // A search can leave only a subgroup row visible. Its activity profile
      // still comes from descendants, even though those rows are filtered out.
      visitDescendants(company.id);
    }
    return [...industries];
  }

  const activeCompany = companies.find((company) => company.id === activeCompanyId);
  if (!activeCompany) return [];
  // Some umbrella entities carry a broad industry of their own while their
  // operating children have narrower, different industries. Keep both.
  if (activeCompany.industry) industries.add(activeCompany.industry);
  visitDescendants(activeCompany.id);

  return [...industries];
}

/**
 * Split the catalogue into relevant and explicitly non-applicable indicators.
 *
 * Fail-open rules are intentional:
 * - no known scope industries => show everything;
 * - no indicator industries => universal, show it;
 * - a calculated (non-unknown) observation in the visible scope => keep it,
 *   even when a legacy or per-company override disagrees with the current
 *   definition tags. Persisted `unknown` placeholders do not count: keeping
 *   them would make an empty, non-applicable indicator impossible to hide.
 */
export function partitionIndicatorsByScope<
  TIndicator extends ApplicabilityIndicator,
>(args: {
  indicators: readonly TIndicator[];
  cells: readonly ApplicabilityCell[];
  visibleCompanyIds: ReadonlySet<string>;
  scopeIndustries: readonly string[];
}): { relevant: TIndicator[]; hidden: TIndicator[] } {
  const { indicators, cells, visibleCompanyIds, scopeIndustries } = args;
  if (scopeIndustries.length === 0) {
    return { relevant: [...indicators], hidden: [] };
  }

  const scopeIndustrySet = new Set(scopeIndustries);
  const calculatedIndicatorIds = new Set<string>();
  for (const cell of cells) {
    if (
      visibleCompanyIds.has(cell.companyId) &&
      cell.status != null &&
      cell.status !== 'unknown'
    ) {
      calculatedIndicatorIds.add(cell.indicatorId);
    }
  }

  const relevant: TIndicator[] = [];
  const hidden: TIndicator[] = [];
  for (const indicator of indicators) {
    const industries = indicator.industries ?? [];
    const isRelevant =
      industries.length === 0 ||
      calculatedIndicatorIds.has(indicator.id) ||
      industries.some((industry) => scopeIndustrySet.has(industry));
    (isRelevant ? relevant : hidden).push(indicator);
  }

  return { relevant, hidden };
}
