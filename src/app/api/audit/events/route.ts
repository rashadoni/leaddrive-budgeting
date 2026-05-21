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
      // Fetch limit+1 so we can detect `hasMore` without a separate count
      // query — the (limit+1)-th row is dropped from the response and its
      // existence signals "more pages to come".
      const rows = await tx.auditEvent.findMany({
        where,
        select: {
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
        },
        // Composite-cursor secondary key: `id` DESC ties the order on
        // same-ms rows so the keyset OR-clause in `buildAuditEventsWhere`
        // produces deterministic, gap-free pagination.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: parsed.filters.limit + 1,
      });

      type Row = (typeof rows)[number];

      // Phase 7.F sub-group RBAC — filter events whose entity sits in a
      // company outside the caller's scope. admin → scope.ids === null →
      // no filtering (full visibility, current behavior preserved).
      let scopedRows: Row[] = rows;
      if (scope.ids != null) {
        // entityId is String? — filter nulls before passing to Prisma `in`
        const ivEventIds = rows
          .filter((r: Row) => r.entityType === 'IndicatorValue' && r.entityId != null)
          .map((r: Row) => r.entityId as string);
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
        scopedRows = rows.filter((r: Row) => {
          // entityId is non-null on Company / IV events (audit writer always sets it)
          if (r.entityType === 'Company') return scope.ids!.has(r.entityId!);
          if (r.entityType === 'IndicatorValue') {
            const cid = ivCompanyMap.get(r.entityId!);
            return cid != null && scope.ids!.has(cid);
          }
          return true;
        });
      }

      const hasMore = scopedRows.length > parsed.filters.limit;
      const page: Row[] = hasMore
        ? scopedRows.slice(0, parsed.filters.limit)
        : scopedRows;
      const nextCursor =
        hasMore && page.length > 0
          ? `${page[page.length - 1].createdAt.toISOString()}|${page[page.length - 1].id}`
          : null;

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
