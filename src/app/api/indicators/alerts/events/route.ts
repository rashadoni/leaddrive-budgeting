/**
 * Phase 7.E C6 v3.2 (Turn IV) — latest AlertEvent snapshot read API.
 *
 * GET /api/indicators/alerts/events
 *
 * Query string:
 *   period       — REQUIRED (`YYYY`, `YYYY-Qn`, or `YYYY-MM`; parsed by
 *                   the shared period helper)
 *   ruleId?      — narrow to a specific rule (e.g. `RULE_CRITICAL_INDICATOR`)
 *   cursor?      — opaque composite `<ISO-8601>|<id>` keyset boundary.
 *                   Usually the last returned row; for restricted scans it
 *                   may be the last safely inspected raw row.
 *   limit?       — page size (default 50, max 200).
 *
 * Auth: `requireAuth` (any org member), followed by subgroup company scope.
 * Restricted users receive only events whose entire affected-company set is
 * inside their allowed scope.
 *
 * Response shape:
 *   {
 *     events: Array<{ id, period, ruleId, ruleName, severity, message,
 *                     messageKey, messageParams, affectedCompanyIds,
 *                     affectedIndicatorCodes, emittedAt: ISO-8601 }>,
 *     nextCursor: "<ISO-8601>|<id>" | null,
 *     hasMore: boolean,
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { withOrgScope } from '@/lib/db/with-org-scope';
import { requireAuth, isAuthError } from '@/lib/api-auth';
import { parsePeriod, PeriodParseError } from '@/lib/risk/periods';
import { getCompanyScope } from '@/lib/rbac/company-scope';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_SCOPE_SCAN_BATCHES = 20;

interface ParsedCursor {
  emittedAt: Date;
  id: string;
}

function parseCursor(raw: string | null): ParsedCursor | null | 'invalid' {
  if (raw === null || raw === '') return null;
  const sepIdx = raw.indexOf('|');
  if (sepIdx <= 0) return 'invalid';
  const isoPart = raw.slice(0, sepIdx);
  const idPart = raw.slice(sepIdx + 1);
  if (idPart.length === 0) return 'invalid';
  const d = new Date(isoPart);
  if (Number.isNaN(d.getTime())) return 'invalid';
  return { emittedAt: d, id: idPart };
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (isAuthError(auth)) return auth;
  const { orgId } = auth;
  if (!orgId) {
    return NextResponse.json({ error: 'User has no organization' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);

  const period = searchParams.get('period');
  if (!period) {
    return NextResponse.json(
      { error: '`period` is required (e.g. ?period=2025).' },
      { status: 400 },
    );
  }
  try {
    parsePeriod(period);
  } catch (err) {
    if (err instanceof PeriodParseError) {
      return NextResponse.json(
        { error: 'Invalid period', message: err.message },
        { status: 400 },
      );
    }
    throw err;
  }

  const ruleId = searchParams.get('ruleId');
  if (ruleId !== null && ruleId.trim() === '') {
    return NextResponse.json(
      { error: '`ruleId`, when supplied, must be non-empty.' },
      { status: 400 },
    );
  }

  const cursor = parseCursor(searchParams.get('cursor'));
  if (cursor === 'invalid') {
    return NextResponse.json(
      {
        error:
          '`cursor` must be `<ISO-8601>|<id>` (composite keyset cursor — see route docstring).',
      },
      { status: 400 },
    );
  }

  let limit = DEFAULT_LIMIT;
  const limitRaw = searchParams.get('limit');
  if (limitRaw !== null) {
    const parsed = Number(limitRaw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
      return NextResponse.json(
        { error: '`limit` must be a positive integer.' },
        { status: 400 },
      );
    }
    if (parsed > MAX_LIMIT) {
      return NextResponse.json(
        { error: `\`limit\` must be ≤ ${MAX_LIMIT}.` },
        { status: 400 },
      );
    }
    limit = parsed;
  }

  // Composite (emittedAt, id) keyset DESC — same shape as audit route
  // (Turn-U) so same-ms ties don't drop rows when a recompute pass
  // commits all events at once.
  const where: {
    organizationId: string;
    period: string;
    ruleId?: string;
    OR?: Array<{
      emittedAt: { lt: Date } | { equals: Date };
      id?: { lt: string };
    }>;
    affectedCompanyIds?: { hasSome: string[] };
    NOT?: { affectedCompanyIds: { hasSome: string[] } };
  } = {
    organizationId: orgId,
    period,
  };
  if (ruleId !== null) where.ruleId = ruleId;
  if (cursor !== null) {
    where.OR = [
      { emittedAt: { lt: cursor.emittedAt } },
      { emittedAt: { equals: cursor.emittedAt }, id: { lt: cursor.id } },
    ];
  }

  // Phase 7.F subgroup RBAC: aggregated rule messages can contain company
  // counts and IDs, so a partially overlapping event cannot be sanitized by
  // trimming the array after the query. Restricted users receive only events
  // whose complete affected-company set sits inside their allowed scope.
  // Empty affected sets are also hidden because their visibility cannot be
  // established at company level. Admin/full-scope behavior is unchanged.
  const scope = await getCompanyScope(orgId, auth.userId, auth.role);

  // Fetch limit+1 to detect `hasMore` without a separate count query. For a
  // restricted user, stale company IDs require a defensive post-filter that
  // Prisma array predicates cannot express. Scan additional keyset batches so
  // filtered rows cannot silently truncate access to later allowed events.
  const pageResult = await withOrgScope(orgId, async (tx) => {
    const scopedWhere = { ...where };
    let allowedIdSet: Set<string> | null = null;
    if (scope.ids !== null) {
      const companyRows = await tx.company.findMany({
        where: { organizationId: orgId },
        select: { id: true },
      });
      const orgCompanyIds = companyRows.map((company: { id: string }) => company.id);
      const allowedIds = orgCompanyIds.filter((id: string) => scope.ids!.has(id));
      if (allowedIds.length === 0) {
        return { rows: [], scanCursor: null, scanCapped: false };
      }
      allowedIdSet = new Set(allowedIds);
      const excludedIds = orgCompanyIds.filter((id: string) => !scope.ids!.has(id));
      scopedWhere.affectedCompanyIds = { hasSome: allowedIds };
      if (excludedIds.length > 0) {
        scopedWhere.NOT = { affectedCompanyIds: { hasSome: excludedIds } };
      }
    }
    const select = {
      id: true,
      period: true,
      ruleId: true,
      ruleName: true,
      severity: true,
      message: true,
      messageKey: true,
      messageParams: true,
      affectedCompanyIds: true,
      affectedIndicatorCodes: true,
      emittedAt: true,
    } as const;
    const orderBy = [{ emittedAt: 'desc' as const }, { id: 'desc' as const }];

    if (allowedIdSet === null) {
      const rows = await tx.alertEvent.findMany({
        where: scopedWhere,
        select,
        orderBy,
        take: limit + 1,
      });
      return { rows, scanCursor: null, scanCapped: false };
    }

    // Defense in depth for stale company IDs that no longer appear in the
    // organization company table. Prisma's array filters can exclude current
    // out-of-scope IDs, but cannot express "every element belongs to this
    // allow-list". Conservatively omit an event if any referenced ID is
    // unknown. The bounded loop continues from the last scanned raw row so a
    // stale row in the middle cannot make later allowed rows unreachable.
    const rows: Prisma.AlertEventGetPayload<{ select: typeof select }>[] = [];
    let scanCursor: ParsedCursor | null = cursor;
    let exhausted = false;
    let batches = 0;
    const batchSize = limit + 1;

    while (rows.length < limit + 1 && batches < MAX_SCOPE_SCAN_BATCHES) {
      batches += 1;
      const pageWhere = { ...scopedWhere };
      if (scanCursor) {
        pageWhere.OR = [
          { emittedAt: { lt: scanCursor.emittedAt } },
          { emittedAt: { equals: scanCursor.emittedAt }, id: { lt: scanCursor.id } },
        ];
      } else {
        delete pageWhere.OR;
      }
      const candidates = await tx.alertEvent.findMany({
        where: pageWhere,
        select,
        orderBy,
        take: batchSize,
      });
      if (candidates.length === 0) {
        exhausted = true;
        break;
      }

      const lastScanned = candidates[candidates.length - 1];
      scanCursor = { emittedAt: lastScanned.emittedAt, id: lastScanned.id };
      for (const row of candidates) {
        if (
          row.affectedCompanyIds.length > 0 &&
          row.affectedCompanyIds.every((companyId) => allowedIdSet!.has(companyId))
        ) {
          rows.push(row);
          if (rows.length === limit + 1) break;
        }
      }
      if (candidates.length < batchSize) {
        exhausted = true;
        break;
      }
    }

    const scanCapped = rows.length <= limit && !exhausted;
    return { rows, scanCursor: scanCapped ? scanCursor : null, scanCapped };
  });

  const rows = pageResult.rows;
  const hasMore = rows.length > limit || pageResult.scanCapped;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const cursorSource = rows.length > limit ? last : pageResult.scanCursor;
  const nextCursor = hasMore && cursorSource
    ? `${cursorSource.emittedAt.toISOString()}|${cursorSource.id}`
    : null;

  type Row = (typeof page)[number];
  const events = page.map((r: Row) => ({
    id: r.id,
    period: r.period,
    ruleId: r.ruleId,
    ruleName: r.ruleName,
    severity: r.severity,
    message: r.message,
    messageKey: r.messageKey,
    messageParams: r.messageParams,
    affectedCompanyIds: r.affectedCompanyIds,
    affectedIndicatorCodes: r.affectedIndicatorCodes,
    emittedAt: r.emittedAt.toISOString(),
  }));

  return NextResponse.json(
    { events, nextCursor, hasMore },
    {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
