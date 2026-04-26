/**
 * Unit tests for `parsePatchBody` — the pure validator used by
 * `PATCH /api/companies/[id]`. Covers the input contract for the
 * `company_role_change` audit-wired endpoint.
 *
 * The handler itself isn't covered here because the repo has no API-route
 * test scaffold yet (tracked as a 🔄 in CARRYOVER alongside the matrix
 * regression test). Validator coverage is the slice that's portable
 * without that scaffold.
 */

import { describe, it, expect } from 'vitest';
import { parsePatchBody } from './validate';

describe('parsePatchBody', () => {
  it('accepts each valid CompanyRole value', () => {
    for (const role of ['operational', 'admin', 'holding'] as const) {
      const out = parsePatchBody({ role });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.value.role).toBe(role);
    }
  });

  it('rejects non-object body', () => {
    expect(parsePatchBody(null).ok).toBe(false);
    expect(parsePatchBody('admin').ok).toBe(false);
    expect(parsePatchBody(42).ok).toBe(false);
    expect(parsePatchBody(undefined).ok).toBe(false);
  });

  it('rejects unknown role values (incl. typos like "Admin" with capital)', () => {
    const r1 = parsePatchBody({ role: 'Admin' });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toMatch(/operational, admin, holding/);

    const r2 = parsePatchBody({ role: 'sysadmin' });
    expect(r2.ok).toBe(false);
  });

  it('rejects non-string role', () => {
    expect(parsePatchBody({ role: 1 }).ok).toBe(false);
    expect(parsePatchBody({ role: null }).ok).toBe(false);
  });

  it('rejects empty body (no recognised fields)', () => {
    const out = parsePatchBody({});
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/expected: role/);
  });

  it('ignores unknown fields but still requires at least one recognised one', () => {
    const out = parsePatchBody({ name: 'New name' });
    expect(out.ok).toBe(false);
  });
});
