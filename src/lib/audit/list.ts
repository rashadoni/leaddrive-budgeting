/**
 * Phase 7.F (Turn 12) — pure filter validation + query builder for the
 * audit-log viewer. Lives outside the API route so the parsing logic is
 * unit-testable without spinning up Prisma / NextRequest.
 *
 * Contract:
 *   - parseAuditEventsQuery(searchParams) → discriminated result of
 *     { ok: true, filters } | { ok: false, error }.
 *   - buildAuditEventsWhere(filters, organizationId) → Prisma `where`
 *     object scoped to the org, with cursor-pagination on createdAt.
 *
 * All time inputs are ISO-8601 strings. The default window is the past
 * 30 days when neither `from` nor `to` is supplied — matches the human-
 * habit of "show me what happened recently" without forcing the UI to
 * pick a default. Callers wanting "everything" pass `from=1970-01-01`.
 */

import type { AuditAction, Prisma } from '@prisma/client';

const ALL_AUDIT_ACTIONS: readonly AuditAction[] = [
  'company_role_change',
  'budget_plan_create',
  'budget_plan_approve',
  'import_budget_create',
  'import_staging_apply',
  'import_staging_expired',
  'indicator_override_create',
  'indicator_override_update',
  'indicator_override_delete',
];

/** The set of entity-type strings the existing wirings emit. New types
 *  added later don't need a change here — `entityType` is server-side
 *  free-text and the validator only enforces "non-empty + ≤ 64 chars". */
const ENTITY_TYPE_MAX_LENGTH = 64;

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/** Default lookback window when `from` is omitted: 30 days. */
export const DEFAULT_LOOKBACK_DAYS = 30;

export interface AuditEventsFilters {
  entityType?: string;
  action?: AuditAction;
  /** ISO-8601 inclusive lower bound on `createdAt`. */
  from: Date;
  /** ISO-8601 inclusive upper bound on `createdAt`. */
  to: Date;
  actorUserId?: string;
  /** Cursor: ISO-8601 of the last seen `createdAt`. Returned rows have
   *  `createdAt < cursor` (descending order — newest first). */
  cursor?: Date;
  limit: number;
}

export type ParseAuditEventsQueryResult =
  | { ok: true; filters: AuditEventsFilters }
  | { ok: false; error: string };

/**
 * Parse a URLSearchParams (or any `{get(name): string|null}` shape) into
 * a typed AuditEventsFilters. Returns a discriminated result so the API
 * route can short-circuit with a 400 when the input is malformed without
 * reaching for try/catch on individual params.
 *
 * `now` is injected so tests can pin it; in production the route passes
 * `new Date()`.
 */
export function parseAuditEventsQuery(
  searchParams: { get: (name: string) => string | null },
  now: Date = new Date(),
): ParseAuditEventsQueryResult {
  const action = searchParams.get('action');
  if (action !== null && !(ALL_AUDIT_ACTIONS as readonly string[]).includes(action)) {
    return {
      ok: false,
      error: `Unknown action "${action}". Expected one of: ${ALL_AUDIT_ACTIONS.join(', ')}.`,
    };
  }

  const entityType = searchParams.get('entityType');
  if (entityType !== null) {
    if (entityType.trim() === '') {
      return { ok: false, error: 'entityType, when supplied, must be non-empty.' };
    }
    if (entityType.length > ENTITY_TYPE_MAX_LENGTH) {
      return {
        ok: false,
        error: `entityType too long (${entityType.length} > ${ENTITY_TYPE_MAX_LENGTH}).`,
      };
    }
  }

  const actorUserId = searchParams.get('actorUserId');
  if (actorUserId !== null && actorUserId.trim() === '') {
    return { ok: false, error: 'actorUserId, when supplied, must be non-empty.' };
  }

  const from = parseIsoDate(searchParams.get('from'));
  if (from === 'invalid') {
    return { ok: false, error: '`from` must be an ISO-8601 timestamp.' };
  }
  const to = parseIsoDate(searchParams.get('to'));
  if (to === 'invalid') {
    return { ok: false, error: '`to` must be an ISO-8601 timestamp.' };
  }
  const cursor = parseIsoDate(searchParams.get('cursor'));
  if (cursor === 'invalid') {
    return { ok: false, error: '`cursor` must be an ISO-8601 timestamp.' };
  }

  const resolvedFrom =
    from === null
      ? new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
      : from;
  const resolvedTo = to === null ? now : to;

  if (resolvedFrom.getTime() > resolvedTo.getTime()) {
    return {
      ok: false,
      error: `\`from\` (${resolvedFrom.toISOString()}) is after \`to\` (${resolvedTo.toISOString()}).`,
    };
  }

  const limitRaw = searchParams.get('limit');
  let limit = DEFAULT_LIMIT;
  if (limitRaw !== null) {
    const parsed = Number(limitRaw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
      return { ok: false, error: '`limit` must be a positive integer.' };
    }
    if (parsed > MAX_LIMIT) {
      return { ok: false, error: `\`limit\` must be ≤ ${MAX_LIMIT}.` };
    }
    limit = parsed;
  }

  const filters: AuditEventsFilters = {
    from: resolvedFrom,
    to: resolvedTo,
    limit,
  };
  if (action !== null) filters.action = action as AuditAction;
  if (entityType !== null) filters.entityType = entityType;
  if (actorUserId !== null) filters.actorUserId = actorUserId;
  if (cursor !== null) filters.cursor = cursor;

  return { ok: true, filters };
}

/** `null` → not supplied; `'invalid'` → present but unparseable. */
function parseIsoDate(raw: string | null): Date | null | 'invalid' {
  if (raw === null || raw === '') return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return 'invalid';
  return d;
}

/**
 * Convert validated filters + tenant scope into the Prisma `where`
 * argument for `auditEvent.findMany`. Pure: same input → same output.
 *
 * Cursor semantics: if `cursor` is set, rows must have `createdAt <
 * cursor` (strict). The endpoint orders by createdAt DESC, so this
 * advances backwards through time on every page request. The cursor
 * value the client sees is the `createdAt` of the LAST row in the
 * previous page; passing it back excludes that row from the next page
 * (no double-render). When two events share an exact `createdAt` ms
 * stamp the boundary is fuzzy by 1ms — acceptable for an audit log
 * where exact ordering on identical timestamps is meaningless.
 */
export function buildAuditEventsWhere(
  filters: AuditEventsFilters,
  organizationId: string,
): Prisma.AuditEventWhereInput {
  const where: Prisma.AuditEventWhereInput = {
    organizationId,
    createdAt: {
      gte: filters.from,
      lte: filters.to,
    },
  };
  if (filters.action) where.action = filters.action;
  if (filters.entityType) where.entityType = filters.entityType;
  if (filters.actorUserId) where.actorUserId = filters.actorUserId;
  if (filters.cursor) {
    // Tighten the existing createdAt range by adding `lt: cursor`.
    // `gte: from` + `lte: to` + `lt: cursor` Prisma allows by merging
    // into a single object — we rebuild explicitly to keep the shape
    // obvious to a reader.
    where.createdAt = {
      gte: filters.from,
      lte: filters.to,
      lt: filters.cursor,
    };
  }
  return where;
}

export { ALL_AUDIT_ACTIONS };
