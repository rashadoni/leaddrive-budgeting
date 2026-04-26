/**
 * Phase 7.B AI Data Mapper — `/staging/[id]` GET endpoint.
 *
 * Fetches a previously-saved mapping proposal by stagingId. Used by the
 * onboarding wizard UI to re-load a proposal when the user navigates back
 * to a pending review (e.g. after browser refresh).
 *
 * Auth: any authenticated user with org-scoped read access. The staging
 * row's organizationId must match the caller's session.orgId; otherwise
 * 404 (not 403, to avoid leaking that the id exists in another org).
 *
 * Returns 410 (Gone) for expired or already-applied/discarded staging.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, isAuthError } from '@/lib/api-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth(request);
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json({ error: 'User has no organization' }, { status: 403 });
  }

  const { id } = await params;
  if (typeof id !== 'string' || id.trim() === '') {
    return NextResponse.json({ error: 'Invalid staging id' }, { status: 400 });
  }

  const staging = await prisma.importStaging.findFirst({
    where: { id, organizationId: session.orgId },
    select: {
      id: true,
      organizationId: true,
      companyId: true,
      status: true,
      sourceFile: true,
      sourceSheet: true,
      proposal: true,
      userOverrides: true,
      createdAt: true,
      expiresAt: true,
      appliedAt: true,
    },
  });
  if (!staging) {
    // 404 — not 403 — to avoid leaking that the id exists in another org.
    return NextResponse.json({ error: 'Staging not found' }, { status: 404 });
  }

  // Surface expiry vs applied/discarded distinctly. Apply endpoint will
  // reject same conditions.
  //
  // Lazy-flip TTL: when GET sees a `pending` row past its expiresAt,
  // persist the transition to `status='expired'`. Otherwise stale rows sit
  // as `pending` indefinitely until a cron job lands (carryover item).
  // Idempotent — safe to run on every read.
  if (staging.status === 'pending' && staging.expiresAt < new Date()) {
    // Race-safe: scope the UPDATE to rows still in `pending` so concurrent
    // GETs don't all UPDATE the same row N times (WAL noise, no logical
    // bug). updateMany returns count=0 silently if another reader won the
    // flip first — that's fine; we still return 410.
    const flipResult = await prisma.importStaging.updateMany({
      where: { id: staging.id, status: 'pending' },
      data: { status: 'expired' },
    });
    // Phase 7.F (Turn 11) — log the lazy-expire transition only when
    // THIS reader was the one to flip the row (count===1). Concurrent
    // readers losing the race must not double-log.
    if (flipResult.count === 1) {
      const { logAuditEvent, buildAuditContext } = await import('@/lib/audit/log');
      await logAuditEvent(prisma, {
        organizationId: session.orgId,
        actorUserId: session.userId || null,
        event: {
          action: 'import_staging_expired',
          entityType: 'ImportStaging',
          entityId: staging.id,
          metadata: {
            companyId: staging.companyId,
            expiresAt: staging.expiresAt.toISOString(),
            triggeredBy: 'lazy_get',
          },
        },
        context: buildAuditContext({
          route: '/api/onboarding/import/staging/[id]',
        }),
      });
    }
    return NextResponse.json(
      {
        error: 'Staging proposal has expired',
        status: 'expired',
        expiresAt: staging.expiresAt.toISOString(),
      },
      { status: 410 },
    );
  }
  if (staging.status === 'expired') {
    return NextResponse.json(
      {
        error: 'Staging proposal has expired',
        status: 'expired',
        expiresAt: staging.expiresAt.toISOString(),
      },
      { status: 410 },
    );
  }
  if (staging.status === 'applied' || staging.status === 'discarded') {
    return NextResponse.json(
      {
        error: `Staging is already ${staging.status}`,
        status: staging.status,
      },
      { status: 410 },
    );
  }

  return NextResponse.json({
    id: staging.id,
    companyId: staging.companyId,
    status: staging.status,
    sourceFile: staging.sourceFile,
    sourceSheet: staging.sourceSheet,
    proposal: staging.proposal,
    userOverrides: staging.userOverrides,
    createdAt: staging.createdAt.toISOString(),
    expiresAt: staging.expiresAt.toISOString(),
    appliedAt: staging.appliedAt?.toISOString() ?? null,
  });
}
