/**
 * Canonical server-side company × indicator applicability.
 *
 * Precedence is the schema contract from CompanyIndicator:
 *   1. an explicit CompanyIndicator row wins (`enabled` true or false);
 *   2. otherwise IndicatorDefinition.industries is the taxonomy fallback.
 *
 * IndicatorValue rows are deliberately absent from this module. A persisted
 * value is computation output, not permission to compute that pair again.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { isIndicatorApplicableToCompany } from './targets';

export interface PairApplicabilityCompany {
  id: string;
  industry?: string | null;
}

export interface PairApplicabilityDefinition {
  id: string;
  industries?: readonly string[] | null;
}

export interface PairApplicabilityOverride {
  companyId: string;
  indicatorId: string;
  enabled: boolean;
}

export interface PairApplicabilityResolver {
  readonly overrides: readonly PairApplicabilityOverride[];
  isApplicable(
    company: PairApplicabilityCompany,
    definition: PairApplicabilityDefinition,
  ): boolean;
}

type PairApplicabilityDb = Pick<PrismaClient, 'companyIndicator'> | Pick<Prisma.TransactionClient, 'companyIndicator'>;

const pairKey = (companyId: string, indicatorId: string): string =>
  `${companyId}::${indicatorId}`;

/** Build the pure resolver from already-scoped explicit assignments. */
export function createPairApplicabilityResolver(
  overrides: readonly PairApplicabilityOverride[],
): PairApplicabilityResolver {
  const byPair = new Map<string, boolean>();
  for (const override of overrides) {
    byPair.set(
      pairKey(override.companyId, override.indicatorId),
      override.enabled,
    );
  }

  return {
    overrides: [...overrides],
    isApplicable(company, definition) {
      const key = pairKey(company.id, definition.id);
      if (byPair.has(key)) return byPair.get(key) === true;
      return isIndicatorApplicableToCompany(company, definition);
    },
  };
}

/**
 * Load explicit assignments for an already org-scoped company/definition set.
 *
 * The id lists keep the query bounded. Relation predicates are intentional
 * defence in depth for BYPASSRLS callers: even if a future caller accidentally
 * passes a foreign id, the assignment cannot cross the requested org boundary.
 * Global definitions remain visible, as do this org's own overrides.
 */
export async function loadPairApplicabilityResolver(
  db: PairApplicabilityDb,
  args: {
    organizationId: string;
    companies: readonly PairApplicabilityCompany[];
    definitions: readonly PairApplicabilityDefinition[];
  },
): Promise<PairApplicabilityResolver> {
  const companyIds = [...new Set(args.companies.map((company) => company.id))];
  const indicatorIds = [
    ...new Set(args.definitions.map((definition) => definition.id)),
  ];

  if (companyIds.length === 0 || indicatorIds.length === 0) {
    return createPairApplicabilityResolver([]);
  }

  const rows = await db.companyIndicator.findMany({
    where: {
      companyId: { in: companyIds },
      indicatorId: { in: indicatorIds },
      company: { organizationId: args.organizationId },
      indicator: {
        OR: [
          { organizationId: null },
          { organizationId: args.organizationId },
        ],
      },
    },
    select: {
      companyId: true,
      indicatorId: true,
      enabled: true,
    },
  });

  return createPairApplicabilityResolver(rows);
}

/** Cartesian match that preserves each caller's full row types. */
export function matchApplicablePairs<
  C extends PairApplicabilityCompany,
  I extends PairApplicabilityDefinition,
>(
  companies: readonly C[],
  definitions: readonly I[],
  resolver: PairApplicabilityResolver,
): Array<{ company: C; definition: I }> {
  const pairs: Array<{ company: C; definition: I }> = [];
  for (const company of companies) {
    for (const definition of definitions) {
      if (resolver.isApplicable(company, definition)) {
        pairs.push({ company, definition });
      }
    }
  }
  return pairs;
}
