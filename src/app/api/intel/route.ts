/**
 * Phase 7.G Turn XLII (Phase D.1) — IntelItem list endpoint.
 *
 * GET /api/intel
 *
 * Query string:
 *   industry?    — filter by industry tag (must match exactly one
 *                  entry in `industryTags`).
 *   company?     — filter by company tag (matches one entry in
 *                  `companyTags`).
 *   minRelevance? — filter to items with `relevanceScore >= N`
 *                  (0..1, default 0).
 *   includeDismissed? — `true` to return items the caller has
 *                  dismissed; default false (the dismiss button on
 *                  the UI hides them).
 *   cursor?      — composite `<ISO-8601>|<id>` keyset cursor; mirrors
 *                  the alert-events + audit-events shape.
 *   limit?       — page size (default 50, max 200).
 *
 * Auth: `requireAuth` (any org member). Same tier as alerts feed —
 * intel items are not more sensitive than what the Risk Terminal
 * already shows.
 *
 * Response:
 *   {
 *     items: IntelItemDTO[],   // see lib/intel/types.ts
 *     nextCursor: string | null,
 *     hasMore: boolean,
 *   }
 *
 * Phase D.1 NOTE: until Phase D.2 ships the actual crawler, this list
 * will be empty for orgs that haven't been seeded manually. The
 * endpoint contract is locked NOW so the UI panel (Phase D.4) can
 * wire to it without churn at swap time.
 */

import { NextRequest, NextResponse } from 'next/server';
import type { IntelItem } from '@prisma/client';
import { withOrgScope } from '@/lib/db/with-org-scope';
import { requireAuth, isAuthError } from '@/lib/api-auth';
import { intelItemToDTO } from '@/lib/intel/types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

interface ParsedCursor {
  fetchedAt: Date;
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
  return { fetchedAt: d, id: idPart };
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (isAuthError(auth)) return auth;
  const { orgId, userId } = auth;

  if (!orgId) {
    return NextResponse.json(
      { error: 'User has no organization' },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);

  // Optional filters.
  const industryFilter = searchParams.get('industry');
  if (industryFilter !== null && industryFilter.trim() === '') {
    return NextResponse.json(
      { error: '`industry`, when supplied, must be non-empty.' },
      { status: 400 },
    );
  }
  const companyFilter = searchParams.get('company');
  if (companyFilter !== null && companyFilter.trim() === '') {
    return NextResponse.json(
      { error: '`company`, when supplied, must be non-empty.' },
      { status: 400 },
    );
  }

  const minRelevanceRaw = searchParams.get('minRelevance');
  let minRelevance = 0;
  if (minRelevanceRaw !== null) {
    const parsed = Number(minRelevanceRaw);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      return NextResponse.json(
        {
          error:
            '`minRelevance` must be a number in [0, 1] (default 0).',
        },
        { status: 400 },
      );
    }
    minRelevance = parsed;
  }

  const includeDismissed =
    searchParams.get('includeDismissed') === 'true';

  // Cursor + limit.
  const cursor = parseCursor(searchParams.get('cursor'));
  if (cursor === 'invalid') {
    return NextResponse.json(
      {
        error:
          '`cursor` must be `<ISO-8601>|<id>` (composite keyset cursor).',
      },
      { status: 400 },
    );
  }

  const limitRaw = searchParams.get('limit');
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== null) {
    const parsed = Number(limitRaw);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
      return NextResponse.json(
        {
          error: `\`limit\` must be a number in [1, ${MAX_LIMIT}] (default ${DEFAULT_LIMIT}).`,
        },
        { status: 400 },
      );
    }
    limit = Math.floor(parsed);
  }

  // Build the WHERE clause.
  const where: {
    organizationId: string;
    relevanceScore?: { gte: number };
    industryTags?: { has: string };
    companyTags?: { has: string };
    OR?: Array<{
      fetchedAt: { lt: Date } | { equals: Date };
      id?: { lt: string };
    }>;
    NOT?: { dismissedBy: { has: string } };
  } = {
    organizationId: orgId,
  };
  if (minRelevance > 0) {
    where.relevanceScore = { gte: minRelevance };
  }
  if (industryFilter !== null) {
    where.industryTags = { has: industryFilter };
  }
  if (companyFilter !== null) {
    where.companyTags = { has: companyFilter };
  }
  if (cursor) {
    // Composite keyset: rows with `fetchedAt < cursor.fetchedAt` OR
    // (same fetchedAt AND id < cursor.id). Mirrors alert-events shape.
    where.OR = [
      { fetchedAt: { lt: cursor.fetchedAt } },
      {
        fetchedAt: { equals: cursor.fetchedAt },
        id: { lt: cursor.id },
      },
    ];
  }
  if (!includeDismissed && userId) {
    // Postgres `NOT (dismissedBy ?| ARRAY[$userId])` — the `has`
    // operator filters arrays containing the value.
    where.NOT = { dismissedBy: { has: userId } };
  }

  const rows = await withOrgScope(orgId, (tx) =>
    tx.intelItem.findMany({
      where,
      orderBy: [
        { fetchedAt: 'desc' },
        { id: 'desc' },
      ],
      take: limit + 1,
    }),
  );

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const last = slice[slice.length - 1];
  const nextCursor =
    hasMore && last
      ? `${last.fetchedAt.toISOString()}|${last.id}`
      : null;

  return NextResponse.json(
    {
      items: slice.map((row: IntelItem) =>
        intelItemToDTO(row, userId ?? null),
      ),
      nextCursor,
      hasMore,
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'private, no-store' },
    },
  );
}
