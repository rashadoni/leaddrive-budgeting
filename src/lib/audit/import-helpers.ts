/**
 * Phase 7.F audit-wiring — shared helpers for import paths.
 *
 * Both the API route (`POST /api/onboarding/import/budget`) and the CLI
 * script (`scripts/import-azmade-budgets.ts`) commit BudgetLine writes,
 * trigger an IndicatorValue recompute, then need to emit an
 * `import_budget_create` audit event with identical metadata shape.
 *
 * Without this helper the two paths drift: the CLI script went six months
 * with no emission at all (Turn-17 backfill via psql was the symptom),
 * which broke the `/budgeting/audit` page until manual rows were
 * inserted. Centralising emission here means a future variant — staging
 * applier, rerun-from-cron, third-party importer — can't accidentally
 * skip the audit.
 *
 * Contract:
 *  - never throws (delegates to `logAuditEvent`'s never-throws guarantee).
 *  - caller passes the post-commit / post-recompute counters; this
 *    function does NOT mutate or re-derive them.
 *  - `actorUserId: null` is the correct value for CLI / cron / system
 *    callers (renders as italic "system" in `AuditFeed`).
 */

import type { PrismaClient } from '@prisma/client';
import {
  logAuditEvent,
  buildAuditContext,
  type AuditEventContext,
  type LogAuditEventResult,
} from './log';

export interface ImportBudgetCreateArgs {
  organizationId: string;
  /** null for CLI / cron / system callers — they have no human actor. */
  actorUserId: string | null;
  planId: string;
  companyId: string;
  companyCode: string;
  year: number;
  parser: 'sopl' | 'rollup';
  inserted: number;
  deleted: number;
  warnings: number;
  parentRollupsDropped: number;
  parentRollupsUnallocated: number;
  recompute: { ok: number; unknown: number; failed: number; targets: number };
  /** Optional forensics context — set by the API route from headers; the
   *  CLI script passes a fixed marker so post-hoc DB queries can tell a
   *  CLI-emitted row apart from an API-emitted one. */
  context?: Partial<AuditEventContext>;
}

export async function logImportBudgetCreate(
  prisma: PrismaClient,
  args: ImportBudgetCreateArgs,
): Promise<LogAuditEventResult> {
  return logAuditEvent(prisma, {
    organizationId: args.organizationId,
    // Defensive coerce: an empty-string `actorUserId` from a buggy caller
    // (e.g. a CLI script reading an unset env var) would otherwise be
    // written as a literal "" actor — `logAuditEvent` only guards against
    // empty `organizationId`. Treat falsy as system / CLI.
    actorUserId: args.actorUserId || null,
    event: {
      action: 'import_budget_create',
      entityType: 'BudgetPlan',
      entityId: args.planId,
      metadata: {
        companyId: args.companyId,
        companyCode: args.companyCode,
        year: args.year,
        parser: args.parser,
        inserted: args.inserted,
        deleted: args.deleted,
        warnings: args.warnings,
        parentRollupsDropped: args.parentRollupsDropped,
        parentRollupsUnallocated: args.parentRollupsUnallocated,
        recompute: args.recompute,
      },
    },
    context: args.context ? buildAuditContext(args.context) : null,
  });
}
