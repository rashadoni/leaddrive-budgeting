/**
 * Phase 7.E C6 v3.1 (Turn IV) — server-side evaluator+persister for AlertEvents.
 *
 * Composes the existing pieces (org settings → thresholds → alert rules →
 * persistAlertEvents) per period. Called from the recompute pipeline at the
 * end of every batch so the AlertEvent log stays in lockstep with the matrix.
 *
 * Designed to never throw to the caller — catches per-period errors, counts
 * them, returns aggregate counts. The recompute trigger wraps this in its
 * own try/catch as belt-and-braces (failure policy: alert-persistence
 * concerns must not crash the import that already wrote IVs successfully).
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import {
  filterOperationalCompanies,
  preferOrgScopedDefinitions,
} from './targets';
import {
  evaluateAlertRules,
  DEFAULT_ALERT_RULES,
  type AlertContext,
} from './alert-rules';
import { readAlertThresholdsFromOrgSettings } from './alert-thresholds-config';
import { type HeatMapCell } from './heatmap-matrix';
import { persistAlertEvents } from './alert-events';
import { loadPairApplicabilityResolver } from './pair-applicability';

export interface EvalAndPersistArgs {
  organizationId: string;
  /** Period strings to evaluate; usually the years touched by the prior recompute. */
  periods: readonly string[];
}

export interface EvalAndPersistLogger {
  /** Per-period failure (caught — never thrown to caller). */
  periodError?: (period: string, err: unknown) => void;
}

export interface EvalAndPersistResult {
  /** Number of periods where evaluator + persist completed end-to-end. */
  periodsPersisted: number;
  /** Number of AlertEvent rows created (across all periods). */
  totalCreated: number;
  /** Number of AlertEvent rows deleted prior to insert (across all periods). */
  totalDeleted: number;
  /** Per-period failures (org row missing / Prisma errors / etc.). */
  failed: number;
}

/**
 * For each period in `periods`, evaluate the default alert rules against the
 * org's current IV state and persist the matches as AlertEvents (replacing
 * any prior period's row set per `persistAlertEvents` semantics).
 *
 * Failure isolation: a single period that errors does NOT stop the others
 * — `failed` counter advances and `periodError` is called if provided.
 *
 * Empty `periods` array is a no-op (no DB hit).
 */
export async function evaluateAndPersistAlertsForPeriods(
  // Phase 8 D5(b) — accept TransactionClient too so callers wrapped
  // in `withOrgScope` thread the tx through without losing the RLS
  // session var. Both shapes already satisfy the alert-eval query
  // surface.
  prisma: PrismaClient | Prisma.TransactionClient,
  args: EvalAndPersistArgs,
  logger: EvalAndPersistLogger = {},
): Promise<EvalAndPersistResult> {
  const { organizationId, periods } = args;
  const result: EvalAndPersistResult = {
    periodsPersisted: 0,
    totalCreated: 0,
    totalDeleted: 0,
    failed: 0,
  };
  if (periods.length === 0) return result;

  // Fetch org once — settings.alertThresholds applies across all periods
  // for the same org.
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  const thresholds = readAlertThresholdsFromOrgSettings(org?.settings);

  // Fetch operational cos + indicators once (period-independent).
  const [companiesRaw, indicatorsRaw] = await Promise.all([
    prisma.company.findMany({
      where: {
        organizationId,
        isActive: true,
        status: { not: 'pending' },
      },
      select: {
        id: true,
        code: true,
        name: true,
        industry: true,
        level: true,
        isActive: true,
        role: true,
        status: true,
      },
    }),
    prisma.indicatorDefinition.findMany({
      where: {
        isActive: true,
        OR: [{ organizationId: null }, { organizationId }],
      },
      select: {
        id: true,
        code: true,
        organizationId: true,
        industries: true,
        isActive: true,
        category: true,
        requiredInputs: true,
      },
    }),
  ]);
  type CompanyRawShape = (typeof companiesRaw)[number];
  const operational = filterOperationalCompanies<CompanyRawShape>(
    companiesRaw.filter((company) => company.status !== 'pending'),
  );
  // Alert rules evaluate operational leaf cells only. Matrix-visible internal
  // definitions are rollup-bearing and parent-only, so no internal definition
  // belongs on this leaf alert surface (ordinary internals are hidden too).
  const indicators = preferOrgScopedDefinitions(indicatorsRaw).filter(
    (indicator) => indicator.category !== 'internal',
  );
  const operationalIds = operational.map((c) => c.id);
  const indicatorIds = indicators.map((i) => i.id);

  if (operationalIds.length === 0 || indicatorIds.length === 0) {
    // Still run persist with empty matches per period so a stale prior
    // state gets cleared (e.g. last operational co just deactivated).
    for (const period of periods) {
      try {
        const out = await persistAlertEvents(prisma, {
          organizationId,
          period,
          matches: [],
        });
        result.totalDeleted += out.deleted;
        result.periodsPersisted += 1;
      } catch (err) {
        result.failed += 1;
        logger.periodError?.(period, err);
      }
    }
    return result;
  }

  const pairApplicability = await loadPairApplicabilityResolver(prisma, {
    organizationId,
    companies: operational,
    definitions: indicators,
  });
  const companyById = new Map(operational.map((company) => [company.id, company]));
  const indicatorById = new Map(
    indicators.map((indicator) => [indicator.id, indicator]),
  );

  for (const period of periods) {
    try {
      const valuesRaw = await prisma.indicatorValue.findMany({
        where: {
          organizationId,
          period,
          companyId: { in: operationalIds },
          indicatorId: { in: indicatorIds },
        },
        select: {
          companyId: true,
          indicatorId: true,
          value: true,
          status: true,
        },
      });
      // Prisma surfaces `status` as `string`; the recompute pipeline
      // guarantees one of HeatMapCell["status"] literals — cast through
      // unknown for type-safety without runtime check (same pattern as
      // matrix endpoint route.ts:184).
      const applicableValuesRaw = valuesRaw.filter((value) => {
        const company = companyById.get(value.companyId);
        const definition = indicatorById.get(value.indicatorId);
        return Boolean(
          company &&
            definition &&
            pairApplicability.isApplicable(company, definition),
        );
      });
      const values = applicableValuesRaw as unknown as Array<{
        companyId: string;
        indicatorId: string;
        value: number | null;
        status: HeatMapCell['status'];
      }>;
      const cells: HeatMapCell[] = values.map((v) => ({
        companyId: v.companyId,
        indicatorId: v.indicatorId,
        value: v.value as number,
        status: v.status,
      }));
      const ctx: AlertContext = {
        companies: operational.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          industry: c.industry,
        })),
        indicators: indicators.map((i) => ({ id: i.id, code: i.code })),
        cells,
      };
      const matches = evaluateAlertRules(DEFAULT_ALERT_RULES, ctx, thresholds);
      const out = await persistAlertEvents(prisma, {
        organizationId,
        period,
        matches,
      });
      result.totalCreated += out.created;
      result.totalDeleted += out.deleted;
      result.periodsPersisted += 1;
    } catch (err) {
      result.failed += 1;
      logger.periodError?.(period, err);
    }
  }

  return result;
}
