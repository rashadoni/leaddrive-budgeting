/**
 * Phase 7.F audit-wiring — shared helpers for import paths.
 *
 * Every import path (`POST /api/onboarding/import/budget`, the AI Mapper
 * staging-apply route, future AI Auto Import multi-file orchestrator)
 * commits BudgetLine writes, triggers an IndicatorValue recompute, then
 * needs to emit an `import_budget_create` audit event with identical
 * metadata shape. Centralising emission here means a future variant —
 * staging applier, rerun-from-cron, third-party importer — can't
 * accidentally skip the audit.
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

/**
 * Phase B Turn-25 — emit `budget_plan_create` from `POST /api/budgeting/plans`.
 *
 * Wraps `logAuditEvent` with the discriminated event so call-sites
 * don't have to reach for the raw logger. Same never-throws contract.
 *
 * `scope` carries the periodicity hint (`yearly` / `quarterly` / `monthly`)
 * so the audit row reproduces the exact period a user picked. Optional
 * because legacy plans pre-Turn-25 didn't always have it.
 */
export async function logBudgetPlanCreate(
  prisma: PrismaClient,
  args: {
    organizationId: string;
    actorUserId: string | null;
    planId: string;
    planName: string;
    year: number;
    scope?: string;
    context?: Partial<AuditEventContext>;
  },
): Promise<LogAuditEventResult> {
  return logAuditEvent(prisma, {
    organizationId: args.organizationId,
    actorUserId: args.actorUserId || null,
    event: {
      action: 'budget_plan_create',
      entityType: 'BudgetPlan',
      entityId: args.planId,
      metadata: {
        planName: args.planName,
        year: args.year,
        ...(args.scope ? { scope: args.scope } : {}),
      },
    },
    context: args.context ? buildAuditContext(args.context) : null,
  });
}

/**
 * Phase B Turn-25 — emit `budget_plan_approve` from `PUT /api/budgeting/plans/[id]`
 * approve/reject branch. `priorStatus` records the transition source so
 * audit consumers can distinguish first-approval vs approve-after-reject.
 */
export async function logBudgetPlanApprove(
  prisma: PrismaClient,
  args: {
    organizationId: string;
    actorUserId: string | null;
    planId: string;
    planName: string;
    approvedBy: string;
    priorStatus: string;
    context?: Partial<AuditEventContext>;
  },
): Promise<LogAuditEventResult> {
  return logAuditEvent(prisma, {
    organizationId: args.organizationId,
    actorUserId: args.actorUserId || null,
    event: {
      action: 'budget_plan_approve',
      entityType: 'BudgetPlan',
      entityId: args.planId,
      metadata: {
        planName: args.planName,
        approvedBy: args.approvedBy,
        priorStatus: args.priorStatus,
      },
    },
    context: args.context ? buildAuditContext(args.context) : null,
  });
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
