/**
 * Phase 7.E C6 v3.2 (Turn IV) — AlertEvent replay read API.
 *
 * GET /api/indicators/alerts/events
 *
 * Query string:
 *   period       — REQUIRED (4-digit year `YYYY` or `YYYY-MM`; mirrors
 *                   matrix endpoint's `parsePeriod` regex)
 *   ruleId?      — narrow to a specific rule (e.g. `RULE_CRITICAL_INDICATOR`)
 *   cursor?      — composite `<ISO-8601>|<id>` of the last row from the
 *                   previous page; opaque to client. Mirrors the audit
 *                   route's keyset pattern (Turn-U closure).
 *   limit?       — page size (default 50, max 200).
 *
 * Auth: `requireAuth` (any org member). AlertEvents are not more
 * sensitive than the live alerts already shown in the HeatMap UI, so the
 * gate is intentionally lower than `/api/audit/events` (manager-only).
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
import { prisma } from '@/lib/prisma';
import { requireAuth, isAuthError } from '@/lib/api-auth';
import { parsePeriod, PeriodParseError } from '@/lib/risk/periods';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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

  // Fetch limit+1 to detect `hasMore` without a separate count query.
  const rows = await prisma.alertEvent.findMany({
    where,
    select: {
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
    },
    orderBy: [{ emittedAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? `${last.emittedAt.toISOString()}|${last.id}` : null;

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
