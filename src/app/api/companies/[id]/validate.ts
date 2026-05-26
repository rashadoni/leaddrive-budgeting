/**
 * Pure validator for `PATCH /api/companies/[id]`. Lives in its own module
 * so `route.test.ts` can import it without dragging in `next/server` →
 * `next-auth` (which crashes under the vitest node resolver — see
 * `Cannot find module 'next/server'` error from earlier).
 *
 * Public surface: `parsePatchBody(unknown)` — see route.ts for caller
 * contract.
 *
 * Truth-infra Phase C.1 (2026-05-26): extended to support `status` field
 * alongside `role`. Either or both may be present in a single PATCH; at
 * least one must be present.
 *
 * Truth-infra Phase C.2 (2026-05-26): extended to support `industry` field.
 * `industry` may be any of the 14 known industry codes OR `null` (to clear
 * the field for level-1 sub-group placeholders).
 */

export type CompanyRoleValue = 'operational' | 'admin' | 'holding';
export type CompanyStatusValue = 'pending' | 'active' | 'archived';

const VALID_ROLES: ReadonlySet<CompanyRoleValue> = new Set([
  'operational',
  'admin',
  'holding',
]);

const VALID_STATUSES: ReadonlySet<CompanyStatusValue> = new Set([
  'pending',
  'active',
  'archived',
]);

/**
 * All 14 known industry codes — mirrors indicator-seeds.ts VALID_INDUSTRIES list.
 * A string not in this set would violate the `Industry.code` FK constraint at
 * the DB level, so rejecting here gives a useful 400 rather than a 500.
 */
export const VALID_INDUSTRIES: ReadonlySet<string> = new Set([
  'agro_crops',
  'beverage',
  'construction',
  'education',
  'entertainment',
  'food_processing',
  'hospitality',
  'industrial',
  'logistics',
  'pharma',
  'poultry',
  'real_estate',
  'retail',
  'services',
]);

export interface ParsedPatchBody {
  role?: CompanyRoleValue;
  status?: CompanyStatusValue;
  /** `undefined` = not in body (no-op). `null` = explicitly clear to NULL. */
  industry?: string | null;
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

/**
 * Runtime guard: is the value a recognised Company status literal?
 *
 * Mirrors `isValidCompanyRole` — defends against schema drift between the
 * Company.status string column and the audit union in `src/lib/audit/log.ts`.
 */
export function isValidCompanyStatus(value: unknown): value is CompanyStatusValue {
  return typeof value === 'string' && VALID_STATUSES.has(value as CompanyStatusValue);
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

  if ('status' in obj) {
    const s = obj.status;
    if (typeof s !== 'string' || !VALID_STATUSES.has(s as CompanyStatusValue)) {
      return {
        ok: false,
        error: 'status must be one of: pending, active, archived',
      };
    }
    out.status = s as CompanyStatusValue;
  }

  if ('industry' in obj) {
    const i = obj.industry;
    if (i === null) {
      // Explicitly clear the industry (level-1 sub-group placeholder).
      out.industry = null;
    } else if (typeof i !== 'string' || !VALID_INDUSTRIES.has(i)) {
      return {
        ok: false,
        error: `industry must be null or one of: ${[...VALID_INDUSTRIES].sort().join(', ')}`,
      };
    } else {
      out.industry = i;
    }
  }

  if (Object.keys(out).length === 0) {
    return {
      ok: false,
      error: 'No supported fields in body (expected: role, status, industry)',
    };
  }
  return { ok: true, value: out };
}
