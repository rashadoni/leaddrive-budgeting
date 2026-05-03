/**
 * Phase 7.E C6 v2 — `/api/organizations/settings` GET + PATCH.
 *
 * Org-scoped settings JSON. v2 only writes the `alertThresholds` sub-key
 * (Phase 7.E sub-9 closure: externalise hardcoded alert-rule thresholds).
 * The endpoint is shaped so future settings modules (e.g. notification
 * prefs, dashboard defaults) can add their own sub-keys without changing
 * the route — each module owns its sub-tree, the merge logic below
 * preserves siblings.
 *
 * Auth model:
 *  - GET: `requireAuth` (any authenticated org member can read what's
 *    configured — the alert behavior is already visible to them, exposing
 *    the threshold numbers adds no privilege).
 *  - PATCH: `requireRole('admin')` — same gate as `/api/companies/[id]`
 *    role-flip. Tuning alert thresholds reshapes the holding view's
 *    perceived risk; only org admins should change it.
 *
 * Audit: PATCH emits `alert_thresholds_update` with before/after blobs
 * (per-action contract documented in `src/lib/audit/log.ts`).
 *
 * Validation: Zod-parse at the API boundary; the evaluator's read path
 * (`readAlertThresholdsFromOrgSettings`) double-validates as a safety
 * net so a hand-edited DB row stays type-safe.
 *
 * Rate-limit: keyed on userId at 10/min. Same as company-patch — admin
 * UI is interactive, this isn't a bulk endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireRole, isAuthError } from '@/lib/api-auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { logAuditEvent, buildAuditContext } from '@/lib/audit/log';
import {
  alertThresholdsConfigSchema,
  type AlertThresholdsConfig,
} from '@/lib/risk/alert-thresholds-config';
import { z } from 'zod';

const RATE_LIMIT = { name: 'org-settings-patch', max: 10, windowMs: 60_000 };

const patchBodySchema = z.object({
  alertThresholds: alertThresholdsConfigSchema.optional(),
});

type OrgSettings = {
  alertThresholds?: AlertThresholdsConfig;
  [key: string]: unknown;
};

function readSettings(value: unknown): OrgSettings {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as OrgSettings;
  }
  return {};
}

export async function GET(request: NextRequest) {
  const session = await requireAuth(request);
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json(
      { error: 'User has no organization' },
      { status: 403 },
    );
  }
  const org = await prisma.organization.findUnique({
    where: { id: session.orgId },
    select: { settings: true },
  });
  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }
  return NextResponse.json({ settings: readSettings(org.settings) });
}

export async function PATCH(request: NextRequest) {
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

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = patchBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid settings payload', issues: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const org = await prisma.organization.findUnique({
    where: { id: session.orgId },
    select: { id: true, settings: true },
  });
  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }

  const currentSettings = readSettings(org.settings);
  const beforeAlertThresholds =
    (currentSettings.alertThresholds as Record<string, unknown> | undefined) ??
    null;
  // Merge: write only the keys the caller sent; leave other settings
  // sub-keys untouched. v2 only ships alertThresholds, but the spread
  // pattern means notification-prefs / dashboard-defaults can be added
  // later without route changes.
  const nextSettings: OrgSettings = { ...currentSettings };
  if (parsed.data.alertThresholds !== undefined) {
    nextSettings.alertThresholds = parsed.data.alertThresholds;
  }

  await prisma.organization.update({
    where: { id: org.id },
    data: { settings: nextSettings as unknown as Prisma.InputJsonValue },
  });

  // Audit emission — best-effort, never blocks the mutation.
  let auditStale = false;
  const afterAlertThresholds = (nextSettings.alertThresholds ?? {}) as Record<
    string,
    unknown
  >;
  if (parsed.data.alertThresholds !== undefined) {
    const auditResult = await logAuditEvent(prisma, {
      organizationId: session.orgId,
      actorUserId: session.userId,
      event: {
        action: 'alert_thresholds_update',
        entityType: 'Organization',
        entityId: org.id,
        metadata: {
          before: beforeAlertThresholds,
          after: afterAlertThresholds,
        },
      },
      context: buildAuditContext({
        route: '/api/organizations/settings',
        userAgent: request.headers.get('user-agent') ?? undefined,
      }),
    });
    if (!auditResult.ok) auditStale = true;
  }

  return NextResponse.json(
    auditStale
      ? { settings: nextSettings, auditStale: true }
      : { settings: nextSettings },
  );
}
