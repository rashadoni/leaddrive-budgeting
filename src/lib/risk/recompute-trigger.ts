/**
 * Phase 7.E hardening (Turn 10) — single entry point for "after a write,
 * refresh the affected (company × indicator) IndicatorValue rows".
 *
 * Replaces near-identical inline copies of the same orchestration logic
 * that had drifted slightly across paths:
 *
 *   - src/app/api/onboarding/import/budget/route.ts (per-company import)
 *   - src/app/api/onboarding/import/staging/[id]/apply/route.ts (AI-mapper apply)
 *
 * This module accepts the general `Array<{companyId, year}>` shape —
 * single-company callers pass `[{companyId, year}]` and the loop
 * degenerates. Multi-company/multi-year callers (AI Auto Import
 * orchestrator) get the same code path.
 *
 * Failure policy mirrors the prior copies: per-pair errors are caught and
 * counted, never re-thrown. A single bad indicator formula must not hide
 * a successful import.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { prismaAdmin } from '@/lib/db/prisma-admin';
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
import { evaluateAndPersistAlertsForPeriods } from './alert-eval-and-persist';
import { verifyPeriodSnapshot } from '../budgeting/period-snapshot';
import { parseLockedPeriods, isPeriodLockedInList } from '../budgeting/period-lock';

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
  /** Phase 7.E C6 v3.1 — called per-period if the alert-eval+persist
   *  step throws. Failure is swallowed (recompute success must not be
   *  blocked by an alert-log persistence error); the counter shows up
   *  in the returned result. */
  alertPersistError?: (period: string, err: unknown) => void;
}

export interface RunRecomputeResult {
  ok: number;
  unknown: number;
  failed: number;
  targets: number;
  /**
   * Phase 7.E C6 v3.1 — alert-event persistence outcome (post-recompute).
   * Phase 7.G Turn IX (v3.4) — required not optional. Short-circuit paths
   * (empty-affected / no-operational / no-targets) return zero-shape
   * `{periodsPersisted: 0, totalCreated: 0, totalDeleted: 0, failed: 0}`
   * instead of omitting the field, so consumers can rely on its presence
   * without optional-chain noise (architect Turn-IV 💡 #1 closure).
   */
  alertEvents: {
    periodsPersisted: number;
    totalCreated: number;
    totalDeleted: number;
    failed: number;
  };
}

/**
 * Optional opts for `runRecomputeForCompanies`.
 *
 * `codeFilter` (sub-44 prereq #2 cont'd closure): when supplied + non-
 * empty, narrows the indicator-definition fetch to only the listed
 * `IndicatorDefinition.code` values via `where.code.in`. Used by
 * `scripts/backfill-historical-ivs.ts --codes=...` to limit a backfill
 * to specific indicators (e.g. only IND_NET_MARGIN for a 2025 fact()
 * baseline). Empty / undefined = no filter (current behavior, pulls
 * the full per-industry catalog).
 *
 * The filter applies BEFORE org-scoping precedence + before parent-co
 * rollup detection, so it correctly affects both branches of the
 * trigger's pipeline.
 */
export interface RunRecomputeOptions {
  codeFilter?: readonly string[];
  /**
   * Phase 10 / Stage B5 — the DataRevision every IndicatorValue written by this
   * run is traced to.
   *
   * Only an import that created a revision inside its own apply transaction
   * passes this; it names the committed source state these observations were
   * derived from (03-DATA-KPI-TRUST-SPEC §6.1 — a source mutation carries its
   * `revisionId` to the recompute it triggers).
   *
   * Omitted → every row keeps `revisionId = null`, exactly as before. That is
   * the legacy contract, and it is not a defect: an untraced row is honestly
   * untraced, and A5's gate holds it at Provisional for precisely that reason.
   *
   * The revision must belong to `organizationId`. This module does not check
   * that — `upsertIndicatorValue` does, on every write, and refuses a foreign
   * one. Validating here as well would only move the error earlier while
   * leaving the real write path to be trusted, so the check lives where the
   * write is.
   */
  revisionId?: string | null;
  /**
   * Phase 10 / Stage B5 — the leaf companies `revisionId` is allowed to stamp.
   *
   * A revision names the companies it attests to (`DataRevision.companyIds`).
   * A recompute run can legitimately cover more than that: a multi-company apply
   * recomputes every company it touched, but only the ones whose data the
   * transaction actually wrote belong to the revision. Stamping the others would
   * have a row cite a revision that does not name it — a false claim, and
   * exactly the kind this stage exists to prevent.
   *
   * So when supplied, only these companies are traced; everyone else in the run
   * writes `revisionId = null`. Omitted → every leaf company in the run is
   * traced, which is right when the caller's revision names them all (the
   * single-company import paths).
   *
   * Parent rollups are never traced regardless — see the `traced` flag below.
   */
  tracedCompanyIds?: ReadonlySet<string>;
}

