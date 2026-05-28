/**
 * PATCH /api/companies/[id] — company role / status / industry management.
 *
 * Supports three independent mutations in a single PATCH; any combination
 * of the three fields may be present:
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
 *   { industry: "<code>" | null }
 *     → reclassifies Company.industry (Truth-infra Phase C.2 — industry
 *       drives which indicator pack runs and which settings form shows).
 *       `null` clears the field (for level-1 sub-group placeholders).
 *       Emits `company_industry_change` audit event.
 *
 * Any combination of the three is valid; an empty body (no recognised
 * fields) returns 400. Same-value PATCH for each field is a true no-op:
 * no DB write, no audit event for that field.
 *
 * Auth: admin-only. All three mutations reshape the holding view.
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
import { parsePatchBody, isValidCompanyRole, isValidCompanyStatus, VALID_INDUSTRIES } from './validate';
import { getLogger } from '@/lib/log';

// Phase 8 D4 continuation (2026-05-28) — structured logger for the
// audit-schema-drift guards. 3 console.error → logger.error calls
// emit when an off-spec column value blocks an audit event emission.
const log = getLogger('api:companies:id');

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
    select: { id: true, code: true, role: true, status: true, industry: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Company not found' }, { status: 404 });
  }

  // Compute which fields actually changed to skip true no-ops.
  const roleChanged = parsed.value.role != null && parsed.value.role !== existing.role;
  const statusChanged = parsed.value.status != null && parsed.value.status !== existing.status;
  // `industry` uses `!== undefined` because `null` is a valid new value (clear).
  const industryChanged =
    parsed.value.industry !== undefined &&
    parsed.value.industry !== existing.industry;

  if (!roleChanged && !statusChanged && !industryChanged) {
    // Complete no-op: same values submitted. Skip DB write AND audit.
    return NextResponse.json({
      id: existing.id,
      code: existing.code,
      role: existing.role,
      status: existing.status,
      industry: existing.industry,
    });
  }

  // Build the update data from changed fields only.
  const updateData: { role?: string; status?: string; industry?: string | null } = {};
  if (roleChanged) updateData.role = parsed.value.role;
  if (statusChanged) updateData.status = parsed.value.status;
  if (industryChanged) updateData.industry = parsed.value.industry;

  const updated = await prisma.company.update({
    where: { id: existing.id },
    data: updateData,
    select: { id: true, code: true, role: true, status: true, industry: true },
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
      log.error('audit/company_role_change: existing.role not in audit union — skipping emission', {
        companyId: existing.id,
        companyCode: existing.code,
        existingRole: String(existing.role),
      });
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
      log.error('audit/company_status_change: existing.status not in audit union — skipping emission', {
        companyId: existing.id,
        companyCode: existing.code,
        existingStatus: String(existing.status),
      });
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

  if (industryChanged) {
    // Guard against off-spec existing.industry values (e.g. typos from bulk
    // SQL imports). industry is String? — not a Prisma enum — so no compile-
    // time guarantee that DB rows conform to VALID_INDUSTRIES. null is valid
    // (unset); any non-null value outside the set means stale/corrupt data.
    if (existing.industry !== null && !VALID_INDUSTRIES.has(existing.industry)) {
      log.error('audit/company_industry_change: existing.industry not in VALID_INDUSTRIES — skipping emission', {
        companyId: existing.id,
        companyCode: existing.code,
        existingIndustry: String(existing.industry),
      });
      auditStale = true;
    } else {
      const auditResult = await logAuditEvent(prisma, {
        organizationId: session.orgId,
        actorUserId: session.userId,
        event: {
          action: 'company_industry_change',
          entityType: 'Company',
          entityId: existing.id,
          metadata: {
            from: existing.industry,
            to: parsed.value.industry ?? null,
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
