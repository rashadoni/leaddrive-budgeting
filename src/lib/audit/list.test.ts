/**
 * Tests for `audit/list.ts` — pure parsing + query-builder shape.
 * No DB required; the only side-effect is `now` injection for
 * default-window determinism.
 */

import { describe, it, expect } from 'vitest';
import {
  parseAuditEventsQuery,
  buildAuditEventsWhere,
  DEFAULT_LIMIT,
  DEFAULT_LOOKBACK_DAYS,
  MAX_LIMIT,
  ALL_AUDIT_ACTIONS,
} from './list';

const NOW = new Date('2026-04-25T12:00:00.000Z');

function sp(params: Record<string, string>): { get: (n: string) => string | null } {
  return {
    get: (name: string) => (name in params ? params[name] : null),
  };
}

describe('parseAuditEventsQuery', () => {
  it('default window: from = now - 30d, to = now, limit = DEFAULT_LIMIT', () => {
    const res = parseAuditEventsQuery(sp({}), NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const expectedFrom = new Date(
      NOW.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    expect(res.filters.from.toISOString()).toBe(expectedFrom.toISOString());
    expect(res.filters.to.toISOString()).toBe(NOW.toISOString());
    expect(res.filters.limit).toBe(DEFAULT_LIMIT);
    expect(res.filters.action).toBeUndefined();
    expect(res.filters.entityType).toBeUndefined();
    expect(res.filters.cursor).toBeUndefined();
    expect(res.filters.actorUserId).toBeUndefined();
  });

  it('rejects unknown action enum', () => {
    const res = parseAuditEventsQuery(sp({ action: 'nuke_db' }), NOW);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/nuke_db/) });
  });

  it('accepts every known action enum', () => {
    for (const action of ALL_AUDIT_ACTIONS) {
      const res = parseAuditEventsQuery(sp({ action }), NOW);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.filters.action).toBe(action);
    }
  });

  it('rejects empty entityType', () => {
    const res = parseAuditEventsQuery(sp({ entityType: '   ' }), NOW);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/non-empty/) });
  });

  it('rejects entityType longer than 64 chars', () => {
    const res = parseAuditEventsQuery(sp({ entityType: 'A'.repeat(65) }), NOW);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/too long/) });
  });

  it('accepts arbitrary entityType under 64 chars (free-form by design)', () => {
    const res = parseAuditEventsQuery(sp({ entityType: 'Company' }), NOW);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.filters.entityType).toBe('Company');
  });

  it('rejects malformed `from` ISO', () => {
    const res = parseAuditEventsQuery(sp({ from: 'not-a-date' }), NOW);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/from/i) });
  });

  it('rejects malformed `to` ISO', () => {
    const res = parseAuditEventsQuery(sp({ to: 'still-bad' }), NOW);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/to/i) });
  });

  it('rejects malformed cursor — bare ISO without `|<id>` suffix', () => {
    const res = parseAuditEventsQuery(sp({ cursor: '2026-04-20T10:30:00.000Z' }), NOW);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/cursor/i) });
  });

  it('rejects malformed cursor — non-ISO date part', () => {
    const res = parseAuditEventsQuery(sp({ cursor: 'oops|cuid_xyz' }), NOW);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/cursor/i) });
  });

  it('rejects malformed cursor — empty id after `|`', () => {
    const res = parseAuditEventsQuery(sp({ cursor: '2026-04-20T10:30:00.000Z|' }), NOW);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/cursor/i) });
  });

  it('rejects malformed cursor — leading `|` (empty ISO)', () => {
    const res = parseAuditEventsQuery(sp({ cursor: '|cuid_xyz' }), NOW);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/cursor/i) });
  });

  it('rejects from > to', () => {
    const res = parseAuditEventsQuery(
      sp({
        from: '2026-04-25T12:00:00.000Z',
        to: '2026-04-24T12:00:00.000Z',
      }),
      NOW,
    );
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/after/i) });
  });

  it('preserves both from and to when supplied', () => {
    const res = parseAuditEventsQuery(
      sp({
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-04-25T00:00:00.000Z',
      }),
      NOW,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.filters.from.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(res.filters.to.toISOString()).toBe('2026-04-25T00:00:00.000Z');
  });

  it('rejects limit=0 / negative / non-integer / non-numeric', () => {
    expect(parseAuditEventsQuery(sp({ limit: '0' }), NOW).ok).toBe(false);
    expect(parseAuditEventsQuery(sp({ limit: '-1' }), NOW).ok).toBe(false);
    expect(parseAuditEventsQuery(sp({ limit: '1.5' }), NOW).ok).toBe(false);
    expect(parseAuditEventsQuery(sp({ limit: 'not-a-number' }), NOW).ok).toBe(false);
    expect(parseAuditEventsQuery(sp({ limit: 'NaN' }), NOW).ok).toBe(false);
  });

  it('rejects limit > MAX_LIMIT', () => {
    const res = parseAuditEventsQuery(sp({ limit: String(MAX_LIMIT + 1) }), NOW);
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/MAX|≤/i) });
  });

  it('accepts limit at MAX_LIMIT exactly', () => {
    const res = parseAuditEventsQuery(sp({ limit: String(MAX_LIMIT) }), NOW);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.filters.limit).toBe(MAX_LIMIT);
  });

  it('parses composite cursor `<iso>|<id>` into {createdAt, id}', () => {
    const res = parseAuditEventsQuery(
      sp({ cursor: '2026-04-20T10:30:00.000Z|cuid_abcdef123' }),
      NOW,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.filters.cursor?.createdAt.toISOString()).toBe(
        '2026-04-20T10:30:00.000Z',
      );
      expect(res.filters.cursor?.id).toBe('cuid_abcdef123');
    }
  });

  it('preserves an id that itself contains `|` (uses indexOf split, not split)', () => {
    // cuid never emits `|` but the parser shouldn't break if a future id
    // format includes one — defensive correctness via `indexOf('|')`.
    const res = parseAuditEventsQuery(
      sp({ cursor: '2026-04-20T10:30:00.000Z|weird|id|with|pipes' }),
      NOW,
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.filters.cursor?.id).toBe('weird|id|with|pipes');
  });

  it('actorUserId trim-empty rejected', () => {
    expect(
      parseAuditEventsQuery(sp({ actorUserId: '   ' }), NOW).ok,
    ).toBe(false);
  });
});

