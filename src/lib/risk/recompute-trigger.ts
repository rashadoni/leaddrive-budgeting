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
  filterRollupParentCompanies,
  isRollupIndicator,
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

  // Phase 7.E phase 3 follow-up — sub-42 prerequisite #1 closure.
  // Detect rollup-bearing indicators (formula uses rollup() resolver,
  // signaled by a `rollup:` prefix in requiredInputs). When present,
  // ALSO fetch parent (level=1, sub-group root) companies for the same
  // org so their rollup IVs land. Without this, indicators like
  // `IND_HOLDING_REVENUE` (formula: `rollup("IND_REVENUE_TOTAL")`) are
  // structurally inert because parent cos never enter the operational
  // filter above. Conditional fetch — orgs with no rollup indicators
  // pay zero extra DB cost.
  const rollupDefs = defs.filter((d) => isRollupIndicator(d));
  let parentCompanies: typeof companies = [];
  if (rollupDefs.length > 0) {
    const parents = await prisma.company.findMany({
      where: {
        organizationId,
        level: 1,
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        industry: true,
        level: true,
        isActive: true,
        role: true,
      },
    });
    parentCompanies = filterRollupParentCompanies(parents);
  }

  // Pre-count total pairs (across all years) so the start message is honest.
  // Parent-co × rollup-def pairs do NOT depend on `byYear` membership —
  // the parent rollup needs to refresh for every year a child touched
  // (an op-co writing 2026 means the parent's 2026 rollup is now stale,
  // independent of which sub-cos appear in `affected`).
  const years = [...byYear.keys()].sort();
  let totalPairs = 0;
  for (const year of years) {
    const yearCompanyIds = byYear.get(year)!;
    const yearOperational = operational.filter((c) =>
      yearCompanyIds.has(c.id),
    );
    totalPairs += matchCompaniesToIndicators(yearOperational, defs).length;
    totalPairs += parentCompanies.length * rollupDefs.length;
  }
  if (totalPairs === 0) {
    logger.noop?.('Recompute: no matching indicators for affected companies.');
    return { ...EMPTY_RESULT };
  }

  const parentSummary =
    parentCompanies.length > 0 && rollupDefs.length > 0
      ? ` (incl. ${parentCompanies.length} parent × ${rollupDefs.length} rollup-bearing indicator${rollupDefs.length === 1 ? '' : 's'})`
      : '';
  logger.start?.(
    `Recompute: ${totalPairs} (company × indicator) pair${totalPairs === 1 ? '' : 's'} ` +
      `across ${operational.length} compan${operational.length === 1 ? 'y' : 'ies'} × ${years.length} ` +
      `year${years.length === 1 ? '' : 's'} (${years.join(', ')})${parentSummary} …`,
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
    const operationalTargets = matchCompaniesToIndicators(yearOperational, defs);
    // Parent-co × rollup-def cartesian. Industry-match is bypassed
    // (rollup-bearing indicators are sector-agnostic by design — their
    // `industries` array is empty so they'd match anyway, but we skip
    // the matchCompaniesToIndicators call because parent-cos lack the
    // `industry: string` invariant that helper enforces).
    const parentTargets = parentCompanies.flatMap((p) =>
      rollupDefs.map((d) => ({ company: p, definition: d })),
    );
    const targets = [...operationalTargets, ...parentTargets];
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
