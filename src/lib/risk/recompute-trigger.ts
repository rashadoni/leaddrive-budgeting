/**
 * Phase 7.E hardening (Turn 10) — single entry point for "after a write,
 * refresh the affected (company × indicator) IndicatorValue rows".
 *
 * Replaces three near-identical inline copies of the same orchestration
 * logic that had drifted slightly across paths:
 *
 *   - src/app/api/onboarding/import/budget/route.ts (per-company import)
 *   - src/app/api/onboarding/import/staging/[id]/apply/route.ts (AI-mapper apply)
 *   - scripts/import-azmade-budgets.ts (CLI batch importer)
 *
 * The first two were single-company; the script handled multi-year batches.
 * This module accepts the general `Array<{companyId, year}>` shape — single-
 * company callers pass `[{companyId, year}]` and the loop degenerates.
 *
 * Failure policy mirrors the prior copies: per-pair errors are caught and
 * counted, never re-thrown. A single bad indicator formula must not hide
 * a successful import.
 */

import type { PrismaClient } from '@prisma/client';
import {
  createPrismaDataSource,
  recomputeIndicator,
  type IndicatorDefinitionLike,
} from './recompute';
import {
  filterOperationalCompanies,
  preferOrgScopedDefinitions,
  matchCompaniesToIndicators,
} from './targets';

export interface RecomputeAffected {
  companyId: string;
  year: number;
}

export interface RecomputeTriggerLogger {
  /** Called once when the run starts with a non-zero target count. */
  start?: (msg: string) => void;
  /** Called once per pair failure. Optional — when omitted, errors are
   *  swallowed silently (the `failed` counter still reflects them in
   *  the returned result). API routes pass a thin `console.error`
   *  forwarder; the script forwards to its own line-prefixed format. */
  pairError?: (label: string, err: unknown) => void;
  /** Called once with the final tally. */
  done?: (msg: string) => void;
  /** Called when there is nothing to recompute (no operational companies / no targets). */
  noop?: (msg: string) => void;
}

export interface RunRecomputeResult {
  ok: number;
  unknown: number;
  failed: number;
  targets: number;
}

const EMPTY_RESULT: RunRecomputeResult = {
  ok: 0,
  unknown: 0,
  failed: 0,
  targets: 0,
};

/**
 * Recompute every (company × matching indicator) pair touched by the caller.
 *
 * - Companies are filtered to operational (level=2 + role='operational' +
 *   industry set) before any indicator-definition fetch — admin / holding
 *   cost-centres are excluded.
 * - Indicator definitions are narrowed by the union of operational
 *   industries (sector-agnostic definitions, where `industries=[]`, also
 *   match) so we don't pull rows we'll discard.
 * - Per-year scoping: a company touched only for 2025 is not recomputed
 *   under period='2026'. The script's prior batch shape is preserved.
 *
 * Returns aggregate counts; individual successes are not enumerated.
 */
export async function runRecomputeForCompanies(
  prisma: PrismaClient,
  organizationId: string,
  affected: RecomputeAffected[],
  logger: RecomputeTriggerLogger = {},
): Promise<RunRecomputeResult> {
  if (affected.length === 0) return { ...EMPTY_RESULT };

  // Group affected companies by year so the per-year `period` string
  // matches the year that was actually written.
  const byYear = new Map<number, Set<string>>();
  for (const a of affected) {
    const set = byYear.get(a.year) ?? new Set<string>();
    set.add(a.companyId);
    byYear.set(a.year, set);
  }

  const allCompanyIds = [...new Set(affected.map((a) => a.companyId))];
  const companies = await prisma.company.findMany({
    where: { organizationId, id: { in: allCompanyIds } },
    select: {
      id: true,
      code: true,
      industry: true,
      level: true,
      isActive: true,
      role: true,
    },
  });
  const operational = filterOperationalCompanies(companies);
  if (operational.length === 0) {
    logger.noop?.(
      'Recompute: no operational (level=2, role=operational) companies in the affected set — nothing to refresh.',
    );
    return { ...EMPTY_RESULT };
  }

  const operationalIndustries = [
    ...new Set(operational.map((c) => c.industry)),
  ];
  const allDefs = await prisma.indicatorDefinition.findMany({
    where: {
      isActive: true,
      OR: [{ organizationId: null }, { organizationId }],
      AND: [
        {
          OR: [
            { industries: { isEmpty: true } },
            { industries: { hasSome: operationalIndustries } },
          ],
        },
      ],
    },
    select: {
      id: true,
      organizationId: true,
      code: true,
      formula: true,
      sparklineFormula: true,
      thresholds: true,
      requiredInputs: true,
      industries: true,
      isActive: true,
      unit: true,
    },
  });
  const defs = preferOrgScopedDefinitions(allDefs);

  // Pre-count total pairs (across all years) so the start message is honest.
  const years = [...byYear.keys()].sort();
  let totalPairs = 0;
  for (const year of years) {
    const yearCompanyIds = byYear.get(year)!;
    const yearOperational = operational.filter((c) =>
      yearCompanyIds.has(c.id),
    );
    totalPairs += matchCompaniesToIndicators(yearOperational, defs).length;
  }
  if (totalPairs === 0) {
    logger.noop?.('Recompute: no matching indicators for affected companies.');
    return { ...EMPTY_RESULT };
  }

  logger.start?.(
    `Recompute: ${totalPairs} (company × indicator) pair${totalPairs === 1 ? '' : 's'} ` +
      `across ${operational.length} compan${operational.length === 1 ? 'y' : 'ies'} × ${years.length} ` +
      `year${years.length === 1 ? '' : 's'} (${years.join(', ')}) …`,
  );

  const ds = createPrismaDataSource(prisma);
  let ok = 0;
  let unknown = 0;
  let failed = 0;
  for (const year of years) {
    const yearCompanyIds = byYear.get(year)!;
    const yearOperational = operational.filter((c) =>
      yearCompanyIds.has(c.id),
    );
    const period = String(year);
    const targets = matchCompaniesToIndicators(yearOperational, defs);
    for (const { company, definition } of targets) {
      const defLike: IndicatorDefinitionLike = {
        id: definition.id,
        code: definition.code,
        formula: definition.formula,
        sparklineFormula: definition.sparklineFormula,
        thresholds: definition.thresholds,
        requiredInputs: definition.requiredInputs,
        unit: definition.unit,
      };
      try {
        // Phase 7.E phase 2 — bulk-import follow-up paths intentionally
        // omit `withSparkline`. At Phase F (60×9×5 = 2700 pairs) inline
        // sparkline would 13× the runtime — the offline
        // `scripts/compute-sparklines.ts` worker is the canonical
        // post-import refresher.
        const result = await recomputeIndicator(ds, {
          organizationId,
          companyId: company.id,
          definition: defLike,
          period,
        });
        if (result.status === 'unknown') unknown += 1;
        else ok += 1;
      } catch (err) {
        failed += 1;
        logger.pairError?.(
          `${company.code}/${definition.code} [${period}]`,
          err,
        );
      }
    }
  }
  logger.done?.(`Recompute done: ok=${ok} unknown=${unknown} failed=${failed}`);

  return { ok, unknown, failed, targets: totalPairs };
}