describe('buildAuditEventsWhere', () => {
  const baseFilters = {
    from: new Date('2026-04-01T00:00:00.000Z'),
    to: new Date('2026-04-25T00:00:00.000Z'),
    limit: 50,
  };

  it('always scopes by organizationId', () => {
    const where = buildAuditEventsWhere(baseFilters, 'org_1');
    expect(where.organizationId).toBe('org_1');
  });

  it('default shape: only org + createdAt range', () => {
    const where = buildAuditEventsWhere(baseFilters, 'org_1');
    expect(where).toEqual({
      organizationId: 'org_1',
      createdAt: { gte: baseFilters.from, lte: baseFilters.to },
    });
  });

  it('composite cursor emits OR keyset clause (Phase 7.G Turn U same-ms tie fix)', () => {
    const cursorAt = new Date('2026-04-20T10:30:00.000Z');
    const where = buildAuditEventsWhere(
      { ...baseFilters, cursor: { createdAt: cursorAt, id: 'cuid_xyz' } },
      'org_1',
    );
    // `createdAt` range bounds preserved at root (out-of-window same-ms
    // rows still excluded by the AND-ed range).
    expect(where.createdAt).toEqual({
      gte: baseFilters.from,
      lte: baseFilters.to,
    });
    // OR clause: `(createdAt < cursor.createdAt) OR (createdAt =
    // cursor.createdAt AND id < cursor.id)`.
    expect(where.OR).toEqual([
      { createdAt: { lt: cursorAt } },
      { createdAt: cursorAt, id: { lt: 'cuid_xyz' } },
    ]);
  });

  it('no cursor → no OR clause', () => {
    const where = buildAuditEventsWhere(baseFilters, 'org_1');
    expect(where.OR).toBeUndefined();
  });

  it('action filter narrows query', () => {
    const where = buildAuditEventsWhere(
      { ...baseFilters, action: 'import_budget_create' },
      'org_1',
    );
    expect(where.action).toBe('import_budget_create');
  });

  it('entityType + actorUserId filters narrow query', () => {
    const where = buildAuditEventsWhere(
      { ...baseFilters, entityType: 'BudgetPlan', actorUserId: 'user_1' },
      'org_1',
    );
    expect(where.entityType).toBe('BudgetPlan');
    expect(where.actorUserId).toBe('user_1');
  });

  it('all filters combined preserve range + OR keyset cursor', () => {
    const cursorAt = new Date('2026-04-20T10:30:00.000Z');
    const where = buildAuditEventsWhere(
      {
        ...baseFilters,
        action: 'import_staging_apply',
        entityType: 'ImportStaging',
        actorUserId: 'user_1',
        cursor: { createdAt: cursorAt, id: 'cuid_xyz' },
      },
      'org_1',
    );
    expect(where).toEqual({
      organizationId: 'org_1',
      createdAt: { gte: baseFilters.from, lte: baseFilters.to },
      action: 'import_staging_apply',
      entityType: 'ImportStaging',
      actorUserId: 'user_1',
      OR: [
        { createdAt: { lt: cursorAt } },
        { createdAt: cursorAt, id: { lt: 'cuid_xyz' } },
      ],
    });
  });
});
