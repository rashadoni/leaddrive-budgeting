/**
 * Pure validator for `PATCH /api/companies/[id]`. Lives in its own module
 * so `route.test.ts` can import it without dragging in `next/server` →
 * `next-auth` (which crashes under the vitest node resolver — see
 * `Cannot find module 'next/server'` error from earlier).
 *
 * Public surface: `parsePatchBody(unknown)` — see route.ts for caller
 * contract.
 */

export type CompanyRoleValue = 'operational' | 'admin' | 'holding';

const VALID_ROLES: ReadonlySet<CompanyRoleValue> = new Set([
  'operational',
  'admin',
  'holding',
]);

export interface ParsedPatchBody {
  role?: CompanyRoleValue;
}

/**
 * Runtime guard: is the value a recognised CompanyRole literal?
 *
 * Used by the route handler before emitting `company_role_change` audit
 * events to defend against schema drift between the Prisma `CompanyRole`
 * enum and the hand-rolled audit-metadata union in `src/lib/audit/log.ts`.
 * If the two diverge (e.g. someone adds a `vendor` role to Prisma but
 * forgets to extend the audit union), this guard fails closed: skip
 * emission + mark `auditStale: true` rather than write off-spec metadata.
 */
export function isValidCompanyRole(value: unknown): value is CompanyRoleValue {
  return typeof value === 'string' && VALID_ROLES.has(value as CompanyRoleValue);
}

export function parsePatchBody(
  body: unknown,
): { ok: true; value: ParsedPatchBody } | { ok: false; error: string } {
  if (body === null || typeof body !== 'object') {
    return { ok: false, error: 'Body must be a JSON object' };
  }
  const obj = body as Record<string, unknown>;
  const out: ParsedPatchBody = {};

  if ('role' in obj) {
    const r = obj.role;
    if (typeof r !== 'string' || !VALID_ROLES.has(r as CompanyRoleValue)) {
      return {
        ok: false,
        error: 'role must be one of: operational, admin, holding',
      };
    }
    out.role = r as CompanyRoleValue;
  }

  if (Object.keys(out).length === 0) {
    return {
      ok: false,
      error: 'No supported fields in body (expected: role)',
    };
  }
  return { ok: true, value: out };
}
