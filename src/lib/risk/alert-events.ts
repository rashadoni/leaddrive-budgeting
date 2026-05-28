/**
 * Phase 7.E C6 v3 (Turn III) — server-side AlertEvent persistence helper.
 *
 * Companion to in-memory `evaluateAlertRules`: writes match output to the
 * `alert_events` table for replay / digest emails / audit trail. The
 * existing `Alert` model is user-acknowledgeable inbox-style and stays
 * untouched; AlertEvent is a separate immutable per-recompute log.
 *
 * Persistence semantics — "current state" model:
 *   1. Delete every existing AlertEvent with the same `(organizationId,
 *      period)` (transaction-scoped, all-or-nothing).
 *   2. Insert the fresh match set with `createMany`.
 *   3. Both steps execute inside the same `prisma.$transaction` so a
 *      crash mid-replay leaves the prior state intact.
 *
 * Idempotency: re-running with the same matches replaces the previous
 * row set; `emittedAt` is bumped to `now()` for every row so historical
 * drift can be ordered by run time. Caller pre-decides whether to call
 * (e.g. recompute pipeline runs it once at end; admin replay endpoints
 * may run it on demand).
 *
 * Wire-in (deferred to v3.1, Turn IV+): caller side at recompute end +
 * GET endpoint for replay queries. This module is the pure write path
 * only — no cross-cutting concerns (audit log emission, SSE notify) so
 * that v3.1 can decide which of those to add per call site.
 */

import type { PrismaClient, Prisma } from '@prisma/client';
import type { AlertMatch } from './alert-rules';

export interface PersistAlertEventsArgs {
  organizationId: string;
  period: string;
  matches: readonly AlertMatch[];
}

export interface PersistAlertEventsResult {
  deleted: number;
  created: number;
}

/**
 * Replace the AlertEvent rows for `(organizationId, period)` with the
 * given match set. Atomic via `prisma.$transaction`. Empty `matches`
 * input is a valid "clear" — the period's prior alert log is wiped and
 * no new rows are written.
 *
 * Caller responsibility: pass the same `period` string the matrix +
 * recompute use (annual `YYYY` or monthly `YYYY-MM`). This helper does
 * not validate the format; that's the recompute pipeline's job (and
 * `parsePeriod` already gates the API surface).
 */
export async function persistAlertEvents(
  // Phase 8 D5(b) — accept TransactionClient too so callers wrapped
  // in `withOrgScope` (BullMQ recompute-processor) thread the tx.
  prisma: PrismaClient | Prisma.TransactionClient,
  args: PersistAlertEventsArgs,
): Promise<PersistAlertEventsResult> {
  const { organizationId, period, matches } = args;

  const rows: Prisma.AlertEventCreateManyInput[] = matches.map((m) => ({
    organizationId,
    period,
    ruleId: m.ruleId,
    ruleName: m.ruleName,
    severity: m.severity,
    message: m.message,
    messageKey: m.messageKey,
    messageParams: m.messageParams as Prisma.InputJsonValue,
    affectedCompanyIds: [...m.affectedCompanyIds],
    affectedIndicatorCodes: m.affectedIndicatorCodes
      ? [...m.affectedIndicatorCodes]
      : [],
  }));

  // Phase 8 D5(b) — if the caller already passed a TransactionClient
  // (RLS-wrapped from withOrgScope), reuse it instead of opening a
  // nested $transaction. Detection via `$transaction` method presence
  // mirrors the dual-mode pattern in import-batch.ts / bs-import-batch.
  const hasTx = "$transaction" in prisma
  const run = async (tx: Prisma.TransactionClient) => {
    const del = await tx.alertEvent.deleteMany({
      where: { organizationId, period },
    });
    if (rows.length === 0) {
      return { deleted: del.count, created: 0 };
    }
    const ins = await tx.alertEvent.createMany({ data: rows });
    return { deleted: del.count, created: ins.count };
  }
  return hasTx
    ? (prisma as PrismaClient).$transaction(run)
    : run(prisma as Prisma.TransactionClient)
}
