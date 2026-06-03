/**
 * Phase 7.F (Turn 12) — audit log read API.
 *
 * GET /api/audit/events
 *
 * Query string:
 *   action?       — one of `AuditAction` enum members
 *   entityType?   — free-form Prisma model name ("Company", "BudgetPlan", ...)
 *   actorUserId?  — narrow to a specific actor
 *   from?         — ISO-8601 inclusive lower bound (default: now − 30 days)
 *   to?           — ISO-8601 inclusive upper bound (default: now)
 *   cursor?       — composite `<ISO-8601>|<id>` of the last row in the
 *                   previous page. Treated as opaque by the client —
 *                   pass back what the server returned in `nextCursor`.
 *                   Note: a stale browser-side cursor in bare-ISO format
 *                   (cached across the Turn-U deploy boundary) yields a
 *                   transient 400; user clicks "Load more" again and
 *                   re-paginates from the current top — acceptable and
 *                   self-healing within one click.
 *   limit?        — page size (default 50, max 200)
 *
 * Auth: `manager` role + same-org. The audit log can leak business-impact
 * information (which companies got imports, which thresholds were
 * overridden, who approved budget plans), so viewer-tier users are not
 * granted access in this MVP.
 *
 * Response shape:
 *   {
 *     events: Array<{
 *       id, action, entityType, entityId, metadata, context,
 *       actor: { id, name, email } | null,
 *       createdAt: ISO-8601
 *     }>,
 *     nextCursor: "<ISO-8601>|<id>" | null,  // null = no more rows
 *     hasMore: boolean,
 *   }
 *
 * Pagination is composite-cursor keyset on `(createdAt, id)` DESC (Phase
 * 7.G Turn U — closes Turn-25 architect ⚠️ on same-ms tie correctness).
 * Strict `lt: cursor.createdAt` would drop (limit+1)-th and beyond rows
 * sharing an exact ms; the composite cursor breaks ties via `id` (cuid
 * is roughly time-ordered) as a stable secondary key. See jsdoc on
 * `buildAuditEventsWhere` for the OR-clause shape.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  parseAuditEventsQuery,
  buildAuditEventsWhere,
} from '@/lib/audit/list';
import { getCompanyScope } from '@/lib/rbac/company-scope';
// Phase 5.2 Stage 2 Tier 2 (2026-05-21) — RLS wrap for audit_events + indicator_values reads.
import { withOrgScope } from '@/lib/db/with-org-scope';

const RATE_LIMIT = { name: 'audit-events-list', max: 60, windowMs: 60_000 };

export async function GET(request: NextRequest) {
  const session = await requireRole(request, 'manager');
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json(
      { error: 'User has no organization' },
      { status: 403 },
    );
  }

  // `requireRole` + `isAuthError` already guarantee `session.userId` is
  // populated (api-auth.ts 401s on missing session); rate-limit key is
  // therefore (orgId, userId) — never falls back to IP.
  const rateLimitError = enforceRateLimit(
    `${RATE_LIMIT.name}:${session.orgId}:${session.userId}`,
    RATE_LIMIT,
  );
  if (rateLimitError) return rateLimitError;

  const { searchParams } = new URL(request.url);
  const parsed = parseAuditEventsQuery(searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const where = buildAuditEventsWhere(parsed.filters, session.orgId);

  // getCompanyScope queries user + company tables (Tier 4 — not yet
  // RLS-protected). Keep it OUTSIDE withOrgScope so the scope object is
  // available inside the callback via closure without prop-drilling.
  const scope = await getCompanyScope(session.orgId, session.userId, session.role);

  // Phase 5.2 Stage 2 Tier 2 — both `audit_events` and `indicator_values`
  // will be RLS-protected. Wrap all reads in a single withOrgScope
  // transaction so SET LOCAL is in scope for both table queries.
  const { events, hasMore, nextCursor } = await withOrgScope(
    session.orgId,
    async (tx) => {
      const limit = parsed.filters.limit;

      const eventSelect = {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        context: true,
        createdAt: true,
        actor: {
          select: { id: true, name: true, email: true },
        },
      } satisfies Prisma.AuditEventSelect;
      type Row = Prisma.AuditEventGetPayload<{ select: typeof eventSelect }>;

      // Phase 7.F sub-group RBAC — drop events whose entity sits in a company
      // outside the caller's scope. admin → scope.ids === null → no filtering
      // (full visibility, current behaviour preserved). Re-resolves the
      // IndicatorValue→company map per batch (entityId is a free-text column,
      // not a relation FK, so this can't be expressed in the Prisma `where`).
      const applyScope = async (batch: Row[]): Promise<Row[]> => {
        if (scope.ids == null) return batch;
        const ivEventIds = batch
          .filter((r) => r.entityType === 'IndicatorValue' && r.entityId != null)
          .map((r) => r.entityId as string);
        const ivCompanyMap = new Map<string, string>();
        if (ivEventIds.length > 0) {
          const ivs = await tx.indicatorValue.findMany({
            where: { id: { in: ivEventIds }, organizationId: session.orgId },
            select: { id: true, companyId: true },
          });
          for (const iv of ivs as Array<{ id: string; companyId: string }>) {
            ivCompanyMap.set(iv.id, iv.companyId);
          }
        }
        return batch.filter((r) => {
          // entityId is non-null on Company / IV events (audit writer always sets it)
          if (r.entityType === 'Company') return scope.ids!.has(r.entityId!);
          if (r.entityType === 'IndicatorValue') {
            const cid = ivCompanyMap.get(r.entityId!);
            return cid != null && scope.ids!.has(cid);
          }
          return true;
        });
      };

      // Loop-page until we have limit+1 IN-SCOPE rows (enough to know there is
      // at least one more page) or the source window is exhausted. This
      // replaces the previous single `take=limit+1` fetch, which derived
      // hasMore/nextCursor from the POST-RBAC-filter array — so any window
      // whose limit+1 RAW rows contained an out-of-scope Company/IndicatorValue
      // event reported hasMore=false and silently TRUNCATED a scoped manager's
      // audit trail (a compliance gap). MAX_SCAN_ROUNDS bounds the worst case
      // for a manager whose in-scope events are very sparse in a large window;
      // on the cap we return a partial page plus a cursor at the last RAW row
      // so the client can resume the scan rather than lose deeper in-scope rows.
      const BATCH = limit + 1;
      const MAX_SCAN_ROUNDS = 25;
      const collected: Row[] = [];
      let advanceCursor = parsed.filters.cursor;
      let exhausted = false;
      let rounds = 0;

      while (collected.length <= limit && !exhausted && rounds < MAX_SCAN_ROUNDS) {
        rounds++;
        const batchWhere = buildAuditEventsWhere(
          { ...parsed.filters, cursor: advanceCursor },
          session.orgId,
        );
        const batch = await tx.auditEvent.findMany({
          where: batchWhere,
          select: eventSelect,
          // Composite-cursor secondary key: `id` DESC ties the order on
          // same-ms rows so the keyset OR-clause in `buildAuditEventsWhere`
          // produces deterministic, gap-free pagination.
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: BATCH,
        });
        if (batch.length < BATCH) exhausted = true;
        if (batch.length === 0) break;
        const lastRaw = batch[batch.length - 1];
        advanceCursor = { createdAt: lastRaw.createdAt, id: lastRaw.id };
        collected.push(...(await applyScope(batch)));
      }

      let hasMore: boolean;
      let page: Row[];
      let nextCursor: string | null;
      if (collected.length > limit) {
        // Enough in-scope rows to fill the page and prove there is ≥1 more.
        hasMore = true;
        page = collected.slice(0, limit);
        const last = page[page.length - 1];
        nextCursor = `${last.createdAt.toISOString()}|${last.id}`;
      } else if (!exhausted && advanceCursor) {
        // Hit the scan cap with a partial page but the window is not exhausted:
        // return what we have and let the client resume the RAW scan from the
        // last scanned row, so no deeper in-scope row is silently dropped.
        hasMore = true;
        page = collected;
        nextCursor = `${advanceCursor.createdAt.toISOString()}|${advanceCursor.id}`;
      } else {
        hasMore = false;
        page = collected;
        nextCursor = null;
      }

      return { events: page, hasMore, nextCursor };
    },
  );

  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      metadata: e.metadata,
      context: e.context,
      actor: e.actor,
      createdAt: e.createdAt.toISOString(),
    })),
    nextCursor,
    hasMore,
  });
}
