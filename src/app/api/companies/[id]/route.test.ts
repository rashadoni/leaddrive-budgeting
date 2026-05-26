/**
 * Unit tests for `parsePatchBody` — the pure validator used by
 * `PATCH /api/companies/[id]`. Covers the input contract for both the
 * `company_role_change` and `company_status_change` audit-wired paths.
 *
 * The handler itself is covered in `handler.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { parsePatchBody } from './validate';

describe('parsePatchBody — role field', () => {
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
});

describe('parsePatchBody — status field', () => {
  it('accepts each valid CompanyStatus value', () => {
    for (const status of ['pending', 'active', 'archived'] as const) {
      const out = parsePatchBody({ status });
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.value.status).toBe(status);
    }
  });

  it('rejects unknown status values', () => {
    const r1 = parsePatchBody({ status: 'Active' }); // capital
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toMatch(/pending, active, archived/);

    const r2 = parsePatchBody({ status: 'draft' }); // wrong domain
    expect(r2.ok).toBe(false);
  });

  it('rejects non-string status', () => {
    expect(parsePatchBody({ status: true }).ok).toBe(false);
    expect(parsePatchBody({ status: 0 }).ok).toBe(false);
  });
});

describe('parsePatchBody — combined fields', () => {
  it('accepts role + status together', () => {
    const out = parsePatchBody({ role: 'admin', status: 'active' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.role).toBe('admin');
      expect(out.value.status).toBe('active');
    }
  });

  it('rejects empty body (no recognised fields)', () => {
    const out = parsePatchBody({});
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/expected: role, status/);
  });

  it('rejects body with only unknown fields', () => {
    const out = parsePatchBody({ name: 'New name' });
    expect(out.ok).toBe(false);
  });

  it('rejects invalid role even when valid status present', () => {
    const out = parsePatchBody({ role: 'vendor', status: 'active' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/operational, admin, holding/);
  });

  it('rejects invalid status even when valid role present', () => {
    const out = parsePatchBody({ role: 'admin', status: 'deleted' });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/pending, active, archived/);
  });
});