const EMPTY_RESULT: RunRecomputeResult = {
  ok: 0,
  unknown: 0,
  failed: 0,
  targets: 0,
  // Phase 7.G Turn IX (v3.4) — alertEvents required (architect Turn-IV
  // 💡 #1 closure). Short-circuit paths return zero-shape so consumers
  // can rely on field presence without optional-chain noise.
  alertEvents: {
    periodsPersisted: 0,
    totalCreated: 0,
    totalDeleted: 0,
    failed: 0,
  },
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
 * - `options.codeFilter` (sub-44 prereq #2 cont'd) optionally restricts
 *   the catalog to specific indicator codes (used by the historical-
 *   backfill script's `--codes` flag).
 *
 * Returns aggregate counts; individual successes are not enumerated.
 */
export async function runRecomputeForCompanies(
  // Phase 8 D5(b) (2026-05-28) — accept TransactionClient so callers
  // wrapped in `withOrgScope` (BullMQ recompute-processor) pick up
  // `app.organization_id` at the DB layer. PrismaClient still works
  // for legacy / CLI call sites (historical-backfill, smoke scripts).
  client: PrismaClient | Prisma.TransactionClient,
  organizationId: string,
  affected: RecomputeAffected[],
  logger: RecomputeTriggerLogger = {},
  options: RunRecomputeOptions = {},
): Promise<RunRecomputeResult> {
  // Phase 5.2 S5 RLS — resolve the write client. A scope tx (BullMQ processor
  // / in-tx callers) has `SET LOCAL app.organization_id` live, so use it
  // directly. The global PrismaClient (post-mutation route call sites, OUTSIDE
  // any withOrgScope tx) is routed through the BYPASSRLS `prismaAdmin` — the
  // IndicatorValue / AlertEvent / audit writes below would otherwise fail the
  // RLS WITH CHECK once the default client flips to the non-superuser app role.
  // A TransactionClient lacks `$transaction`; the full PrismaClient has it.
  const prisma: PrismaClient | Prisma.TransactionClient =
    typeof (client as { $transaction?: unknown }).$transaction === "function"
      ? prismaAdmin
      : client;
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
      // CXLVIII guard — used to determine whether a BudgetLine tagged with a
      // currencyCode equals the company's base (no FX conversion) or is
      // genuinely foreign (rate required). Null falls back to 'AZN' at the
      // resolver's argument default.
      baseCurrencyCode: true,
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
  // Sub-44 prereq #2 cont'd — `options.codeFilter` narrows the catalog
  // to specific indicator codes when supplied + non-empty. Empty /
  // undefined → no filter (back-compat). De-duped to avoid sending
  // `code IN (X, X, Y)` to Postgres which is silly but harmless.
  const codeFilter = options.codeFilter ?? [];
  const codeFilterDedupe =
    codeFilter.length > 0 ? Array.from(new Set(codeFilter)) : [];
  const allDefs = await prisma.indicatorDefinition.findMany({
    where: {
      isActive: true,
      ...(codeFilterDedupe.length > 0 && {
        code: { in: codeFilterDedupe },
      }),
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
      // Phase 7.H F4.v2.1 — pulled into the IndicatorDefinitionLike that
      // recomputeIndicator consumes so every IV writes the right
      // provenance stamp without per-call lookup.
      defaultValueSource: true,
      aggregation: true, // 2026-05-31 — snapshot/flow → ctx.aggregation
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
  //
  // Sub-44 architect 💡 closure (industries-empty guard): rollup-bearing
  // defs MUST be sector-agnostic (`industries.length === 0`). A future
  // seed declaring `requiredInputs: ['rollup:...']` with non-empty
  // `industries` would silently fire on ALL parent cos here (parent
  // targets bypass `matchCompaniesToIndicators` industry-filter at
  // `:230`), violating the indicator's own sector restriction. Strict
  // layer-up belongs at seed-author time (`validateRollupSeed` rejects
  // such seeds in `seed-indicators.ts`); this runtime filter is
  // belt-and-braces — drops sector-restricted rollups from the parent
  // pass + logs a warning so any seed that slipped past the loader
  // surfaces in ops logs rather than silently double-counting.
  const allRollupCandidates = defs.filter((d) => isRollupIndicator(d));
  const rollupDefs: typeof allRollupCandidates = [];
  for (const d of allRollupCandidates) {
    if (d.industries.length === 0) {
      rollupDefs.push(d);
    } else {
      // Defensive — should never fire in production if seed-author
      // validation runs at deploy time. Surface if it does.
      logger.pairError?.(
        `rollup-skip/${d.code}`,
        new Error(
          `Rollup-bearing indicator '${d.code}' has non-empty industries [${d.industries.join(',')}] — sector-restricted rollups are not supported (would silently fire on all parent-cos). Seed validation should reject this; runtime guard dropping from parent pass.`,
        ),
      );
    }
  }
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
        baseCurrencyCode: true,
      },
    });
    parentCompanies = filterRollupParentCompanies(parents);
  }

  // Pre-count total pairs (across all years) so the start message is honest.
  // Parent-co × rollup-def pairs do NOT depend on `byYear` membership —
  // the parent rollup needs to refresh for every year a child touched
  // (an op-co writing 2026 means the parent's 2026 rollup is now stale,
  // independent of which sub-cos appear in `affected`).
  //
  // Limitation (sub-44 architect ⚠️): a year NOT in `affected` (i.e. no
  // child wrote it in this batch) won't refresh the parent rollup at
  // that year, even if a sibling IV at that year was updated by another
  // path (e.g. a manual SQL touch, a different /apply call landing
  // mid-flight). The parent's stale-year IV stays at its old value.
  // Mitigation today: every BudgetLine write goes through this trigger,
  // so the only stale paths are out-of-band DB mutation. Future v2
  // could either (a) widen the parent-rollup pass to ALL existing IV
  // years per parent, OR (b) adopt an event-bus invalidation model.
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
    // Phase 10 / Stage B5 — only the companies the caller actually named may
    // carry the caller's revision.
    //
    // `parentCompanies` is every level-1 company in the org, not the imported
    // company's ancestor, and a parent's rollup aggregates N children. A
    // revision raised by importing ONE child names exactly that child in its
    // `companyIds` and one workbook in its `sourceArtifactIds` — so stamping it
    // onto a holding's rollup would have the rollup claim provenance from a
    // source that explains one of its inputs, and would stamp unrelated
    // sub-groups besides. A rollup's real lineage is the union of its
    // children's revisions, which a single `revisionId` cannot express.
    //
    // So parent rollups stay untraced (null → honestly untraced → Provisional)
    // until a revision can speak for an aggregate. That is a gap, and it is a
    // smaller lie than the alternative.
    // A leaf company is traced only if the caller's revision actually names it
    // (`tracedCompanyIds`, when supplied). A parent rollup never is.
    const tracedIds = options.tracedCompanyIds;
    const targets = [
      ...operationalTargets.map((t) => ({
        ...t,
        traced: tracedIds ? tracedIds.has(t.company.id) : true,
      })),
      ...parentTargets.map((t) => ({ ...t, traced: false })),
    ];
    for (const { company, definition, traced } of targets) {
      const defLike: IndicatorDefinitionLike = {
        id: definition.id,
        code: definition.code,
        formula: definition.formula,
        sparklineFormula: definition.sparklineFormula,
        thresholds: definition.thresholds,
        requiredInputs: definition.requiredInputs,
        unit: definition.unit,
        aggregation: definition.aggregation, // 2026-05-31 — snapshot/flow
        // Phase 7.H F4.v2.1 — string-union mirror of the Prisma enum
        // value (1:1 names). Cast through unknown because the generated
        // Prisma enum type isn't structurally identical to our
        // `ValueSource` string union at the TS level.
        defaultValueSource: definition.defaultValueSource as unknown as IndicatorDefinitionLike["defaultValueSource"],
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
          baseCurrency: company.baseCurrencyCode ?? undefined,
          industry: company.industry ?? null,
          // Phase 10 / Stage B5 — undefined on every legacy caller, which
          // leaves the row `revisionId = null` as before. A parent rollup is
          // never traced to a caller's revision (see `traced` above).
          revisionId: traced ? options.revisionId : undefined,
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

  // Phase 7.E C6 v3.1 (Turn IV) — wire AlertEvent persistence into the
  // recompute pipeline. Runs after the IV writes succeed so the AlertEvent
  // log always reflects the matrix the matrix endpoint surfaces. Belt-
  // and-braces try/catch: an alert-persist failure must not crash the
  // import that already wrote IVs successfully. Per-period isolation is
  // already provided by the helper itself; the outer catch handles a
  // catastrophic init failure (e.g. org row vanished mid-flight, settings
  // fetch threw before the per-period loop) and surfaces it via the
  // sentinel period `__init__` — distinguishes "helper crashed before
  // touching any period" from "period 2025 specifically failed".
  let alertEvents: RunRecomputeResult['alertEvents'];
  try {
    const periods = years.map((y) => String(y));
    const out = await evaluateAndPersistAlertsForPeriods(
      prisma,
      { organizationId, periods },
      {
        periodError: (period, err) =>
          logger.alertPersistError?.(period, err),
      },
    );
    alertEvents = {
      periodsPersisted: out.periodsPersisted,
      totalCreated: out.totalCreated,
      totalDeleted: out.totalDeleted,
      failed: out.failed,
    };
  } catch (err) {
    // Catastrophic init failure — surface as ONE error labeled with the
    // sentinel `__init__` rather than N identical "year=YYYY" calls.
    // Closes architect Turn-IV ⚠️ #1 (fault-mode conflation): consumers
    // can dedupe / route differently for init vs per-period failures.
    logger.alertPersistError?.(ALERT_PERSIST_INIT_LABEL, err);
    alertEvents = {
      periodsPersisted: 0,
      totalCreated: 0,
      totalDeleted: 0,
      failed: years.length,
    };
  }

  // Financial-truth-infra Phase E.5 — post-recompute snapshot verify
  // for locked periods. If a fiscal period was signed off (PeriodSnapshot
  // exists) but the recompute just wrote IVs that hash differently,
  // emit `period_snapshot_drift` audit event. Best-effort: a verify
  // failure never breaks the recompute pipeline (try/catch around it).
  //
  // The locked-period list comes from Organization.lockedPeriods; the
  // helper matches by string equality against ALL touched periods.
  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { lockedPeriods: true },
    });
    if (org) {
      const locks = parseLockedPeriods(org.lockedPeriods);
      for (const year of years) {
        const period = String(year);
        if (!isPeriodLockedInList(locks, period)) continue;
        const verifyResult = await verifyPeriodSnapshot(prisma, organizationId, period);
        if (verifyResult.hasSnapshot && !verifyResult.matches) {
          await prisma.auditEvent.create({
            data: {
              organizationId,
              actorUserId: null,
              action: 'period_snapshot_drift',
              entityType: 'Organization',
              entityId: organizationId,
              metadata: {
                period,
                ivHashMatched: verifyResult.snapshot?.ivHash === verifyResult.current.ivHash,
                budgetHashMatched: verifyResult.snapshot?.budgetHash === verifyResult.current.budgetHash,
                snapshotSignedAt: verifyResult.snapshot?.signedAt.toISOString(),
                triggeredBy: 'recompute-trigger',
              },
            },
          });
          logger.alertPersistError?.(period, new Error(
            `period_snapshot_drift: locked period ${period} hash diverged from signoff baseline`,
          ));
        }
      }
    }
  } catch {
    // Snapshot verify is non-essential — silently swallow any failure
    // (e.g. mock-Prisma in tests doesn't stub organization.findUnique,
    // or org row vanished mid-recompute). Real drift is captured via
    // the audit-event write above; an init failure is not user-visible
    // drift, so we don't pollute the per-period error stream.
  }

  return { ok, unknown, failed, targets: totalPairs, alertEvents };
}

/**
 * Sentinel period label emitted on `alertPersistError` when the
 * post-recompute alert-persist helper throws before reaching its
 * per-period loop (init failure: settings fetch / company fetch / etc.).
 * Distinguishes "1 root-cause init failure" from "5 period-specific
 * failures" in consumer logs (architect Turn-IV ⚠️ #1 closure).
 */
export const ALERT_PERSIST_INIT_LABEL = '__init__';
