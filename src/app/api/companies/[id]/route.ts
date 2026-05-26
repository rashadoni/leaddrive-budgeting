/**
 * PATCH /api/companies/[id] — company role + status management.
 *
 * Supports two independent mutations in a single PATCH; either or both
 * fields may be present:
 *
 *   { role: "operational"|"admin"|"holding" }
 *     → changes CompanyRole (Phase 7.E scoring toggle). Emits
 *       `company_role_change` audit event.
 *
 *   { status: "pending"|"active"|"archived" }
 *     → changes Company.status (Truth-infra Phase C.1 — admin manual
 *       override of the onboarding-readiness gate). Emits
 *       `company_status_change` audit event.
 *
 * Either or both fields may be included in a single request body; an
 * empty body (no recognised fields) returns 400.
 *
 * Auth: admin-only. Both mutations reshape the holding view:
 *   - role flip removes admin/holding rows from the operational HeatMap.
 *   - status flip hides/shows the company in the terminal (matrix filters
 *     out `status='pending'` by default).
 *
 * Rate-limit: keyed on userId at 10/min — interactive single-row clicks.
 *
 * Audit: same-value PATCH is a true no-op (no DB write, no audit event).
 *        Changed fields each emit their respective audit action.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { logAuditEvent, buildAuditContext } from '@/lib/audit/log';
import { parsePatchBody, isValidCompanyRole, isValidCompanyStatus } from './validate';

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
    select: { id: true, code: true, role: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  }

  // Compute which fields actually changed to skip true no-ops.
  const roleChanged = parsed.value.role != null && parsed.value.role !== existing.role;
  const statusChanged = parsed.value.status != null && parsed.value.status !== existing.status;

  if (!roleChanged && !statusChanged) {
    // Complete no-op: same values submitted. Skip DB write AND audit.
    return NextResponse.json({ id: existing.id, code: existing.code, role: existing.role, status: existing.status });
  }

  // Build the update data from changed fields only.
  const updateData: { role?: string; status?: string } = {};
  if (roleChanged) updateData.role = parsed.value.role;
  if (statusChanged) updateData.status = parsed.value.status;

  const updated = await prisma.company.update({
    where: { id: existing.id },
    data: updateData,
    select: { id: true, code: true, role: true, status: true },
  });

  // Best-effort audit emission for each changed field.
  // Never-throws contract: log failures surface as `auditStale: true`
  // alongside the successful mutation rather than rolling back the change.
  let auditStale = false;
  const auditCtx = buildAuditContext({
    route: '/api/companies/[id]',
    userAgent: request.headers.get('user-agent') ?? undefined,
  });

  if (roleChanged) {
    if (!isValidCompanyRole(existing.role)) {
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
            to: parsed.value.role!,
            companyCode: existing.code,
          },
        },
        context: auditCtx,
      });
      if (!auditResult.ok) auditStale = true;
    }
  }

  if (statusChanged) {
    if (!isValidCompanyStatus(existing.status)) {
      console.error(
        `audit/company_status_change: existing.status=${String(existing.status)} not in audit union — skipping emission`,
      );
      auditStale = true;
    } else {
      const auditResult = await logAuditEvent(prisma, {
        organizationId: session.orgId,
        actorUserId: session.userId,
        event: {
          action: 'company_status_change',
          entityType: 'Company',
          entityId: existing.id,
          metadata: {
            from: existing.status as 'pending' | 'active' | 'archived',
            to: parsed.value.status!,
            companyCode: existing.code,
          },
        },
        context: auditCtx,
      });
      if (!auditResult.ok) auditStale = true;
    }
  }

  return NextResponse.json(auditStale ? { ...updated, auditStale } : updated);
}
