/**
 * Phase 7.F audit-wiring extension — `/api/companies/[id]` PATCH endpoint.
 *
 * Today the only mutation supported is `role`: operational ↔ admin ↔ holding.
 * Surfaced because Phase 7.E added `CompanyRole` enum + the holding-view
 * filter (`filterOperationalCompanies`), but the only way to flip a company's
 * role was a direct seed/SQL edit — leaving no audit trail. This closes the
 * `company_role_change` enum member that's been wire-ready in
 * `src/lib/audit/log.ts:46-54` since Turn 11.
 *
 * Auth: admin-only. Role flips reshape the holding view (admin/holding rows
 * disappear from the operational heatmap), so they're a privileged operation
 * — manager+ would let editors hide companies from leadership dashboards by
 * accident.
 *
 * Rate-limit: keyed on userId (not orgId) at 10/min. Tighter than the
 * import-budget 5/min because role flips are interactive single-row clicks,
 * not bulk operations; the limit exists to throttle mistakes / runaway
 * scripts, not to bound throughput.
 *
 * Audit: emits `company_role_change` with `from`/`to`/`companyCode`.
 * Same-role PATCH is a no-op — returns 200 with the existing row, does NOT
 * emit an audit event (audit-trail noise reduction; no state change to
 * record).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit';
import { logAuditEvent, buildAuditContext } from '@/lib/audit/log';
import { parsePatchBody, isValidCompanyRole } from './validate';

const RATE_LIMIT = { name: 'company-patch', max: 10, windowMs: 60_000 };

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(request, 'admin');
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json(
      { error: 'User has no organization' },
      { status: 403 },
    );
  }

  const rateLimitError = enforceRateLimit(
    `${RATE_LIMIT.name}:${session.userId}`,
    RATE_LIMIT,
  );
  if (rateLimitError) return rateLimitError;

  const { id } = await params;
  if (typeof id !== 'string' || id.trim() === '') {
    return NextResponse.json({ error: 'Invalid company id' }, { status: 400 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = parsePatchBody(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Tenant-scoped lookup — 404 (not 403) if the id belongs to another org,
  // matching the pattern in /api/onboarding/import/staging/[id] so we don't
  // leak existence of cross-tenant ids.
  const existing = await prisma.company.findFirst({
    where: { id, organizationId: session.orgId },
    select: { id: true, code: true, role: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  }

  // No-op short-circuit: same role → return current row, skip audit.
  // Audit trail is for *changes*, not idempotent re-submits.
  if (parsed.value.role && parsed.value.role === existing.role) {
    return NextResponse.json(existing);
  }

  const updated = await prisma.company.update({
    where: { id: existing.id },
    data: {
      role: parsed.value.role,
    },
    select: { id: true, code: true, role: true },
  });

  // Best-effort audit emission. Mirrors the never-throws contract of every
  // other call-site: logger failures get surfaced as `auditStale: true`
  // alongside the successful mutation rather than rolling back the change.
  //
  // Runtime guard on `existing.role`: Prisma's `CompanyRole` enum is the
  // source of truth, but `AuditEventInput.metadata.from/to` is a hand-rolled
  // literal union (`src/lib/audit/log.ts:50-52`). If a future migration adds
  // a 4th role member without updating BOTH `validate.ts:VALID_ROLES` AND
  // the audit union, an unguarded cast would silently emit an off-spec
  // metadata blob. Guard kicks in at runtime: if `existing.role` isn't
  // recognised, skip emission + flag stale rather than write a malformed row.
  let auditStale = false;
  if (parsed.value.role && parsed.value.role !== existing.role) {
    if (!isValidCompanyRole(existing.role)) {
      // Defensive — schema drift between Prisma enum and audit union.
      // Action still proceeds (mutation already committed); audit is best-effort.
      console.error(
        `audit/company_role_change: existing.role=${String(existing.role)} not in audit union — skipping emission`,
      );
      auditStale = true;
    } else {
      const auditResult = await logAuditEvent(prisma, {
        organizationId: session.orgId,
        actorUserId: session.userId,
        event: {
          action: 'company_role_change',
          entityType: 'Company',
          entityId: existing.id,
          metadata: {
            from: existing.role,
            to: parsed.value.role,
            companyCode: existing.code,
          },
        },
        context: buildAuditContext({
          route: '/api/companies/[id]',
          userAgent: request.headers.get('user-agent') ?? undefined,
        }),
      });
      if (!auditResult.ok) auditStale = true;
    }
  }

  return NextResponse.json(auditStale ? { ...updated, auditStale } : updated);
}
