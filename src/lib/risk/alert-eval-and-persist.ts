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
import { filterOperationalCompanies } from './targets';
import {
  evaluateAlertRules,
  DEFAULT_ALERT_RULES,
  type AlertContext,
} from './alert-rules';
import { readAlertThresholdsFromOrgSettings } from './alert-thresholds-config';
import { type HeatMapCell } from './heatmap-matrix';
import { persistAlertEvents } from './alert-events';

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
  const [companiesRaw, indicators] = await Promise.all([
    prisma.company.findMany({
      where: { organizationId, isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        industry: true,
        level: true,
        isActive: true,
        role: true,
      },
    }),
    prisma.indicatorDefinition.findMany({
      where: {
        isActive: true,
        OR: [{ organizationId: null }, { organizationId }],
      },
      select: { id: true, code: true },
    }),
  ]);
  type CompanyRawShape = (typeof companiesRaw)[number];
  const operational =
    filterOperationalCompanies<CompanyRawShape>(companiesRaw);
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
      const values = valuesRaw as unknown as Array<{
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
