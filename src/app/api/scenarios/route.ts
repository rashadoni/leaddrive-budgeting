import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireRole, isAuthError } from '@/lib/api-auth';

// GET: Fetch available scenarios for the caller's organization.
//
// SECURITY (Phase A audit fix, 2026-04-26): the previous implementation
// accepted `organizationId` as a query-string parameter with no auth
// check at all — any unauthenticated caller could read scenarios from
// any org by guessing the orgId. Now `requireAuth` resolves the orgId
// from the session; query-string `organizationId` is ignored.
export async function GET(request: NextRequest) {
  const session = await requireAuth(request);
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json({ error: 'User has no organization' }, { status: 403 });
  }

  try {
    const scenarios = await prisma.scenario.findMany({
      where: {
        organizationId: session.orgId,
        isActive: true,
      },
      orderBy: { createdAt: 'desc' }
    });

    return NextResponse.json(scenarios);
  } catch (error: any) {
    console.error('Error fetching scenarios:', error);
    return NextResponse.json({ error: 'Failed to fetch scenarios' }, { status: 500 });
  }
}

// POST: Apply a scenario (Trigger computation with overrides).
//
// SECURITY (Phase A audit fix, 2026-04-26): the previous implementation
// fetched the scenario via `findUnique({ where: { id } })` with no org
// scoping AND accepted `organizationId` from the body — letting any
// authenticated user trigger a scenario run against any other org's
// scenario by passing both ids. Now: orgId comes from the session;
// scenario lookup is tenant-scoped via `findFirst`.
//
// SECURITY (Phase A architect Round-2, 2026-04-26): tightened gate from
// `requireAuth` to `requireRole("editor")` — POST queues a compute run
// that consumes resources; viewers should not trigger arbitrary scenario
// execution. Mirror of `plans/route.ts:59` POST guard for write-class
// actions.
export async function POST(request: NextRequest) {
  const session = await requireRole(request, "editor");
  if (isAuthError(session)) return session;
  if (!session.orgId) {
    return NextResponse.json({ error: 'User has no organization' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { scenarioId, period } = body;

    if (!scenarioId || !period) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const scenario = await prisma.scenario.findFirst({
      where: { id: scenarioId, organizationId: session.orgId }
    });

    if (!scenario) {
      // 404 (not 403) on cross-tenant id — don't leak existence in another org.
      return NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
    }

    // Here we would push a job to the queue, passing the scenario.overrides
    // For now, return accepted status.
    console.log(`[Queue] Added scenario ${scenario.code} run for org ${session.orgId}`);

    return NextResponse.json({
      message: 'Scenario execution queued',
      scenarioCode: scenario.code,
      overrides: scenario.overrides
    }, { status: 202 });
  } catch (error: any) {
    console.error('Error applying scenario:', error);
    return NextResponse.json({ error: 'Failed to apply scenario' }, { status: 500 });
  }
}
